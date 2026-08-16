import type { Address } from "viem";

export const CHAIN_ID = 4663;

export const ADDRESSES = {
  compoundingClaimRecipient: "0xf9526Dd3361fe0ba6b7a99533ed471D3E808E99a",
  creatorFeeSplitter: "0xeFF166AAf189323c58dc27eD1206EB2C37FaACDf",
  noCreatorFeeSplitter: "0x222D6d4f1ce59b0d48D5505114eC8Addc90A4359",
  poolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  positionManager: "0x58daec3116aae6d93017baaea7749052e8a04fa7",
  stateView: "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b",
  quoter: "0x8dc178efb8111bb0973dd9d722ebeff267c98f94",
  universalRouter: "0x8876789976decbfcbbbe364623c63652db8c0904",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  native: "0x0000000000000000000000000000000000000000",
} as const satisfies Record<string, Address>;

export const PINNED_LIQUIDITY_LAUNCHER_COMMIT = "dd8769cd45c0e9450e928513ee129b0af74f7f32";
export const REQUIRED_LIQUIDITY_INCREASE = 100_000_000_000_000_000_000n;
