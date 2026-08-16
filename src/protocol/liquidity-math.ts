export const Q96 = 1n << 96n;
export const Q192 = 1n << 192n;
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

const MAX_UINT256 = (1n << 256n) - 1n;
export const Q128 = 1n << 128n;
const TICK_MULTIPLIERS: readonly bigint[] = [
  0xfffcb933bd6fad37aa2d162d1a594001n,
  0xfff97272373d413259a46990580e213an,
  0xfff2e50f5f656932ef12357cf3c7fdccn,
  0xffe5caca7e10e4e61c3624eaa0941cd0n,
  0xffcb9843d60f6159c9db58835c926644n,
  0xff973b41fa98c081472e6896dfb254c0n,
  0xff2ea16466c96a3843ec78b326b52861n,
  0xfe5dee046a99a2a811c461f1969c3053n,
  0xfcbe86c7900a88aedcffc83b479aa3a4n,
  0xf987a7253ac413176f2b074cf7815e54n,
  0xf3392b0822b70005940c7a398e4b70f3n,
  0xe7159475a2c29b7443b29c7fa6e889d9n,
  0xd097f3bdfd2022b8845ad8f792aa5825n,
  0xa9f746462d870fdf8a65dc1f90e061e5n,
  0x70d869a156d2a1b890bb3df62baf32f7n,
  0x31be135f97d08fd981231505542fcfa6n,
  0x9aa508b5b7a84e1c677de54f3e99bc9n,
  0x5d6af8dedb81196699c329225ee604n,
  0x2216e584f5fa1ea926041bedfe98n,
  0x48a170391f7dc42444e8fa2n,
] as const;

export function divRoundingUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("denominator must be positive");
  return numerator / denominator + (numerator % denominator === 0n ? 0n : 1n);
}

export function mulDivRoundingUp(a: bigint, b: bigint, denominator: bigint): bigint {
  return divRoundingUp(a * b, denominator);
}

export function sqrtPriceX96AtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK) {
    throw new Error(`tick must be an integer in [${MIN_TICK}, ${MAX_TICK}]`);
  }
  const absTick = Math.abs(tick);
  const firstMultiplier = TICK_MULTIPLIERS[0];
  if (firstMultiplier === undefined) throw new Error("tick multiplier table is empty");
  let ratio = (absTick & 1) !== 0 ? firstMultiplier : 0x100000000000000000000000000000000n;

  for (let index = 1; index < TICK_MULTIPLIERS.length; index += 1) {
    if ((absTick & (1 << index)) !== 0) {
      const multiplier = TICK_MULTIPLIERS[index];
      if (multiplier === undefined) throw new Error("tick multiplier table invariant violated");
      ratio = (ratio * multiplier) >> 128n;
    }
  }
  if (tick > 0) ratio = MAX_UINT256 / ratio;
  return (ratio >> 32n) + (ratio & ((1n << 32n) - 1n) ? 1n : 0n);
}

export function amount0DeltaRoundingUp(
  sqrtPriceAX96: bigint,
  sqrtPriceBX96: bigint,
  liquidity: bigint,
): bigint {
  let lower = sqrtPriceAX96;
  let upper = sqrtPriceBX96;
  if (lower > upper) [lower, upper] = [upper, lower];
  if (lower <= 0n) throw new Error("sqrt price must be positive");
  const numerator1 = liquidity << 96n;
  const numerator2 = upper - lower;
  return divRoundingUp(mulDivRoundingUp(numerator1, numerator2, upper), lower);
}

export function amount1DeltaRoundingUp(
  sqrtPriceAX96: bigint,
  sqrtPriceBX96: bigint,
  liquidity: bigint,
): bigint {
  let lower = sqrtPriceAX96;
  let upper = sqrtPriceBX96;
  if (lower > upper) [lower, upper] = [upper, lower];
  return mulDivRoundingUp(liquidity, upper - lower, Q96);
}

export function requiredAmountsForLiquidity(input: {
  sqrtPriceX96: bigint;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
}): { amount0: bigint; amount1: bigint } {
  if (input.tickLower >= input.tickUpper) throw new Error("tickLower must be below tickUpper");
  if (input.liquidity < 0n) throw new Error("liquidity must be non-negative");
  const sqrtLower = sqrtPriceX96AtTick(input.tickLower);
  const sqrtUpper = sqrtPriceX96AtTick(input.tickUpper);

  if (input.sqrtPriceX96 <= sqrtLower) {
    return {
      amount0: amount0DeltaRoundingUp(sqrtLower, sqrtUpper, input.liquidity),
      amount1: 0n,
    };
  }
  if (input.sqrtPriceX96 < sqrtUpper) {
    return {
      amount0: amount0DeltaRoundingUp(input.sqrtPriceX96, sqrtUpper, input.liquidity),
      amount1: amount1DeltaRoundingUp(sqrtLower, input.sqrtPriceX96, input.liquidity),
    };
  }
  return {
    amount0: 0n,
    amount1: amount1DeltaRoundingUp(sqrtLower, sqrtUpper, input.liquidity),
  };
}

export function token1ToToken0Spot(amount1: bigint, sqrtPriceX96: bigint): bigint {
  if (sqrtPriceX96 <= 0n) throw new Error("sqrt price must be positive");
  return (amount1 * Q192) / (sqrtPriceX96 * sqrtPriceX96);
}

export function accruedFeesFromGrowth(input: {
  liquidity: bigint;
  currentFeeGrowthInsideX128: bigint;
  lastFeeGrowthInsideX128: bigint;
}): bigint {
  const growthDelta =
    (input.currentFeeGrowthInsideX128 - input.lastFeeGrowthInsideX128) & MAX_UINT256;
  return (growthDelta * input.liquidity) / Q128;
}
