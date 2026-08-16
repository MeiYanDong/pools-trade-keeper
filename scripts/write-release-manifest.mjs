import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(projectRoot, "dist/release-manifest.json");
const fixedFiles = [
  ".node-version",
  "package.json",
  "package-lock.json",
  "scripts/clean-dist.mjs",
  "scripts/scan-secrets.mjs",
  "scripts/write-release-manifest.mjs",
  "deploy/journald-disk-budget.conf",
  "deploy/package-release.sh",
  "deploy/pools-trade-shadow-runtime.conf",
  "deploy/pools-trade-shadow.service",
  "deploy/verify-shadow.sh",
  "docs/sniper-spec.json",
  "docs/capability-manifest.json",
  "fixtures/historical-claims.json",
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await walk(path)));
    else if (entry.isFile()) paths.push(path);
  }
  return paths;
}

async function digest(path) {
  const content = await readFile(path);
  return {
    path: relative(projectRoot, path).split("\\").join("/"),
    bytes: (await stat(path)).size,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

async function buildManifest() {
  const packageJson = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
  const nodeVersion = (await readFile(resolve(projectRoot, ".node-version"), "utf8")).trim();
  const compiledFiles = await walk(resolve(projectRoot, "dist/src"));
  const paths = [...compiledFiles, ...fixedFiles.map((path) => resolve(projectRoot, path))].sort();
  const files = await Promise.all(paths.map(digest));
  return {
    schemaVersion: 1,
    package: { name: packageJson.name, version: packageJson.version },
    runtime: { node: nodeVersion },
    sourceBinding: {
      liquidityLauncherCommit: "dd8769cd45c0e9450e928513ee129b0af74f7f32",
    },
    files,
  };
}

const expected = buildManifest();
const checkOnly = process.argv.includes("--check");
if (checkOnly) {
  const [actual, wanted] = await Promise.all([
    readFile(manifestPath, "utf8").then(JSON.parse),
    expected,
  ]);
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error("release manifest does not match the current compiled artifact");
  }
  process.stdout.write(`release manifest verified: ${actual.files.length} files\n`);
} else {
  const manifest = await expected;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  process.stdout.write(`release manifest written: ${manifest.files.length} files\n`);
}
