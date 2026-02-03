import { db } from "@/lib/db";

export interface ExecutionSettings {
  useSlurm: boolean;
  slurmQueue: string;
  slurmCores: number;
  slurmMemory: string;
  slurmTimeLimit: number;
  slurmOptions: string;
  runtimeMode: "conda";
  condaPath: string;
  condaEnv: string;
  nextflowProfile: string;
  pipelineRunDir: string;
  weblogUrl: string;
  weblogSecret: string;
}

export const DEFAULT_EXECUTION_SETTINGS: ExecutionSettings = {
  useSlurm: false,
  slurmQueue: "cpu",
  slurmCores: 4,
  slurmMemory: "64GB",
  slurmTimeLimit: 12,
  slurmOptions: "",
  runtimeMode: "conda",
  condaPath: "",
  condaEnv: "seqdesk-pipelines",
  nextflowProfile: "",
  pipelineRunDir: "/data/pipeline_runs",
  weblogUrl: "",
  weblogSecret: "",
};

export async function getExecutionSettings(): Promise<ExecutionSettings> {
  const settings = await db.siteSettings.findUnique({
    where: { id: "singleton" },
    select: { extraSettings: true },
  });

  if (!settings?.extraSettings) {
    return DEFAULT_EXECUTION_SETTINGS;
  }

  try {
    const extra = JSON.parse(settings.extraSettings);
    const merged = {
      ...DEFAULT_EXECUTION_SETTINGS,
      ...(extra.pipelineExecution || {}),
    } as ExecutionSettings;

    merged.runtimeMode = "conda";
    return merged;
  } catch {
    return DEFAULT_EXECUTION_SETTINGS;
  }
}

export async function saveExecutionSettings(
  executionSettings: ExecutionSettings
): Promise<void> {
  const settings = await db.siteSettings.findUnique({
    where: { id: "singleton" },
    select: { extraSettings: true },
  });

  let extra: Record<string, unknown> = {};
  if (settings?.extraSettings) {
    try {
      extra = JSON.parse(settings.extraSettings);
    } catch {
      // ignore
    }
  }

  extra.pipelineExecution = executionSettings;

  await db.siteSettings.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      extraSettings: JSON.stringify(extra),
    },
    update: {
      extraSettings: JSON.stringify(extra),
    },
  });
}
