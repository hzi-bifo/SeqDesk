import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  DEFAULT_EXECUTION_SETTINGS,
  getExecutionSettings,
  saveExecutionSettings,
  type ExecutionSettings,
} from '@/lib/pipelines/execution-settings';

function normalizeString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
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

    // Validate pipelineRunDir - must be a proper directory path, not just "/"
    let pipelineRunDir = normalizeString(
      body.pipelineRunDir,
      DEFAULT_EXECUTION_SETTINGS.pipelineRunDir
    );
    if (pipelineRunDir === '/' || pipelineRunDir === '') {
      pipelineRunDir = DEFAULT_EXECUTION_SETTINGS.pipelineRunDir;
    }

    // Validate and merge with defaults
    const newSettings: ExecutionSettings = {
      useSlurm: body.useSlurm ?? DEFAULT_EXECUTION_SETTINGS.useSlurm,
      slurmQueue: normalizeString(body.slurmQueue, DEFAULT_EXECUTION_SETTINGS.slurmQueue),
      slurmCores: body.slurmCores ?? DEFAULT_EXECUTION_SETTINGS.slurmCores,
      slurmMemory: normalizeString(body.slurmMemory, DEFAULT_EXECUTION_SETTINGS.slurmMemory),
      slurmTimeLimit: body.slurmTimeLimit ?? DEFAULT_EXECUTION_SETTINGS.slurmTimeLimit,
      slurmOptions: normalizeString(body.slurmOptions, DEFAULT_EXECUTION_SETTINGS.slurmOptions),
      runtimeMode: 'conda',
      condaPath: normalizeString(body.condaPath, DEFAULT_EXECUTION_SETTINGS.condaPath),
      condaEnv: normalizeString(body.condaEnv, DEFAULT_EXECUTION_SETTINGS.condaEnv),
      nextflowProfile: normalizeString(
        body.nextflowProfile,
        DEFAULT_EXECUTION_SETTINGS.nextflowProfile
      ),
      pipelineRunDir,
      weblogUrl: normalizeString(body.weblogUrl, DEFAULT_EXECUTION_SETTINGS.weblogUrl),
      weblogSecret: normalizeString(
        body.weblogSecret,
        DEFAULT_EXECUTION_SETTINGS.weblogSecret
      ),
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
