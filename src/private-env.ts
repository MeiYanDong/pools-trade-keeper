import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const DEFAULT_PRIVATE_ENV_PATH = resolve("secrets/keeper.env");

export async function loadPrivateEnvFile(path = DEFAULT_PRIVATE_ENV_PATH): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  for (const [lineIndex, original] of raw.split(/\r?\n/u).entries()) {
    const line = original.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error(`invalid private env line ${lineIndex + 1}`);
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!/^[A-Z][A-Z0-9_]*$/u.test(key)) {
      throw new Error(`invalid private env key on line ${lineIndex + 1}`);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return true;
}
