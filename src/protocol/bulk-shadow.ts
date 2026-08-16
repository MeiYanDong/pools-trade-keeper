import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAddress, toHex, type Address } from "viem";
import { ADDRESSES, REQUIRED_LIQUIDITY_INCREASE } from "../chain/addresses.js";
import {
  compoundingClaimRecipientAbi,
  feeSplitterAbi,
  positionManagerAbi,
  stateViewAbi,
} from "../chain/abis.js";
import type { KeeperPublicClient } from "../chain/client.js";
import type { PoolKey } from "../domain.js";
import { stringifyJson } from "../evidence/json.js";
import {
  accruedFeesFromGrowth,
  requiredAmountsForLiquidity,
  token1ToToken0Spot,
} from "./liquidity-math.js";
import { poolIdOf } from "./pool-id.js";
import { decodePositionTicks } from "./position-info.js";

interface RawPoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

interface FeeSplit {
  recipient: Address;
  nativeBps: number;
  tokenBps: number;
  useCallback: boolean;
}

type LooseCallResult =
  | { status: "success"; result: unknown }
  | { status: "failure"; error: unknown };

interface Seed {
  tokenId: bigint;
  claimable0: bigint;
  claimable1: bigint;
  poolKey: PoolKey;
  poolId: `0x${string}`;
  tickLower: number;
  tickUpper: number;
  owner: Address;
  split: FeeSplit;
}

export interface BulkShadowRow {
  tokenId: bigint;
  status: "POSITIVE_AT_SPOT" | "ZERO_AT_SPOT" | "NEGATIVE_AT_SPOT" | "STALE_POSITION" | "UNKNOWN";
  reason?: string;
  currency1?: Address;
  feeSplitter?: Address;
  claimable0?: bigint;
  claimable1?: bigint;
  pendingAllocated0?: bigint;
  pendingAllocated1?: bigint;
  projectedClaimable0?: bigint;
  projectedClaimable1?: bigint;
  required0?: bigint;
  required1?: bigint;
  grossSpotNative?: bigint;
}

export interface BulkShadowSummary {
  mode: "shadow";
  fixedBlock: bigint;
  inventoryTotal: number;
  inventoryOffset: number;
  inventorySize: number;
  evaluated: number;
  positiveAtSpot: number;
  zeroAtSpot: number;
  negativeAtSpot: number;
  stalePositions: number;
  unknown: number;
  shots: 0;
  durationMs: number;
  rowsPath: string;
  candidatesPath: string;
  topCandidates: BulkShadowRow[];
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

function successful<T>(result: LooseCallResult | undefined): T | null {
  return result?.status === "success" ? (result.result as T) : null;
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, path);
}

async function resilientMulticall(
  operation: () => Promise<readonly LooseCallResult[]>,
  label: string,
  onProgress?: (message: string) => void,
): Promise<readonly LooseCallResult[]> {
  const retryDelaysMs = [2_000, 5_000, 15_000, 30_000];
  let latest: readonly LooseCallResult[] = [];
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    latest = await operation();
    const failures = latest.filter((result) => result.status === "failure").length;
    const systemicFailure = latest.length > 0 && failures / latest.length >= 0.9;
    if (!systemicFailure) return latest;
    const delayMs = retryDelaysMs[attempt];
    if (delayMs === undefined) return latest;
    onProgress?.(
      `${label} systemic inner-call failure ${failures}/${latest.length}; retrying after ${delayMs}ms`,
    );
    await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
  }
  return latest;
}

export async function runBulkShadow(input: {
  client: KeeperPublicClient;
  tokenIds: readonly string[];
  inventoryTotal?: number;
  inventoryOffset?: number;
  fixedBlock?: bigint;
  dataDir: string;
  tokenChunk: number;
  onProgress?: (message: string) => void;
}): Promise<BulkShadowSummary> {
  if (!Number.isSafeInteger(input.tokenChunk) || input.tokenChunk <= 0) {
    throw new Error("tokenChunk must be a positive safe integer");
  }
  if (input.tokenIds.length === 0) throw new Error("tokenIds must not be empty");
  const startedAt = Date.now();
  const fixedBlock = input.fixedBlock ?? (await input.client.getBlockNumber());
  const [creatorSplits, noCreatorSplits] = await Promise.all([
    input.client.readContract({
      address: ADDRESSES.creatorFeeSplitter,
      abi: feeSplitterAbi,
      functionName: "getSplits",
      blockNumber: fixedBlock,
    }),
    input.client.readContract({
      address: ADDRESSES.noCreatorFeeSplitter,
      abi: feeSplitterAbi,
      functionName: "getSplits",
      blockNumber: fixedBlock,
    }),
  ]);
  const splitByOwner = new Map<string, FeeSplit>();
  for (const [owner, splits] of [
    [ADDRESSES.creatorFeeSplitter, creatorSplits],
    [ADDRESSES.noCreatorFeeSplitter, noCreatorSplits],
  ] as const) {
    const split = splits.find(
      (candidate) =>
        candidate.recipient.toLowerCase() === ADDRESSES.compoundingClaimRecipient.toLowerCase(),
    );
    if (split)
      splitByOwner.set(owner.toLowerCase(), {
        recipient: getAddress(split.recipient),
        nativeBps: Number(split.nativeBps),
        tokenBps: Number(split.tokenBps),
        useCallback: split.useCallback,
      });
  }

  const rows: BulkShadowRow[] = [];
  const seeds: Seed[] = [];
  const tokenChunks = chunks(input.tokenIds, input.tokenChunk);
  for (const [chunkIndex, tokenChunk] of tokenChunks.entries()) {
    const ids = tokenChunk.map(BigInt);
    const contracts = ids.flatMap((tokenId) => [
      {
        address: ADDRESSES.compoundingClaimRecipient,
        abi: compoundingClaimRecipientAbi,
        functionName: "amounts",
        args: [tokenId],
      } as const,
      {
        address: ADDRESSES.positionManager,
        abi: positionManagerAbi,
        functionName: "getPoolAndPositionInfo",
        args: [tokenId],
      } as const,
      {
        address: ADDRESSES.positionManager,
        abi: positionManagerAbi,
        functionName: "ownerOf",
        args: [tokenId],
      } as const,
    ]);
    const results = await resilientMulticall(
      async () =>
        (await input.client.multicall({
          contracts,
          allowFailure: true,
          blockNumber: fixedBlock,
          batchSize: 0,
        })) as readonly LooseCallResult[],
      `phase1 chunk ${chunkIndex + 1}/${tokenChunks.length}`,
      input.onProgress,
    );
    for (const [index, tokenId] of ids.entries()) {
      const base = index * 3;
      const amounts = successful<readonly [bigint, bigint]>(results[base]);
      const position = successful<readonly [RawPoolKey, bigint]>(results[base + 1]);
      const owner = successful<Address>(results[base + 2]);
      if (!amounts || !position || !owner) {
        rows.push({ tokenId, status: "UNKNOWN", reason: "phase1_multicall_failure" });
        continue;
      }
      const split = splitByOwner.get(owner.toLowerCase());
      if (!split) {
        rows.push({
          tokenId,
          status: "STALE_POSITION",
          reason: "position_not_owned_by_configured_fee_splitter",
        });
        continue;
      }
      const [rawPoolKey, packedInfo] = position;
      const poolKey: PoolKey = {
        currency0: getAddress(rawPoolKey.currency0),
        currency1: getAddress(rawPoolKey.currency1),
        fee: Number(rawPoolKey.fee),
        tickSpacing: Number(rawPoolKey.tickSpacing),
        hooks: getAddress(rawPoolKey.hooks),
      };
      if (poolKey.currency0.toLowerCase() !== ADDRESSES.native.toLowerCase()) {
        rows.push({ tokenId, status: "UNKNOWN", reason: "currency0_not_native" });
        continue;
      }
      const { tickLower, tickUpper } = decodePositionTicks(packedInfo);
      seeds.push({
        tokenId,
        claimable0: amounts[0],
        claimable1: amounts[1],
        poolKey,
        poolId: poolIdOf(poolKey),
        tickLower,
        tickUpper,
        owner: getAddress(owner),
        split,
      });
    }
    if ((chunkIndex + 1) % 10 === 0 || chunkIndex + 1 === tokenChunks.length) {
      input.onProgress?.(
        `phase1 ${chunkIndex + 1}/${tokenChunks.length}; seeds=${seeds.length}; terminal=${rows.length}`,
      );
    }
  }

  const phase1Unknown = rows.filter((row) => row.status === "UNKNOWN").length;
  const maximumToleratedUnknown = Math.max(10, Math.ceil(input.tokenIds.length * 0.05));
  if (phase1Unknown > maximumToleratedUnknown) {
    throw new Error(
      `bulk_phase1_failure_rate: ${phase1Unknown}/${input.tokenIds.length} unknown; reduce BULK_TOKEN_CHUNK or retry the fixed-block scan`,
    );
  }

  const seedChunks = chunks(seeds, input.tokenChunk);
  for (const [chunkIndex, currentSeeds] of seedChunks.entries()) {
    const contracts = currentSeeds.flatMap((seed) => [
      {
        address: ADDRESSES.stateView,
        abi: stateViewAbi,
        functionName: "getSlot0",
        args: [seed.poolId],
      } as const,
      {
        address: ADDRESSES.stateView,
        abi: stateViewAbi,
        functionName: "getPositionInfo",
        args: [
          seed.poolId,
          ADDRESSES.positionManager,
          seed.tickLower,
          seed.tickUpper,
          toHex(seed.tokenId, { size: 32 }),
        ],
      } as const,
      {
        address: ADDRESSES.stateView,
        abi: stateViewAbi,
        functionName: "getFeeGrowthInside",
        args: [seed.poolId, seed.tickLower, seed.tickUpper],
      } as const,
    ]);
    const results = await resilientMulticall(
      async () =>
        (await input.client.multicall({
          contracts,
          allowFailure: true,
          blockNumber: fixedBlock,
          batchSize: 0,
        })) as readonly LooseCallResult[],
      `phase2 chunk ${chunkIndex + 1}/${seedChunks.length}`,
      input.onProgress,
    );
    for (const [index, seed] of currentSeeds.entries()) {
      const base = index * 3;
      const slot0 = successful<readonly [bigint, number, number, number]>(results[base]);
      const positionInfo = successful<readonly [bigint, bigint, bigint]>(results[base + 1]);
      const currentGrowth = successful<readonly [bigint, bigint]>(results[base + 2]);
      if (!slot0 || !positionInfo || !currentGrowth) {
        rows.push({ tokenId: seed.tokenId, status: "UNKNOWN", reason: "phase2_multicall_failure" });
        continue;
      }
      const [sqrtPriceX96] = slot0;
      const [coreLiquidity, lastGrowth0, lastGrowth1] = positionInfo;
      const totalPending0 = accruedFeesFromGrowth({
        liquidity: coreLiquidity,
        currentFeeGrowthInsideX128: currentGrowth[0],
        lastFeeGrowthInsideX128: lastGrowth0,
      });
      const totalPending1 = accruedFeesFromGrowth({
        liquidity: coreLiquidity,
        currentFeeGrowthInsideX128: currentGrowth[1],
        lastFeeGrowthInsideX128: lastGrowth1,
      });
      const pendingAllocated0 = (totalPending0 * BigInt(seed.split.nativeBps)) / 10_000n;
      const pendingAllocated1 = (totalPending1 * BigInt(seed.split.tokenBps)) / 10_000n;
      const projectedClaimable0 = seed.claimable0 + pendingAllocated0;
      const projectedClaimable1 = seed.claimable1 + pendingAllocated1;
      const required = requiredAmountsForLiquidity({
        sqrtPriceX96,
        tickLower: seed.tickLower,
        tickUpper: seed.tickUpper,
        liquidity: REQUIRED_LIQUIDITY_INCREASE,
      });
      const projectedValue =
        projectedClaimable0 + token1ToToken0Spot(projectedClaimable1, sqrtPriceX96);
      const requiredValue = required.amount0 + token1ToToken0Spot(required.amount1, sqrtPriceX96);
      const grossSpotNative = projectedValue - requiredValue;
      rows.push({
        tokenId: seed.tokenId,
        status:
          grossSpotNative > 0n
            ? "POSITIVE_AT_SPOT"
            : grossSpotNative < 0n
              ? "NEGATIVE_AT_SPOT"
              : "ZERO_AT_SPOT",
        currency1: seed.poolKey.currency1,
        feeSplitter: seed.owner,
        claimable0: seed.claimable0,
        claimable1: seed.claimable1,
        pendingAllocated0,
        pendingAllocated1,
        projectedClaimable0,
        projectedClaimable1,
        required0: required.amount0,
        required1: required.amount1,
        grossSpotNative,
      });
    }
    if ((chunkIndex + 1) % 10 === 0 || chunkIndex + 1 === seedChunks.length) {
      input.onProgress?.(`phase2 ${chunkIndex + 1}/${seedChunks.length}; rows=${rows.length}`);
    }
  }

  const totalUnknown = rows.filter((row) => row.status === "UNKNOWN").length;
  if (totalUnknown > maximumToleratedUnknown) {
    throw new Error(
      `bulk_total_failure_rate: ${totalUnknown}/${input.tokenIds.length} unknown; scan result withheld instead of treating RPC failures as economic evidence`,
    );
  }

  rows.sort((left, right) => (left.tokenId < right.tokenId ? -1 : 1));
  const candidates = rows
    .filter((row) => row.status === "POSITIVE_AT_SPOT")
    .sort((left, right) => ((left.grossSpotNative ?? 0n) > (right.grossSpotNative ?? 0n) ? -1 : 1));
  await mkdir(input.dataDir, { recursive: true, mode: 0o700 });
  const inventoryTotal = input.inventoryTotal ?? input.tokenIds.length;
  const inventoryOffset = input.inventoryOffset ?? 0;
  const shardSuffix =
    inventoryOffset === 0 && inventoryTotal === input.tokenIds.length
      ? ""
      : `-offset-${inventoryOffset}-count-${input.tokenIds.length}`;
  const rowsPath = join(input.dataDir, `bulk-shadow-${fixedBlock}${shardSuffix}.jsonl`);
  const candidatesPath = join(input.dataDir, `bulk-candidates-${fixedBlock}${shardSuffix}.json`);
  await atomicWrite(rowsPath, `${rows.map((row) => stringifyJson(row, 0)).join("\n")}\n`);
  await atomicWrite(candidatesPath, `${stringifyJson(candidates)}\n`);
  const summary: BulkShadowSummary = {
    mode: "shadow",
    fixedBlock,
    inventoryTotal,
    inventoryOffset,
    inventorySize: input.tokenIds.length,
    evaluated: rows.filter((row) => row.status !== "UNKNOWN" && row.status !== "STALE_POSITION")
      .length,
    positiveAtSpot: candidates.length,
    zeroAtSpot: rows.filter((row) => row.status === "ZERO_AT_SPOT").length,
    negativeAtSpot: rows.filter((row) => row.status === "NEGATIVE_AT_SPOT").length,
    stalePositions: rows.filter((row) => row.status === "STALE_POSITION").length,
    unknown: rows.filter((row) => row.status === "UNKNOWN").length,
    shots: 0,
    durationMs: Date.now() - startedAt,
    rowsPath,
    candidatesPath,
    topCandidates: candidates.slice(0, 20),
  };
  await atomicWrite(
    join(input.dataDir, `bulk-summary${shardSuffix}.json`),
    `${stringifyJson(summary)}\n`,
  );
  return summary;
}
