import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { prepareGenericRun } from '@/lib/pipelines/generic-executor';
import { getPackage } from '@/lib/pipelines/package-loader';
import { getExecutionSettings } from '@/lib/pipelines/execution-settings';
import { prepareSubmgRun } from '@/lib/pipelines/submg/submg-runner';
import { processCompletedPipelineRun } from '@/lib/pipelines/run-completion';
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

async function finalizeLocalRun(
  runId: string,
  pipelineId: string,
  exitCode: number | null
): Promise<void> {
  const completedAt = new Date();
  if (exitCode === 0) {
    await db.pipelineRun.update({
      where: { id: runId },
      data: {
        status: 'completed',
        progress: 100,
        currentStep: 'Completed',
        completedAt,
        statusSource: 'process',
        lastEventAt: completedAt,
        queueStatus: 'COMPLETED',
        queueUpdatedAt: completedAt,
      },
    });
    processCompletedPipelineRun(runId, pipelineId).catch((err) => {
      console.error('[Pipeline Run] Output resolution failed:', err);
    });
  } else {
    const message = `Pipeline exited with code ${exitCode ?? 'unknown'}`;
    await db.pipelineRun.update({
      where: { id: runId },
      data: {
        status: 'failed',
        currentStep: 'Failed',
        errorTail: message,
        completedAt,
        statusSource: 'process',
        lastEventAt: completedAt,
        queueStatus: 'FAILED',
        queueUpdatedAt: completedAt,
      },
    });
  }
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

    // Validate pipelineRunDir
    if (!executionSettings.pipelineRunDir || executionSettings.pipelineRunDir === '/') {
      return NextResponse.json(
        { error: 'Pipeline run directory not configured properly. Set it in Admin > Infrastructure.' },
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

    const pipelineId = run.pipelineId;
    const isSubmgPipeline = pipelineId === 'submg';

    if (
      !isSubmgPipeline &&
      executionSettings.runtimeMode === 'conda' &&
      process.platform === 'darwin' &&
      process.arch === 'arm64'
    ) {
      const message = 'Conda runtime on macOS ARM is not supported for nf-core/mag (packages like bowtie2 are unavailable). Use a Linux/SLURM server instead.';
      await db.pipelineRun.update({
        where: { id },
        data: {
          status: 'failed',
          errorTail: message,
          completedAt: new Date(),
          statusSource: 'launcher',
          lastEventAt: new Date(),
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
          statusSource: 'launcher',
          lastEventAt: new Date(),
        },
      });
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const condaBin = await resolveCondaBin(executionSettings.condaPath);
    if (!condaBin && !executionSettings.useSlurm && !isSubmgPipeline) {
      const message =
        'Conda profile selected but conda was not found. Configure a conda path or install conda.';
      await db.pipelineRun.update({
        where: { id },
        data: {
          status: 'failed',
          errorTail: message,
          completedAt: new Date(),
          statusSource: 'launcher',
          lastEventAt: new Date(),
        },
      });
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (!condaBin && executionSettings.useSlurm) {
      console.warn(
        '[Start Pipeline] Conda not found on the web host. Proceeding because SLURM is enabled.'
      );
    }

    if (selectedSampleIds && !run.inputSampleIds) {
      await db.pipelineRun.update({
        where: { id: run.id },
        data: { inputSampleIds: JSON.stringify(selectedSampleIds) },
      });
    }

    // Verify pipeline package exists
    const pkg = getPackage(pipelineId);
    if (!pkg) {
      return NextResponse.json(
        { error: `Pipeline package not found: ${pipelineId}` },
        { status: 400 }
      );
    }

    // Prepare the run (generates config/scripts and staging files)
    const prepResult = isSubmgPipeline
      ? await prepareSubmgRun({
          runId: run.id,
          studyId: run.studyId!,
          sampleIds: selectedSampleIds,
          config,
          executionSettings: {
            ...executionSettings,
            dataBasePath: siteSettings.dataBasePath,
            nextflowProfile: effectiveProfile,
          },
          dataBasePath: siteSettings.dataBasePath,
        })
      : await prepareGenericRun({
          runId: run.id,
          pipelineId,
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
          statusSource: 'launcher',
          lastEventAt: new Date(),
        },
      });

      return NextResponse.json(
        { error: 'Failed to prepare run', details: prepResult.errors },
        { status: 400 }
      );
    }

    // Now actually execute the run
    if (prepResult.runFolder) {
      const scriptPath =
        ('scriptPath' in prepResult ? prepResult.scriptPath : undefined) ||
        path.join(prepResult.runFolder, 'run.sh');

      // Verify script exists
      try {
        await fs.access(scriptPath);
      } catch {
        const message = `Run script not found: ${scriptPath}`;
        await db.pipelineRun.update({
          where: { id },
          data: {
            status: 'failed',
            errorTail: message,
            completedAt: new Date(),
            statusSource: 'launcher',
            lastEventAt: new Date(),
          },
        });
        return NextResponse.json({ error: message }, { status: 500 });
      }

      if (executionSettings.useSlurm) {
        // Verify sbatch is available
        const sbatchAvailable = await commandExists('sbatch');
        if (!sbatchAvailable) {
          const message = 'SLURM sbatch command not found. Make sure SLURM is installed and in PATH.';
          await db.pipelineRun.update({
            where: { id },
            data: {
              status: 'failed',
              errorTail: message,
              completedAt: new Date(),
              statusSource: 'launcher',
              lastEventAt: new Date(),
            },
          });
          return NextResponse.json({ error: message }, { status: 500 });
        }

        // Submit to SLURM
        try {
          const sbatchProcess = spawn('sbatch', ['--parsable', scriptPath], {
            cwd: prepResult.runFolder,
          });

          let jobId = '';
          let stdoutData = '';
          let stderrData = '';

          sbatchProcess.stdout.on('data', (data) => {
            const output = data.toString();
            stdoutData += output;
            // Parse job ID from parsable output: "12345" or "12345;cluster"
            const match = output.trim().match(/^(\d+)/);
            if (match) {
              jobId = match[1];
            }
          });

          sbatchProcess.stderr.on('data', (data) => {
            stderrData += data.toString();
          });

          await new Promise<void>((resolve, reject) => {
            sbatchProcess.on('close', (code) => {
              if (code === 0) {
                if (!jobId) {
                  const details = stderrData.trim() || stdoutData.trim() || 'No output captured';
                  reject(new Error(`sbatch did not return a job id: ${details}`));
                  return;
                }
                resolve();
              } else {
                const details = stderrData.trim() || stdoutData.trim() || 'No output captured';
                reject(new Error(`sbatch exited with code ${code}: ${details}`));
              }
            });
            sbatchProcess.on('error', (err) => {
              reject(new Error(`Failed to run sbatch: ${err.message}`));
            });
          });

          // Update run with job ID (queued)
          await db.pipelineRun.update({
            where: { id },
            data: {
              status: 'queued',
              queueJobId: jobId,
              queuedAt: new Date(),
              queueStatus: 'PENDING',
              queueReason: null,
              queueUpdatedAt: new Date(),
              statusSource: 'launcher',
              lastEventAt: new Date(),
            },
          });

          return NextResponse.json({
            success: true,
            status: 'queued',
            jobId,
            runFolder: prepResult.runFolder,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'SLURM submission failed';
          console.error('[Pipeline Run] SLURM submission failed:', message);
          await db.pipelineRun.update({
            where: { id },
            data: {
              status: 'failed',
              errorTail: message,
              completedAt: new Date(),
              statusSource: 'launcher',
              lastEventAt: new Date(),
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
              stdio: 'ignore',
              detached: true,
            });
            childProcess.unref();

            childProcess.on('close', (code) => {
              void finalizeLocalRun(run.id, pipelineId, code);
            });
          childProcess.on('error', (error) => {
            console.error('[Pipeline Run] Local execution error:', error);
            void finalizeLocalRun(run.id, pipelineId, 1);
          });

          // Update run status to running
          await db.pipelineRun.update({
            where: { id },
            data: {
              status: 'running',
              queueJobId: `local-${childProcess.pid}`,
              startedAt: new Date(),
              queueStatus: 'RUNNING',
              queueUpdatedAt: new Date(),
              statusSource: 'launcher',
              lastEventAt: new Date(),
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
              statusSource: 'launcher',
              lastEventAt: new Date(),
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
      runId: run.id,
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
