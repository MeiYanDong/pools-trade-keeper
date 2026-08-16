import type { EconomicAssessment, PositionSnapshot } from "../domain.js";

export interface ShadowBuffers {
  estimatedSuccessGasNative: bigint;
  competitionBufferNative: bigint;
  exitHaircutBps: number;
  minimumShadowProfitNative: bigint;
}

export function assessSnapshot(
  snapshot: PositionSnapshot,
  buffers: ShadowBuffers,
): EconomicAssessment {
  const blockers = [
    "fee_splitter_standing_balance_unknown",
    "executable_exit_quote_unknown",
    "exact_executor_callback_simulation_unknown",
    "conditional_win_probability_unknown",
    "signing_capability_unsupported",
    "broadcast_capability_unsupported",
  ];

  if (
    snapshot.projectedClaimValueSpotNative.state === "UNKNOWN" ||
    snapshot.requiredValueSpotNative.state === "UNKNOWN"
  ) {
    return {
      classification: "BELOW_SHADOW_THRESHOLD",
      grossSpotNative: { state: "UNKNOWN", reason: "native spot valuation unavailable" },
      bufferedSpotNative: { state: "UNKNOWN", reason: "gross spot valuation unavailable" },
      shotDecision: "NO_SHOT",
      blockers,
    };
  }

  const gross =
    snapshot.projectedClaimValueSpotNative.value - snapshot.requiredValueSpotNative.value;
  const haircut =
    (snapshot.projectedClaimValueSpotNative.value * BigInt(buffers.exitHaircutBps)) / 10_000n;
  const buffered =
    gross - buffers.estimatedSuccessGasNative - buffers.competitionBufferNative - haircut;
  const classification =
    gross <= 0n
      ? "NEGATIVE_AT_SPOT"
      : buffered >= buffers.minimumShadowProfitNative
        ? "SHADOW_CANDIDATE"
        : "BELOW_SHADOW_THRESHOLD";

  return {
    classification,
    grossSpotNative: {
      state: "KNOWN",
      value: gross,
      evidence: "same-block proactive collect-plus-claim spot projection only",
    },
    bufferedSpotNative: {
      state: "KNOWN",
      value: buffered,
      evidence: "configured shadow buffers; not a realized or executable quote",
    },
    shotDecision: "NO_SHOT",
    blockers,
  };
}

export function historicalNetNative(grossSurplusNative: bigint, gasCostNative: bigint): bigint {
  return grossSurplusNative - gasCostNative;
}
