import { rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distPath = resolve(projectRoot, "dist");
if (dirname(distPath) !== projectRoot || basename(distPath) !== "dist") {
  throw new Error("refusing to clean an unexpected path");
}
await rm(distPath, { recursive: true, force: true });
process.stdout.write("cleaned generated dist directory\n");
