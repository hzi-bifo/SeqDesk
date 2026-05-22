import crypto from "crypto";
import { constants as fsConstants, createReadStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { getResolvedDataBasePath } from "@/lib/files/data-base-path";

export interface WorkbenchStorageBase {
  baseDir: string;
  cacheRoot: string;
  jobsRoot: string;
}

export interface WorkbenchImportStoragePaths extends WorkbenchStorageBase {
  cacheDir: string;
  jobDir: string;
  logPath: string;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(",")}}`;
}

export function buildStableRequestHash(providerId: string, input: unknown): string {
  return crypto
    .createHash("sha256")
    .update(`${providerId}:${stableStringify(input)}`)
    .digest("hex")
    .slice(0, 32);
}

export function sanitizePathSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

export function isPathInsideBase(targetPath: string, basePath: string): boolean {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedBase = path.resolve(basePath);
  const relative = path.relative(resolvedBase, resolvedTarget);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function assertPathInsideBase(
  targetPath: string,
  basePath: string,
  label = "Path"
): void {
  if (!isPathInsideBase(targetPath, basePath)) {
    throw new Error(`${label} must stay inside ${basePath}`);
  }
}

export async function resolveWorkbenchStorageBase(): Promise<WorkbenchStorageBase> {
  const resolved = await getResolvedDataBasePath();
  if (!resolved.dataBasePath) {
    throw new Error("Data base path is not configured. Set it in Admin > Infrastructure before starting Workbench imports.");
  }

  const baseDir = path.join(path.resolve(resolved.dataBasePath), "workbench");
  const cacheRoot = path.join(baseDir, "cache");
  const jobsRoot = path.join(baseDir, "jobs");

  await fs.mkdir(cacheRoot, { recursive: true });
  await fs.mkdir(jobsRoot, { recursive: true });
  await fs.access(baseDir, fsConstants.W_OK);

  return { baseDir, cacheRoot, jobsRoot };
}

export async function resolveWorkbenchImportStorage(args: {
  providerId: string;
  cacheKey: string;
  jobId: string;
}): Promise<WorkbenchImportStoragePaths> {
  const base = await resolveWorkbenchStorageBase();
  const providerSegment = sanitizePathSegment(args.providerId);
  const cacheDir = path.join(base.cacheRoot, providerSegment, args.cacheKey);
  const jobDir = path.join(base.jobsRoot, args.jobId);
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.mkdir(jobDir, { recursive: true });
  return {
    ...base,
    cacheDir,
    jobDir,
    logPath: path.join(jobDir, "import.log"),
  };
}

export async function getPathSizeBytes(targetPath: string): Promise<number> {
  const stat = await fs.stat(targetPath);
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;
  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    total += await getPathSizeBytes(path.join(targetPath, entry.name));
  }
  return total;
}

export async function computeFileSha256(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}
