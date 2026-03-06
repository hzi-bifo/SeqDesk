export interface ParsedReleaseInfo {
  version: string;
  channel: string;
  releaseDate: string;
  downloadUrl: string;
  checksum: string;
  releaseNotes: string;
  minNodeVersion: string;
  size?: number;
}

export interface ParsedUpdateCheckResponse {
  updateAvailable: boolean;
  latest: ParsedReleaseInfo | null;
}

function expectObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }

  return value as Record<string, unknown>;
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }

  return value.trim();
}

function readOptionalString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value !== "string") {
    throw new Error(`${key} must be a string`);
  }

  return value.trim();
}

function readRequiredBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`${key} must be a boolean`);
  }

  return value;
}

function readOptionalSize(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${key} must be a non-negative integer`);
  }

  return parsed;
}

export function parseReleaseInfoResponse(payload: unknown): ParsedReleaseInfo {
  const record = expectObject(payload, "release payload");

  return {
    version: readRequiredString(record, "version"),
    channel: readOptionalString(record, "channel") || "stable",
    releaseDate: readOptionalString(record, "releaseDate"),
    downloadUrl: readRequiredString(record, "downloadUrl"),
    checksum: readOptionalString(record, "checksum"),
    releaseNotes: readOptionalString(record, "releaseNotes"),
    minNodeVersion: readOptionalString(record, "minNodeVersion"),
    size: readOptionalSize(record, "size"),
  };
}

export function parseUpdateCheckResponse(payload: unknown): ParsedUpdateCheckResponse {
  const record = expectObject(payload, "update response");
  const updateAvailable = readRequiredBoolean(record, "updateAvailable");

  let latest: ParsedReleaseInfo | null = null;
  if (record.latest !== undefined && record.latest !== null) {
    latest = parseReleaseInfoResponse(record.latest);
  }

  if (updateAvailable && !latest) {
    throw new Error("latest is required when updateAvailable is true");
  }

  return {
    updateAvailable,
    latest,
  };
}
