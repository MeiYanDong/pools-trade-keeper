import { describe, expect, it } from "vitest";
import type { PositionSnapshot } from "../src/domain.js";
import { assessSnapshot, historicalNetNative } from "../src/decision/economics.js";

const baseSnapshot: PositionSnapshot = {
  observedAtBlock: 1n,
  tokenId: 1n,
  poolId: `0x${"00".repeat(32)}`,
  poolKey: {
    currency0: `0x${"00".repeat(20)}`,
    currency1: `0x${"11".repeat(20)}`,
    fee: 2500,
    tickSpacing: 50,
    hooks: `0x${"00".repeat(20)}`,
  },
  positionOwner: `0x${"22".repeat(20)}`,
  feeSplitter: { state: "KNOWN", value: `0x${"22".repeat(20)}`, evidence: "test" },
  tickLower: -100,
  tickUpper: 100,
  currentTick: 0,
  sqrtPriceX96: 1n << 96n,
  positionLiquidity: 1n,
  minLiquidityIncrease: 100_000_000_000_000_000_000n,
  claimable0: 0n,
  claimable1: 0n,
  pendingFees0: { state: "KNOWN", value: 0n, evidence: "test" },
  pendingFees1: { state: "KNOWN", value: 0n, evidence: "test" },
  recipientNativeBps: { state: "KNOWN", value: 10_000, evidence: "test" },
  recipientTokenBps: { state: "KNOWN", value: 10_000, evidence: "test" },
  projectedClaimable0: { state: "KNOWN", value: 0n, evidence: "test" },
  projectedClaimable1: { state: "KNOWN", value: 0n, evidence: "test" },
  required0: 0n,
  required1: 0n,
  claimValueSpotNative: { state: "KNOWN", value: 10_000n, evidence: "test" },
  projectedClaimValueSpotNative: { state: "KNOWN", value: 10_000n, evidence: "test" },
  requiredValueSpotNative: { state: "KNOWN", value: 7_000n, evidence: "test" },
};

describe("economic gate", () => {
  it("can rank a shadow candidate but never produces a live shot", () => {
    const result = assessSnapshot(baseSnapshot, {
      estimatedSuccessGasNative: 500n,
      competitionBufferNative: 500n,
      exitHaircutBps: 100,
      minimumShadowProfitNative: 1_000n,
    });
    expect(result.classification).toBe("SHADOW_CANDIDATE");
    expect(result.shotDecision).toBe("NO_SHOT");
    expect(result.blockers).toContain("executable_exit_quote_unknown");
  });

  it("replays historical mark-to-market receipt arithmetic", () => {
    expect(historicalNetNative(571_210_000_000_000n, 24_164_500_000_000n)).toBe(
      547_045_500_000_000n,
    );
  });
});
