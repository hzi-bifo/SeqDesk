import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import fs from 'fs/promises';
import path from 'path';
import { parseTraceFile, findTraceFile } from '@/lib/pipelines/nextflow';

// GET - Get logs for a pipeline run
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const logType = searchParams.get('type') || 'output'; // 'output' or 'error'
    const tailLines = parseInt(searchParams.get('tail') || '100', 10);

    const run = await db.pipelineRun.findUnique({
      where: { id },
      select: {
        id: true,
        runFolder: true,
        outputPath: true,
        errorPath: true,
        outputTail: true,
        errorTail: true,
        status: true,
        progress: true,
        currentStep: true,
        study: {
          select: {
            userId: true,
          },
        },
        order: {
          select: {
            userId: true,
          },
        },
      },
    });

    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    if (
      session.user.role !== 'FACILITY_ADMIN' &&
      run.study?.userId !== session.user.id &&
      run.order?.userId !== session.user.id
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let content = '';
    let fromFile = false;

    // Determine which log file to read
    const logPath = logType === 'error' ? run.errorPath : run.outputPath;
    const cachedTail = logType === 'error' ? run.errorTail : run.outputTail;

    // Try to read from file if path exists
    if (logPath && run.runFolder) {
      try {
        const fullPath = path.isAbsolute(logPath)
          ? logPath
          : path.join(run.runFolder, logPath);

        const fileContent = await fs.readFile(fullPath, 'utf-8');
        const lines = fileContent.split('\n');

        // Get tail lines
        const startIndex = Math.max(0, lines.length - tailLines);
        content = lines.slice(startIndex).join('\n');
        fromFile = true;
      } catch {
        // File doesn't exist or can't be read, fall back to cached tail
        content = cachedTail || '';
      }
    } else {
      // Use cached tail from database
      content = cachedTail || '';
    }

    // If running, also try to parse trace file for step updates
    let steps: { process: string; status: string; tasks: number }[] = [];
    let traceProgress: number | null = null;

    if (run.status === 'running' && run.runFolder) {
      try {
        const tracePath = await findTraceFile(run.runFolder);
        if (tracePath) {
          const traceResult = await parseTraceFile(tracePath);
          traceProgress = traceResult.overallProgress;

          // Convert process summaries to step info
          steps = Array.from(traceResult.processes.values()).map((p) => ({
            process: p.name,
            status: p.status,
            tasks: p.totalTasks,
          }));
        }
      } catch {
        // Trace file parsing failed, continue with regular log response
      }
    }

    return NextResponse.json({
      content,
      fromFile,
      status: run.status,
      progress: traceProgress ?? run.progress,
      currentStep: run.currentStep,
      steps,
    });
  } catch (error) {
    console.error('[Pipeline Logs API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch logs' },
      { status: 500 }
    );
  }
}
