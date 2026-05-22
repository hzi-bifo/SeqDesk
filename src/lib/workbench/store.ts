import { execFile, spawn } from "child_process";
import { createWriteStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import { getExecutionSettings } from "@/lib/pipelines/execution-settings";
import {
  resolveWorkbenchStorageBase,
  sanitizePathSegment,
  type WorkbenchStorageBase,
} from "@/lib/workbench/storage";

const execFileAsync = promisify(execFile);

export type WorkbenchStoreItemKind = "tool" | "importer" | "pipeline" | "analysis";
export type WorkbenchStoreInstallState = "running" | "success" | "error";
export type WorkbenchStoreInstallMethod = "conda";
export type WorkbenchStoreStatusState = "installed" | "missing" | "setup-needed";
export type WorkbenchStoreStatusSource = "managed" | "system";

export interface WorkbenchStoreItem {
  id: string;
  label: string;
  description: string;
  category: string;
  kind: WorkbenchStoreItemKind;
  usedBy: string[];
  commands: string[];
  install: {
    method: WorkbenchStoreInstallMethod;
    packages: string[];
    channels: string[];
    autoSetup: boolean;
  };
}

export interface WorkbenchStoreInstallJob {
  itemId: string;
  state: WorkbenchStoreInstallState;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  logPath: string;
  managedPath: string;
}

export interface WorkbenchStoreItemStatus {
  state: WorkbenchStoreStatusState;
  source?: WorkbenchStoreStatusSource;
  version?: string;
  message: string;
  details?: string;
  managedPath?: string;
}

export interface SerializedWorkbenchStoreItem extends WorkbenchStoreItem {
  status: WorkbenchStoreItemStatus;
  installJob: WorkbenchStoreInstallJob | null;
}

interface WorkbenchStorePaths extends WorkbenchStorageBase {
  storeRoot: string;
  jobsRoot: string;
  toolsRoot: string;
}

const WORKBENCH_STORE_ITEMS: WorkbenchStoreItem[] = [
  {
    id: "ncbi-datasets-cli",
    label: "NCBI Datasets CLI",
    description:
      "Server-side NCBI datasets/dataformat tools used by reference genome importers.",
    category: "Import tools",
    kind: "tool",
    usedBy: ["ncbi-genomes-taxon"],
    commands: ["datasets", "dataformat", "unzip"],
    install: {
      method: "conda",
      packages: ["ncbi-datasets-cli", "unzip"],
      channels: ["conda-forge"],
      autoSetup: true,
    },
  },
];

function dateNowIso(): string {
  return new Date().toISOString();
}

function getExecutableName(command: string): string {
  return process.platform === "win32" ? `${command}.exe` : command;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function commandVersion(command: string): Promise<string | undefined> {
  try {
    const { stdout, stderr } = await execFileAsync(
      command,
      command.endsWith("unzip") || command.endsWith("unzip.exe") ? ["-v"] : ["--version"],
      { timeout: 5000, maxBuffer: 1024 * 1024 }
    );
    return `${stdout || stderr}`.split(/\r?\n/)[0]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function resolveCondaBinary(): Promise<string | null> {
  const settings = await getExecutionSettings().catch(() => null);
  const condaPath = settings?.condaPath?.trim();
  if (condaPath) {
    const candidates = [
      path.join(condaPath, "condabin", getExecutableName("conda")),
      path.join(condaPath, "bin", getExecutableName("conda")),
      path.join(condaPath, "Scripts", getExecutableName("conda")),
    ];
    for (const candidate of candidates) {
      if (await pathExists(candidate)) return candidate;
    }
  }

  try {
    await execFileAsync("conda", ["--version"], { timeout: 5000 });
    return "conda";
  } catch {
    return null;
  }
}

async function resolveWorkbenchStorePaths(): Promise<WorkbenchStorePaths> {
  const base = await resolveWorkbenchStorageBase();
  const storeRoot = path.join(base.baseDir, "store");
  const jobsRoot = path.join(storeRoot, "jobs");
  const toolsRoot = path.join(base.baseDir, "tools");
  await fs.mkdir(jobsRoot, { recursive: true });
  await fs.mkdir(toolsRoot, { recursive: true });
  return {
    ...base,
    storeRoot,
    jobsRoot,
    toolsRoot,
  };
}

export function listWorkbenchStoreCatalog(): WorkbenchStoreItem[] {
  return [...WORKBENCH_STORE_ITEMS];
}

export function getWorkbenchStoreItem(itemId: string): WorkbenchStoreItem | null {
  return WORKBENCH_STORE_ITEMS.find((item) => item.id === itemId) || null;
}

export async function getWorkbenchManagedToolPrefix(itemId: string): Promise<string | null> {
  try {
    const paths = await resolveWorkbenchStorePaths();
    return path.join(paths.toolsRoot, sanitizePathSegment(itemId));
  } catch {
    return null;
  }
}

export async function getWorkbenchManagedCommandPath(
  itemId: string,
  command: string
): Promise<string | null> {
  const prefix = await getWorkbenchManagedToolPrefix(itemId);
  if (!prefix) return null;
  const commandPath =
    process.platform === "win32"
      ? path.join(prefix, "Scripts", getExecutableName(command))
      : path.join(prefix, "bin", getExecutableName(command));
  return (await pathExists(commandPath)) ? commandPath : null;
}

export async function resolveWorkbenchStoreCommand(
  command: string,
  preferredItemId?: string
): Promise<string> {
  const candidates = preferredItemId
    ? [getWorkbenchStoreItem(preferredItemId)].filter(Boolean)
    : WORKBENCH_STORE_ITEMS;

  for (const item of candidates) {
    if (!item || !item.commands.includes(command)) continue;
    const managedCommand = await getWorkbenchManagedCommandPath(item.id, command);
    if (managedCommand) return managedCommand;
  }

  return command;
}

async function readInstallJob(itemId: string): Promise<WorkbenchStoreInstallJob | null> {
  try {
    const paths = await resolveWorkbenchStorePaths();
    const content = await fs.readFile(
      path.join(paths.jobsRoot, `${sanitizePathSegment(itemId)}.json`),
      "utf8"
    );
    return JSON.parse(content) as WorkbenchStoreInstallJob;
  } catch {
    return null;
  }
}

async function writeInstallJob(job: WorkbenchStoreInstallJob): Promise<WorkbenchStoreInstallJob> {
  const paths = await resolveWorkbenchStorePaths();
  await fs.writeFile(
    path.join(paths.jobsRoot, `${sanitizePathSegment(job.itemId)}.json`),
    JSON.stringify(job, null, 2)
  );
  return job;
}

async function getStoreItemStatus(item: WorkbenchStoreItem): Promise<WorkbenchStoreItemStatus> {
  const managedPath = await getWorkbenchManagedToolPrefix(item.id);
  const managedVersions = await Promise.all(
    item.commands.map(async (command) => {
      const commandPath = await getWorkbenchManagedCommandPath(item.id, command);
      return commandPath ? commandVersion(commandPath) : undefined;
    })
  );
  if (managedVersions.every(Boolean)) {
    return {
      state: "installed",
      source: "managed",
      version: managedVersions.find(Boolean),
      managedPath: managedPath || undefined,
      message: "Installed by SeqDesk Store",
      details: managedPath ? `Managed prefix: ${managedPath}` : undefined,
    };
  }

  const systemVersions = await Promise.all(item.commands.map((command) => commandVersion(command)));
  if (systemVersions.every(Boolean)) {
    return {
      state: "installed",
      source: "system",
      version: systemVersions.find(Boolean),
      managedPath: managedPath || undefined,
      message: "Available on server PATH",
      details: "SeqDesk will use the server-installed command.",
    };
  }

  const condaBinary = await resolveCondaBinary();
  if (!condaBinary) {
    return {
      state: "setup-needed",
      managedPath: managedPath || undefined,
      message: "Conda is required for managed setup",
      details:
        "Configure Conda in Admin > Pipeline Runtime, or install the required command manually on the server PATH.",
    };
  }

  return {
    state: "missing",
    managedPath: managedPath || undefined,
    message: "Not installed",
    details: `SeqDesk Store can install this with ${condaBinary}.`,
  };
}

export async function listWorkbenchStoreItems(): Promise<SerializedWorkbenchStoreItem[]> {
  return Promise.all(
    WORKBENCH_STORE_ITEMS.map(async (item) => ({
      ...item,
      status: await getStoreItemStatus(item),
      installJob: await readInstallJob(item.id),
    }))
  );
}

export async function startWorkbenchStoreInstall(
  itemId: string
): Promise<WorkbenchStoreInstallJob> {
  const item = getWorkbenchStoreItem(itemId);
  if (!item) {
    throw new Error("Workbench Store item not found");
  }

  const existing = await readInstallJob(item.id);
  if (existing?.state === "running") {
    return existing;
  }

  const paths = await resolveWorkbenchStorePaths();
  const condaBinary = await resolveCondaBinary();
  if (!condaBinary) {
    throw new Error("Conda is not configured or available on the SeqDesk server.");
  }

  const managedPath = path.join(paths.toolsRoot, sanitizePathSegment(item.id));
  const logPath = path.join(paths.jobsRoot, `${sanitizePathSegment(item.id)}.log`);
  const condaMetaPath = path.join(managedPath, "conda-meta");
  const action = (await pathExists(condaMetaPath)) ? "install" : "create";
  const args = [
    action,
    "--yes",
    "--prefix",
    managedPath,
    "--override-channels",
    ...item.install.channels.flatMap((channel) => ["-c", channel]),
    ...item.install.packages,
  ];

  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const initialJob: WorkbenchStoreInstallJob = {
    itemId: item.id,
    state: "running",
    startedAt: dateNowIso(),
    logPath,
    managedPath,
  };
  await writeInstallJob(initialJob);

  const logStream = createWriteStream(logPath, { flags: "a" });
  logStream.write(`[${initialJob.startedAt}] ${condaBinary} ${args.join(" ")}\n`);

  const child = spawn(condaBinary, args, {
    env: {
      ...process.env,
      CONDA_PKGS_DIRS: path.join(paths.toolsRoot, "pkgs"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);

  child.on("error", async (error) => {
    const failed = {
      ...initialJob,
      state: "error" as const,
      finishedAt: dateNowIso(),
      error: error.message,
    };
    await writeInstallJob(failed).catch(() => {});
    logStream.end();
  });

  child.on("close", async (code) => {
    const finishedAt = dateNowIso();
    const nextJob: WorkbenchStoreInstallJob =
      code === 0
        ? {
            ...initialJob,
            state: "success",
            finishedAt,
          }
        : {
            ...initialJob,
            state: "error",
            finishedAt,
            error: `Workbench Store install exited with code ${code}`,
          };
    await writeInstallJob(nextJob).catch(() => {});
    logStream.end();
  });

  return initialJob;
}
