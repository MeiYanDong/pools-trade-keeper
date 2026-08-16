const REQUIRED_SECTIONS = [
  "objective",
  "opportunity",
  "timing",
  "profile",
  "decision",
  "execution",
  "recovery",
  "exit",
  "evidence",
  "capabilities",
  "race_thesis",
  "signal_strategy",
  "competition",
  "shot_policy",
  "race_timeline",
  "opportunity_census",
  "learning",
] as const;

const CAPABILITY_NAMES = [
  "transport",
  "discovery",
  "identity",
  "quote",
  "simulation",
  "calldata",
  "sign",
  "broadcast",
  "reconcile",
  "exit",
  "replay",
] as const;

const CAPABILITY_LEVELS = new Set([
  "UNSUPPORTED",
  "PLANNED",
  "IMPLEMENTED",
  "TESTED",
  "HISTORICAL_RECEIPT",
  "VERIFIED_CURRENT",
]);
const CAPABILITY_ACCESS = new Set(["READ", "PREPARE", "WRITE", "RECOVER"]);
const BLOCKING_MODES = new Set([
  "block",
  "cached",
  "async",
  "degrade",
  "observe",
  "non_blocking",
  "bounded_bypass",
]);
const GATE_GROUPS = ["correctness_invariants", "adaptive_gates", "soft_checks"] as const;
const GATE_FIELDS = [
  "id",
  "condition",
  "risk_reduced",
  "false_block_cost",
  "latency_budget_ms",
  "latency_estimate",
  "voi_estimate",
  "blocking_mode",
  "isolation_scope",
  "fallback",
] as const;

type JsonObject = Record<string, unknown>;

export interface SniperSpecValidation {
  valid: boolean;
  errors: string[];
  gateCounts: Record<(typeof GATE_GROUPS)[number], number>;
}

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readPath(root: JsonObject, path: readonly string[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    const record = object(current);
    if (!record) return undefined;
    current = record[segment];
  }
  return current;
}

function requireEqual(
  root: JsonObject,
  path: readonly string[],
  expected: unknown,
  errors: string[],
): void {
  const actual = readPath(root, path);
  if (actual !== expected) errors.push(`${path.join(".")} must equal ${JSON.stringify(expected)}`);
}

function validateEstimate(value: unknown, path: string, errors: string[]): void {
  const estimate = object(value);
  if (!estimate || (estimate.state !== "KNOWN" && estimate.state !== "UNKNOWN")) {
    errors.push(`${path} must declare state KNOWN or UNKNOWN`);
    return;
  }
  if (estimate.state === "KNOWN" && !text(estimate.basis)) {
    errors.push(`${path}.basis is required for KNOWN evidence`);
  }
  if (estimate.state === "UNKNOWN" && !text(estimate.reason)) {
    errors.push(`${path}.reason is required for UNKNOWN evidence`);
  }
}

function validateGates(spec: JsonObject, errors: string[]) {
  const counts = {
    correctness_invariants: 0,
    adaptive_gates: 0,
    soft_checks: 0,
  };
  const decision = object(spec.decision);
  if (!decision) {
    errors.push("decision must be an object");
    return counts;
  }
  for (const group of GATE_GROUPS) {
    const gates = decision[group];
    if (!Array.isArray(gates) || gates.length === 0) {
      errors.push(`decision.${group} must be a non-empty array`);
      continue;
    }
    counts[group] = gates.length;
    for (const [index, rawGate] of gates.entries()) {
      const path = `decision.${group}[${index}]`;
      const gate = object(rawGate);
      if (!gate) {
        errors.push(`${path} must be an object`);
        continue;
      }
      for (const field of GATE_FIELDS) {
        if (!(field in gate)) errors.push(`${path}.${field} is required`);
      }
      if (!text(gate.id)) errors.push(`${path}.id must be non-empty`);
      if (!text(gate.condition)) errors.push(`${path}.condition must be non-empty`);
      if (!Number.isInteger(gate.latency_budget_ms) || Number(gate.latency_budget_ms) < 0) {
        errors.push(`${path}.latency_budget_ms must be a non-negative integer`);
      }
      if (!BLOCKING_MODES.has(String(gate.blocking_mode))) {
        errors.push(`${path}.blocking_mode is unsupported`);
      }
      if (!text(gate.fallback)) errors.push(`${path}.fallback must be non-empty`);
      validateEstimate(gate.latency_estimate, `${path}.latency_estimate`, errors);
      validateEstimate(gate.voi_estimate, `${path}.voi_estimate`, errors);
    }
  }
  const correctnessIds = new Set(
    Array.isArray(decision.correctness_invariants)
      ? decision.correctness_invariants.map((gate) => object(gate)?.id)
      : [],
  );
  for (const requiredId of ["deployed-bindings-match", "same-block-state"]) {
    if (!correctnessIds.has(requiredId)) errors.push(`missing correctness invariant ${requiredId}`);
  }
  const adaptiveIds = new Set(
    Array.isArray(decision.adaptive_gates)
      ? decision.adaptive_gates.map((gate) => object(gate)?.id)
      : [],
  );
  if (!adaptiveIds.has("executable-exit-and-callback")) {
    errors.push("missing adaptive gate executable-exit-and-callback");
  }
  return counts;
}

function validateCapabilities(spec: JsonObject, errors: string[]): void {
  const capabilities = object(spec.capabilities);
  if (!capabilities) {
    errors.push("capabilities must be an object");
    return;
  }
  for (const name of CAPABILITY_NAMES) {
    const capability = object(capabilities[name]);
    if (!capability) {
      errors.push(`capabilities.${name} is required`);
      continue;
    }
    if (!CAPABILITY_LEVELS.has(String(capability.level))) {
      errors.push(`capabilities.${name}.level is unsupported`);
    }
    if (!CAPABILITY_ACCESS.has(String(capability.access))) {
      errors.push(`capabilities.${name}.access is unsupported`);
    }
    if (!Array.isArray(capability.limitations) || capability.limitations.length === 0) {
      errors.push(`capabilities.${name}.limitations must be non-empty`);
    }
  }
  for (const name of ["calldata", "sign", "broadcast", "exit"]) {
    if (object(capabilities[name])?.level !== "UNSUPPORTED") {
      errors.push(`capabilities.${name}.level must remain UNSUPPORTED in this repository`);
    }
  }
}

export function validateSniperSpec(value: unknown): SniperSpecValidation {
  const errors: string[] = [];
  const spec = object(value);
  const emptyCounts = { correctness_invariants: 0, adaptive_gates: 0, soft_checks: 0 };
  if (!spec)
    return { valid: false, errors: ["spec must be a JSON object"], gateCounts: emptyCounts };

  if (spec.spec_version !== "1.4") errors.push("spec_version must equal 1.4");
  for (const section of REQUIRED_SECTIONS) {
    if (!object(spec[section])) errors.push(`${section} must be an object`);
  }

  requireEqual(spec, ["profile", "chain_id"], 4663, errors);
  requireEqual(spec, ["profile", "operation_mode"], "shadow", errors);
  requireEqual(spec, ["profile", "wallet_scope"], "none", errors);
  requireEqual(spec, ["execution", "mode"], "shadow", errors);
  requireEqual(spec, ["execution", "signing_policy"], "unsupported", errors);
  requireEqual(spec, ["execution", "broadcast_policy"], "unsupported", errors);
  requireEqual(spec, ["shot_policy", "race_experiment", "enabled"], false, errors);
  requireEqual(spec, ["exit", "policy"], "NO_ENTRY_UNTIL_EXECUTABLE_EXIT_EXISTS", errors);
  requireEqual(spec, ["exit", "manual_override"], false, errors);
  requireEqual(spec, ["evidence", "broadcast_attempts"], false, errors);
  requireEqual(spec, ["evidence", "realized_exit_record"], false, errors);
  requireEqual(spec, ["race_thesis", "allocation"], "EXCLUSIVE_STATE_CLAIM", errors);

  const riskBudget = object(readPath(spec, ["objective", "risk_budget"]));
  if (!riskBudget) errors.push("objective.risk_budget must be an object");
  else {
    for (const [name, budget] of Object.entries(riskBudget)) {
      if (budget !== 0) errors.push(`objective.risk_budget.${name} must remain zero`);
    }
  }

  const shotProfiles = readPath(spec, ["shot_policy", "profiles"]);
  if (
    !Array.isArray(shotProfiles) ||
    !shotProfiles.some((entry) => object(entry)?.profile === "NO_SHOT")
  ) {
    errors.push("shot_policy.profiles must include NO_SHOT");
  }
  if (
    Array.isArray(shotProfiles) &&
    shotProfiles.some((entry) => object(entry)?.race_mode !== "SHADOW")
  ) {
    errors.push("all shot_policy profiles must remain SHADOW");
  }

  const gateCounts = validateGates(spec, errors);
  validateCapabilities(spec, errors);
  return { valid: errors.length === 0, errors, gateCounts };
}
