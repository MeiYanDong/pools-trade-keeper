import { describe, expect, it } from "vitest";
import { ADDRESSES } from "../src/chain/addresses.js";
import type { KeeperPublicClient } from "../src/chain/client.js";
import type { PositionSnapshot } from "../src/domain.js";
import {
  quoteNativeToTokenRebalance,
  quoteResidualNative,
} from "../src/protocol/rebalance-quote.js";

const snapshot: PositionSnapshot = {
  observedAtBlock: 456n,
  tokenId: 123n,
  poolId: `0x${"22".repeat(32)}`,
  poolKey: {
    currency0: ADDRESSES.native,
    currency1: `0x${"11".repeat(20)}`,
    fee: 2_500,
    tickSpacing: 50,
    hooks: ADDRESSES.native,
  },
  positionOwner: ADDRESSES.creatorFeeSplitter,
  feeSplitter: { state: "KNOWN", value: ADDRESSES.creatorFeeSplitter, evidence: "test" },
  tickLower: -100,
  tickUpper: 100,
  currentTick: 0,
  sqrtPriceX96: 1n << 96n,
  positionLiquidity: 1n,
  minLiquidityIncrease: 1n,
  claimable0: 10_000n,
  claimable1: 0n,
  pendingFees0: { state: "KNOWN", value: 0n, evidence: "test" },
  pendingFees1: { state: "KNOWN", value: 0n, evidence: "test" },
  recipientNativeBps: { state: "KNOWN", value: 10_000, evidence: "test" },
  recipientTokenBps: { state: "KNOWN", value: 10_000, evidence: "test" },
  projectedClaimable0: { state: "KNOWN", value: 10_000n, evidence: "test" },
  projectedClaimable1: { state: "KNOWN", value: 0n, evidence: "test" },
  required0: 1_000n,
  required1: 100n,
  claimValueSpotNative: { state: "KNOWN", value: 10_000n, evidence: "test" },
  projectedClaimValueSpotNative: { state: "KNOWN", value: 10_000n, evidence: "test" },
  requiredValueSpotNative: { state: "KNOWN", value: 1_100n, evidence: "test" },
};

describe("candidate rebalance quote economics", () => {
  it("marks the strongest full-inventory candidate negative after exact quote and modeled gas", () => {
    const residual = quoteResidualNative({
      projectedNative: 2_188_527_000_000_000n,
      requiredNative: 5_690_369_110_222n,
      quoteAmountInNative: 2_168_612_659_176_664n,
      gasPriceWei: 30_390_000n,
      modeledExecutorGasUnits: 549_493n,
    });
    expect(residual).toBe(-2_475_120_556_886n);
  });

  it("quotes exact token output at the snapshot block but always emits NO_SHOT", async () => {
    const simulations: unknown[] = [];
    const client = {
      simulateContract: async (request: unknown) => {
        simulations.push(request);
        return { result: [1_000n, 55_000n] as const };
      },
    } as unknown as KeeperPublicClient;

    const quote = await quoteNativeToTokenRebalance({
      client,
      snapshot,
      gasPriceWei: 10n,
      modeledExecutorGasUnits: 10n,
    });

    expect(simulations).toHaveLength(1);
    expect(simulations[0]).toMatchObject({
      address: ADDRESSES.quoter,
      functionName: "quoteExactOutputSingle",
      blockNumber: 456n,
      args: [
        {
          poolKey: snapshot.poolKey,
          zeroForOne: true,
          exactAmount: 100n,
          hookData: "0x",
        },
      ],
    });
    expect(quote).toMatchObject({
      classification: "QUOTE_CANDIDATE",
      residualAfterQuoteAndModeledGasNative: 7_900n,
      shotDecision: "NO_SHOT",
    });
    expect(quote.blockers).toContain("broadcast_capability_unsupported");
  });

  it("classifies an executable quote as negative after modeled gas", async () => {
    const client = {
      simulateContract: async () => ({ result: [8_950n, 55_000n] as const }),
    } as unknown as KeeperPublicClient;
    const quote = await quoteNativeToTokenRebalance({
      client,
      snapshot,
      gasPriceWei: 10n,
      modeledExecutorGasUnits: 10n,
    });
    expect(quote.classification).toBe("NEGATIVE_AFTER_QUOTE_AND_MODELED_GAS");
    expect(quote.residualAfterQuoteAndModeledGasNative).toBe(-50n);
    expect(quote.shotDecision).toBe("NO_SHOT");
  });
});
