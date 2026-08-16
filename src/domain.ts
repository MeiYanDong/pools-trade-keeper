import type { Address, Hex } from "viem";

export type Knowledge<T> =
  | { state: "KNOWN"; value: T; evidence: string }
  | { state: "UNKNOWN"; reason: string };

export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

export interface PositionSnapshot {
  observedAtBlock: bigint;
  tokenId: bigint;
  poolId: Hex;
  poolKey: PoolKey;
  positionOwner: Address;
  feeSplitter: Knowledge<Address>;
  tickLower: number;
  tickUpper: number;
  currentTick: number;
  sqrtPriceX96: bigint;
  positionLiquidity: bigint;
  minLiquidityIncrease: bigint;
  claimable0: bigint;
  claimable1: bigint;
  pendingFees0: Knowledge<bigint>;
  pendingFees1: Knowledge<bigint>;
  recipientNativeBps: Knowledge<number>;
  recipientTokenBps: Knowledge<number>;
  projectedClaimable0: Knowledge<bigint>;
  projectedClaimable1: Knowledge<bigint>;
  required0: bigint;
  required1: bigint;
  claimValueSpotNative: Knowledge<bigint>;
  projectedClaimValueSpotNative: Knowledge<bigint>;
  requiredValueSpotNative: Knowledge<bigint>;
}

export type ShadowClassification =
  | "NEGATIVE_AT_SPOT"
  | "BELOW_SHADOW_THRESHOLD"
  | "SHADOW_CANDIDATE";

export interface EconomicAssessment {
  classification: ShadowClassification;
  grossSpotNative: Knowledge<bigint>;
  bufferedSpotNative: Knowledge<bigint>;
  shotDecision: "NO_SHOT";
  blockers: string[];
}

export interface EvidenceRecord<T = unknown> {
  schemaVersion: 1;
  kind: string;
  observedAt: string;
  chainId: number;
  payload: T;
}
