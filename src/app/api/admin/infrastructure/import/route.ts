import fs from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  DEFAULT_EXECUTION_SETTINGS,
  type ExecutionSettings,
} from "@/lib/pipelines/execution-settings";

type JsonRecord = Record<string, unknown>;

interface InfrastructureImportRequest {
  config?: unknown;
  dryRun?: boolean;
}

interface InfrastructureImportValues {
  dataBasePath?: string;
  pipelineRunDir?: string;
  useSlurm?: boolean;
  slurmQueue?: string;
  slurmCores?: number;
  slurmMemory?: string;
  slurmTimeLimit?: number;
  slurmOptions?: string;
  condaPath?: string;
  condaEnv?: string;
  nextflowProfile?: string;
  weblogUrl?: string;
  weblogSecret?: string;
  port?: number;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function firstDefined(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "y", "1", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "no", "n", "0", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function toOptionalInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return undefined;
}

function parseImportValues(config: unknown): InfrastructureImportValues {
  const root = toRecord(config);
  if (!root) {
    throw new Error("Infrastructure config must be a JSON object.");
  }

  const site = toRecord(root.site);
  const pipelines = toRecord(root.pipelines);
  const execution = toRecord(pipelines?.execution);
  const conda = toRecord(execution?.conda);
  const slurm = toRecord(execution?.slurm);
  const runtime = toRecord(root.runtime);
  const app = toRecord(root.app);

  const executionMode = toOptionalString(execution?.mode)?.toLowerCase();
  const explicitUseSlurm = toOptionalBoolean(
    firstDefined(root.useSlurm, execution?.useSlurm, slurm?.enabled)
  );

  let useSlurm = explicitUseSlurm;
  if (useSlurm === undefined) {
    if (executionMode === "slurm") {
      useSlurm = true;
    } else if (executionMode === "local" || executionMode === "kubernetes") {
      useSlurm = false;
    }
  }

  const slurmCores = toOptionalInt(
    firstDefined(root.slurmCores, execution?.slurmCores, slurm?.cores)
  );
  const slurmTimeLimit = toOptionalInt(
    firstDefined(root.slurmTimeLimit, execution?.slurmTimeLimit, slurm?.timeLimit)
  );
  const port = toOptionalInt(firstDefined(root.port, root.appPort, app?.port));

  const values: InfrastructureImportValues = {
    dataBasePath: toOptionalString(
      firstDefined(
        root.sequencingDataDir,
        root.sequencingDataPath,
        root.dataBasePath,
        site?.dataBasePath
      )
    ),
    pipelineRunDir: toOptionalString(
      firstDefined(
        root.pipelineRunDir,
        root.runDirectory,
        execution?.runDirectory,
        execution?.pipelineRunDir
      )
    ),
    useSlurm,
    slurmQueue: toOptionalString(
      firstDefined(root.slurmQueue, execution?.slurmQueue, slurm?.queue)
    ),
    slurmMemory: toOptionalString(
      firstDefined(root.slurmMemory, execution?.slurmMemory, slurm?.memory)
    ),
    slurmOptions: toOptionalString(
      firstDefined(
        root.slurmOptions,
        root.clusterOptions,
        execution?.slurmOptions,
        execution?.clusterOptions,
        slurm?.options,
        slurm?.clusterOptions
      )
    ),
    condaPath: toOptionalString(
      firstDefined(root.condaPath, root.condaBase, execution?.condaPath, conda?.path)
    ),
    condaEnv: toOptionalString(
      firstDefined(
        root.condaEnv,
        root.condaEnvironment,
        execution?.condaEnv,
        conda?.environment
      )
    ),
    nextflowProfile: toOptionalString(
      firstDefined(root.nextflowProfile, execution?.nextflowProfile)
    ),
    weblogUrl: toOptionalString(
      firstDefined(
        root.nextflowWeblogUrl,
        root.weblogUrl,
        execution?.weblogUrl,
        runtime?.weblogUrl
      )
    ),
    weblogSecret: toOptionalString(
      firstDefined(root.weblogSecret, execution?.weblogSecret, runtime?.weblogSecret)
    ),
    port: port !== undefined && port > 0 ? port : undefined,
  };

  if (slurmCores !== undefined && slurmCores > 0) {
    values.slurmCores = slurmCores;
  }
  if (slurmTimeLimit !== undefined && slurmTimeLimit > 0) {
    values.slurmTimeLimit = slurmTimeLimit;
  }

  const hasAnyValue = Object.values(values).some((value) => value !== undefined);
  if (!hasAnyValue) {
    throw new Error(
      "No supported settings found. Include keys like sequencingDataDir, pipelineRunDir, condaPath, condaEnv, useSlurm, nextflowWeblogUrl, or port."
    );
  }

  return values;
}

async function upsertPortInEnvFile(port: number): Promise<string> {
  let target: ".env" | ".env.local" = ".env";
  let current = "";
  try {
    current = await fs.readFile(".env", "utf8");
    target = ".env";
  } catch {
    try {
      current = await fs.readFile(".env.local", "utf8");
      target = ".env.local";
    } catch {
      current = "";
      target = ".env";
    }
  }

  const nextLine = `PORT=${port}`;
  const hasTrailingNewline = current.endsWith("\n");
  let nextContent: string;

  if (/^PORT=.*$/m.test(current)) {
    nextContent = current.replace(/^PORT=.*$/m, nextLine);
  } else if (current.length === 0) {
    nextContent = `${nextLine}\n`;
  } else {
    nextContent = `${current}${hasTrailingNewline ? "" : "\n"}${nextLine}\n`;
  }

  if (nextContent !== current) {
    if (target === ".env") {
      await fs.writeFile(".env", nextContent, "utf8");
    } else {
      await fs.writeFile(".env.local", nextContent, "utf8");
    }
  }

  return target;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== "FACILITY_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as InfrastructureImportRequest;
    const dryRun = body?.dryRun === true;
    const values = parseImportValues(body?.config);

    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { dataBasePath: true, extraSettings: true },
    });

    let extraSettings: JsonRecord = {};
    if (settings?.extraSettings) {
      try {
        const parsed = JSON.parse(settings.extraSettings) as unknown;
        extraSettings = toRecord(parsed) || {};
      } catch {
        extraSettings = {};
      }
    }

    const currentExecution: ExecutionSettings = {
      ...DEFAULT_EXECUTION_SETTINGS,
      ...(toRecord(extraSettings.pipelineExecution) as Partial<ExecutionSettings>),
      runtimeMode: "conda",
    };

    const nextExecution: ExecutionSettings = {
      ...currentExecution,
      runtimeMode: "conda",
    };

    if (values.useSlurm !== undefined) {
      nextExecution.useSlurm = values.useSlurm;
    }
    if (values.slurmQueue !== undefined) {
      nextExecution.slurmQueue = values.slurmQueue;
    }
    if (values.slurmCores !== undefined) {
      nextExecution.slurmCores = values.slurmCores;
    }
    if (values.slurmMemory !== undefined) {
      nextExecution.slurmMemory = values.slurmMemory;
    }
    if (values.slurmTimeLimit !== undefined) {
      nextExecution.slurmTimeLimit = values.slurmTimeLimit;
    }
    if (values.slurmOptions !== undefined) {
      nextExecution.slurmOptions = values.slurmOptions;
    }
    if (values.condaPath !== undefined) {
      nextExecution.condaPath = values.condaPath;
    }
    if (values.condaEnv !== undefined) {
      nextExecution.condaEnv = values.condaEnv;
    }
    if (values.nextflowProfile !== undefined) {
      nextExecution.nextflowProfile = values.nextflowProfile;
    }
    if (values.weblogUrl !== undefined) {
      nextExecution.weblogUrl = values.weblogUrl;
    }
    if (values.weblogSecret !== undefined) {
      nextExecution.weblogSecret = values.weblogSecret;
    }
    if (values.pipelineRunDir !== undefined) {
      nextExecution.pipelineRunDir =
        values.pipelineRunDir === "/"
          ? DEFAULT_EXECUTION_SETTINGS.pipelineRunDir
          : values.pipelineRunDir;
    }

    const applied: Record<string, string | number | boolean> = {};
    if (values.dataBasePath !== undefined) applied.dataBasePath = values.dataBasePath;
    if (values.pipelineRunDir !== undefined) {
      applied.pipelineRunDir = nextExecution.pipelineRunDir;
    }
    if (values.useSlurm !== undefined) applied.useSlurm = values.useSlurm;
    if (values.condaPath !== undefined) applied.condaPath = values.condaPath;
    if (values.condaEnv !== undefined) applied.condaEnv = values.condaEnv;
    if (values.weblogUrl !== undefined) applied.weblogUrl = values.weblogUrl;
    if (values.weblogSecret !== undefined) applied.weblogSecret = values.weblogSecret;
    if (values.slurmQueue !== undefined) applied.slurmQueue = values.slurmQueue;
    if (values.slurmCores !== undefined) applied.slurmCores = values.slurmCores;
    if (values.slurmMemory !== undefined) applied.slurmMemory = values.slurmMemory;
    if (values.slurmTimeLimit !== undefined) {
      applied.slurmTimeLimit = values.slurmTimeLimit;
    }
    if (values.slurmOptions !== undefined) applied.slurmOptions = values.slurmOptions;
    if (values.nextflowProfile !== undefined) {
      applied.nextflowProfile = values.nextflowProfile;
    }
    if (values.port !== undefined) applied.port = values.port;

    if (dryRun) {
      const warnings: string[] = [];
      if (values.port !== undefined) {
        warnings.push("Saving will update PORT in .env/.env.local and requires a restart.");
      }
      return NextResponse.json({
        success: true,
        message: "Configuration is valid.",
        applied,
        warnings,
      });
    }

    extraSettings.pipelineExecution = nextExecution;

    const updateData: { extraSettings: string; dataBasePath?: string | null } = {
      extraSettings: JSON.stringify(extraSettings),
    };
    if (values.dataBasePath !== undefined) {
      updateData.dataBasePath = values.dataBasePath;
    }

    await db.siteSettings.upsert({
      where: { id: "singleton" },
      update: updateData,
      create: {
        id: "singleton",
        dataBasePath:
          updateData.dataBasePath ??
          (settings?.dataBasePath?.trim() || null),
        extraSettings: updateData.extraSettings,
      },
    });

    const warnings: string[] = [];
    let updatedEnvFile: string | undefined;
    if (values.port !== undefined) {
      try {
        updatedEnvFile = await upsertPortInEnvFile(values.port);
        warnings.push(
          `Updated PORT in ${updatedEnvFile}. Restart SeqDesk to apply the new port.`
        );
      } catch (error) {
        warnings.push(
          `Could not update PORT automatically: ${
            error instanceof Error ? error.message : "unknown error"
          }`
        );
      }
    }

    return NextResponse.json({
      success: true,
      message: "Infrastructure settings imported.",
      applied,
      warnings,
      updatedEnvFile,
    });
  } catch (error) {
    console.error("[Infrastructure Import] Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to import infrastructure settings",
      },
      { status: 400 }
    );
  }
}
