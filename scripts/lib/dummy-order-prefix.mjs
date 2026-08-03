/**
 * Build the owner-specific portion of deterministic dummy-order numbers.
 *
 * The readable prefix alone is not globally unique, so retain a short portion
 * of it and add two independent hashes of the complete user id. Keep this in
 * a plain ESM module because both the TypeScript seed code and Node-only CI
 * runtime scripts need to derive exactly the same order-number prefix.
 */
export function buildDummyOrderOwnerPrefix(userId) {
  const value = String(userId || "");
  const normalized = value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (!normalized) return "USER";

  let fnv = 0x811c9dc5;
  let djb = 5381;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    fnv = Math.imul(fnv ^ code, 0x01000193);
    djb = Math.imul(djb, 33) ^ code;
  }
  const hashPart = (hash) =>
    (hash >>> 0).toString(36).toUpperCase().padStart(7, "0");
  return `${normalized.slice(0, 4)}${hashPart(fnv)}${hashPart(djb)}`;
}
