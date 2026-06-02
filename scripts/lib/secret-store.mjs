import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

/**
 * Plain-JS mirror of src/lib/security/secret-store.ts, used by the install
 * scripts (which cannot import the app's TypeScript modules). The envelope
 * format, key derivation, and constants are intentionally IDENTICAL so a value
 * encrypted on either side decrypts on the other.
 *
 *   enc:v1:<base64( salt[16] | iv[12] | tag[16] | ciphertext )>
 *
 * Keep this in sync with the TypeScript module.
 */

const VERSION = "v1";
const PREFIX = `enc:${VERSION}:`;
const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const TAG_LENGTH = 16;
const HKDF_INFO = "seqdesk-secret-store";

function resolveKeyMaterial() {
  return (
    process.env.SEQDESK_ENCRYPTION_KEY ||
    process.env.NEXTAUTH_SECRET ||
    process.env.AUTH_SECRET ||
    ""
  );
}

function requireKeyMaterial(operation) {
  const keyMaterial = resolveKeyMaterial();
  if (!keyMaterial) {
    throw new Error(
      `Cannot ${operation} secret: no key material available. ` +
        "Set NEXTAUTH_SECRET (or SEQDESK_ENCRYPTION_KEY) in the environment.",
    );
  }
  return keyMaterial;
}

function deriveKey(salt, keyMaterial) {
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

export function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function encryptSecret(value) {
  if (value === null || value === undefined || value === "") return value;
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

export function decryptSecret(value) {
  if (value === null || value === undefined || value === "") return value;
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
