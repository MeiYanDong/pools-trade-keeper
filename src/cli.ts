import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ADDRESSES, CHAIN_ID, REQUIRED_LIQUIDITY_INCREASE } from "./chain/addresses.js";
import { compoundingClaimRecipientAbi, positionManagerAbi } from "./chain/abis.js";
import { createKeeperPublicClient } from "./chain/client.js";
import { loadRuntimeConfig, redactUrl, type RuntimeConfig } from "./config.js";
import { assessAuthorization } from "./decision/authorization.js";
import { assessSnapshot } from "./decision/economics.js";
import { backfillInventory, extendInventory, readInventory } from "./discovery/inventory.js";
import {
  readRoundRobinCursor,
  selectRoundRobin,
  writeRoundRobinCursor,
} from "./discovery/round-robin.js";
import { EvidenceLedger } from "./evidence/ledger.js";
import { stringifyJson } from "./evidence/json.js";
import { readPositionSnapshot } from "./protocol/snapshot.js";
import { runBulkShadow } from "./protocol/bulk-shadow.js";
import {
  HISTORICAL_EXECUTOR_GAS_UNITS,
  quoteNativeToTokenRebalance,
} from "./protocol/rebalance-quote.js";
import { loadPrivateEnvFile } from "./private-env.js";
import { replayHistoricalFixtures } from "./replay.js";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function tokenIdOption(): bigint {
  const raw = option("--token-id");
  if (!raw || !/^\d+$/.test(raw)) throw new Error("--token-id <non-negative integer> is required");
  return BigInt(raw);
}

function blockOption(): bigint | undefined {
  const raw = option("--block");
  if (!raw) return undefined;
  if (!/^\d+$/.test(raw)) throw new Error("--block must be a non-negative integer");
  return BigInt(raw);
}

function nonNegativeIntegerOption(name: string): number | undefined {
  const raw = option(name);
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return Number(raw);
}

function printJson(value: unknown): void {
  process.stdout.write(`${stringifyJson(value)}\n`);
}

function safeErrorMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const raw of [process.env.RPC_HTTP_URL, process.env.RPC_WSS_URL]) {
    if (raw) message = message.split(raw).join(redactUrl(raw) ?? "<redacted-rpc>");
  }
  return message;
}

async function doctor(config: RuntimeConfig): Promise<void> {
  const client = createKeeperPublicClient(config);
  const observedAtBlock = await client.getBlockNumber();
  const actualChainId = await client.getChainId();
  const contractEntries = Object.entries({
    compoundingClaimRecipient: ADDRESSES.compoundingClaimRecipient,
    creatorFeeSplitter: ADDRESSES.creatorFeeSplitter,
    noCreatorFeeSplitter: ADDRESSES.noCreatorFeeSplitter,
    positionManager: ADDRESSES.positionManager,
    stateView: ADDRESSES.stateView,
    multicall3: ADDRESSES.multicall3,
  });
  const codeChecks = await Promise.all(
    contractEntries.map(async ([name, address]) => ({
      name,
      address,
      codePresent:
        ((await client.getBytecode({ address, blockNumber: observedAtBlock }))?.length ?? 0) > 2,
    })),
  );
  const [minLiquidityIncrease, positionManager] = await Promise.all([
    client.readContract({
      address: ADDRESSES.compoundingClaimRecipient,
      abi: compoundingClaimRecipientAbi,
      functionName: "minLiquidityIncrease",
      blockNumber: observedAtBlock,
    }),
    client.readContract({
      address: ADDRESSES.compoundingClaimRecipient,
      abi: compoundingClaimRecipientAbi,
      functionName: "positionManager",
      blockNumber: observedAtBlock,
    }),
  ]);
  const checks = {
    chainIdMatches: actualChainId === CHAIN_ID && actualChainId === config.chainId,
    allCodePresent: codeChecks.every((entry) => entry.codePresent),
    minLiquidityMatches: minLiquidityIncrease === REQUIRED_LIQUIDITY_INCREASE,
    positionManagerMatches:
      positionManager.toLowerCase() === ADDRESSES.positionManager.toLowerCase(),
  };
  printJson({
    status: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
    mode: "READ_ONLY",
    observedAtBlock,
    rpc: {
      http: redactUrl(config.rpcHttpUrl),
      wss: redactUrl(config.rpcWssUrl),
    },
    actualChainId,
    checks,
    codeChecks,
    bindings: { minLiquidityIncrease, positionManager },
    authorization: assessAuthorization(config),
  });
  if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
}

async function snapshotCommand(config: RuntimeConfig): Promise<void> {
  const client = createKeeperPublicClient(config);
  const snapshot = await readPositionSnapshot(client, tokenIdOption(), blockOption());
  const assessment = assessSnapshot(snapshot, {
    estimatedSuccessGasNative: config.maxGasNativeWei,
    competitionBufferNative: 0n,
    exitHaircutBps: 0,
    minimumShadowProfitNative: config.minNetProfitNativeWei,
  });
  const result = { snapshot, assessment };
  await new EvidenceLedger(config.dataDir).append({
    schemaVersion: 1,
    kind: "position_snapshot",
    observedAt: new Date().toISOString(),
    chainId: config.chainId,
    payload: result,
  });
  printJson(result);
}

async function quoteCandidateCommand(config: RuntimeConfig): Promise<void> {
  const client = createKeeperPublicClient(config);
  const snapshot = await readPositionSnapshot(client, tokenIdOption(), blockOption());
  const rawGasUnits = option("--executor-gas-units") ?? HISTORICAL_EXECUTOR_GAS_UNITS.toString();
  if (!/^\d+$/.test(rawGasUnits))
    throw new Error("--executor-gas-units must be a non-negative integer");
  const gasPriceWei = await client.getGasPrice();
  const quote = await quoteNativeToTokenRebalance({
    client,
    snapshot,
    gasPriceWei,
    modeledExecutorGasUnits: BigInt(rawGasUnits),
  });
  await new EvidenceLedger(config.dataDir).append({
    schemaVersion: 1,
    kind: "candidate_rebalance_quote",
    observedAt: new Date().toISOString(),
    chainId: config.chainId,
    payload: quote,
  });
  printJson({
    quote,
    evidenceBoundary: {
      quote: "deployed V4Quoter exact-output eth_call at snapshot block",
      gasPrice: "latest RPC gas price observed after snapshot",
      modeledExecutorGasUnits:
        "historical successful receipt baseline; not an exact callback estimate",
    },
  });
}

async function backfillCommand(config: RuntimeConfig): Promise<void> {
  let chunks = 0;
  const inventory = await backfillInventory({
    client: createKeeperPublicClient(config),
    dataDir: config.dataDir,
    fromBlock: config.backfillFromBlock,
    chunkBlocks: config.eventChunkBlocks,
    onProgress: (progress) => {
      chunks += 1;
      if (chunks % 50 === 0) {
        process.stderr.write(
          `scanned through block ${progress.toBlock}; tokenIds=${progress.tokenIds}\n`,
        );
      }
    },
  });
  printJson(inventory);
}

async function deploymentBlockCommand(config: RuntimeConfig): Promise<void> {
  const client = createKeeperPublicClient(config);
  let low = 0n;
  let high = await client.getBlockNumber();
  const latestCode = await client.getBytecode({
    address: ADDRESSES.compoundingClaimRecipient,
    blockNumber: high,
  });
  if (!latestCode || latestCode === "0x") throw new Error("recipient has no code at latest block");
  try {
    while (low < high) {
      const middle = (low + high) / 2n;
      const code = await client.getBytecode({
        address: ADDRESSES.compoundingClaimRecipient,
        blockNumber: middle,
      });
      if (code && code !== "0x") high = middle;
      else low = middle + 1n;
    }
  } catch {
    printJson({
      status: "UNKNOWN",
      address: ADDRESSES.compoundingClaimRecipient,
      reason:
        "RPC does not expose the historical state required to binary-search the deployment block",
      rpc: redactUrl(config.rpcHttpUrl),
    });
    process.exitCode = 2;
    return;
  }
  printJson({
    status: "VERIFIED_BY_HISTORICAL_ETH_GET_CODE",
    address: ADDRESSES.compoundingClaimRecipient,
    firstCodeBlock: low,
    rpc: redactUrl(config.rpcHttpUrl),
  });
}

async function inventoryStartCommand(config: RuntimeConfig): Promise<void> {
  const rawProbe = option("--probe-blocks") ?? "1000000";
  if (!/^\d+$/.test(rawProbe) || BigInt(rawProbe) <= 0n) {
    throw new Error("--probe-blocks must be a positive integer");
  }
  const probeBlocks = BigInt(rawProbe);
  const client = createKeeperPublicClient(config);
  const latest = await client.getBlockNumber();
  for (let start = 0n; start <= latest; start += probeBlocks) {
    const end = start + probeBlocks - 1n > latest ? latest : start + probeBlocks - 1n;
    const [amounts, claims, creatorTransfers, noCreatorTransfers] = await Promise.all([
      client.getLogs({
        address: ADDRESSES.compoundingClaimRecipient,
        event: compoundingClaimRecipientAbi[3],
        fromBlock: start,
        toBlock: end,
      }),
      client.getLogs({
        address: ADDRESSES.compoundingClaimRecipient,
        event: compoundingClaimRecipientAbi[4],
        fromBlock: start,
        toBlock: end,
      }),
      client.getLogs({
        address: ADDRESSES.positionManager,
        event: positionManagerAbi[3],
        args: { to: ADDRESSES.creatorFeeSplitter },
        fromBlock: start,
        toBlock: end,
      }),
      client.getLogs({
        address: ADDRESSES.positionManager,
        event: positionManagerAbi[3],
        args: { to: ADDRESSES.noCreatorFeeSplitter },
        fromBlock: start,
        toBlock: end,
      }),
    ]);
    const observations = [
      ...amounts.map((log) => ({ kind: "AmountsReceived", blockNumber: log.blockNumber })),
      ...claims.map((log) => ({ kind: "Claimed", blockNumber: log.blockNumber })),
      ...creatorTransfers.map((log) => ({
        kind: "CreatorFeeSplitterTransfer",
        blockNumber: log.blockNumber,
      })),
      ...noCreatorTransfers.map((log) => ({
        kind: "NoCreatorFeeSplitterTransfer",
        blockNumber: log.blockNumber,
      })),
    ].filter((entry): entry is { kind: string; blockNumber: bigint } => entry.blockNumber !== null);
    observations.sort((left, right) => (left.blockNumber < right.blockNumber ? -1 : 1));
    const earliest = observations[0];
    if (earliest) {
      const recommended = earliest.blockNumber > 1_000n ? earliest.blockNumber - 1_000n : 0n;
      printJson({
        status: "EARLIEST_RELEVANT_EVENT_FOUND",
        earliest,
        recommendedBackfillFromBlock: recommended,
        probeWindow: { start, end, probeBlocks },
        caveat:
          "earliest relevant event is not the contract deployment block; a 1000-block safety margin is applied",
      });
      return;
    }
    process.stderr.write(`no relevant events through block ${end}\n`);
  }
  printJson({ status: "UNKNOWN", reason: "no relevant events found through latest block", latest });
  process.exitCode = 2;
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  const entries = values.entries();
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      for (const [index, value] of entries) {
        results[index] = await worker(value);
      }
    }),
  );
  return results;
}

async function shadowOnce(config: RuntimeConfig) {
  const explicit = option("--token-id");
  let nextCursor: number | null = null;
  let ids: bigint[];
  if (explicit) {
    ids = [BigInt(explicit)];
  } else {
    const inventory = await readInventory(config.dataDir);
    const cursor = await readRoundRobinCursor(config.dataDir);
    const selection = selectRoundRobin(inventory.tokenIds, cursor, config.shadowMaxPositions);
    ids = selection.selected.map(BigInt);
    nextCursor = selection.nextIndex;
  }
  const client = createKeeperPublicClient(config);
  const fixedBlock = await client.getBlockNumber();
  const ledger = new EvidenceLedger(config.dataDir);
  let batchGasPrice: Promise<bigint> | undefined;
  const results = await mapConcurrent(ids, config.shadowConcurrency, async (tokenId) => {
    try {
      const snapshot = await readPositionSnapshot(client, tokenId, fixedBlock);
      const assessment = assessSnapshot(snapshot, {
        estimatedSuccessGasNative: config.maxGasNativeWei,
        competitionBufferNative: 0n,
        exitHaircutBps: 0,
        minimumShadowProfitNative: config.minNetProfitNativeWei,
      });
      let rebalanceQuote: Awaited<ReturnType<typeof quoteNativeToTokenRebalance>> | undefined;
      let quoteError: string | undefined;
      if (assessment.classification === "SHADOW_CANDIDATE") {
        try {
          batchGasPrice ??= client.getGasPrice();
          rebalanceQuote = await quoteNativeToTokenRebalance({
            client,
            snapshot,
            gasPriceWei: await batchGasPrice,
          });
        } catch (error) {
          quoteError = error instanceof Error ? error.message : String(error);
        }
      }
      const result = {
        tokenId,
        status: "OBSERVED",
        assessment,
        snapshot,
        ...(rebalanceQuote === undefined ? {} : { rebalanceQuote }),
        ...(quoteError === undefined ? {} : { quoteError }),
      };
      if (assessment.classification === "SHADOW_CANDIDATE") {
        await ledger.append({
          schemaVersion: 1,
          kind: "shadow_spot_candidate",
          observedAt: new Date().toISOString(),
          chainId: config.chainId,
          payload: result,
        });
      }
      return result;
    } catch (error) {
      const result = {
        tokenId,
        status: "UNKNOWN",
        reason: error instanceof Error ? error.message : String(error),
      };
      await ledger.append({
        schemaVersion: 1,
        kind: "shadow_error",
        observedAt: new Date().toISOString(),
        chainId: config.chainId,
        payload: result,
      });
      return result;
    }
  });
  if (nextCursor !== null) await writeRoundRobinCursor(config.dataDir, nextCursor);
  const run = {
    mode: "shadow",
    fixedBlock,
    count: results.length,
    nextCursor,
    spotCandidates: results.filter(
      (result) => "assessment" in result && result.assessment.classification === "SHADOW_CANDIDATE",
    ).length,
    candidates: results.filter(
      (result) =>
        "rebalanceQuote" in result && result.rebalanceQuote?.classification === "QUOTE_CANDIDATE",
    ).length,
    shots: 0,
    authorization: assessAuthorization(config),
    results,
  };
  const classifications: Record<string, number> = {};
  let errors = 0;
  for (const result of results) {
    if ("assessment" in result) {
      const key = result.assessment.classification;
      classifications[key] = (classifications[key] ?? 0) + 1;
    } else {
      errors += 1;
    }
  }
  await ledger.append({
    schemaVersion: 1,
    kind: "shadow_batch_summary",
    observedAt: new Date().toISOString(),
    chainId: config.chainId,
    payload: {
      fixedBlock,
      count: results.length,
      nextCursor,
      candidates: run.candidates,
      spotCandidates: run.spotCandidates,
      errors,
      classifications,
      tokenIds: ids,
      shots: 0,
    },
  });
  return run;
}

function compactShadow(run: Awaited<ReturnType<typeof shadowOnce>>, dataDir: string): unknown {
  const classifications: Record<string, number> = {};
  let errors = 0;
  for (const result of run.results) {
    if ("assessment" in result) {
      const key = result.assessment.classification;
      classifications[key] = (classifications[key] ?? 0) + 1;
    } else {
      errors += 1;
    }
  }
  return {
    mode: run.mode,
    fixedBlock: run.fixedBlock,
    count: run.count,
    candidates: run.candidates,
    spotCandidates: run.spotCandidates,
    shots: run.shots,
    errors,
    classifications,
    authorization: run.authorization,
    detailStore: join(dataDir, "evidence.jsonl"),
  };
}

async function shadowCommand(config: RuntimeConfig): Promise<void> {
  const client = createKeeperPublicClient(config);
  const shouldSync = process.argv.includes("--sync") || process.argv.includes("--watch");
  if (shouldSync) {
    await extendInventory({
      client,
      dataDir: config.dataDir,
      chunkBlocks: config.eventChunkBlocks,
    });
  }
  if (!process.argv.includes("--watch")) {
    const run = await shadowOnce(config);
    printJson(process.argv.includes("--verbose") ? run : compactShadow(run, config.dataDir));
    return;
  }
  const intervalMs = Number(process.env.SHADOW_INTERVAL_MS ?? "15000");
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1000) {
    throw new Error("SHADOW_INTERVAL_MS must be an integer >= 1000");
  }
  for (;;) {
    await extendInventory({
      client,
      dataDir: config.dataDir,
      chunkBlocks: config.eventChunkBlocks,
    });
    const run = await shadowOnce(config);
    printJson(process.argv.includes("--verbose") ? run : compactShadow(run, config.dataDir));
    await new Promise((resolveDelay) => setTimeout(resolveDelay, intervalMs));
  }
}

async function bulkShadowCommand(config: RuntimeConfig): Promise<void> {
  const inventory = await readInventory(config.dataDir);
  const offset = nonNegativeIntegerOption("--offset") ?? 0;
  const limit = nonNegativeIntegerOption("--limit");
  if (offset >= inventory.tokenIds.length) {
    throw new Error(`--offset ${offset} is outside inventory size ${inventory.tokenIds.length}`);
  }
  if (limit === 0) throw new Error("--limit must be greater than zero");
  const tokenIds = inventory.tokenIds.slice(
    offset,
    limit === undefined ? undefined : offset + limit,
  );
  const fixedBlock = blockOption();
  const summary = await runBulkShadow({
    client: createKeeperPublicClient(config),
    tokenIds,
    inventoryTotal: inventory.tokenIds.length,
    inventoryOffset: offset,
    ...(fixedBlock === undefined ? {} : { fixedBlock }),
    dataDir: config.dataDir,
    tokenChunk: config.bulkTokenChunk,
    onProgress: (message) => process.stderr.write(`${message}\n`),
  });
  printJson({
    ...summary,
    authorization: assessAuthorization(config),
    caveat:
      "POSITIVE_AT_SPOT is only a research candidate; no executable exit, callback simulation, gas, race cost, signing or broadcast is implied",
  });
}

async function replayCommand(): Promise<void> {
  const results = await replayHistoricalFixtures(
    pathToFileURL(resolve("fixtures/historical-claims.json")),
  );
  printJson({
    status: results.every((result) => result.passed) ? "PASS" : "FAIL",
    results,
  });
  if (results.some((result) => !result.passed)) process.exitCode = 1;
}

async function capabilitiesCommand(): Promise<void> {
  printJson(JSON.parse(await readFile(resolve("docs/capability-manifest.json"), "utf8")));
}

const command = process.argv[2];
try {
  await loadPrivateEnvFile();
  if (command === "replay") await replayCommand();
  else if (command === "capabilities") await capabilitiesCommand();
  else {
    const config = loadRuntimeConfig();
    if (command === "doctor") await doctor(config);
    else if (command === "snapshot") await snapshotCommand(config);
    else if (command === "quote-candidate") await quoteCandidateCommand(config);
    else if (command === "backfill") await backfillCommand(config);
    else if (command === "deployment-block") await deploymentBlockCommand(config);
    else if (command === "inventory-start") await inventoryStartCommand(config);
    else if (command === "shadow") await shadowCommand(config);
    else if (command === "bulk-shadow") await bulkShadowCommand(config);
    else
      throw new Error(
        "usage: cli.ts <doctor|deployment-block|inventory-start|snapshot|quote-candidate|backfill|shadow|bulk-shadow|replay|capabilities>",
      );
  }
} catch (error) {
  process.stderr.write(`${safeErrorMessage(error)}\n`);
  process.exitCode = 1;
}
