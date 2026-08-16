import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface RoundRobinSelection {
  selected: string[];
  nextIndex: number;
}

export function selectRoundRobin(
  tokenIds: readonly string[],
  startIndex: number,
  limit: number,
): RoundRobinSelection {
  if (!Number.isSafeInteger(startIndex) || startIndex < 0)
    throw new Error("startIndex must be non-negative");
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("limit must be positive");
  if (tokenIds.length === 0) return { selected: [], nextIndex: 0 };
  const normalizedStart = startIndex % tokenIds.length;
  const count = Math.min(limit, tokenIds.length);
  const selected = Array.from({ length: count }, (_, offset) => {
    const tokenId = tokenIds[(normalizedStart + offset) % tokenIds.length];
    if (tokenId === undefined) throw new Error("round-robin index invariant violated");
    return tokenId;
  });
  return {
    selected,
    nextIndex: (normalizedStart + count) % tokenIds.length,
  };
}

export async function readRoundRobinCursor(dataDir: string): Promise<number> {
  try {
    const parsed = JSON.parse(await readFile(join(dataDir, "shadow-cursor.json"), "utf8")) as {
      nextIndex?: unknown;
    };
    return Number.isSafeInteger(parsed.nextIndex) && Number(parsed.nextIndex) >= 0
      ? Number(parsed.nextIndex)
      : 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

export async function writeRoundRobinCursor(dataDir: string, nextIndex: number): Promise<void> {
  const path = join(dataDir, "shadow-cursor.json");
  const temporary = `${path}.tmp-${process.pid}`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(
    temporary,
    `${JSON.stringify({ schemaVersion: 1, nextIndex, writtenAt: new Date().toISOString() }, null, 2)}\n`,
    { mode: 0o600 },
  );
  await rename(temporary, path);
}
