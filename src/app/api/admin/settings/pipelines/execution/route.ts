import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';

export interface ExecutionSettings {
  useSlurm: boolean;
  slurmQueue: string;
  slurmCores: number;
  slurmMemory: string;
  slurmTimeLimit: number;
  slurmOptions: string;
  runtimeMode: 'local' | 'conda' | 'docker' | 'singularity' | 'apptainer';
  condaPath: string;
  condaEnv: string;
  nextflowProfile: string;
  pipelineRunDir: string;
  weblogUrl: string;
  weblogSecret: string;
}

const DEFAULT_EXECUTION_SETTINGS: ExecutionSettings = {
  useSlurm: false,
  slurmQueue: 'cpu',
  slurmCores: 4,
  slurmMemory: '64GB',
  slurmTimeLimit: 12,
  slurmOptions: '',
  runtimeMode: 'local',
  condaPath: '',
  condaEnv: 'seqdesk-pipelines',
  nextflowProfile: '',
  pipelineRunDir: '/data/pipeline_runs',
  weblogUrl: '',
  weblogSecret: '',
};

function resolveRuntimeMode(settings: Partial<ExecutionSettings>): ExecutionSettings['runtimeMode'] {
  const mode = settings.runtimeMode;
  if (mode && ['local', 'conda', 'docker', 'singularity', 'apptainer'].includes(mode)) {
    return mode;
  }

  const profile = (settings.nextflowProfile || '').toLowerCase();
  if (profile.includes('conda')) return 'conda';
  if (profile.includes('docker')) return 'docker';
  if (profile.includes('singularity')) return 'singularity';
  if (profile.includes('apptainer')) return 'apptainer';
  return 'local';
}

async function getExecutionSettings(): Promise<ExecutionSettings> {
  const settings = await db.siteSettings.findUnique({
    where: { id: 'singleton' },
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

    merged.runtimeMode = resolveRuntimeMode(merged);
    return merged;
  } catch {
    return DEFAULT_EXECUTION_SETTINGS;
  }
}

async function saveExecutionSettings(executionSettings: ExecutionSettings): Promise<void> {
  const settings = await db.siteSettings.findUnique({
    where: { id: 'singleton' },
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
    where: { id: 'singleton' },
    create: {
      id: 'singleton',
      extraSettings: JSON.stringify(extra),
    },
    update: {
      extraSettings: JSON.stringify(extra),
    },
  });
}

// GET - Get execution settings
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'FACILITY_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const settings = await getExecutionSettings();

    return NextResponse.json({ settings });
  } catch (error) {
    console.error('[Execution Settings API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch execution settings' },
      { status: 500 }
    );
  }
}

// POST - Update execution settings
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'FACILITY_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await request.json();

    // Validate and merge with defaults
    const newSettings: ExecutionSettings = {
      useSlurm: body.useSlurm ?? DEFAULT_EXECUTION_SETTINGS.useSlurm,
      slurmQueue: body.slurmQueue || DEFAULT_EXECUTION_SETTINGS.slurmQueue,
      slurmCores: body.slurmCores ?? DEFAULT_EXECUTION_SETTINGS.slurmCores,
      slurmMemory: body.slurmMemory || DEFAULT_EXECUTION_SETTINGS.slurmMemory,
      slurmTimeLimit: body.slurmTimeLimit ?? DEFAULT_EXECUTION_SETTINGS.slurmTimeLimit,
      slurmOptions: body.slurmOptions ?? DEFAULT_EXECUTION_SETTINGS.slurmOptions,
      runtimeMode: resolveRuntimeMode(body),
      condaPath: body.condaPath ?? DEFAULT_EXECUTION_SETTINGS.condaPath,
      condaEnv: body.condaEnv ?? DEFAULT_EXECUTION_SETTINGS.condaEnv,
      nextflowProfile: body.nextflowProfile ?? DEFAULT_EXECUTION_SETTINGS.nextflowProfile,
      pipelineRunDir: body.pipelineRunDir || DEFAULT_EXECUTION_SETTINGS.pipelineRunDir,
      weblogUrl: body.weblogUrl ?? DEFAULT_EXECUTION_SETTINGS.weblogUrl,
      weblogSecret: body.weblogSecret ?? DEFAULT_EXECUTION_SETTINGS.weblogSecret,
    };

    await saveExecutionSettings(newSettings);

    return NextResponse.json({ success: true, settings: newSettings });
  } catch (error) {
    console.error('[Execution Settings API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to update execution settings' },
      { status: 500 }
    );
  }
}

// Export for use in other modules
export { getExecutionSettings, DEFAULT_EXECUTION_SETTINGS };
