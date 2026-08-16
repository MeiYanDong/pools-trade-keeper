import { describe, expect, it } from "vitest";
import { loadRuntimeConfig, redactUrl } from "../src/config.js";
import { assessAuthorization } from "../src/decision/authorization.js";

describe("runtime config", () => {
  it("defaults to shadow and zero live budgets", () => {
    const config = loadRuntimeConfig({ RPC_HTTP_URL: "https://rpc.example/secret-token" });
    expect(config.operationMode).toBe("shadow");
    expect(config.liveBroadcastEnabled).toBe(false);
    expect(config.maxDailyLossNativeWei).toBe(0n);
    expect(redactUrl(config.rpcHttpUrl)).toBe("https://rpc.example/<redacted>");
  });

  it("never grants live authorization in this version", () => {
    const config = loadRuntimeConfig({
      RPC_HTTP_URL: "https://rpc.example/secret-token",
      OPERATION_MODE: "live",
      LIVE_BROADCAST_ENABLED: "true",
      MAX_GAS_NATIVE_WEI: "1",
      MAX_FAILED_GAS_NATIVE_WEI: "1",
      MIN_NET_PROFIT_NATIVE_WEI: "1",
      MAX_DAILY_LOSS_NATIVE_WEI: "1",
      AUTHORIZATION_EXPIRES_AT: "2099-01-01T00:00:00Z",
    });
    const authorization = assessAuthorization(config, new Date("2026-01-01T00:00:00Z"));
    expect(authorization.liveAuthorized).toBe(false);
    expect(authorization.blockers).toContain("signing_capability_unsupported");
    expect(authorization.blockers).toContain("broadcast_capability_unsupported");
  });

  it("rejects unverified bulk multicall sizes", () => {
    expect(() =>
      loadRuntimeConfig({
        RPC_HTTP_URL: "https://rpc.example/secret-token",
        BULK_TOKEN_CHUNK: "251",
      }),
    ).toThrow("BULK_TOKEN_CHUNK must be <= 250");
  });
});
