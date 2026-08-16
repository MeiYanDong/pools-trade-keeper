import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { EvidenceRecord } from "../domain.js";
import { stringifyJson } from "./json.js";

export class EvidenceLedger {
  readonly path: string;

  constructor(dataDir: string) {
    this.path = join(dataDir, "evidence.jsonl");
  }

  async append<T>(record: EvidenceRecord<T>): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await appendFile(this.path, `${stringifyJson(record, 0)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }
}
