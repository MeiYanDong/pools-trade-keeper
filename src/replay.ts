import { readFile } from "node:fs/promises";
import { z } from "zod";
import { historicalNetNative } from "./decision/economics.js";

const unsignedInteger = z.string().regex(/^\d+$/);
const signedInteger = z.string().regex(/^-?\d+$/);

export const historicalFixtureSchema = z
  .object({
    id: z.string().min(1),
    evidenceKind: z.enum(["MARK_TO_MARKET", "REALIZED_NATIVE_RESIDUAL"]),
    tokenId: unsignedInteger,
    blockNumber: unsignedInteger,
    transactionHash: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .optional(),
    sourceUrl: z.string().url(),
    grossNativeWei: unsignedInteger,
    gasCostNativeWei: unsignedInteger,
    expectedNetNativeWei: signedInteger,
    evidenceLevel: z.string().min(1),
  })
  .superRefine((fixture, context) => {
    if (fixture.evidenceKind === "REALIZED_NATIVE_RESIDUAL" && !fixture.transactionHash) {
      context.addIssue({
        code: "custom",
        path: ["transactionHash"],
        message: "realized residual evidence requires a transaction hash",
      });
    }
  });

const historicalFixturesSchema = z.array(historicalFixtureSchema).min(1);

export interface ReplayResult {
  id: string;
  passed: boolean;
  calculatedNetNativeWei: bigint;
  expectedNetNativeWei: bigint;
  evidenceKind: "MARK_TO_MARKET" | "REALIZED_NATIVE_RESIDUAL";
  evidenceLevel: string;
  sourceUrl: string;
}

export async function replayHistoricalFixtures(url: URL): Promise<ReplayResult[]> {
  const fixtures = historicalFixturesSchema.parse(JSON.parse(await readFile(url, "utf8")));
  return fixtures.map((fixture) => {
    const calculated = historicalNetNative(
      BigInt(fixture.grossNativeWei),
      BigInt(fixture.gasCostNativeWei),
    );
    const expected = BigInt(fixture.expectedNetNativeWei);
    return {
      id: fixture.id,
      passed: calculated === expected,
      calculatedNetNativeWei: calculated,
      expectedNetNativeWei: expected,
      evidenceKind: fixture.evidenceKind,
      evidenceLevel: fixture.evidenceLevel,
      sourceUrl: fixture.sourceUrl,
    };
  });
}
