#!/usr/bin/env bash
set -euo pipefail

[[ "$#" -eq 1 ]] || {
  printf 'usage: %s OUTPUT_DIRECTORY\n' "$0" >&2
  exit 2
}

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_dir="$1"
release_id="${RELEASE_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
artifact_path="${output_dir}/pools-trade-shadow-${release_id}.tar.gz"

mkdir -p "${output_dir}"
(
  cd "${project_root}"
  COPYFILE_DISABLE=1 tar --no-xattrs -czf "${artifact_path}" \
    dist .node-version package.json package-lock.json \
    scripts/clean-dist.mjs scripts/scan-secrets.mjs scripts/write-release-manifest.mjs \
    deploy docs/sniper-spec.json docs/capability-manifest.json \
    fixtures/historical-claims.json
)

if tar -tzf "${artifact_path}" | grep -E '(^|/)\._' >/dev/null; then
  printf 'release artifact contains forbidden AppleDouble metadata\n' >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  artifact_sha256="$(sha256sum "${artifact_path}" | awk '{print $1}')"
else
  artifact_sha256="$(shasum -a 256 "${artifact_path}" | awk '{print $1}')"
fi

printf 'release_id=%s\nartifact_path=%s\nartifact_sha256=%s\n' \
  "${release_id}" "${artifact_path}" "${artifact_sha256}"
