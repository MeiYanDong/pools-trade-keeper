import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ADDRESSES } from "../src/chain/addresses.js";
import type { KeeperPublicClient } from "../src/chain/client.js";
import {
  backfillInventory,
  extendInventory,
  readInventory,
  type InventoryFile,
} from "../src/discovery/inventory.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pools-inventory-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("inventory backfill", () => {
  it("adaptively splits rejected log ranges and persists a gap-free, sorted inventory", async () => {
    const dataDir = await temporaryDirectory();
    const observedRanges: Array<readonly [bigint, bigint]> = [];
    const client = {
      getBlockNumber: async () => 13n,
      getLogs: async (request: {
        event: { name: string };
        fromBlock: bigint;
        toBlock: bigint;
        args?: { to?: string };
      }) => {
        observedRanges.push([request.fromBlock, request.toBlock]);
        if (request.toBlock - request.fromBlock > 1n) throw new Error("provider range limit");
        const offset =
          request.event.name === "AmountsReceived"
            ? 0n
            : request.event.name === "Claimed"
              ? 100n
              : request.args?.to?.toLowerCase() === ADDRESSES.creatorFeeSplitter.toLowerCase()
                ? 200n
                : 300n;
        return [{ args: { tokenId: request.fromBlock + offset } }];
      },
    } as unknown as KeeperPublicClient;

    const inventory = await backfillInventory({
      client,
      dataDir,
      fromBlock: 10n,
      chunkBlocks: 4n,
    });

    expect(observedRanges).toContainEqual([10n, 13n]);
    expect(observedRanges).toContainEqual([10n, 11n]);
    expect(observedRanges).toContainEqual([12n, 13n]);
    expect(inventory).toMatchObject({
      scannedFromBlock: "10",
      scannedToBlock: "13",
      amountEventCount: 2,
      claimEventCount: 2,
      positionTransferEventCount: 4,
    });
    expect(inventory.tokenIds).toEqual(["10", "12", "110", "112", "210", "212", "310", "312"]);
    expect(await readInventory(dataDir)).toEqual(inventory);
    expect((await stat(join(dataDir, "inventory.json"))).mode & 0o777).toBe(0o600);
  });

  it("resumes at exactly scannedToBlock + 1 and rejects gaps or overlaps", async () => {
    const dataDir = await temporaryDirectory();
    const ranges: Array<readonly [bigint, bigint]> = [];
    const base: InventoryFile = {
      schemaVersion: 1,
      contract: ADDRESSES.compoundingClaimRecipient,
      scannedFromBlock: "10",
      scannedToBlock: "13",
      amountEventCount: 1,
      claimEventCount: 1,
      positionTransferEventCount: 2,
      tokenIds: ["1"],
      writtenAt: new Date().toISOString(),
    };
    await writeFile(join(dataDir, "inventory.json"), JSON.stringify(base));
    const client = {
      getBlockNumber: async () => 15n,
      getLogs: async (request: { fromBlock: bigint; toBlock: bigint }) => {
        ranges.push([request.fromBlock, request.toBlock]);
        return [];
      },
    } as unknown as KeeperPublicClient;

    const extended = await extendInventory({ client, dataDir, chunkBlocks: 100n });
    expect(ranges).toHaveLength(4);
    expect(ranges.every((range) => range[0] === 14n && range[1] === 15n)).toBe(true);
    expect(extended.scannedFromBlock).toBe("10");
    expect(extended.scannedToBlock).toBe("15");

    await expect(
      backfillInventory({
        client,
        dataDir,
        fromBlock: 15n,
        toBlock: 15n,
        chunkBlocks: 1n,
        baseInventory: base,
      }),
    ).rejects.toThrow("without a gap or overlap");
  });

  it("rejects malformed persisted inventory instead of trusting a cast", async () => {
    const dataDir = await temporaryDirectory();
    await writeFile(
      join(dataDir, "inventory.json"),
      JSON.stringify({
        schemaVersion: 1,
        contract: ADDRESSES.compoundingClaimRecipient,
        scannedFromBlock: "20",
        scannedToBlock: "19",
        amountEventCount: 0,
        claimEventCount: 0,
        positionTransferEventCount: 0,
        tokenIds: ["not-a-token-id"],
        writtenAt: new Date().toISOString(),
      }),
    );
    await expect(readInventory(dataDir)).rejects.toThrow();
    expect(await readFile(join(dataDir, "inventory.json"), "utf8")).toContain("not-a-token-id");
  });
});
