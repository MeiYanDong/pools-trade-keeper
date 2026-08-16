import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CHAIN_ID } from "../src/chain/addresses.js";
import { readRoundRobinCursor, writeRoundRobinCursor } from "../src/discovery/round-robin.js";
import { EvidenceLedger } from "../src/evidence/ledger.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pools-evidence-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("persistent Shadow evidence", () => {
  it("keeps concurrent append records parseable and private", async () => {
    const dataDir = await temporaryDirectory();
    const ledger = new EvidenceLedger(dataDir);
    await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        ledger.append({
          schemaVersion: 1,
          kind: "test_observation",
          observedAt: new Date().toISOString(),
          chainId: CHAIN_ID,
          payload: { index, amount: BigInt(index) },
        }),
      ),
    );
    const lines = (await readFile(ledger.path, "utf8")).trim().split("\n");
    const records = lines.map(
      (line) => JSON.parse(line) as { payload: { index: number; amount: string } },
    );
    expect(records).toHaveLength(25);
    expect(records.map((record) => record.payload.index).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 25 }, (_, index) => index),
    );
    expect(records[24]?.payload.amount).toMatch(/^\d+$/);
    expect((await stat(ledger.path)).mode & 0o777).toBe(0o600);
  });

  it("atomically persists and restores the round-robin cursor", async () => {
    const dataDir = await temporaryDirectory();
    expect(await readRoundRobinCursor(dataDir)).toBe(0);
    await writeRoundRobinCursor(dataDir, 321);
    expect(await readRoundRobinCursor(dataDir)).toBe(321);
    expect((await stat(join(dataDir, "shadow-cursor.json"))).mode & 0o777).toBe(0o600);
  });
});
