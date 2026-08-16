#!/usr/bin/env bash
set -euo pipefail

umask 077

APP_DIR="${APP_DIR:-/opt/pools-trade-keeper}"
ENV_FILE="${ENV_FILE:-/etc/pools-trade-keeper/keeper.env}"
SERVICE_NAME="${SERVICE_NAME:-pools-trade-shadow.service}"
RUNTIME_USER="${RUNTIME_USER:-pools-keeper}"
NODE_BIN="${NODE_BIN:-node}"
VERIFY_DATA_DIR="${VERIFY_DATA_DIR:-/var/lib/pools-trade-keeper}"
MAX_EVIDENCE_AGE_SECONDS="${MAX_EVIDENCE_AGE_SECONDS:-180}"
MAX_BLOCK_LAG="${MAX_BLOCK_LAG:-500}"
MAX_DISK_USED_PERCENT="${MAX_DISK_USED_PERCENT:-89}"
MAX_SERVICE_RESTARTS="${MAX_SERVICE_RESTARTS:-0}"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command is missing: $1"
}

[[ "${EUID}" -eq 0 ]] || fail "run as root so the protected EnvironmentFile can be loaded"
for command_name in awk date df grep jq readlink runuser stat systemctl tail; do
  require_command "${command_name}"
done
if [[ "${NODE_BIN}" != */* ]]; then
  require_command "${NODE_BIN}"
  NODE_BIN="$(command -v "${NODE_BIN}")"
fi
[[ -x "${NODE_BIN}" ]] || fail "Node.js runtime is not executable: ${NODE_BIN}"
NODE_BIN="$(readlink -f "${NODE_BIN}")"
for threshold in \
  "${MAX_EVIDENCE_AGE_SECONDS}" \
  "${MAX_BLOCK_LAG}" \
  "${MAX_DISK_USED_PERCENT}" \
  "${MAX_SERVICE_RESTARTS}"; do
  [[ "${threshold}" =~ ^[0-9]+$ ]] || fail "verification thresholds must be non-negative integers"
done

[[ -d "${APP_DIR}" ]] || fail "application directory is missing: ${APP_DIR}"
[[ -f "${ENV_FILE}" ]] || fail "environment file is missing: ${ENV_FILE}"
[[ "$(stat -c '%a' "${ENV_FILE}")" == "600" ]] || fail "environment file mode must be 600"
[[ "$(stat -c '%U:%G' "${ENV_FILE}")" == "root:root" ]] || fail "environment file must be root:root"

systemctl is-active --quiet "${SERVICE_NAME}" || fail "service is not active"
systemctl is-enabled --quiet "${SERVICE_NAME}" || fail "service is not enabled"
service_restarts="$(systemctl show "${SERVICE_NAME}" --property=NRestarts --value)"
[[ "${service_restarts}" =~ ^[0-9]+$ ]] || fail "service restart count is not numeric"
(( service_restarts <= MAX_SERVICE_RESTARTS )) || fail "service restart count exceeds threshold"
service_exec_start="$(systemctl show "${SERVICE_NAME}" --property=ExecStart --value)"
grep -F -- "${NODE_BIN}" <<<"${service_exec_start}" >/dev/null \
  || fail "service is not configured to use the verified Node.js runtime: ${NODE_BIN}"

expected_node_version="$(<"${APP_DIR}/.node-version")"
actual_node_version="$("${NODE_BIN}" --version)"
actual_node_version="${actual_node_version#v}"
[[ "${actual_node_version}" == "${expected_node_version}" ]] \
  || fail "Node.js mismatch: expected ${expected_node_version}, got ${actual_node_version}"

(
  cd "${APP_DIR}"
  "${NODE_BIN}" scripts/write-release-manifest.mjs --check
) >/dev/null || fail "release artifact hash verification failed"

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a
runtime_data_dir="${DATA_DIR:-${VERIFY_DATA_DIR}}"
[[ -f "${runtime_data_dir}/evidence.jsonl" ]] || fail "evidence ledger is missing"

run_as_runtime() {
  runuser --preserve-environment -u "${RUNTIME_USER}" -- "$@"
}

doctor_output="$(cd "${APP_DIR}" && run_as_runtime "${NODE_BIN}" dist/src/cli.js doctor)" \
  || fail "read-only doctor command failed"
jq -e '
  .status == "PASS"
  and .mode == "READ_ONLY"
  and .authorization.effectiveMode == "shadow"
  and .authorization.liveAuthorized == false
' <<<"${doctor_output}" >/dev/null || fail "doctor did not prove the read-only Shadow boundary"

replay_output="$(cd "${APP_DIR}" && run_as_runtime "${NODE_BIN}" dist/src/cli.js replay)" \
  || fail "historical replay command failed"
jq -e '.status == "PASS" and ([.results[].passed] | all)' <<<"${replay_output}" >/dev/null \
  || fail "historical replay did not pass"

latest_summary="$(grep -F '"kind":"shadow_batch_summary"' "${runtime_data_dir}/evidence.jsonl" | tail -n 1)"
[[ -n "${latest_summary}" ]] || fail "no Shadow batch summary exists"
jq -e '
  .schemaVersion == 1
  and .chainId == 4663
  and .payload.shots == 0
  and .payload.errors == 0
' <<<"${latest_summary}" >/dev/null || fail "latest batch has errors, shots, or an invalid schema"

observed_at="$(jq -er '.observedAt' <<<"${latest_summary}")"
observed_epoch="$(date -d "${observed_at}" +%s)" || fail "latest evidence timestamp is invalid"
now_epoch="$(date +%s)"
evidence_age=$((now_epoch - observed_epoch))
(( evidence_age >= 0 && evidence_age <= MAX_EVIDENCE_AGE_SECONDS )) \
  || fail "latest evidence is stale: ${evidence_age}s"

chain_block="$(jq -er '.observedAtBlock | tonumber' <<<"${doctor_output}")"
evidence_block="$(jq -er '.payload.fixedBlock | tonumber' <<<"${latest_summary}")"
block_lag=$((chain_block - evidence_block))
(( block_lag >= 0 && block_lag <= MAX_BLOCK_LAG )) \
  || fail "latest evidence block lag is outside the allowed envelope: ${block_lag}"

disk_used_percent="$(df -P "${runtime_data_dir}" | tail -n 1 | awk '{gsub(/%/, "", $5); print $5}')"
[[ "${disk_used_percent}" =~ ^[0-9]+$ ]] || fail "disk usage is not numeric"
(( disk_used_percent <= MAX_DISK_USED_PERCENT )) \
  || fail "disk usage ${disk_used_percent}% exceeds ${MAX_DISK_USED_PERCENT}%"

jq -n \
  --arg service "${SERVICE_NAME}" \
  --arg node "${actual_node_version}" \
  --arg nodeBin "${NODE_BIN}" \
  --argjson restarts "${service_restarts}" \
  --argjson evidenceAgeSeconds "${evidence_age}" \
  --argjson evidenceBlock "${evidence_block}" \
  --argjson chainBlock "${chain_block}" \
  --argjson diskUsedPercent "${disk_used_percent}" \
  '{
    status: "PASS",
    mode: "READ_ONLY_SHADOW",
    service: $service,
    node: $node,
    nodeBin: $nodeBin,
    restarts: $restarts,
    evidenceAgeSeconds: $evidenceAgeSeconds,
    evidenceBlock: $evidenceBlock,
    chainBlock: $chainBlock,
    diskUsedPercent: $diskUsedPercent,
    shots: 0
  }'
