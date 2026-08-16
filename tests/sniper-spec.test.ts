import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { validateSniperSpec } from "../src/spec/sniper-spec.js";

async function currentSpec(): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(new URL("../docs/sniper-spec.json", import.meta.url), "utf8"),
  ) as Record<string, unknown>;
}

describe("self-contained sniper specification gate", () => {
  it("accepts the repository Shadow specification and its required gates", async () => {
    const result = validateSniperSpec(await currentSpec());
    expect(result).toEqual({
      valid: true,
      errors: [],
      gateCounts: { correctness_invariants: 2, adaptive_gates: 1, soft_checks: 1 },
    });
  });

  it("rejects broadcast capability or removal of same-block correctness", async () => {
    const spec = await currentSpec();
    const execution = spec.execution as Record<string, unknown>;
    execution.broadcast_policy = "enabled";
    const capabilities = spec.capabilities as Record<string, Record<string, unknown>>;
    const broadcast = capabilities.broadcast;
    if (!broadcast) throw new Error("test fixture is missing broadcast capability");
    broadcast.level = "IMPLEMENTED";
    const decision = spec.decision as Record<string, unknown>;
    decision.correctness_invariants = [];

    const result = validateSniperSpec(spec);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('execution.broadcast_policy must equal "unsupported"');
    expect(result.errors).toContain(
      "capabilities.broadcast.level must remain UNSUPPORTED in this repository",
    );
    expect(result.errors).toContain("missing correctness invariant same-block-state");
  });
});
