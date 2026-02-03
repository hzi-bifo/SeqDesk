import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  DEFAULT_EXECUTION_SETTINGS,
  getExecutionSettings,
  saveExecutionSettings,
  type ExecutionSettings,
} from '@/lib/pipelines/execution-settings';

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
      runtimeMode: 'conda',
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
