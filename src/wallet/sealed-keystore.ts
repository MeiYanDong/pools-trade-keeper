import { createCipheriv, randomBytes, scrypt as nodeScrypt } from "node:crypto";
import type { Address, Hex } from "viem";

export interface SealedKeystore {
  version: 1;
  address: Address;
  createdAt: string;
  crypto: {
    cipher: "aes-256-gcm";
    ciphertext: string;
    iv: string;
    authTag: string;
    kdf: "scrypt";
    salt: string;
    params: {
      N: number;
      r: number;
      p: number;
      keyLength: number;
    };
  };
}

const SCRYPT_PARAMS = {
  N: 1 << 17,
  r: 8,
  p: 1,
  keyLength: 32,
} as const;

function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(
      passphrase,
      salt,
      SCRYPT_PARAMS.keyLength,
      {
        N: SCRYPT_PARAMS.N,
        r: SCRYPT_PARAMS.r,
        p: SCRYPT_PARAMS.p,
        maxmem: 256 * 1024 * 1024,
      },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

export async function sealPrivateKey(input: {
  privateKey: Hex;
  address: Address;
  passphrase: string;
  now?: Date;
}): Promise<SealedKeystore> {
  if (input.passphrase.length < 14)
    throw new Error("passphrase must contain at least 14 characters");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(input.passphrase, salt);
  const plaintext = Buffer.from(input.privateKey.slice(2), "hex");
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      version: 1,
      address: input.address,
      createdAt: (input.now ?? new Date()).toISOString(),
      crypto: {
        cipher: "aes-256-gcm",
        ciphertext: ciphertext.toString("base64"),
        iv: iv.toString("base64"),
        authTag: authTag.toString("base64"),
        kdf: "scrypt",
        salt: salt.toString("base64"),
        params: SCRYPT_PARAMS,
      },
    };
  } finally {
    plaintext.fill(0);
    key.fill(0);
  }
}

export function isSealedKeystore(value: unknown): value is SealedKeystore {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SealedKeystore>;
  return (
    candidate.version === 1 &&
    typeof candidate.address === "string" &&
    candidate.address.startsWith("0x") &&
    candidate.crypto?.cipher === "aes-256-gcm" &&
    candidate.crypto.kdf === "scrypt"
  );
}
