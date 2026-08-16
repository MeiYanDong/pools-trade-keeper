import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { sealPrivateKey } from "../src/wallet/sealed-keystore.js";

describe("sealed keystore", () => {
  it("does not contain plaintext private-key bytes", async () => {
    const privateKey = `0x${"11".repeat(32)}` as const;
    const account = privateKeyToAccount(privateKey);
    const sealed = await sealPrivateKey({
      privateKey,
      address: account.address,
      passphrase: "test-only-passphrase-1234",
      now: new Date("2026-08-15T00:00:00Z"),
    });
    const serialized = JSON.stringify(sealed);
    expect(serialized).not.toContain(privateKey.slice(2));
    expect(sealed.address).toBe(account.address);
    expect(sealed.crypto.ciphertext.length).toBeGreaterThan(20);
  });
});
