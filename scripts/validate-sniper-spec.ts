import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateSniperSpec } from "../src/spec/sniper-spec.js";

const specFlag = process.argv.indexOf("--spec");
const specPath = specFlag >= 0 ? process.argv[specFlag + 1] : undefined;
if (!specPath) throw new Error("usage: validate-sniper-spec.ts --spec <path>");

const parsed = JSON.parse(await readFile(resolve(specPath), "utf8"));
const validation = validateSniperSpec(parsed);
if (!validation.valid) {
  for (const error of validation.errors) process.stderr.write(`sniper-spec-validator: ${error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`sniper-spec-validator: VALID ${specPath}\n`);
  process.stdout.write(
    `gate_counts: correctness_invariants=${validation.gateCounts.correctness_invariants} adaptive_gates=${validation.gateCounts.adaptive_gates} soft_checks=${validation.gateCounts.soft_checks}\n`,
  );
  process.stdout.write("execution_boundary: shadow=true no_shot=true sign=false broadcast=false\n");
}
