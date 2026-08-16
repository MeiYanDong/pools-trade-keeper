import { describe, expect, it } from "vitest";
import {
  MAX_TICK,
  MIN_TICK,
  Q96,
  amount0DeltaRoundingUp,
  amount1DeltaRoundingUp,
  accruedFeesFromGrowth,
  requiredAmountsForLiquidity,
  sqrtPriceX96AtTick,
  token1ToToken0Spot,
} from "../src/protocol/liquidity-math.js";

describe("Uniswap v4 liquidity math", () => {
  it("matches canonical TickMath boundary values", () => {
    expect(sqrtPriceX96AtTick(0)).toBe(Q96);
    expect(sqrtPriceX96AtTick(MIN_TICK)).toBe(4_295_128_739n);
    expect(sqrtPriceX96AtTick(MAX_TICK)).toBe(
      1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n,
    );
  });

  it("rounds asset deltas up", () => {
    const liquidity = 1_000_000_000_000_000_000n;
    expect(amount0DeltaRoundingUp(Q96, 2n * Q96, liquidity)).toBe(liquidity / 2n);
    expect(amount1DeltaRoundingUp(Q96, 2n * Q96, liquidity)).toBe(liquidity);
  });

  it("splits both assets when the current price is inside the range", () => {
    const result = requiredAmountsForLiquidity({
      sqrtPriceX96: Q96,
      tickLower: -60,
      tickUpper: 60,
      liquidity: 100_000_000_000_000_000_000n,
    });
    expect(result.amount0).toBeGreaterThan(0n);
    expect(result.amount1).toBeGreaterThan(0n);
  });

  it("values raw token1 in raw token0 at spot", () => {
    expect(token1ToToken0Spot(1_000_000_000_000_000_000n, Q96)).toBe(1_000_000_000_000_000_000n);
    expect(token1ToToken0Spot(1_000_000_000_000_000_000n, 2n * Q96)).toBe(250_000_000_000_000_000n);
  });

  it("derives accrued fees from Q128 fee growth", () => {
    expect(
      accruedFeesFromGrowth({
        liquidity: 10n,
        currentFeeGrowthInsideX128: 3n << 128n,
        lastFeeGrowthInsideX128: 1n << 128n,
      }),
    ).toBe(20n);
  });
});
