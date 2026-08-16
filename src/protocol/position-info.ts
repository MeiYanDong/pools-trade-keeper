const MASK_24 = 0xff_ffffn;
const SIGN_BIT_24 = 0x80_0000n;
const MODULUS_24 = 0x100_0000n;

function decodeInt24(value: bigint): number {
  const masked = value & MASK_24;
  return Number(masked & SIGN_BIT_24 ? masked - MODULUS_24 : masked);
}

export function decodePositionTicks(packedInfo: bigint): {
  tickLower: number;
  tickUpper: number;
} {
  return {
    tickLower: decodeInt24(packedInfo >> 8n),
    tickUpper: decodeInt24(packedInfo >> 32n),
  };
}

export function encodeTicksForTest(tickLower: number, tickUpper: number): bigint {
  const lower = BigInt(tickLower) & MASK_24;
  const upper = BigInt(tickUpper) & MASK_24;
  return (upper << 32n) | (lower << 8n);
}
