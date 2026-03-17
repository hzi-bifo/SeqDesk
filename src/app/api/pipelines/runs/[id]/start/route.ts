import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { getResolvedDataBasePath } from '@/lib/files/data-base-path';
import { prepareGenericRun } from '@/lib/pipelines/generic-executor';
import { getPackage } from '@/lib/pipelines/package-loader';
import { getExecutionSettings } from '@/lib/pipelines/execution-settings';
import type { ExecutionSettings } from '@/lib/pipelines/execution-settings';
import {
  detectRuntimePlatform,
  isMacOsArmRuntime,
  resolveCondaBin,
} from '@/lib/pipelines/runtime-platform';
import { getLocalCondaCompatibilityBlockMessage } from '@/lib/pipelines/runtime-compatibility';
import { prepareSubmgRun } from '@/lib/pipelines/submg/submg-runner';
import { processCompletedPipelineRun } from '@/lib/pipelines/run-completion';
import { validatePipelineMetadata } from '@/lib/pipelines/metadata-validation';
import { isDemoSession } from '@/lib/demo/server';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import type { PipelineTarget } from '@/lib/pipelines/types';

const execAsync = promisify(exec);

async function commandExists(command: string): Promise<boolean> {
  try {
    await execAsync(`command -v ${command}`, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
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

function splitSbatchOptions(value: string): string[] {
  const tokens = value.match(/(?:[^\s"'\\]+|"[^"]*"|'[^']*')+/g);
  if (!tokens) return [];

  return tokens.map((token) => {
    if (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"))
    ) {
      return token.slice(1, -1);
    }
    return token;
  });
}

function buildSbatchSubmitArgs(
  scriptPath: string,
  executionSettings: ExecutionSettings
): string[] {
  const args = ['--parsable'];
  const queue = executionSettings.slurmQueue?.trim();
  if (queue) {
    args.push('-p', queue);
  }

  const options = executionSettings.slurmOptions?.trim();
  if (options) {
    args.push(...splitSbatchOptions(options));
  }

  args.push(scriptPath);
  return args;
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

    if (isDemoSession(session)) {
      return NextResponse.json(
        { error: 'Pipeline execution is disabled in the public demo.' },
        { status: 403 }
      );
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
        order: {
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

    const target: PipelineTarget | null =
      run.targetType === 'order' && run.orderId
        ? { type: 'order', orderId: run.orderId }
        : run.studyId
          ? { type: 'study', studyId: run.studyId }
          : null;

    if (!target) {
      return NextResponse.json(
        { error: 'Run has no associated target' },
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

    const metadataValidation = await validatePipelineMetadata(
      selectedSampleIds && selectedSampleIds.length > 0
        ? { ...target, sampleIds: selectedSampleIds }
        : target,
      run.pipelineId,
    );
    const metadataErrors = metadataValidation.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => issue.message);
    if (metadataErrors.length > 0) {
      return NextResponse.json(
        {
          error: 'Pipeline metadata validation failed',
          details: metadataErrors,
        },
        { status: 400 }
      );
    }

    // Get execution settings
    const executionSettings = await getExecutionSettings();

    // Log settings for debugging
    console.log('[Start Pipeline] Execution settings:', {
      condaPath: executionSettings.condaPath,
      pipelineRunDir: executionSettings.pipelineRunDir,
      useSlurm: executionSettings.useSlurm,
    });

    const resolvedDataBasePath = await getResolvedDataBasePath();

    if (!resolvedDataBasePath.dataBasePath) {
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
    const pkg = getPackage(pipelineId);

    if (!pkg) {
      return NextResponse.json(
        { error: `Pipeline package not found: ${pipelineId}` },
        { status: 400 }
      );
    }

    const runtimePlatform = await detectRuntimePlatform(executionSettings.condaPath);
    const runtimeDetails = `${runtimePlatform.raw} (${runtimePlatform.source})`;

    const localCondaCompatibilityMessage =
      !isSubmgPipeline
        ? getLocalCondaCompatibilityBlockMessage({
            manifest: pkg.manifest,
            runtimeMode: executionSettings.runtimeMode,
            useSlurm: executionSettings.useSlurm,
            runtimePlatform,
          })
        : null;

    if (localCondaCompatibilityMessage) {
      await db.pipelineRun.update({
        where: { id },
        data: {
          status: 'failed',
          errorTail: localCondaCompatibilityMessage,
          completedAt: new Date(),
          statusSource: 'launcher',
          lastEventAt: new Date(),
        },
      });
      return NextResponse.json({ error: localCondaCompatibilityMessage }, { status: 400 });
    }
    if (executionSettings.useSlurm && isMacOsArmRuntime(runtimePlatform)) {
      console.warn(
        `[Start Pipeline] macOS ARM controller detected (${runtimeDetails}), but proceeding because SLURM is enabled.`
      );
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

    // Prepare the run (generates config/scripts and staging files)
    const prepResult = isSubmgPipeline
      ? await prepareSubmgRun({
          runId: run.id,
          studyId: run.studyId!,
          sampleIds: selectedSampleIds,
          config,
          executionSettings: {
            ...executionSettings,
            dataBasePath: resolvedDataBasePath.dataBasePath,
            nextflowProfile: effectiveProfile,
          },
          dataBasePath: resolvedDataBasePath.dataBasePath,
        })
      : await prepareGenericRun({
          runId: run.id,
          pipelineId,
          target: selectedSampleIds && selectedSampleIds.length > 0
            ? { ...target, sampleIds: selectedSampleIds }
            : target,
          config,
          executionSettings: {
            ...executionSettings,
            dataBasePath: resolvedDataBasePath.dataBasePath,
            nextflowProfile: effectiveProfile,
          },
          userId: session.user.id,
        });

    if (!prepResult.success) {
      const prepWarnings =
        'warnings' in prepResult && Array.isArray(prepResult.warnings)
          ? prepResult.warnings
          : [];
      const prepDetails = [...prepResult.errors, ...prepWarnings];
      // Update run status to failed
      await db.pipelineRun.update({
        where: { id },
        data: {
          status: 'failed',
          errorTail: prepDetails.join('\n'),
          completedAt: new Date(),
          statusSource: 'launcher',
          lastEventAt: new Date(),
        },
      });

      return NextResponse.json(
        { error: 'Failed to prepare run', details: prepDetails },
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
          const sbatchArgs = buildSbatchSubmitArgs(scriptPath, executionSettings);
          const sbatchProcess = spawn('sbatch', sbatchArgs, {
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
