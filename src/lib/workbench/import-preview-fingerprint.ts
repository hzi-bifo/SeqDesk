import { createHash } from "node:crypto";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

// A change detector, not an authorization token. Import always re-resolves server-side.
export function importPreviewFingerprint(providerId: string, input: unknown, preview: unknown): string {
  return createHash("sha256").update(canonical({ version: 1, providerId, input, preview })).digest("hex");
}
