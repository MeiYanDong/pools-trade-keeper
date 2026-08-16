import { ADDRESSES } from "../chain/addresses.js";
import { v4QuoterAbi } from "../chain/abis.js";
import type { KeeperPublicClient } from "../chain/client.js";
import type { PositionSnapshot } from "../domain.js";

export const HISTORICAL_EXECUTOR_GAS_UNITS = 549_493n;

export interface NativeToTokenRebalanceQuote {
  tokenId: bigint;
  observedAtBlock: bigint;
  direction: "NATIVE_TO_TOKEN_EXACT_OUTPUT";
  tokenDeficit: bigint;
  nativeAvailableAfterRequired0: bigint;
  quoteAmountInNative: bigint;
  quoterGasEstimate: bigint;
  gasPriceWei: bigint;
  modeledExecutorGasUnits: bigint;
  modeledGasCostNative: bigint;
  residualAfterQuoteAndModeledGasNative: bigint;
  classification: "NEGATIVE_AFTER_QUOTE_AND_MODELED_GAS" | "QUOTE_CANDIDATE";
  shotDecision: "NO_SHOT";
  blockers: string[];
}

export function quoteResidualNative(input: {
  projectedNative: bigint;
  requiredNative: bigint;
  quoteAmountInNative: bigint;
  gasPriceWei: bigint;
  modeledExecutorGasUnits: bigint;
}): bigint {
  return (
    input.projectedNative -
    input.requiredNative -
    input.quoteAmountInNative -
    input.gasPriceWei * input.modeledExecutorGasUnits
  );
}

export async function quoteNativeToTokenRebalance(input: {
  client: KeeperPublicClient;
  snapshot: PositionSnapshot;
  gasPriceWei: bigint;
  modeledExecutorGasUnits?: bigint;
}): Promise<NativeToTokenRebalanceQuote> {
  const { snapshot } = input;
  if (snapshot.poolKey.currency0.toLowerCase() !== ADDRESSES.native.toLowerCase()) {
    throw new Error("quote_candidate_currency0_not_native");
  }
  if (
    snapshot.projectedClaimable0.state !== "KNOWN" ||
    snapshot.projectedClaimable1.state !== "KNOWN"
  ) {
    throw new Error("quote_candidate_projected_claim_unknown");
  }
  const tokenDeficit = snapshot.required1 - snapshot.projectedClaimable1.value;
  const nativeAvailableAfterRequired0 = snapshot.projectedClaimable0.value - snapshot.required0;
  if (tokenDeficit <= 0n) throw new Error("quote_candidate_native_to_token_not_required");
  if (nativeAvailableAfterRequired0 <= 0n) throw new Error("quote_candidate_no_native_surplus");
  const simulation = await input.client.simulateContract({
    address: ADDRESSES.quoter,
    abi: v4QuoterAbi,
    functionName: "quoteExactOutputSingle",
    args: [
      {
        poolKey: snapshot.poolKey,
        zeroForOne: true,
        exactAmount: tokenDeficit,
        hookData: "0x",
      },
    ],
    blockNumber: snapshot.observedAtBlock,
  });
  const [quoteAmountInNative, quoterGasEstimate] = simulation.result;
  const modeledExecutorGasUnits = input.modeledExecutorGasUnits ?? HISTORICAL_EXECUTOR_GAS_UNITS;
  const modeledGasCostNative = input.gasPriceWei * modeledExecutorGasUnits;
  const residualAfterQuoteAndModeledGasNative = quoteResidualNative({
    projectedNative: snapshot.projectedClaimable0.value,
    requiredNative: snapshot.required0,
    quoteAmountInNative,
    gasPriceWei: input.gasPriceWei,
    modeledExecutorGasUnits,
  });
  return {
    tokenId: snapshot.tokenId,
    observedAtBlock: snapshot.observedAtBlock,
    direction: "NATIVE_TO_TOKEN_EXACT_OUTPUT",
    tokenDeficit,
    nativeAvailableAfterRequired0,
    quoteAmountInNative,
    quoterGasEstimate,
    gasPriceWei: input.gasPriceWei,
    modeledExecutorGasUnits,
    modeledGasCostNative,
    residualAfterQuoteAndModeledGasNative,
    classification:
      residualAfterQuoteAndModeledGasNative > 0n
        ? "QUOTE_CANDIDATE"
        : "NEGATIVE_AFTER_QUOTE_AND_MODELED_GAS",
    shotDecision: "NO_SHOT",
    blockers: [
      "exact_executor_callback_simulation_unknown",
      "fee_splitter_standing_balance_unknown",
      "conditional_win_probability_unknown",
      "failed_transaction_gas_distribution_unknown",
      "signing_capability_unsupported",
      "broadcast_capability_unsupported",
    ],
  };
}
