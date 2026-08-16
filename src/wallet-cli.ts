import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { loadRuntimeConfig } from "./config.js";
import { stringifyJson } from "./evidence/json.js";
import { isSealedKeystore, sealPrivateKey } from "./wallet/sealed-keystore.js";

async function readHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("wallet initialization requires an interactive TTY");
  }
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
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

async function initialize(): Promise<void> {
  const config = loadRuntimeConfig({
    ...process.env,
    RPC_HTTP_URL: process.env.RPC_HTTP_URL ?? "http://wallet-init.invalid",
  });
  process.stdout.write(
    "This creates a new wallet locally and stores only encrypted key material. " +
      "There is no private-key export command. Back up the encrypted file and passphrase separately.\n",
  );
  const first = await readHidden("New passphrase (minimum 14 characters): ");
  const second = await readHidden("Repeat passphrase: ");
  if (first !== second) throw new Error("passphrases do not match");
  if (first.length < 14) throw new Error("passphrase must contain at least 14 characters");

  let privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const sealed = await sealPrivateKey({
    privateKey,
    address: account.address,
    passphrase: first,
  });
  privateKey = "0x";
  await mkdir(dirname(config.keystorePath), { recursive: true, mode: 0o700 });
  await writeFile(config.keystorePath, `${stringifyJson(sealed)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(`Wallet address: ${account.address}\n`);
  process.stdout.write(`Encrypted keystore: ${config.keystorePath}\n`);
  process.stdout.write("Private key was not printed.\n");
}

async function address(): Promise<void> {
  const config = loadRuntimeConfig({
    ...process.env,
    RPC_HTTP_URL: process.env.RPC_HTTP_URL ?? "http://wallet-address.invalid",
  });
  const parsed: unknown = JSON.parse(await readFile(config.keystorePath, "utf8"));
  if (!isSealedKeystore(parsed)) throw new Error("invalid sealed keystore");
  process.stdout.write(`${parsed.address}\n`);
}

const command = process.argv[2];
try {
  if (command === "init") await initialize();
  else if (command === "address") await address();
  else throw new Error("usage: wallet-cli.ts <init|address>");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
