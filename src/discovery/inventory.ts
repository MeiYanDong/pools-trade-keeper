import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { ADDRESSES } from "../chain/addresses.js";
import { compoundingClaimRecipientAbi } from "../chain/abis.js";
import { positionManagerAbi } from "../chain/abis.js";
import type { KeeperPublicClient } from "../chain/client.js";
import { stringifyJson } from "../evidence/json.js";

const decimalString = z.string().regex(/^\d+$/);

export const inventoryFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    contract: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    scannedFromBlock: decimalString,
    scannedToBlock: decimalString,
    amountEventCount: z.number().int().nonnegative(),
    claimEventCount: z.number().int().nonnegative(),
    positionTransferEventCount: z.number().int().nonnegative(),
    tokenIds: z.array(decimalString),
    writtenAt: z.iso.datetime(),
  })
  .superRefine((inventory, context) => {
    if (BigInt(inventory.scannedFromBlock) > BigInt(inventory.scannedToBlock)) {
      context.addIssue({
        code: "custom",
        path: ["scannedToBlock"],
        message: "scannedToBlock must not be below scannedFromBlock",
      });
    }
  });

export type InventoryFile = z.infer<typeof inventoryFileSchema>;

async function getLogsAdaptive<T>(input: {
  fromBlock: bigint;
  toBlock: bigint;
  fetch: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>;
}): Promise<T[]> {
  try {
    return await input.fetch(input.fromBlock, input.toBlock);
  } catch (error) {
    if (input.fromBlock >= input.toBlock) throw error;
    const middle = (input.fromBlock + input.toBlock) / 2n;
    const left = await getLogsAdaptive({
      fromBlock: input.fromBlock,
      toBlock: middle,
      fetch: input.fetch,
    });
    const right = await getLogsAdaptive({
      fromBlock: middle + 1n,
      toBlock: input.toBlock,
      fetch: input.fetch,
    });
    return [...left, ...right];
  }
}

export async function backfillInventory(input: {
  client: KeeperPublicClient;
  dataDir: string;
  fromBlock: bigint;
  toBlock?: bigint;
  chunkBlocks: bigint;
  baseInventory?: InventoryFile;
  onProgress?: (progress: { fromBlock: bigint; toBlock: bigint; tokenIds: number }) => void;
}): Promise<InventoryFile> {
  if (input.chunkBlocks <= 0n) throw new Error("chunkBlocks must be positive");
  const finalBlock = input.toBlock ?? (await input.client.getBlockNumber());
  if (input.fromBlock > finalBlock) throw new Error("fromBlock is above the current block");
  if (input.baseInventory && input.fromBlock !== BigInt(input.baseInventory.scannedToBlock) + 1n) {
    throw new Error("base inventory must resume at scannedToBlock + 1 without a gap or overlap");
  }

  const tokenIds = new Set<string>(input.baseInventory?.tokenIds ?? []);
  let amountEventCount = input.baseInventory?.amountEventCount ?? 0;
  let claimEventCount = input.baseInventory?.claimEventCount ?? 0;
  let positionTransferEventCount = input.baseInventory?.positionTransferEventCount ?? 0;
  for (let start = input.fromBlock; start <= finalBlock; start += input.chunkBlocks) {
    const end =
      start + input.chunkBlocks - 1n > finalBlock ? finalBlock : start + input.chunkBlocks - 1n;
    const [amountLogs, claimLogs, creatorPositionLogs, noCreatorPositionLogs] = await Promise.all([
      getLogsAdaptive({
        fromBlock: start,
        toBlock: end,
        fetch: (fromBlock, toBlock) =>
          input.client.getLogs({
            address: ADDRESSES.compoundingClaimRecipient,
            event: compoundingClaimRecipientAbi[3],
            fromBlock,
            toBlock,
          }),
      }),
      getLogsAdaptive({
        fromBlock: start,
        toBlock: end,
        fetch: (fromBlock, toBlock) =>
          input.client.getLogs({
            address: ADDRESSES.compoundingClaimRecipient,
            event: compoundingClaimRecipientAbi[4],
            fromBlock,
            toBlock,
          }),
      }),
      getLogsAdaptive({
        fromBlock: start,
        toBlock: end,
        fetch: (fromBlock, toBlock) =>
          input.client.getLogs({
            address: ADDRESSES.positionManager,
            event: positionManagerAbi[3],
            args: { to: ADDRESSES.creatorFeeSplitter },
            fromBlock,
            toBlock,
          }),
      }),
      getLogsAdaptive({
        fromBlock: start,
        toBlock: end,
        fetch: (fromBlock, toBlock) =>
          input.client.getLogs({
            address: ADDRESSES.positionManager,
            event: positionManagerAbi[3],
            args: { to: ADDRESSES.noCreatorFeeSplitter },
            fromBlock,
            toBlock,
          }),
      }),
    ]);
    amountEventCount += amountLogs.length;
    claimEventCount += claimLogs.length;
    positionTransferEventCount += creatorPositionLogs.length + noCreatorPositionLogs.length;
    for (const log of amountLogs) {
      if (log.args.tokenId !== undefined) tokenIds.add(log.args.tokenId.toString());
    }
    for (const log of claimLogs) {
      if (log.args.tokenId !== undefined) tokenIds.add(log.args.tokenId.toString());
    }
    for (const log of [...creatorPositionLogs, ...noCreatorPositionLogs]) {
      if (log.args.tokenId !== undefined) tokenIds.add(log.args.tokenId.toString());
    }
    input.onProgress?.({ fromBlock: start, toBlock: end, tokenIds: tokenIds.size });
  }

  const inventory: InventoryFile = {
    schemaVersion: 1,
    contract: ADDRESSES.compoundingClaimRecipient,
    scannedFromBlock: input.baseInventory?.scannedFromBlock ?? input.fromBlock.toString(),
    scannedToBlock: finalBlock.toString(),
    amountEventCount,
    claimEventCount,
    positionTransferEventCount,
    tokenIds: [...tokenIds].sort((a, b) => {
      const left = BigInt(a);
      const right = BigInt(b);
      return left < right ? -1 : left > right ? 1 : 0;
    }),
    writtenAt: new Date().toISOString(),
  };
  await writeInventory(input.dataDir, inventory);
  return inventory;
}

export async function extendInventory(input: {
  client: KeeperPublicClient;
  dataDir: string;
  chunkBlocks: bigint;
}): Promise<InventoryFile> {
  const existing = await readInventory(input.dataDir);
  const latest = await input.client.getBlockNumber();
  const next = BigInt(existing.scannedToBlock) + 1n;
  if (next > latest) return existing;
  return backfillInventory({
    client: input.client,
    dataDir: input.dataDir,
    fromBlock: next,
    toBlock: latest,
    chunkBlocks: input.chunkBlocks,
    baseInventory: existing,
  });
}

export async function writeInventory(dataDir: string, inventory: InventoryFile): Promise<void> {
  const validated = inventoryFileSchema.parse(inventory);
  const path = join(dataDir, "inventory.json");
  const temporary = `${path}.tmp-${process.pid}`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(temporary, `${stringifyJson(validated)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export async function readInventory(dataDir: string): Promise<InventoryFile> {
  const raw = await readFile(join(dataDir, "inventory.json"), "utf8");
  return inventoryFileSchema.parse(JSON.parse(raw));
}
