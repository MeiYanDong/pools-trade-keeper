import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { replayHistoricalFixtures } from "../src/replay.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("historical replay", () => {
  it("separates mark-to-market arithmetic from two realized native residual receipts", async () => {
    const results = await replayHistoricalFixtures(
      new URL("../fixtures/historical-claims.json", import.meta.url),
    );
    expect(results).toHaveLength(3);
    expect(results.every((result) => result.passed)).toBe(true);
    expect(results.filter((result) => result.evidenceKind === "MARK_TO_MARKET")).toHaveLength(1);
    expect(
      results.filter((result) => result.evidenceKind === "REALIZED_NATIVE_RESIDUAL"),
    ).toHaveLength(2);
    expect(results[0]?.evidenceLevel).toContain("not realized token exit");
    expect(results[1]).toMatchObject({
      evidenceKind: "REALIZED_NATIVE_RESIDUAL",
      calculatedNetNativeWei: 647_973_537_785_485n,
    });
    expect(results[2]).toMatchObject({
      evidenceKind: "REALIZED_NATIVE_RESIDUAL",
      calculatedNetNativeWei: 559_865_148_596_908n,
    });
  });

  it("rejects a claimed realized receipt that has no transaction hash", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pools-replay-"));
    temporaryDirectories.push(directory);
    const fixturePath = join(directory, "invalid.json");
    await writeFile(
      fixturePath,
      JSON.stringify([
        {
          id: "invalid-realized-claim",
          evidenceKind: "REALIZED_NATIVE_RESIDUAL",
          tokenId: "1",
          blockNumber: "1",
          sourceUrl: "https://example.com/tx/1",
          grossNativeWei: "2",
          gasCostNativeWei: "1",
          expectedNetNativeWei: "1",
          evidenceLevel: "invalid because it has no transaction hash",
        },
      ]),
    );
    await expect(replayHistoricalFixtures(pathToFileURL(fixturePath))).rejects.toThrow(
      "realized residual evidence requires a transaction hash",
    );
  });
});
