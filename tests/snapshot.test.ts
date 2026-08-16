import { describe, expect, it } from "vitest";
import { ADDRESSES, REQUIRED_LIQUIDITY_INCREASE } from "../src/chain/addresses.js";
import type { KeeperPublicClient } from "../src/chain/client.js";
import { Q96, Q128 } from "../src/protocol/liquidity-math.js";
import { encodeTicksForTest } from "../src/protocol/position-info.js";
import { readPositionSnapshot } from "../src/protocol/snapshot.js";

describe("fixed-block position snapshot", () => {
  it("reads every contract input at one block and asserts the projected business values", async () => {
    const blocks: bigint[] = [];
    const token = `0x${"11".repeat(20)}` as const;
    const client = {
      getBlockNumber: async () => 777n,
      readContract: async (request: { functionName: string; blockNumber?: bigint }) => {
        if (request.blockNumber !== undefined) blocks.push(request.blockNumber);
        switch (request.functionName) {
          case "amounts":
            return [1_000n, 2_000n] as const;
          case "getPoolAndPositionInfo":
            return [
              {
                currency0: ADDRESSES.native,
                currency1: token,
                fee: 2_500,
                tickSpacing: 50,
                hooks: ADDRESSES.native,
              },
              encodeTicksForTest(-100, 100),
            ] as const;
          case "getPositionLiquidity":
            return 12_345n;
          case "minLiquidityIncrease":
            return REQUIRED_LIQUIDITY_INCREASE;
          case "ownerOf":
            return ADDRESSES.creatorFeeSplitter;
          case "getSlot0":
            return [Q96, 0, 0, 2_500] as const;
          case "getPositionInfo":
            return [100n, 0n, 0n] as const;
          case "getFeeGrowthInside":
            return [Q128, Q128] as const;
          case "getSplits":
            return [
              {
                recipient: ADDRESSES.compoundingClaimRecipient,
                nativeBps: 6_000,
                tokenBps: 10_000,
                useCallback: true,
              },
            ] as const;
          default:
            throw new Error(`unexpected read ${request.functionName}`);
        }
      },
    } as unknown as KeeperPublicClient;

    const snapshot = await readPositionSnapshot(client, 42n);

    expect(snapshot.observedAtBlock).toBe(777n);
    expect(blocks).toHaveLength(9);
    expect(new Set(blocks)).toEqual(new Set([777n]));
    expect(snapshot.minLiquidityIncrease).toBe(REQUIRED_LIQUIDITY_INCREASE);
    expect(snapshot.pendingFees0).toMatchObject({ state: "KNOWN", value: 100n });
    expect(snapshot.pendingFees1).toMatchObject({ state: "KNOWN", value: 100n });
    expect(snapshot.projectedClaimable0).toMatchObject({ state: "KNOWN", value: 1_060n });
    expect(snapshot.projectedClaimable1).toMatchObject({ state: "KNOWN", value: 2_100n });
    expect(snapshot.feeSplitter).toMatchObject({
      state: "KNOWN",
      value: ADDRESSES.creatorFeeSplitter,
    });
    expect(snapshot.required0).toBeGreaterThan(0n);
    expect(snapshot.required1).toBeGreaterThan(0n);
  });
});
