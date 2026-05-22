import fs from "fs/promises";
import os from "os";
import path from "path";
import type {
  WorkbenchImportPreview,
  WorkbenchImportStartContext,
} from "@/lib/workbench/importers/types";
import {
  assertPathInsideBase,
  sanitizePathSegment,
  type WorkbenchImportStoragePaths,
} from "@/lib/workbench/storage";

export type WorkbenchIntegrationKind = "importer" | "store-tool" | "pipeline" | "analysis";
export type WorkbenchIntegrationFixtureMode = "fixture" | "mocked" | "fixture-and-live" | "live";

export interface WorkbenchIntegrationTestSpec {
  id: string;
  kind: WorkbenchIntegrationKind;
  fixtureMode: WorkbenchIntegrationFixtureMode;
  requiredLayers: Array<"contract" | "execution" | "security" | "ui-api">;
  expectedOutputs: string[];
  allowedWriteRoots: string[];
  maxRuntimeMs: number;
  maxDownloadBytes?: number;
  liveSmoke?: {
    command: string;
    input: unknown;
    maxRuntimeMs: number;
    maxDownloadBytes?: number;
  };
}

export interface WorkbenchTestTempRoot {
  rootDir: string;
  cleanup(): Promise<void>;
}

export interface MockCommandResult {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

export interface MockCommandInvocation {
  command: string;
  args: string[];
}

export const WORKBENCH_REQUIRED_TEST_LAYERS = [
  "contract",
  "execution",
  "security",
  "ui-api",
] as const;

export async function createWorkbenchTestTempRoot(
  prefix = "seqdesk-workbench-test-"
): Promise<WorkbenchTestTempRoot> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return {
    rootDir,
    cleanup: () => fs.rm(rootDir, { recursive: true, force: true }),
  };
}

export async function createWorkbenchTestStoragePaths(args: {
  rootDir: string;
  providerId?: string;
  cacheKey?: string;
  jobId?: string;
}): Promise<WorkbenchImportStoragePaths> {
  const providerId = sanitizePathSegment(args.providerId || "test-provider");
  const cacheKey = args.cacheKey || "cache-key";
  const jobId = args.jobId || "job-1";
  const baseDir = path.join(args.rootDir, "workbench");
  const cacheRoot = path.join(baseDir, "cache");
  const jobsRoot = path.join(baseDir, "jobs");
  const cacheDir = path.join(cacheRoot, providerId, cacheKey);
  const jobDir = path.join(jobsRoot, jobId);
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.mkdir(jobDir, { recursive: true });
  return {
    baseDir,
    cacheRoot,
    jobsRoot,
    cacheDir,
    jobDir,
    logPath: path.join(jobDir, "import.log"),
  };
}

export function assertWorkbenchPathInsideAllowedRoots(args: {
  targetPath: string;
  allowedRoots: string[];
  label?: string;
}): void {
  const allowed = args.allowedRoots.some((root) => {
    try {
      assertPathInsideBase(args.targetPath, root, args.label);
      return true;
    } catch {
      return false;
    }
  });
  if (!allowed) {
    throw new Error(
      `${args.label || "Workbench path"} must stay inside one of: ${args.allowedRoots.join(", ")}`
    );
  }
}

export function assertJsonSerializable(value: unknown, label = "value"): void {
  try {
    JSON.stringify(value);
  } catch (error) {
    throw new Error(
      `${label} must be JSON serializable: ${
        error instanceof Error ? error.message : "unknown serialization error"
      }`
    );
  }
}

export function assertSerializedWorkbenchDataset(value: unknown): void {
  assertJsonSerializable(value, "Serialized Workbench dataset");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Serialized Workbench dataset must be an object.");
  }
  const record = value as Record<string, unknown>;
  for (const key of ["id", "providerId", "name", "sourceType", "status", "createdAt", "updatedAt"]) {
    if (typeof record[key] !== "string" || !record[key]) {
      throw new Error(`Serialized Workbench dataset requires string field ${key}.`);
    }
  }
}

export function assertSerializedWorkbenchImportJob(value: unknown): void {
  assertJsonSerializable(value, "Serialized Workbench import job");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Serialized Workbench import job must be an object.");
  }
  const record = value as Record<string, unknown>;
  for (const key of ["id", "providerId", "status", "createdAt", "updatedAt"]) {
    if (typeof record[key] !== "string" || !record[key]) {
      throw new Error(`Serialized Workbench import job requires string field ${key}.`);
    }
  }
}

export function createMockCommandRunner(
  handler?: (invocation: MockCommandInvocation) => Promise<MockCommandResult> | MockCommandResult
) {
  const invocations: MockCommandInvocation[] = [];
  return {
    invocations,
    async run(command: string, args: string[] = []): Promise<MockCommandResult> {
      const invocation = { command, args };
      invocations.push(invocation);
      return handler ? handler(invocation) : { stdout: "", stderr: "", exitCode: 0 };
    },
  };
}

export async function createMockWorkbenchImportStartContext<TInput>(args: {
  rootDir: string;
  input: TInput;
  preview: WorkbenchImportPreview;
  providerId?: string;
  cacheKey?: string;
  jobId?: string;
  workspaceId?: string;
  userId?: string;
}): Promise<
  WorkbenchImportStartContext<TInput> & {
    updates: Parameters<WorkbenchImportStartContext<TInput>["update"]>[0][];
    logs: string[];
  }
> {
  const updates: Parameters<WorkbenchImportStartContext<TInput>["update"]>[0][] = [];
  const logs: string[] = [];
  const storage = await createWorkbenchTestStoragePaths({
    rootDir: args.rootDir,
    providerId: args.providerId,
    cacheKey: args.cacheKey,
    jobId: args.jobId,
  });

  return {
    jobId: args.jobId || "job-1",
    workspaceId: args.workspaceId || "workspace-1",
    userId: args.userId || "user-1",
    input: args.input,
    preview: args.preview,
    cacheKey: args.cacheKey || "cache-key",
    storage,
    updates,
    logs,
    update: async (update) => {
      updates.push(update);
    },
    log: async (line) => {
      logs.push(line);
    },
  };
}
