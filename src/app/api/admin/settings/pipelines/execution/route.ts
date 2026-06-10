import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  DEFAULT_EXECUTION_SETTINGS,
  getExecutionSettings,
  normalizePipelineExecutionOverrides,
  saveExecutionSettings,
  type ExecutionSettings,
} from '@/lib/pipelines/execution-settings';

function normalizeString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

// These values are interpolated into the generated run.sh (conda activation,
// run-directory paths). Reject characters that could break out of a quoted
// shell context or run a command substitution before they are ever persisted.
const SHELL_UNSAFE_SETTING = /[\x00-\x1f\x7f"`$\\]/;

class UnsafeSettingError extends Error {}

function assertSafeSetting(value: string, label: string): void {
  if (SHELL_UNSAFE_SETTING.test(value)) {
    throw new UnsafeSettingError(
      `${label} may not contain control characters or any of: " \` $ \\`
    );
  }
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
    const pipelineDatabaseDir = normalizeString(
      body.pipelineDatabaseDir,
      DEFAULT_EXECUTION_SETTINGS.pipelineDatabaseDir
    );
    const condaPath = normalizeString(body.condaPath, DEFAULT_EXECUTION_SETTINGS.condaPath);
    const condaEnv = normalizeString(body.condaEnv, DEFAULT_EXECUTION_SETTINGS.condaEnv);

    try {
      assertSafeSetting(condaPath, 'Conda path');
      assertSafeSetting(condaEnv, 'Conda environment');
      assertSafeSetting(pipelineRunDir, 'Pipeline run directory');
      assertSafeSetting(pipelineDatabaseDir, 'Pipeline database directory');
    } catch (error) {
      if (error instanceof UnsafeSettingError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    // Validate and merge with defaults
    const newSettings: ExecutionSettings = {
      useSlurm: body.useSlurm ?? DEFAULT_EXECUTION_SETTINGS.useSlurm,
      slurmQueue: normalizeString(body.slurmQueue, DEFAULT_EXECUTION_SETTINGS.slurmQueue),
      slurmCores: body.slurmCores ?? DEFAULT_EXECUTION_SETTINGS.slurmCores,
      slurmMemory: normalizeString(body.slurmMemory, DEFAULT_EXECUTION_SETTINGS.slurmMemory),
      slurmTimeLimit: body.slurmTimeLimit ?? DEFAULT_EXECUTION_SETTINGS.slurmTimeLimit,
      slurmOptions: normalizeString(body.slurmOptions, DEFAULT_EXECUTION_SETTINGS.slurmOptions),
      pipelineOverrides: normalizePipelineExecutionOverrides(body.pipelineOverrides),
      runtimeMode: 'conda',
      condaPath,
      condaEnv,
      nextflowProfile: normalizeString(
        body.nextflowProfile,
        DEFAULT_EXECUTION_SETTINGS.nextflowProfile
      ),
      pipelineRunDir,
      pipelineDatabaseDir,
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
