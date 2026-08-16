import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const excludedDirectories = new Set([".git", "dist", "node_modules"]);
const maxFileBytes = 2 * 1024 * 1024;

const rules = [
  {
    id: "private-key-pem",
    pattern: new RegExp(["-----BEGIN ", "(?:RSA |EC |OPENSSH )?PRIVATE KEY-----"].join(""), "i"),
  },
  {
    id: "private-key-assignment",
    pattern: /\b(?:PRIVATE_KEY|WALLET_PRIVATE_KEY)\s*[:=]\s*["']?(?:0x)?[a-f0-9]{64}\b/i,
  },
  {
    id: "seed-phrase-assignment",
    pattern: /\b(?:MNEMONIC|SEED_PHRASE)\s*[:=]\s*["'][^"'\n]{20,}["']/i,
  },
  {
    id: "credentialed-chainstack-url",
    pattern: /(?:https?|wss):\/\/[^\s"'`]*chainstack\.com\/[a-z0-9_-]{16,}/i,
  },
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === ".DS_Store") continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) files.push(...(await walk(path)));
    } else if (entry.isFile() && (await stat(path)).size <= maxFileBytes) {
      files.push(path);
    }
  }
  return files;
}

const findings = [];
for (const path of await walk(projectRoot)) {
  const content = await readFile(path, "utf8");
  for (const rule of rules) {
    if (rule.pattern.test(content)) {
      findings.push({ file: relative(projectRoot, path), rule: rule.id });
    }
  }
}

if (findings.length > 0) {
  process.stderr.write(
    `secret scan failed:\n${findings.map(({ file, rule }) => `- ${file}: ${rule}`).join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(`secret scan passed: ${rules.length} high-confidence rules\n`);
}
