import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { testSetting, detectVersions } from '@/lib/pipelines/prerequisite-check';
import { getExecutionSettings } from '@/lib/pipelines/execution-settings';

// POST - Test a specific setting
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'FACILITY_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await request.json();
    const { setting, value } = body;

    if (!setting) {
      return NextResponse.json({ error: 'Setting name required' }, { status: 400 });
    }

    const result = await testSetting(setting, value);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Test Setting API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to test setting' },
      { status: 500 }
    );
  }
}

// GET - Detect installed versions
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'FACILITY_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Get conda path from settings
    const execSettings = await getExecutionSettings();
    const versions = await detectVersions(
      execSettings.condaPath || undefined,
      execSettings.condaEnv || undefined
    );
    return NextResponse.json({ versions });
  } catch (error) {
    console.error('[Detect Versions API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to detect versions' },
      { status: 500 }
    );
  }
}
