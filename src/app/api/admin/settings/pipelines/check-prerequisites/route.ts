import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { checkAllPrerequisites, quickPrerequisiteCheck } from '@/lib/pipelines/prerequisite-check';
import { getExecutionSettings } from '@/lib/pipelines/execution-settings';

// GET - Run prerequisite checks
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'FACILITY_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const quick = searchParams.get('quick') === 'true';

    // Get execution settings
    const executionSettings = await getExecutionSettings();

    // Get data base path from site settings
    const siteSettings = await db.siteSettings.findUnique({
      where: { id: 'singleton' },
      select: { dataBasePath: true },
    });

    if (quick) {
      console.log('[Prerequisites Check] Quick check with settings:', {
        condaPath: executionSettings.condaPath,
        pipelineRunDir: executionSettings.pipelineRunDir,
        dataBasePath: siteSettings?.dataBasePath,
      });
      const result = await quickPrerequisiteCheck(
        executionSettings,
        siteSettings?.dataBasePath || undefined
      );
      console.log('[Prerequisites Check] Quick result:', result);
      return NextResponse.json(result);
    }

    const result = await checkAllPrerequisites(
      executionSettings,
      siteSettings?.dataBasePath || undefined
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Prerequisites Check API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to check prerequisites' },
      { status: 500 }
    );
  }
}
