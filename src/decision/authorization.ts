import type { RuntimeConfig } from "../config.js";

export interface AuthorizationAssessment {
  requestedMode: RuntimeConfig["operationMode"];
  effectiveMode: "shadow";
  liveAuthorized: false;
  blockers: string[];
}

export function assessAuthorization(
  config: RuntimeConfig,
  now = new Date(),
): AuthorizationAssessment {
  const blockers: string[] = [];
  if (config.operationMode !== "shadow") blockers.push("runtime_only_supports_shadow");
  if (!config.liveBroadcastEnabled) blockers.push("live_broadcast_flag_false");
  if (config.maxGasNativeWei === 0n) blockers.push("max_gas_budget_missing");
  if (config.maxFailedGasNativeWei === 0n) blockers.push("failed_gas_budget_missing");
  if (config.minNetProfitNativeWei === 0n) blockers.push("minimum_net_profit_missing");
  if (config.maxDailyLossNativeWei === 0n) blockers.push("daily_loss_budget_missing");
  if (!config.authorizationExpiresAt) blockers.push("authorization_expiry_missing");
  else if (config.authorizationExpiresAt <= now) blockers.push("authorization_expired");
  blockers.push("executor_contract_not_implemented");
  blockers.push("signing_capability_unsupported");
  blockers.push("broadcast_capability_unsupported");

  return {
    requestedMode: config.operationMode,
    effectiveMode: "shadow",
    liveAuthorized: false,
    blockers,
  };
}
