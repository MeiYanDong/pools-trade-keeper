import { getAddress, toHex, type Address } from "viem";
import { ADDRESSES } from "../chain/addresses.js";
import {
  compoundingClaimRecipientAbi,
  feeSplitterAbi,
  positionManagerAbi,
  stateViewAbi,
} from "../chain/abis.js";
import type { KeeperPublicClient } from "../chain/client.js";
import type { PoolKey, PositionSnapshot } from "../domain.js";
import {
  accruedFeesFromGrowth,
  requiredAmountsForLiquidity,
  token1ToToken0Spot,
} from "./liquidity-math.js";
import { poolIdOf } from "./pool-id.js";
import { decodePositionTicks } from "./position-info.js";

interface RawPoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

export async function readPositionSnapshot(
  client: KeeperPublicClient,
  tokenId: bigint,
  requestedBlock?: bigint,
): Promise<PositionSnapshot> {
  const observedAtBlock = requestedBlock ?? (await client.getBlockNumber());
  const [amounts, positionResult, positionLiquidity, minLiquidityIncrease, positionOwner] =
    await Promise.all([
      client.readContract({
        address: ADDRESSES.compoundingClaimRecipient,
        abi: compoundingClaimRecipientAbi,
        functionName: "amounts",
        args: [tokenId],
        blockNumber: observedAtBlock,
      }),
      client.readContract({
        address: ADDRESSES.positionManager,
        abi: positionManagerAbi,
        functionName: "getPoolAndPositionInfo",
        args: [tokenId],
        blockNumber: observedAtBlock,
      }),
      client.readContract({
        address: ADDRESSES.positionManager,
        abi: positionManagerAbi,
        functionName: "getPositionLiquidity",
        args: [tokenId],
        blockNumber: observedAtBlock,
      }),
      client.readContract({
        address: ADDRESSES.compoundingClaimRecipient,
        abi: compoundingClaimRecipientAbi,
        functionName: "minLiquidityIncrease",
        blockNumber: observedAtBlock,
      }),
      client.readContract({
        address: ADDRESSES.positionManager,
        abi: positionManagerAbi,
        functionName: "ownerOf",
        args: [tokenId],
        blockNumber: observedAtBlock,
      }),
    ]);

  const [rawKey, packedInfo] = positionResult as readonly [RawPoolKey, bigint];
  const poolKey: PoolKey = {
    currency0: getAddress(rawKey.currency0),
    currency1: getAddress(rawKey.currency1),
    fee: Number(rawKey.fee),
    tickSpacing: Number(rawKey.tickSpacing),
    hooks: getAddress(rawKey.hooks),
  };
  const poolId = poolIdOf(poolKey);
  const [sqrtPriceX96, currentTick] = await client.readContract({
    address: ADDRESSES.stateView,
    abi: stateViewAbi,
    functionName: "getSlot0",
    args: [poolId],
    blockNumber: observedAtBlock,
  });
  const { tickLower, tickUpper } = decodePositionTicks(packedInfo);
  const knownFeeSplitter = [ADDRESSES.creatorFeeSplitter, ADDRESSES.noCreatorFeeSplitter].find(
    (candidate) => candidate.toLowerCase() === positionOwner.toLowerCase(),
  );
  const [positionCore, currentFeeGrowth, splits] = await Promise.all([
    client.readContract({
      address: ADDRESSES.stateView,
      abi: stateViewAbi,
      functionName: "getPositionInfo",
      args: [poolId, ADDRESSES.positionManager, tickLower, tickUpper, toHex(tokenId, { size: 32 })],
      blockNumber: observedAtBlock,
    }),
    client.readContract({
      address: ADDRESSES.stateView,
      abi: stateViewAbi,
      functionName: "getFeeGrowthInside",
      args: [poolId, tickLower, tickUpper],
      blockNumber: observedAtBlock,
    }),
    knownFeeSplitter
      ? client.readContract({
          address: knownFeeSplitter,
          abi: feeSplitterAbi,
          functionName: "getSplits",
          blockNumber: observedAtBlock,
        })
      : Promise.resolve(null),
  ]);
  const [coreLiquidity, lastFeeGrowth0, lastFeeGrowth1] = positionCore;
  const [currentFeeGrowth0, currentFeeGrowth1] = currentFeeGrowth;
  const totalPending0 = accruedFeesFromGrowth({
    liquidity: coreLiquidity,
    currentFeeGrowthInsideX128: currentFeeGrowth0,
    lastFeeGrowthInsideX128: lastFeeGrowth0,
  });
  const totalPending1 = accruedFeesFromGrowth({
    liquidity: coreLiquidity,
    currentFeeGrowthInsideX128: currentFeeGrowth1,
    lastFeeGrowthInsideX128: lastFeeGrowth1,
  });
  const compoundingSplit = splits?.find(
    (split) => split.recipient.toLowerCase() === ADDRESSES.compoundingClaimRecipient.toLowerCase(),
  );
  const required = requiredAmountsForLiquidity({
    sqrtPriceX96,
    tickLower,
    tickUpper,
    liquidity: minLiquidityIncrease,
  });
  const [claimable0, claimable1] = amounts;
  const currency0IsNative = poolKey.currency0.toLowerCase() === ADDRESSES.native.toLowerCase();
  const projected0 = compoundingSplit
    ? claimable0 + (totalPending0 * BigInt(compoundingSplit.nativeBps)) / 10_000n
    : null;
  const projected1 = compoundingSplit
    ? claimable1 + (totalPending1 * BigInt(compoundingSplit.tokenBps)) / 10_000n
    : null;

  return {
    observedAtBlock,
    tokenId,
    poolId,
    poolKey,
    positionOwner,
    feeSplitter: knownFeeSplitter
      ? {
          state: "KNOWN",
          value: knownFeeSplitter,
          evidence: "PositionManager.ownerOf at fixed block",
        }
      : { state: "UNKNOWN", reason: "position is not owned by a configured Pools FeeSplitter" },
    tickLower,
    tickUpper,
    currentTick,
    sqrtPriceX96,
    positionLiquidity,
    minLiquidityIncrease,
    claimable0,
    claimable1,
    pendingFees0: knownFeeSplitter
      ? {
          state: "KNOWN",
          value: totalPending0,
          evidence: "fixed-block fee-growth delta before FeeSplitter allocation",
        }
      : { state: "UNKNOWN", reason: "FeeSplitter owner is unknown" },
    pendingFees1: knownFeeSplitter
      ? {
          state: "KNOWN",
          value: totalPending1,
          evidence: "fixed-block fee-growth delta before FeeSplitter allocation",
        }
      : { state: "UNKNOWN", reason: "FeeSplitter owner is unknown" },
    recipientNativeBps: compoundingSplit
      ? {
          state: "KNOWN",
          value: Number(compoundingSplit.nativeBps),
          evidence: "FeeSplitter.getSplits at fixed block",
        }
      : { state: "UNKNOWN", reason: "CompoundingClaimRecipient split not found" },
    recipientTokenBps: compoundingSplit
      ? {
          state: "KNOWN",
          value: Number(compoundingSplit.tokenBps),
          evidence: "FeeSplitter.getSplits at fixed block",
        }
      : { state: "UNKNOWN", reason: "CompoundingClaimRecipient split not found" },
    projectedClaimable0:
      projected0 === null
        ? { state: "UNKNOWN", reason: "pending fee allocation is unknown" }
        : {
            state: "KNOWN",
            value: projected0,
            evidence:
              "current attribution plus fixed-block fee-growth allocation; excludes FeeSplitter standing balance",
          },
    projectedClaimable1:
      projected1 === null
        ? { state: "UNKNOWN", reason: "pending fee allocation is unknown" }
        : {
            state: "KNOWN",
            value: projected1,
            evidence:
              "current attribution plus fixed-block fee-growth allocation; excludes FeeSplitter standing balance",
          },
    required0: required.amount0,
    required1: required.amount1,
    claimValueSpotNative: currency0IsNative
      ? {
          state: "KNOWN",
          value: claimable0 + token1ToToken0Spot(claimable1, sqrtPriceX96),
          evidence: "same-block StateView spot mark-to-market; not an executable exit quote",
        }
      : {
          state: "UNKNOWN",
          reason: "currency0 is not the native currency",
        },
    projectedClaimValueSpotNative:
      currency0IsNative && projected0 !== null && projected1 !== null
        ? {
            state: "KNOWN",
            value: projected0 + token1ToToken0Spot(projected1, sqrtPriceX96),
            evidence:
              "proactive collect-plus-claim projection at same-block spot; excludes FeeSplitter standing balance and executable exit impact",
          }
        : {
            state: "UNKNOWN",
            reason: "projected pending allocation or native valuation unavailable",
          },
    requiredValueSpotNative: currency0IsNative
      ? {
          state: "KNOWN",
          value: required.amount0 + token1ToToken0Spot(required.amount1, sqrtPriceX96),
          evidence: "exact rounded-up deltaL asset amounts valued at same-block StateView spot",
        }
      : {
          state: "UNKNOWN",
          reason: "currency0 is not the native currency",
        },
  };
}
