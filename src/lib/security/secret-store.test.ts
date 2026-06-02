import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, isEncrypted } from "./secret-store";
import {
  decryptSecret as decryptSecretMjs,
  encryptSecret as encryptSecretMjs,
} from "../../../scripts/lib/secret-store.mjs";

const ORIGINAL_KEYS = {
  SEQDESK_ENCRYPTION_KEY: process.env.SEQDESK_ENCRYPTION_KEY,
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
  AUTH_SECRET: process.env.AUTH_SECRET,
};

function clearKeys() {
  delete process.env.SEQDESK_ENCRYPTION_KEY;
  delete process.env.NEXTAUTH_SECRET;
  delete process.env.AUTH_SECRET;
}

describe("secret-store", () => {
  beforeEach(() => {
    clearKeys();
    process.env.NEXTAUTH_SECRET = "unit-test-deployment-secret-abcdef";
  });

  afterEach(() => {
    clearKeys();
    for (const [key, value] of Object.entries(ORIGINAL_KEYS)) {
      if (value !== undefined) process.env[key] = value;
    }
  });

  it("round-trips a value through encrypt/decrypt", () => {
    const plaintext = "Webin-12345-super-secret-password";
    const encrypted = encryptSecret(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(isEncrypted(encrypted)).toBe(true);
    expect(decryptSecret(encrypted)).toBe(plaintext);
  });

  it("produces a versioned, non-plaintext envelope", () => {
    const encrypted = encryptSecret("hunter2");
    expect(encrypted.startsWith("enc:v1:")).toBe(true);
    expect(encrypted).not.toContain("hunter2");
  });

  it("uses a fresh nonce so the same plaintext encrypts differently each time", () => {
    const a = encryptSecret("same-input");
    const b = encryptSecret("same-input");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same-input");
    expect(decryptSecret(b)).toBe("same-input");
  });

  it("is idempotent: re-encrypting an already-encrypted value is a no-op", () => {
    const once = encryptSecret("token");
    const twice = encryptSecret(once);
    expect(twice).toBe(once);
    expect(decryptSecret(twice)).toBe("token");
  });

  it("passes legacy plaintext through decrypt unchanged (backward compat)", () => {
    expect(decryptSecret("legacy-plaintext-password")).toBe(
      "legacy-plaintext-password",
    );
  });

  it("legacy plaintext decrypts even without key material", () => {
    clearKeys();
    expect(decryptSecret("still-plaintext")).toBe("still-plaintext");
  });

  it("preserves empty/null/undefined sentinels", () => {
    expect(encryptSecret("")).toBe("");
    expect(encryptSecret(null)).toBeNull();
    expect(encryptSecret(undefined)).toBeUndefined();
    expect(decryptSecret("")).toBe("");
    expect(decryptSecret(null)).toBeNull();
    expect(decryptSecret(undefined)).toBeUndefined();
  });

  it("isEncrypted only matches the versioned prefix", () => {
    expect(isEncrypted("enc:v1:abc")).toBe(true);
    expect(isEncrypted("plaintext")).toBe(false);
    expect(isEncrypted(null)).toBe(false);
    expect(isEncrypted(undefined)).toBe(false);
  });

  it("detects tampering via the GCM auth tag", () => {
    const encrypted = encryptSecret("integrity-protected");
    // Flip a byte in the base64 ciphertext body.
    const body = encrypted.slice("enc:v1:".length);
    const flipped =
      body[0] === "A"
        ? "B" + body.slice(1)
        : "A" + body.slice(1);
    expect(() => decryptSecret("enc:v1:" + flipped)).toThrow();
  });

  it("cannot be decrypted with a different key", () => {
    const encrypted = encryptSecret("key-bound-secret");
    process.env.NEXTAUTH_SECRET = "a-completely-different-secret-value";
    expect(() => decryptSecret(encrypted)).toThrow();
  });

  it("prefers SEQDESK_ENCRYPTION_KEY over NEXTAUTH_SECRET", () => {
    process.env.SEQDESK_ENCRYPTION_KEY = "dedicated-encryption-key";
    const encrypted = encryptSecret("dedicated");
    expect(decryptSecret(encrypted)).toBe("dedicated");
    // Removing the auth secret must not affect decryption when the dedicated key stands.
    delete process.env.NEXTAUTH_SECRET;
    expect(decryptSecret(encrypted)).toBe("dedicated");
  });

  it("throws when encrypting without any key material", () => {
    clearKeys();
    expect(() => encryptSecret("needs-a-key")).toThrow(/key material/i);
  });

  it("throws when decrypting an encrypted value without key material", () => {
    const encrypted = encryptSecret("locked");
    clearKeys();
    expect(() => decryptSecret(encrypted)).toThrow(/key material/i);
  });

  // The install scripts use a plain-JS mirror (scripts/lib/secret-store.mjs).
  // It must be wire-compatible so a profile-provisioned ENA password encrypted
  // at install time decrypts in the running app, and vice versa.
  it("is wire-compatible with the install-script (.mjs) mirror", () => {
    const secret = "Webin-12345-provisioned-by-profile";
    // Encrypted by the install script -> readable by the app.
    expect(decryptSecret(encryptSecretMjs(secret))).toBe(secret);
    // Encrypted by the app -> readable by the install script.
    expect(decryptSecretMjs(encryptSecret(secret))).toBe(secret);
  });
});
