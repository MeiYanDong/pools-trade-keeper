import { homedir } from "node:os";
import { resolve } from "node:path";

export type OperationMode = "shadow" | "canary" | "live";

export interface RuntimeConfig {
  rpcHttpUrl: string;
  rpcWssUrl: string | undefined;
  chainId: number;
  operationMode: OperationMode;
  liveBroadcastEnabled: boolean;
  backfillFromBlock: bigint;
  eventChunkBlocks: bigint;
  shadowMaxPositions: number;
  shadowConcurrency: number;
  bulkTokenChunk: number;
  dataDir: string;
  maxGasNativeWei: bigint;
  maxFailedGasNativeWei: bigint;
  minNetProfitNativeWei: bigint;
  maxDailyLossNativeWei: bigint;
  authorizationExpiresAt: Date | undefined;
  keystorePath: string;
}

function requireUrl(name: string, raw: string | undefined, protocols: string[]): string {
  if (!raw) throw new Error(`${name} is required`);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${name} must use ${protocols.join(" or ")}`);
  }
  return raw;
}

function optionalUrl(
  name: string,
  raw: string | undefined,
  protocols: string[],
): string | undefined {
  if (!raw) return undefined;
  return requireUrl(name, raw, protocols);
}

function integer(name: string, raw: string | undefined, fallback: number, minimum = 0): number {
  const parsed = Number(raw ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return parsed;
}

function bigintValue(name: string, raw: string | undefined, fallback = "0"): bigint {
  try {
    const parsed = BigInt(raw ?? fallback);
    if (parsed < 0n) throw new Error("negative");
    return parsed;
  } catch {
    throw new Error(`${name} must be a non-negative integer string`);
  }
}

function booleanValue(name: string, raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function operationMode(raw: string | undefined): OperationMode {
  const value = raw ?? "shadow";
  if (value === "shadow" || value === "canary" || value === "live") return value;
  throw new Error("OPERATION_MODE must be shadow, canary, or live");
}

function optionalDate(name: string, raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${name} must be an ISO-8601 timestamp`);
  return parsed;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const bulkTokenChunk = integer("BULK_TOKEN_CHUNK", env.BULK_TOKEN_CHUNK, 200, 1);
  if (bulkTokenChunk > 250) {
    throw new Error(
      "BULK_TOKEN_CHUNK must be <= 250 to stay within the verified Multicall3/RPC envelope",
    );
  }
  return {
    rpcHttpUrl: requireUrl("RPC_HTTP_URL", env.RPC_HTTP_URL, ["http:", "https:"]),
    rpcWssUrl: optionalUrl("RPC_WSS_URL", env.RPC_WSS_URL, ["ws:", "wss:"]),
    chainId: integer("CHAIN_ID", env.CHAIN_ID, 4663, 1),
    operationMode: operationMode(env.OPERATION_MODE),
    liveBroadcastEnabled: booleanValue("LIVE_BROADCAST_ENABLED", env.LIVE_BROADCAST_ENABLED, false),
    backfillFromBlock: bigintValue("BACKFILL_FROM_BLOCK", env.BACKFILL_FROM_BLOCK),
    eventChunkBlocks: bigintValue("EVENT_CHUNK_BLOCKS", env.EVENT_CHUNK_BLOCKS, "2000"),
    shadowMaxPositions: integer("SHADOW_MAX_POSITIONS", env.SHADOW_MAX_POSITIONS, 100, 1),
    shadowConcurrency: integer("SHADOW_CONCURRENCY", env.SHADOW_CONCURRENCY, 5, 1),
    bulkTokenChunk,
    dataDir: resolve(env.DATA_DIR ?? "./data"),
    maxGasNativeWei: bigintValue("MAX_GAS_NATIVE_WEI", env.MAX_GAS_NATIVE_WEI),
    maxFailedGasNativeWei: bigintValue("MAX_FAILED_GAS_NATIVE_WEI", env.MAX_FAILED_GAS_NATIVE_WEI),
    minNetProfitNativeWei: bigintValue("MIN_NET_PROFIT_NATIVE_WEI", env.MIN_NET_PROFIT_NATIVE_WEI),
    maxDailyLossNativeWei: bigintValue("MAX_DAILY_LOSS_NATIVE_WEI", env.MAX_DAILY_LOSS_NATIVE_WEI),
    authorizationExpiresAt: optionalDate("AUTHORIZATION_EXPIRES_AT", env.AUTHORIZATION_EXPIRES_AT),
    keystorePath: resolve(
      env.KEYSTORE_PATH ?? `${homedir()}/.config/pools-trade-keeper/keeper.keystore.json`,
    ),
  };
}

export function redactUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  const parsed = new URL(raw);
  return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}/<redacted>`;
}
