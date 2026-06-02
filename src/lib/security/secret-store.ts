import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

/**
 * Symmetric encryption-at-rest for sensitive settings stored in the database
 * (e.g. the ENA Webin password). Values are encrypted before being written to
 * the `SiteSettings` columns and decrypted when read back for use.
 *
 * Format of an encrypted value:
 *   enc:v1:<base64( salt[16] | iv[12] | tag[16] | ciphertext )>
 *
 * Backward compatibility: any value that does NOT carry the `enc:v1:` prefix is
 * treated as legacy plaintext and returned unchanged by `decryptSecret`, so
 * existing installs keep working. Such values are encrypted automatically the
 * next time they are saved.
 *
 * Key material is derived from the deployment secret (the same high-entropy
 * value already used for NextAuth). Because that material is random rather than
 * a low-entropy password, HKDF is the correct, fast derivation — it is cheap
 * enough to run on every config read. Operators can supply a dedicated
 * `SEQDESK_ENCRYPTION_KEY` to decouple it from the auth secret.
 */

const VERSION = "v1";
const PREFIX = `enc:${VERSION}:`;
const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // AES-256
const IV_LENGTH = 12; // GCM standard nonce length
const SALT_LENGTH = 16;
const TAG_LENGTH = 16;
const HKDF_INFO = "seqdesk-secret-store";

function resolveKeyMaterial(): string {
  return (
    process.env.SEQDESK_ENCRYPTION_KEY ||
    process.env.NEXTAUTH_SECRET ||
    process.env.AUTH_SECRET ||
    ""
  );
}

function requireKeyMaterial(operation: "encrypt" | "decrypt"): string {
  const keyMaterial = resolveKeyMaterial();
  if (!keyMaterial) {
    throw new Error(
      `Cannot ${operation} secret: no key material available. ` +
        "Set NEXTAUTH_SECRET (or SEQDESK_ENCRYPTION_KEY) in the environment.",
    );
  }
  return keyMaterial;
}

function deriveKey(salt: Buffer, keyMaterial: string): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(keyMaterial, "utf8"),
      salt,
      Buffer.from(HKDF_INFO, "utf8"),
      KEY_LENGTH,
    ),
  );
}

/** True when the value is one this module produced (carries the version prefix). */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function encryptSecret(value: string): string;
export function encryptSecret(value: null): null;
export function encryptSecret(value: undefined): undefined;
export function encryptSecret(
  value: string | null | undefined,
): string | null | undefined;
export function encryptSecret(
  value: string | null | undefined,
): string | null | undefined {
  // Preserve "no value" sentinels exactly so callers keep their clear/keep
  // semantics (empty string clears, null/undefined leaves unset).
  if (value === null || value === undefined || value === "") return value;
  // Idempotent: never double-wrap an already-encrypted value.
  if (isEncrypted(value)) return value;

  const keyMaterial = requireKeyMaterial("encrypt");
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = deriveKey(salt, keyMaterial);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  const packed = Buffer.concat([salt, iv, tag, ciphertext]);
  return PREFIX + packed.toString("base64");
}

export function decryptSecret(value: string): string;
export function decryptSecret(value: null): null;
export function decryptSecret(value: undefined): undefined;
export function decryptSecret(
  value: string | null | undefined,
): string | null | undefined;
export function decryptSecret(
  value: string | null | undefined,
): string | null | undefined {
  if (value === null || value === undefined || value === "") return value;
  // Legacy plaintext (written before encryption was introduced) — pass through
  // unchanged. No key material is required for this path.
  if (!isEncrypted(value)) return value;

  const keyMaterial = requireKeyMaterial("decrypt");
  const packed = Buffer.from(value.slice(PREFIX.length), "base64");

  const salt = packed.subarray(0, SALT_LENGTH);
  const iv = packed.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = packed.subarray(
    SALT_LENGTH + IV_LENGTH,
    SALT_LENGTH + IV_LENGTH + TAG_LENGTH,
  );
  const ciphertext = packed.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  const key = deriveKey(salt, keyMaterial);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
