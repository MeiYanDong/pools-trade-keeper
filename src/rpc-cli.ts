import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { redactUrl } from "./config.js";
import { DEFAULT_PRIVATE_ENV_PATH } from "./private-env.js";

async function readHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("RPC initialization requires an interactive TTY");
  }
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise((resolveValue, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolveValue(value);
    };
    const onData = (chunk: string) => {
      if (chunk === "\u0003") return finish(new Error("cancelled"));
      if (chunk === "\r" || chunk === "\n") return finish();
      if (chunk === "\u007f" || chunk === "\b") {
        value = value.slice(0, -1);
        return;
      }
      if (!chunk.startsWith("\u001b")) value += chunk;
    };
    process.stdin.on("data", onData);
  });
}

function validateEndpoint(name: string, raw: string, protocols: readonly string[]): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} is not a valid URL`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${name} must use ${protocols.join(" or ")}`);
  }
  if (/[\r\n]/u.test(raw)) throw new Error(`${name} contains a forbidden newline`);
  return raw;
}

async function initialize(): Promise<void> {
  const outputPath = resolve(process.env.RPC_ENV_PATH ?? DEFAULT_PRIVATE_ENV_PATH);
  process.stdout.write(
    "Paste the credentialed endpoints at the hidden prompts. Values are not echoed and the file is created with mode 0600.\n",
  );
  const http = validateEndpoint("RPC HTTP URL", await readHidden("RPC HTTP URL: "), [
    "http:",
    "https:",
  ]);
  const wss = validateEndpoint("RPC WSS URL", await readHidden("RPC WSS URL: "), ["ws:", "wss:"]);
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeFile(outputPath, `RPC_HTTP_URL=${http}\nRPC_WSS_URL=${wss}\nCHAIN_ID=4663\n`, {
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(`Saved private RPC configuration: ${outputPath}\n`);
  process.stdout.write(`HTTP endpoint: ${redactUrl(http)}\n`);
  process.stdout.write(`WSS endpoint: ${redactUrl(wss)}\n`);
  process.stdout.write("Credential tokens were not printed.\n");
}

try {
  if (process.argv[2] === "init") await initialize();
  else throw new Error("usage: rpc-cli.ts init");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
