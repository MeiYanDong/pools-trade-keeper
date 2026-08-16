import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ADDRESSES, REQUIRED_LIQUIDITY_INCREASE } from "../src/chain/addresses.js";
import type { KeeperPublicClient } from "../src/chain/client.js";
import { runBulkShadow } from "../src/protocol/bulk-shadow.js";
import { Q96, requiredAmountsForLiquidity } from "../src/protocol/liquidity-math.js";
import { encodeTicksForTest } from "../src/protocol/position-info.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pools-bulk-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

function success(result: unknown) {
  return { status: "success" as const, result };
}

function failure() {
  return { status: "failure" as const, error: new Error("rpc inner failure") };
}

describe("bulk Shadow decision path", () => {
  it("rejects an invalid chunk size instead of entering a non-progressing loop", async () => {
    await expect(
      runBulkShadow({
        client: {} as KeeperPublicClient,
        tokenIds: ["1"],
        fixedBlock: 1n,
        dataDir: await temporaryDirectory(),
        tokenChunk: 0,
      }),
    ).rejects.toThrow("tokenChunk must be a positive safe integer");
  });

  it("preserves a fixed block and separates positive, negative, and stale positions", async () => {
    const dataDir = await temporaryDirectory();
    const blocks: bigint[] = [];
    const token = `0x${"11".repeat(20)}` as const;
    const poolKey = {
      currency0: ADDRESSES.native,
      currency1: token,
      fee: 2_500,
      tickSpacing: 50,
      hooks: ADDRESSES.native,
    };
    const client = {
      readContract: async (request: { functionName: string; blockNumber?: bigint }) => {
        if (request.blockNumber !== undefined) blocks.push(request.blockNumber);
        if (request.functionName !== "getSplits") throw new Error("unexpected direct read");
        return [
          {
            recipient: ADDRESSES.compoundingClaimRecipient,
            nativeBps: 10_000,
            tokenBps: 10_000,
            useCallback: true,
          },
        ];
      },
      multicall: async (request: {
        contracts: ReadonlyArray<{ functionName: string; args: readonly [bigint] }>;
        blockNumber?: bigint;
      }) => {
        if (request.blockNumber !== undefined) blocks.push(request.blockNumber);
        return request.contracts.map((contract) => {
          const tokenId = contract.args?.[0];
          if (contract.functionName === "amounts") {
            return success(tokenId === 1n ? [1_000_000_000_000_000_000_000n, 0n] : [0n, 0n]);
          }
          if (contract.functionName === "getPoolAndPositionInfo") {
            return success([poolKey, encodeTicksForTest(-100, 100)]);
          }
          if (contract.functionName === "ownerOf") {
            return success(tokenId === 3n ? `0x${"33".repeat(20)}` : ADDRESSES.creatorFeeSplitter);
          }
          if (contract.functionName === "getSlot0") return success([Q96, 0, 0, 2_500]);
          if (contract.functionName === "getPositionInfo") return success([0n, 0n, 0n]);
          if (contract.functionName === "getFeeGrowthInside") return success([0n, 0n]);
          throw new Error(`unexpected multicall ${contract.functionName}`);
        });
      },
    } as unknown as KeeperPublicClient;

    const summary = await runBulkShadow({
      client,
      tokenIds: ["1", "2", "3"],
      fixedBlock: 888n,
      dataDir,
      tokenChunk: 10,
    });

    expect(new Set(blocks)).toEqual(new Set([888n]));
    expect(summary).toMatchObject({
      fixedBlock: 888n,
      evaluated: 2,
      positiveAtSpot: 1,
      negativeAtSpot: 1,
      stalePositions: 1,
      unknown: 0,
      shots: 0,
    });
    const rows = (await readFile(summary.rowsPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, string>);
    expect(rows.map((row) => row.status)).toEqual([
      "POSITIVE_AT_SPOT",
      "NEGATIVE_AT_SPOT",
      "STALE_POSITION",
    ]);
    const required = requiredAmountsForLiquidity({
      sqrtPriceX96: Q96,
      tickLower: -100,
      tickUpper: 100,
      liquidity: REQUIRED_LIQUIDITY_INCREASE,
    });
    expect(rows[0]?.required0).toBe(required.amount0.toString());
    expect(rows[0]?.required1).toBe(required.amount1.toString());
    const candidates = JSON.parse(await readFile(summary.candidatesPath, "utf8")) as unknown[];
    expect(candidates).toHaveLength(1);
  });

  it("withholds a scan when inner-call unknowns exceed the explicit threshold", async () => {
    const dataDir = await temporaryDirectory();
    const tokenIds = Array.from({ length: 21 }, (_, index) => String(index + 1));
    const client = {
      readContract: async () => [
        {
          recipient: ADDRESSES.compoundingClaimRecipient,
          nativeBps: 10_000,
          tokenBps: 10_000,
          useCallback: true,
        },
      ],
      multicall: async (request: {
        contracts: ReadonlyArray<{ functionName: string; args: readonly [bigint] }>;
      }) =>
        request.contracts.map((contract) => {
          const tokenId = contract.args[0];
          if (contract.functionName === "amounts" && tokenId <= 11n) return failure();
          if (contract.functionName === "amounts") return success([0n, 0n]);
          if (contract.functionName === "getPoolAndPositionInfo") {
            return success([
              {
                currency0: ADDRESSES.native,
                currency1: `0x${"11".repeat(20)}`,
                fee: 2_500,
                tickSpacing: 50,
                hooks: ADDRESSES.native,
              },
              encodeTicksForTest(-100, 100),
            ]);
          }
          if (contract.functionName === "ownerOf") return success(`0x${"33".repeat(20)}`);
          throw new Error(`unexpected multicall ${contract.functionName}`);
        }),
    } as unknown as KeeperPublicClient;

    await expect(
      runBulkShadow({
        client,
        tokenIds,
        fixedBlock: 999n,
        dataDir,
        tokenChunk: 100,
      }),
    ).rejects.toThrow("bulk_phase1_failure_rate: 11/21 unknown");
  });
});
