import { createPublicClient, defineChain, http, type PublicClient } from "viem";
import type { RuntimeConfig } from "../config.js";

export type KeeperPublicClient = PublicClient;

export function createKeeperPublicClient(config: RuntimeConfig): KeeperPublicClient {
  const chain = defineChain({
    id: config.chainId,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: [config.rpcHttpUrl] },
    },
    contracts: {
      multicall3: {
        address: "0xcA11bde05977b3631167028862bE2a173976CA11",
        blockCreated: 0,
      },
    },
  });

  return createPublicClient({
    chain,
    transport: http(config.rpcHttpUrl, {
      batch: false,
      retryCount: 3,
      timeout: 12_000,
    }),
  });
}
