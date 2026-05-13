import fs from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  DEFAULT_EXECUTION_SETTINGS,
  normalizePipelineExecutionOverrides,
  type PipelineExecutionOverride,
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
  pipelineOverrides?: Record<string, PipelineExecutionOverride>;
  port?: number;
}

const FORM_CONFIG_KEYS = [
  "orderFormSettings",
  "order_form_settings",
  "studyFormSettings",
  "study_form_settings",
  "orderFormConfig",
  "studyFormConfig",
  "orderForm",
  "studyForm",
  "forms",
];

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

function normalizeExecutionMode(value: unknown): string | undefined {
  const mode = toOptionalString(value)?.toLowerCase();
  if (mode === "inherit" || mode === "local" || mode === "slurm") {
    return mode;
  }
  return undefined;
}

function parsePipelineExecutionOverride(value: unknown): JsonRecord | undefined {
  const source = toRecord(value);
  if (!source) {
    return undefined;
  }

  const slurm = toRecord(source.slurm);
  const nextSlurm: JsonRecord = {};
  const mode = normalizeExecutionMode(source.mode);
  const queue = toOptionalString(firstDefined(source.slurmQueue, slurm?.queue));
  const cores = toOptionalInt(firstDefined(source.slurmCores, slurm?.cores));
  const memory = toOptionalString(firstDefined(source.slurmMemory, slurm?.memory));
  const timeLimit = toOptionalInt(firstDefined(source.slurmTimeLimit, slurm?.timeLimit));
  const options = toOptionalString(
    firstDefined(
      source.slurmOptions,
      source.clusterOptions,
      slurm?.options,
      slurm?.clusterOptions
    )
  );
  const nextflowProfile = toOptionalString(source.nextflowProfile);

  if (queue) nextSlurm.queue = queue;
  if (cores !== undefined && cores > 0) nextSlurm.cores = cores;
  if (memory) nextSlurm.memory = memory;
  if (timeLimit !== undefined && timeLimit > 0) nextSlurm.timeLimit = timeLimit;
  if (options !== undefined) nextSlurm.options = options;

  const override: JsonRecord = {};
  if (mode) override.mode = mode;
  if (Object.keys(nextSlurm).length > 0) override.slurm = nextSlurm;
  if (nextflowProfile) override.nextflowProfile = nextflowProfile;

  return Object.keys(override).length > 0 ? override : undefined;
}

function parsePipelineExecutionOverrides(config: unknown): Record<string, PipelineExecutionOverride> {
  const root = toRecord(config);
  const pipelines = toRecord(root?.pipelines);
  const execution = toRecord(pipelines?.execution);
  const rawOverrides: Record<string, unknown> = {};
  const candidateMaps = [
    toRecord(pipelines?.pipelineOverrides),
    toRecord(pipelines?.executionOverrides),
    toRecord(execution?.pipelineOverrides),
    toRecord(execution?.overrides),
  ];

  for (const candidate of candidateMaps) {
    if (!candidate) continue;
    for (const [pipelineId, rawOverride] of Object.entries(candidate)) {
      const id = pipelineId.trim();
      const override = parsePipelineExecutionOverride(rawOverride);
      if (id && override) {
        rawOverrides[id] = {
          ...(toRecord(rawOverrides[id]) || {}),
          ...override,
          slurm: {
            ...(toRecord(toRecord(rawOverrides[id])?.slurm) || {}),
            ...(toRecord(override.slurm) || {}),
          },
        };
      }
    }
  }

  if (pipelines) {
    for (const [pipelineId, rawPipelineConfig] of Object.entries(pipelines)) {
      const id = pipelineId.trim();
      const pipelineConfig = toRecord(rawPipelineConfig);
      if (!id || !pipelineConfig) continue;
      const override =
        parsePipelineExecutionOverride(pipelineConfig.execution) ||
        parsePipelineExecutionOverride(pipelineConfig.runtime);
      if (override) {
        rawOverrides[id] = {
          ...(toRecord(rawOverrides[id]) || {}),
          ...override,
          slurm: {
            ...(toRecord(toRecord(rawOverrides[id])?.slurm) || {}),
            ...(toRecord(override.slurm) || {}),
          },
        };
      }
    }
  }

  return normalizePipelineExecutionOverrides(rawOverrides);
}

function hasFormConfigKeys(config: unknown): boolean {
  const root = toRecord(config);
  if (!root) {
    return false;
  }

  if (FORM_CONFIG_KEYS.some((key) => root[key] !== undefined)) {
    return true;
  }

  const forms = toRecord(root.forms);
  return Boolean(
    forms &&
      [
        "order",
        "study",
        "orderFormSettings",
        "order_form_settings",
        "studyFormSettings",
        "study_form_settings",
      ].some((key) => forms[key] !== undefined)
  );
}

function getFormConfigWarnings(config: unknown): string[] {
  if (!hasFormConfigKeys(config)) {
    return [];
  }

  return [
    "Order and study form settings were detected but were not imported here. Use the Order Form or Study Form Import / Export tabs for full form definitions; installer-only form preset paths are ignored by this in-app infrastructure import.",
  ];
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
  const pipelineOverrides = parsePipelineExecutionOverrides(root);

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
    pipelineOverrides:
      Object.keys(pipelineOverrides).length > 0 ? pipelineOverrides : undefined,
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
    if (hasFormConfigKeys(root)) {
      throw new Error(
        "This JSON looks like form setup, not infrastructure setup. Import order and study form definitions from their Form Builder Import / Export tabs."
      );
    }
    throw new Error(
      "No supported settings found. Include keys like sequencingDataDir, pipelineRunDir, condaPath, condaEnv, useSlurm, nextflowWeblogUrl, or port."
    );
  }

  return values;
}

function updateUrlPort(urlValue: string, port: number): string | undefined {
  try {
    const parsed = new URL(urlValue);
    parsed.port = String(port);
    const next = parsed.toString();
    return next.endsWith("/") ? next.slice(0, -1) : next;
  } catch {
    return undefined;
  }
}

async function upsertPortInConfigFile(port: number): Promise<string> {
  const target = "seqdesk.config.json";
  let current: JsonRecord = {};

  try {
    const raw = await fs.readFile(target, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed)) {
      current = parsed;
    }
  } catch {
    current = {};
  }

  const next = { ...current } as JsonRecord;
  const app = toRecord(next.app) ?? {};
  app.port = port;
  next.app = app;

  const runtime = toRecord(next.runtime) ?? {};
  const existingNextAuthUrl = toOptionalString(runtime.nextAuthUrl);
  if (existingNextAuthUrl) {
    const updated = updateUrlPort(existingNextAuthUrl, port);
    if (updated) {
      runtime.nextAuthUrl = updated;
    }
  } else {
    runtime.nextAuthUrl = `http://localhost:${port}`;
  }
  next.runtime = runtime;

  await fs.writeFile(target, `${JSON.stringify(next, null, 2)}\n`, "utf8");
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
    const formConfigWarnings = getFormConfigWarnings(body?.config);

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
    if (values.pipelineOverrides !== undefined) {
      nextExecution.pipelineOverrides = {
        ...(currentExecution.pipelineOverrides || {}),
        ...values.pipelineOverrides,
      };
    }

    const applied: Record<string, unknown> = {};
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
    if (values.pipelineOverrides !== undefined) {
      applied.pipelineOverrides = values.pipelineOverrides;
    }
    if (values.port !== undefined) applied.port = values.port;

    if (dryRun) {
      const warnings: string[] = [...formConfigWarnings];
      if (values.port !== undefined) {
        warnings.push("Saving will update app.port in seqdesk.config.json and requires a restart.");
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

    const warnings: string[] = [...formConfigWarnings];
    let updatedConfigFile: string | undefined;
    if (values.port !== undefined) {
      try {
        updatedConfigFile = await upsertPortInConfigFile(values.port);
        warnings.push(
          `Updated app.port in ${updatedConfigFile}. Restart SeqDesk to apply the new port.`
        );
      } catch (error) {
        warnings.push(
          `Could not update app.port automatically: ${
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
      updatedConfigFile,
      updatedEnvFile: updatedConfigFile,
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
