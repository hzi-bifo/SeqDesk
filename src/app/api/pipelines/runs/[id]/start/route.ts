import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { prepareMagRun } from '@/lib/pipelines/mag/executor';
import { getExecutionSettings } from '@/app/api/admin/settings/pipelines/execution/route';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';

const execAsync = promisify(exec);

async function commandExists(command: string): Promise<boolean> {
  try {
    await execAsync(`command -v ${command}`, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function resolveCondaBin(condaPath?: string): Promise<string | null> {
  if (condaPath) {
    const possiblePaths = [
      path.join(condaPath, 'condabin', 'conda'),
      path.join(condaPath, 'bin', 'conda'),
    ];
    for (const p of possiblePaths) {
      try {
        await fs.access(p);
        return p;
      } catch {
        // try next
      }
    }
  }

  return (await commandExists('conda')) ? 'conda' : null;
}

function resolveEffectiveProfile(
  profileOverride?: string
): string {
  const override = profileOverride?.trim();
  if (!override) return 'conda';
  const parts = override
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const lowerParts = parts.map((part) => part.toLowerCase());
  if (!lowerParts.includes('conda')) {
    parts.push('conda');
  }
  return parts.join(',');
}

// POST - Start/execute a pipeline run
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'FACILITY_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { id } = await params;

    // Get the run
    const run = await db.pipelineRun.findUnique({
      where: { id },
      include: {
        study: {
          include: {
            samples: {
              include: { reads: true },
            },
          },
        },
      },
    });

    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    if (run.status !== 'pending') {
      return NextResponse.json(
        { error: `Cannot start run with status: ${run.status}` },
        { status: 400 }
      );
    }

    if (!run.study) {
      return NextResponse.json(
        { error: 'Run has no associated study' },
        { status: 400 }
      );
    }

    // Parse config from run
    let config: Record<string, unknown> = {};
    if (run.config) {
      try {
        config = JSON.parse(run.config);
      } catch {
        return NextResponse.json(
          { error: 'Run config is invalid JSON' },
          { status: 400 }
        );
      }
    }

    // Parse sample selection from run or request body
    let selectedSampleIds: string[] | undefined;
    if (run.inputSampleIds) {
      try {
        const parsed = JSON.parse(run.inputSampleIds);
        if (!Array.isArray(parsed)) {
          return NextResponse.json(
            { error: 'Run sample selection is invalid' },
            { status: 400 }
          );
        }
        if (parsed.length === 0 || parsed.some((id) => typeof id !== 'string')) {
          return NextResponse.json(
            { error: 'Run sample selection is invalid' },
            { status: 400 }
          );
        }
        selectedSampleIds = parsed;
      } catch {
        return NextResponse.json(
          { error: 'Run sample selection is invalid JSON' },
          { status: 400 }
        );
      }
    } else {
      try {
        const body = await request.json();
        if (Array.isArray(body?.sampleIds)) {
          if (
            body.sampleIds.length === 0 ||
            body.sampleIds.some((id: unknown) => typeof id !== 'string')
          ) {
            return NextResponse.json(
              { error: 'Run sample selection is invalid' },
              { status: 400 }
            );
          }
          selectedSampleIds = body.sampleIds;
        }
      } catch {
        // No body provided, ignore
      }
    }

    // Get execution settings
    const executionSettings = await getExecutionSettings();

    // Log settings for debugging
    console.log('[Start Pipeline] Execution settings:', {
      condaPath: executionSettings.condaPath,
      pipelineRunDir: executionSettings.pipelineRunDir,
      useSlurm: executionSettings.useSlurm,
    });

    // Get data base path from site settings
    const siteSettings = await db.siteSettings.findUnique({
      where: { id: 'singleton' },
      select: { dataBasePath: true },
    });

    if (!siteSettings?.dataBasePath) {
      return NextResponse.json(
        { error: 'Data base path not configured in settings' },
        { status: 400 }
      );
    }

    // Warn if conda path is not configured (nextflow won't be found)
    if (!executionSettings.condaPath) {
      console.warn('[Start Pipeline] WARNING: condaPath is not configured - nextflow may not be found');
    }

    const effectiveProfile = resolveEffectiveProfile(executionSettings.nextflowProfile);
    const profileParts = effectiveProfile
      ? effectiveProfile.split(',').map((p) => p.trim()).filter(Boolean)
      : [];

    if (executionSettings.runtimeMode === 'conda' && process.platform === 'darwin' && process.arch === 'arm64') {
      const message = 'Conda runtime on macOS ARM is not supported for nf-core/mag (packages like bowtie2 are unavailable). Use a Linux/SLURM server instead.';
      await db.pipelineRun.update({
        where: { id },
        data: {
          status: 'failed',
          errorTail: message,
          completedAt: new Date(),
        },
      });
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const forbiddenProfiles = new Set(['docker', 'singularity', 'apptainer', 'podman']);
    const forbiddenSelected = profileParts
      .map((part) => part.toLowerCase())
      .filter((part) => forbiddenProfiles.has(part));
    if (forbiddenSelected.length > 0) {
      const message = `Unsupported Nextflow profile(s): ${forbiddenSelected.join(', ')}. SeqDesk only supports conda-based execution.`;
      await db.pipelineRun.update({
        where: { id },
        data: {
          status: 'failed',
          errorTail: message,
          completedAt: new Date(),
        },
      });
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const condaBin = await resolveCondaBin(executionSettings.condaPath);
    if (!condaBin) {
      const message = 'Conda profile selected but conda was not found. Configure a conda path or install conda.';
      await db.pipelineRun.update({
        where: { id },
        data: {
          status: 'failed',
          errorTail: message,
          completedAt: new Date(),
        },
      });
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (selectedSampleIds && !run.inputSampleIds) {
      await db.pipelineRun.update({
        where: { id: run.id },
        data: { inputSampleIds: JSON.stringify(selectedSampleIds) },
      });
    }

    // Prepare the run (generates samplesheet, scripts, etc.)
    const prepResult = await prepareMagRun({
      runId: run.id,
      studyId: run.studyId!,
      sampleIds: selectedSampleIds,
      config,
      executionSettings: {
        ...executionSettings,
        dataBasePath: siteSettings.dataBasePath,
        nextflowProfile: effectiveProfile,
      },
      userId: session.user.id,
    });

    if (!prepResult.success) {
      // Update run status to failed
      await db.pipelineRun.update({
        where: { id },
        data: {
          status: 'failed',
          errorTail: prepResult.errors.join('\n'),
          completedAt: new Date(),
        },
      });

      return NextResponse.json(
        { error: 'Failed to prepare run', details: prepResult.errors },
        { status: 400 }
      );
    }

    // Now actually execute the run
    if (prepResult.runFolder) {
      const scriptPath = path.join(prepResult.runFolder, 'run.sh');

      if (executionSettings.useSlurm) {
        // Submit to SLURM
        try {
          const sbatchProcess = spawn('sbatch', [scriptPath], {
            cwd: prepResult.runFolder,
          });

          let jobId = '';
          sbatchProcess.stdout.on('data', (data) => {
            const output = data.toString();
            // Parse job ID from "Submitted batch job 12345"
            const match = output.match(/Submitted batch job (\d+)/);
            if (match) {
              jobId = match[1];
            }
          });

          await new Promise<void>((resolve, reject) => {
            sbatchProcess.on('close', (code) => {
              if (code === 0) {
                resolve();
              } else {
                reject(new Error(`sbatch exited with code ${code}`));
              }
            });
            sbatchProcess.on('error', reject);
          });

          // Update run with job ID
          await db.pipelineRun.update({
            where: { id },
            data: {
              status: 'running',
              queueJobId: jobId,
              startedAt: new Date(),
            },
          });

          return NextResponse.json({
            success: true,
            status: 'running',
            jobId,
            runFolder: prepResult.runFolder,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'SLURM submission failed';
          await db.pipelineRun.update({
            where: { id },
            data: {
              status: 'failed',
              errorTail: message,
              completedAt: new Date(),
            },
          });

          return NextResponse.json(
            { error: message },
            { status: 500 }
          );
        }
      } else {
        // Run locally in background
        try {
          const childProcess = spawn('bash', [scriptPath], {
            cwd: prepResult.runFolder,
            detached: true,
            stdio: 'ignore',
          });

          // Don't wait for the process - let it run in background
          childProcess.unref();

          // Update run status to running
          await db.pipelineRun.update({
            where: { id },
            data: {
              status: 'running',
              queueJobId: `local-${childProcess.pid}`,
              startedAt: new Date(),
            },
          });

          return NextResponse.json({
            success: true,
            status: 'running',
            pid: childProcess.pid,
            runFolder: prepResult.runFolder,
            message: 'Pipeline started in background. Check the Analysis dashboard for status.',
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Local execution failed';
          await db.pipelineRun.update({
            where: { id },
            data: {
              status: 'failed',
              errorTail: message,
              completedAt: new Date(),
            },
          });

          return NextResponse.json(
            { error: message },
            { status: 500 }
          );
        }
      }
    }

    return NextResponse.json({
      success: true,
      runId: prepResult.runId,
      runFolder: prepResult.runFolder,
    });
  } catch (error) {
    console.error('[Start Pipeline Run API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to start pipeline run' },
      { status: 500 }
    );
  }
}
