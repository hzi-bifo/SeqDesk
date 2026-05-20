import { spawn, exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

import { db } from '@/lib/db';
import { getResolvedDataBasePath } from '@/lib/files/data-base-path';
import { notifyPipelineRunTerminalInApp } from '@/lib/notifications/in-app';
import { PIPELINE_REGISTRY } from '@/lib/pipelines';
import { getAdapter, registerAdapter } from '@/lib/pipelines/adapters';
import { mergePipelineDerivedConfig } from '@/lib/pipelines/derived-config';
import { getPipelineEnabled } from '@/lib/pipelines/enablement';
import { getExecutionSettings } from '@/lib/pipelines/execution-settings';
import {
  normalizeRunExecutionOverride,
  serializeRunExecutionRequest,
  buildExecutionProfileJson,
  parseRunExecutionProfileRequest,
  resolvePipelineExecutionPolicy,
} from '@/lib/pipelines/execution-policy';
import { prepareGenericRun } from '@/lib/pipelines/generic-executor';
import { createGenericAdapter } from '@/lib/pipelines/generic-adapter';
import {
  buildMetaxPathCompatibilityMessage,
  checkMetaxPathPackageCompatibility,
} from '@/lib/pipelines/metaxpath-compatibility';
import { validatePipelineMetadata } from '@/lib/pipelines/metadata-validation';
import { getPackage } from '@/lib/pipelines/package-loader';
import { processCompletedPipelineRun } from '@/lib/pipelines/run-completion';
import {
  buildPipelineRunResultFileSummary,
  getPipelineRunTargetKey,
  getPrimaryPipelineRunResultFile,
} from '@/lib/pipelines/result-files';
import { summarizePipelineFailure } from '@/lib/pipelines/run-log-summary';
import {
  detectRuntimePlatform,
  isMacOsArmRuntime,
  resolveCondaBin,
} from '@/lib/pipelines/runtime-platform';
import {
  getLocalCondaCompatibilityBlockMessage,
  shouldSkipCondaOnMacArm,
} from '@/lib/pipelines/runtime-compatibility';
import {
  getPipelineRunConfigIssues,
  normalizePipelineRunConfig,
} from '@/lib/pipelines/simulate-reads-config';
import { prepareSubmgRun } from '@/lib/pipelines/submg/submg-runner';
import { supportsPipelineTarget } from '@/lib/pipelines/target';
import type { PipelineTarget } from '@/lib/pipelines/types';

const execAsync = promisify(exec);

export type PipelineServiceResponse<TBody = Record<string, unknown>> = {
  status: number;
  body: TBody;
};

type CreatePipelineRunInput = {
  body: Record<string, unknown>;
  userId: string;
};

type StartPipelineRunInput = {
  runId: string;
  body?: Record<string, unknown>;
  userId: string;
};

function jsonResponse<TBody extends Record<string, unknown>>(
  body: TBody,
  status = 200
): PipelineServiceResponse<TBody> {
  return { status, body };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseRunResults(rawResults: string | null | undefined): Record<string, unknown> | null {
  if (!rawResults) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawResults);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeArtifactSize(value: bigint | number | string | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function parseConfigJson(rawConfig: string | null | undefined): Record<string, unknown> {
  if (!rawConfig) return {};
  try {
    const parsed = JSON.parse(rawConfig);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function stripSeqDeskOnlyRunConfig(config: Record<string, unknown>): Record<string, unknown> {
  const runtimeConfig = { ...config };
  delete runtimeConfig.allowedSequencingTechnologies;
  return runtimeConfig;
}

function getPipelineDefaultConfig(pipelineId: string): Record<string, unknown> {
  try {
    return PIPELINE_REGISTRY[pipelineId]?.defaultConfig || {};
  } catch {
    return {};
  }
}

async function resolvePipelineRuntimeConfig(
  pipelineId: string,
  runConfig: Record<string, unknown> | null
): Promise<Record<string, unknown>> {
  const savedConfigRecord = await db.pipelineConfig.findUnique({
    where: { pipelineId },
    select: { config: true },
  });
  const savedConfig = parseConfigJson(savedConfigRecord?.config);
  const mergedConfig = stripSeqDeskOnlyRunConfig({
    ...getPipelineDefaultConfig(pipelineId),
    ...savedConfig,
    ...(runConfig || {}),
  });

  return normalizePipelineRunConfig(pipelineId, mergedConfig);
}

async function resolvePipelineLaunchConfig(args: {
  pipelineId: string;
  runConfig: Record<string, unknown> | null;
  target: PipelineTarget;
}): Promise<{
  config: Record<string, unknown>;
  derivedIssues: string[];
}> {
  const baseConfig = await resolvePipelineRuntimeConfig(args.pipelineId, args.runConfig);
  const derived = await mergePipelineDerivedConfig({
    pipelineId: args.pipelineId,
    target: args.target,
    config: baseConfig,
  });

  if (derived.issues.length > 0) {
    return {
      config: baseConfig,
      derivedIssues: derived.issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => issue.message),
    };
  }

  return {
    config: normalizePipelineRunConfig(args.pipelineId, derived.config),
    derivedIssues: [],
  };
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execAsync(`command -v ${command}`, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function resolveEffectiveProfile(profileOverride?: string): string {
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

function buildSbatchSubmitArgs(scriptPath: string): string[] {
  return ['--parsable', scriptPath];
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
    await notifyPipelineRunTerminalInApp(runId, null, 'completed');
    processCompletedPipelineRun(runId, pipelineId).catch((err) => {
      console.error('[Pipeline Run] Output resolution failed:', err);
    });
  } else {
    const run = await db.pipelineRun.findUnique({
      where: { id: runId },
      select: {
        outputPath: true,
        errorPath: true,
      },
    });
    const { outputTail, errorTail } = await summarizePipelineFailure({
      outputPath: run?.outputPath ?? null,
      errorPath: run?.errorPath ?? null,
      exitCode,
    });
    await db.pipelineRun.update({
      where: { id: runId },
      data: {
        status: 'failed',
        currentStep: 'Failed',
        outputTail,
        errorTail,
        completedAt,
        statusSource: 'process',
        lastEventAt: completedAt,
        queueStatus: 'FAILED',
        queueUpdatedAt: completedAt,
      },
    });
    await notifyPipelineRunTerminalInApp(runId, null, 'failed');
  }
}

export async function listPipelineRunsForOperator(args: {
  userId: string;
  role: string;
  pipelineId?: string | null;
  status?: string | null;
  studyId?: string | null;
  orderId?: string | null;
  limit?: number;
  offset?: number;
}): Promise<PipelineServiceResponse> {
  const limit = Number.isFinite(args.limit) ? Number(args.limit) : 50;
  const offset = Number.isFinite(args.offset) ? Number(args.offset) : 0;
  const where: Record<string, unknown> = {};

  if (args.role !== 'FACILITY_ADMIN') {
    where.OR = [
      { study: { userId: args.userId } },
      { order: { userId: args.userId } },
    ];
  }

  if (args.pipelineId) {
    where.pipelineId = args.pipelineId;
  }
  if (args.status) {
    where.status = args.status;
  }
  if (args.studyId) {
    where.studyId = args.studyId;
  }
  if (args.orderId) {
    where.orderId = args.orderId;
  }

  const [runs, total] = await Promise.all([
    db.pipelineRun.findMany({
      where,
      include: {
        study: {
          select: { id: true, title: true, userId: true },
        },
        order: {
          select: { id: true, name: true, orderNumber: true, userId: true },
        },
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        _count: {
          select: { assembliesCreated: true, binsCreated: true },
        },
        artifacts: {
          select: {
            id: true,
            name: true,
            path: true,
            type: true,
            sampleId: true,
            outputId: true,
            size: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    db.pipelineRun.count({ where }),
  ]);

  const selectionLookupKeys = runs
    .map((run) => {
      const targetKey = getPipelineRunTargetKey(run);
      return targetKey ? { pipelineId: run.pipelineId, targetKey } : null;
    })
    .filter((value): value is { pipelineId: string; targetKey: string } => Boolean(value));

  const selections = selectionLookupKeys.length
    ? await db.pipelineResultSelection.findMany({
        where: {
          OR: selectionLookupKeys.map((selection) => ({
            pipelineId: selection.pipelineId,
            targetKey: selection.targetKey,
          })),
        },
        include: {
          selectedBy: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      })
    : [];

  const selectionByTarget = new Map(
    selections.map((selection) => [
      `${selection.pipelineId}:${selection.targetKey}`,
      selection,
    ])
  );

  const enrichedRuns = await Promise.all(runs.map(async (run) => {
    const definition = PIPELINE_REGISTRY[run.pipelineId];
    const artifacts = run.artifacts.map((artifact) => ({
      ...artifact,
      size: normalizeArtifactSize(artifact.size),
    }));
    const resultFileSummary = await buildPipelineRunResultFileSummary({
      pipelineId: run.pipelineId,
      runId: run.id,
      runFolder: run.runFolder,
      artifacts,
    });
    const targetKey = getPipelineRunTargetKey(run);
    const selection = targetKey
      ? selectionByTarget.get(`${run.pipelineId}:${targetKey}`) ?? null
      : null;
    return {
      ...run,
      artifacts,
      pipelineName: definition?.name || run.pipelineId,
      pipelineIcon: definition?.icon || 'CircleDot',
      results: parseRunResults(run.results),
      isSelectedFinal: selection?.selectedRunId === run.id,
      selectedFinal: selection
        ? {
            selectedRunId: selection.selectedRunId,
            selectedAt: selection.selectedAt,
            selectedBy: selection.selectedBy,
          }
        : null,
      resultFiles: resultFileSummary.files,
      resultFilesOmittedCount: resultFileSummary.omittedCount,
      resultFilesOmittedSampleFileCount: resultFileSummary.omittedSampleFileCount,
      primaryResultFile: getPrimaryPipelineRunResultFile(resultFileSummary.files),
    };
  }));

  return jsonResponse({
    runs: enrichedRuns,
    total,
    limit,
    offset,
  });
}

export async function createPipelineRunForOperator({
  body,
  userId,
}: CreatePipelineRunInput): Promise<PipelineServiceResponse> {
  const pipelineId = typeof body.pipelineId === 'string' ? body.pipelineId : '';
  const studyId = typeof body.studyId === 'string' ? body.studyId : undefined;
  const orderId = typeof body.orderId === 'string' ? body.orderId : undefined;
  const sampleIds = body.sampleIds;
  const config = body.config;
  let requestedSampleIds: string[] | undefined;
  const executionRequest = normalizeRunExecutionOverride(body);

  if (
    body.executionMode !== undefined &&
    !['default', 'local', 'slurm'].includes(
      String(body.executionMode).trim().toLowerCase()
    )
  ) {
    return jsonResponse(
      { error: 'executionMode must be one of: default, local, slurm' },
      400
    );
  }

  if (sampleIds !== undefined) {
    if (!Array.isArray(sampleIds) || sampleIds.some((id: unknown) => typeof id !== 'string')) {
      return jsonResponse({ error: 'sampleIds must be an array of strings' }, 400);
    }
    requestedSampleIds = sampleIds;
  }

  if ((!studyId && !orderId) || (studyId && orderId)) {
    return jsonResponse({ error: 'Exactly one of studyId or orderId is required' }, 400);
  }

  const target: PipelineTarget = orderId
    ? { type: 'order', orderId, sampleIds: requestedSampleIds }
    : { type: 'study', studyId: studyId!, sampleIds: requestedSampleIds };

  const definition = PIPELINE_REGISTRY[pipelineId];
  if (!definition) {
    return jsonResponse({ error: 'Invalid pipeline ID' }, 400);
  }

  if (!(await getPipelineEnabled(pipelineId))) {
    return jsonResponse({ error: `Pipeline ${pipelineId} is disabled` }, 403);
  }

  if (!supportsPipelineTarget(definition, target)) {
    return jsonResponse(
      { error: `Pipeline ${pipelineId} does not support ${target.type} targets` },
      400
    );
  }

  const [study, order] = await Promise.all([
    target.type === 'study'
      ? db.study.findUnique({
          where: { id: target.studyId },
          include: {
            samples: {
              include: {
                reads: {
                  where: { isActive: true },
                  orderBy: [{ dataClass: 'asc' }, { id: 'asc' }],
                },
                assemblies: true,
                bins: true,
              },
            },
          },
        })
      : Promise.resolve(null),
    target.type === 'order'
      ? db.order.findUnique({
          where: { id: target.orderId },
          include: {
            samples: {
              include: {
                reads: {
                  where: { isActive: true },
                  orderBy: [{ dataClass: 'asc' }, { id: 'asc' }],
                },
                assemblies: true,
                bins: true,
              },
            },
          },
        })
      : Promise.resolve(null),
  ]);

  const samples = target.type === 'study' ? study?.samples || [] : order?.samples || [];

  if (target.type === 'study' && !study) {
    return jsonResponse({ error: 'Study not found' }, 404);
  }

  if (target.type === 'order' && !order) {
    return jsonResponse({ error: 'Order not found' }, 404);
  }

  if (requestedSampleIds && requestedSampleIds.length > 0) {
    const sampleIdSet = new Set(samples.map((sample) => sample.id));
    const missingSampleIds = requestedSampleIds.filter((sampleId) => !sampleIdSet.has(sampleId));
    if (missingSampleIds.length > 0) {
      return jsonResponse(
        { error: `Invalid sample IDs: ${missingSampleIds.join(', ')}` },
        400
      );
    }
  }

  const validationTarget =
    requestedSampleIds && requestedSampleIds.length > 0
      ? { ...target, sampleIds: requestedSampleIds }
      : target;
  const metadataValidation = await validatePipelineMetadata(validationTarget, pipelineId);
  const metadataErrors = metadataValidation.issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.message);

  if (metadataErrors.length > 0) {
    return jsonResponse(
      { error: 'Pipeline metadata validation failed', details: metadataErrors },
      400
    );
  }

  let adapter = getAdapter(pipelineId);
  if (!adapter) {
    const genericAdapter = createGenericAdapter(pipelineId);
    if (genericAdapter) {
      registerAdapter(genericAdapter);
      adapter = genericAdapter;
    }
  }

  if (adapter) {
    const inputValidation = await adapter.validateInputs(validationTarget);
    if (!inputValidation.valid) {
      return jsonResponse(
        { error: 'Pipeline input validation failed', details: inputValidation.issues },
        400
      );
    }
  }

  const launchConfig = await resolvePipelineLaunchConfig({
    pipelineId,
    runConfig: asRecord(config),
    target: validationTarget,
  });
  if (launchConfig.derivedIssues.length > 0) {
    return jsonResponse(
      { error: 'Pipeline metadata validation failed', details: launchConfig.derivedIssues },
      400
    );
  }

  const normalizedConfig = launchConfig.config;
  const configIssues = getPipelineRunConfigIssues(pipelineId, normalizedConfig);
  if (configIssues.length > 0) {
    return jsonResponse(
      { error: 'Pipeline config validation failed', details: configIssues },
      400
    );
  }

  const runNumber = `${pipelineId.toUpperCase()}-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 7)
    .toUpperCase()}`;

  const run = await db.pipelineRun.create({
    data: {
      runNumber,
      pipelineId,
      status: 'pending',
      targetType: target.type,
      studyId: target.type === 'study' ? target.studyId : null,
      orderId: target.type === 'order' ? target.orderId : null,
      userId,
      config: Object.keys(normalizedConfig).length > 0 ? JSON.stringify(normalizedConfig) : null,
      inputSampleIds:
        requestedSampleIds && requestedSampleIds.length > 0
          ? JSON.stringify(requestedSampleIds)
          : null,
      executionMode:
        executionRequest?.executionMode === 'local' ||
        executionRequest?.executionMode === 'slurm'
          ? executionRequest.executionMode
          : null,
      executionProfile: serializeRunExecutionRequest(executionRequest),
    },
  });

  return jsonResponse({
    success: true,
    run: {
      id: run.id,
      runNumber: run.runNumber,
      status: run.status,
      pipelineId: run.pipelineId,
      studyId: run.studyId,
      orderId: run.orderId,
      targetType: run.targetType,
      executionMode: run.executionMode,
    },
  });
}

export async function startPipelineRunForOperator({
  runId,
  body = {},
  userId,
}: StartPipelineRunInput): Promise<PipelineServiceResponse> {
  const startBody = body;

  if (
    startBody.executionMode !== undefined &&
    !['default', 'local', 'slurm'].includes(
      String(startBody.executionMode).trim().toLowerCase()
    )
  ) {
    return jsonResponse(
      { error: 'executionMode must be one of: default, local, slurm' },
      400
    );
  }

  const run = await db.pipelineRun.findUnique({
    where: { id: runId },
    include: {
      study: {
        include: {
          samples: {
            include: {
              reads: {
                where: { isActive: true },
                orderBy: [{ dataClass: 'asc' }, { id: 'asc' }],
              },
            },
          },
        },
      },
      order: {
        include: {
          samples: {
            include: {
              reads: {
                where: { isActive: true },
                orderBy: [{ dataClass: 'asc' }, { id: 'asc' }],
              },
            },
          },
        },
      },
    },
  });

  if (!run) {
    return jsonResponse({ error: 'Run not found' }, 404);
  }

  if (run.status !== 'pending') {
    return jsonResponse({ error: `Cannot start run with status: ${run.status}` }, 400);
  }

  if (!(await getPipelineEnabled(run.pipelineId))) {
    return jsonResponse({ error: `Pipeline ${run.pipelineId} is disabled` }, 403);
  }

  const target: PipelineTarget | null =
    run.targetType === 'order' && run.orderId
      ? { type: 'order', orderId: run.orderId }
      : run.studyId
        ? { type: 'study', studyId: run.studyId }
        : null;

  if (!target) {
    return jsonResponse({ error: 'Run has no associated target' }, 400);
  }

  let config: Record<string, unknown> = {};
  if (run.config) {
    try {
      config = JSON.parse(run.config);
    } catch {
      return jsonResponse({ error: 'Run config is invalid JSON' }, 400);
    }
  }

  let selectedSampleIds: string[] | undefined;
  if (run.inputSampleIds) {
    try {
      const parsed = JSON.parse(run.inputSampleIds);
      if (!Array.isArray(parsed)) {
        return jsonResponse({ error: 'Run sample selection is invalid' }, 400);
      }
      if (parsed.length === 0 || parsed.some((id) => typeof id !== 'string')) {
        return jsonResponse({ error: 'Run sample selection is invalid' }, 400);
      }
      selectedSampleIds = parsed;
    } catch {
      return jsonResponse({ error: 'Run sample selection is invalid JSON' }, 400);
    }
  } else if (Array.isArray(startBody.sampleIds)) {
    if (
      startBody.sampleIds.length === 0 ||
      startBody.sampleIds.some((id: unknown) => typeof id !== 'string')
    ) {
      return jsonResponse({ error: 'Run sample selection is invalid' }, 400);
    }
    selectedSampleIds = startBody.sampleIds;
  }

  const validationTarget =
    selectedSampleIds && selectedSampleIds.length > 0
      ? { ...target, sampleIds: selectedSampleIds }
      : target;
  const metadataValidation = await validatePipelineMetadata(validationTarget, run.pipelineId);
  const metadataErrors = metadataValidation.issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.message);
  if (metadataErrors.length > 0) {
    return jsonResponse(
      {
        error: 'Pipeline metadata validation failed',
        details: metadataErrors,
      },
      400
    );
  }

  const launchConfig = await resolvePipelineLaunchConfig({
    pipelineId: run.pipelineId,
    runConfig: config,
    target: validationTarget,
  });
  if (launchConfig.derivedIssues.length > 0) {
    const message = launchConfig.derivedIssues.join('\n');
    await db.pipelineRun.update({
      where: { id: runId },
      data: {
        status: 'failed',
        errorTail: message,
        completedAt: new Date(),
        statusSource: 'launcher',
        lastEventAt: new Date(),
      },
    });
    return jsonResponse(
      { error: 'Pipeline metadata validation failed', details: launchConfig.derivedIssues },
      400
    );
  }

  config = launchConfig.config;
  const configIssues = getPipelineRunConfigIssues(run.pipelineId, config);
  if (configIssues.length > 0) {
    const message = configIssues.join('\n');
    await db.pipelineRun.update({
      where: { id: runId },
      data: {
        status: 'failed',
        errorTail: message,
        completedAt: new Date(),
        statusSource: 'launcher',
        lastEventAt: new Date(),
      },
    });
    return jsonResponse(
      { error: 'Pipeline config validation failed', details: configIssues },
      400
    );
  }

  const executionSettings = await getExecutionSettings();
  const storedExecutionRequest =
    parseRunExecutionProfileRequest(run.executionProfile) ||
    normalizeRunExecutionOverride({ executionMode: run.executionMode });
  const requestExecutionOverride = normalizeRunExecutionOverride(startBody);
  const executionPolicy = resolvePipelineExecutionPolicy({
    pipelineId: run.pipelineId,
    settings: executionSettings,
    runOverride: requestExecutionOverride || storedExecutionRequest,
  });
  const effectiveExecutionSettings = executionPolicy.settings;
  const executionProfileJson = buildExecutionProfileJson(executionPolicy);

  console.log('[Start Pipeline] Execution settings:', {
    condaPath: effectiveExecutionSettings.condaPath,
    pipelineRunDir: effectiveExecutionSettings.pipelineRunDir,
    useSlurm: effectiveExecutionSettings.useSlurm,
    executionMode: executionPolicy.mode,
    executionSource: executionPolicy.source,
  });

  const resolvedDataBasePath = await getResolvedDataBasePath();

  if (!resolvedDataBasePath.dataBasePath) {
    return jsonResponse({ error: 'Data base path not configured in settings' }, 400);
  }

  if (
    !effectiveExecutionSettings.pipelineRunDir ||
    effectiveExecutionSettings.pipelineRunDir === '/'
  ) {
    return jsonResponse(
      {
        error:
          'Pipeline run directory not configured properly. Set it in Admin > Infrastructure.',
      },
      400
    );
  }

  if (!effectiveExecutionSettings.condaPath) {
    console.warn(
      '[Start Pipeline] WARNING: condaPath is not configured - nextflow may not be found'
    );
  }

  const pipelineId = run.pipelineId;
  const isSubmgPipeline = pipelineId === 'submg';
  const pkg = getPackage(pipelineId);

  if (!pkg) {
    return jsonResponse({ error: `Pipeline package not found: ${pipelineId}` }, 400);
  }

  if (pipelineId === 'metaxpath') {
    const requiredTarget =
      run.targetType === 'study' || run.targetType === 'order'
        ? run.targetType
        : undefined;
    const compatibility = await checkMetaxPathPackageCompatibility(pkg, {
      requiredTarget,
    });
    if (!compatibility.compatible) {
      const message = buildMetaxPathCompatibilityMessage(compatibility);
      await db.pipelineRun.update({
        where: { id: runId },
        data: {
          status: 'failed',
          errorTail: message,
          completedAt: new Date(),
          statusSource: 'launcher',
          lastEventAt: new Date(),
        },
      });
      return jsonResponse(
        {
          error: 'MetaxPath package compatibility check failed',
          details: compatibility.issues,
        },
        400
      );
    }
  }

  const effectiveProfile = resolveEffectiveProfile(effectiveExecutionSettings.nextflowProfile);
  const profileParts = effectiveProfile
    ? effectiveProfile.split(',').map((p) => p.trim()).filter(Boolean)
    : [];

  const runtimePlatform = await detectRuntimePlatform(effectiveExecutionSettings.condaPath);
  const runtimeDetails = `${runtimePlatform.raw} (${runtimePlatform.source})`;

  const localCondaCompatibilityMessage =
    !isSubmgPipeline
      ? getLocalCondaCompatibilityBlockMessage({
          manifest: pkg.manifest,
          runtimeMode: effectiveExecutionSettings.runtimeMode,
          useSlurm: effectiveExecutionSettings.useSlurm,
          runtimePlatform,
        })
      : null;

  if (localCondaCompatibilityMessage) {
    await db.pipelineRun.update({
      where: { id: runId },
      data: {
        status: 'failed',
        errorTail: localCondaCompatibilityMessage,
        completedAt: new Date(),
        statusSource: 'launcher',
        lastEventAt: new Date(),
      },
    });
    return jsonResponse({ error: localCondaCompatibilityMessage }, 400);
  }
  if (effectiveExecutionSettings.useSlurm && isMacOsArmRuntime(runtimePlatform)) {
    console.warn(
      `[Start Pipeline] macOS ARM controller detected (${runtimeDetails}), but proceeding because SLURM is enabled.`
    );
  }

  const skipConda = !isSubmgPipeline && shouldSkipCondaOnMacArm({
    manifest: pkg.manifest,
    runtimeMode: effectiveExecutionSettings.runtimeMode,
    useSlurm: effectiveExecutionSettings.useSlurm,
    runtimePlatform,
  });
  if (skipConda) {
    console.log(
      `[Start Pipeline] macOS ARM detected with allowMacOsArmLocal - skipping conda profile for ${pipelineId}`
    );
  }

  const forbiddenProfiles = new Set(['docker', 'singularity', 'apptainer', 'podman']);
  const forbiddenSelected = profileParts
    .map((part) => part.toLowerCase())
    .filter((part) => forbiddenProfiles.has(part));
  if (forbiddenSelected.length > 0) {
    const message = `Unsupported Nextflow profile(s): ${forbiddenSelected.join(', ')}. SeqDesk only supports conda-based execution.`;
    await db.pipelineRun.update({
      where: { id: runId },
      data: {
        status: 'failed',
        errorTail: message,
        completedAt: new Date(),
        statusSource: 'launcher',
        lastEventAt: new Date(),
      },
    });
    return jsonResponse({ error: message }, 400);
  }

  const condaBin = await resolveCondaBin(effectiveExecutionSettings.condaPath);
  const nextflowAvailable = await commandExists('nextflow');
  if (
    !condaBin &&
    !nextflowAvailable &&
    !effectiveExecutionSettings.useSlurm &&
    !isSubmgPipeline
  ) {
    const message =
      'Neither conda nor nextflow were found. Configure a conda path, or install nextflow on the host.';
    await db.pipelineRun.update({
      where: { id: runId },
      data: {
        status: 'failed',
        errorTail: message,
        completedAt: new Date(),
        statusSource: 'launcher',
        lastEventAt: new Date(),
      },
    });
    return jsonResponse({ error: message }, 400);
  }
  if (!condaBin && nextflowAvailable && !effectiveExecutionSettings.useSlurm && !isSubmgPipeline) {
    console.warn(
      '[Start Pipeline] Conda not found, but nextflow is available directly. Proceeding without conda bootstrap.'
    );
  }
  if (!condaBin && effectiveExecutionSettings.useSlurm) {
    console.warn(
      '[Start Pipeline] Conda not found on the web host. Proceeding because SLURM is enabled.'
    );
  }

  const normalizedConfigJson = JSON.stringify(config);
  const pendingRunUpdate: Record<string, unknown> = {
    config: normalizedConfigJson,
    executionMode: executionPolicy.mode,
    executionProfile: executionProfileJson,
  };
  if (selectedSampleIds && !run.inputSampleIds) {
    pendingRunUpdate.inputSampleIds = JSON.stringify(selectedSampleIds);
  }

  if (selectedSampleIds && !run.inputSampleIds) {
    await db.pipelineRun.update({
      where: { id: run.id },
      data: pendingRunUpdate,
    });
  } else if (
    run.config !== normalizedConfigJson ||
    run.executionMode !== executionPolicy.mode ||
    run.executionProfile !== executionProfileJson
  ) {
    await db.pipelineRun.update({
      where: { id: run.id },
      data: pendingRunUpdate,
    });
  }

  const prepResult = isSubmgPipeline
    ? await prepareSubmgRun({
        runId: run.id,
        studyId: run.studyId!,
        sampleIds: selectedSampleIds,
        config,
        executionSettings: {
          ...effectiveExecutionSettings,
          dataBasePath: resolvedDataBasePath.dataBasePath,
          nextflowProfile: effectiveProfile,
        },
        dataBasePath: resolvedDataBasePath.dataBasePath,
      })
    : await prepareGenericRun({
        runId: run.id,
        pipelineId,
        target:
          selectedSampleIds && selectedSampleIds.length > 0
            ? { ...target, sampleIds: selectedSampleIds }
            : target,
        config,
        executionSettings: {
          ...effectiveExecutionSettings,
          dataBasePath: resolvedDataBasePath.dataBasePath,
          nextflowProfile: effectiveProfile,
          skipConda,
        },
        userId,
      });

  if (!prepResult.success) {
    const prepWarnings =
      'warnings' in prepResult && Array.isArray(prepResult.warnings)
        ? prepResult.warnings
        : [];
    const prepDetails = [...prepResult.errors, ...prepWarnings];
    await db.pipelineRun.update({
      where: { id: runId },
      data: {
        status: 'failed',
        errorTail: prepDetails.join('\n'),
        completedAt: new Date(),
        statusSource: 'launcher',
        lastEventAt: new Date(),
      },
    });

    return jsonResponse({ error: 'Failed to prepare run', details: prepDetails }, 400);
  }

  if (prepResult.runFolder) {
    const scriptPath =
      ('scriptPath' in prepResult ? prepResult.scriptPath : undefined) ||
      path.join(prepResult.runFolder, 'run.sh');

    try {
      await fs.access(scriptPath);
    } catch {
      const message = `Run script not found: ${scriptPath}`;
      await db.pipelineRun.update({
        where: { id: runId },
        data: {
          status: 'failed',
          errorTail: message,
          completedAt: new Date(),
          statusSource: 'launcher',
          lastEventAt: new Date(),
        },
      });
      return jsonResponse({ error: message }, 500);
    }

    if (effectiveExecutionSettings.useSlurm) {
      const sbatchAvailable = await commandExists('sbatch');
      if (!sbatchAvailable) {
        const message = 'SLURM sbatch command not found. Make sure SLURM is installed and in PATH.';
        await db.pipelineRun.update({
          where: { id: runId },
          data: {
            status: 'failed',
            errorTail: message,
            completedAt: new Date(),
            statusSource: 'launcher',
            lastEventAt: new Date(),
          },
        });
        return jsonResponse({ error: message }, 500);
      }

      try {
        const sbatchArgs = buildSbatchSubmitArgs(scriptPath);
        const sbatchProcess = spawn('sbatch', sbatchArgs, {
          cwd: prepResult.runFolder,
        });

        let jobId = '';
        let stdoutData = '';
        let stderrData = '';

        sbatchProcess.stdout.on('data', (data) => {
          const output = data.toString();
          stdoutData += output;
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

        await db.pipelineRun.update({
          where: { id: runId },
          data: {
            status: 'queued',
            queueJobId: jobId,
            queuedAt: new Date(),
            queueStatus: 'PENDING',
            queueReason: null,
            queueUpdatedAt: new Date(),
            currentStep: 'Waiting for scheduler',
            statusSource: 'launcher',
            lastEventAt: new Date(),
          },
        });

        return jsonResponse({
          success: true,
          status: 'queued',
          jobId,
          runFolder: prepResult.runFolder,
          executionMode: executionPolicy.mode,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'SLURM submission failed';
        console.error('[Pipeline Run] SLURM submission failed:', message);
        await db.pipelineRun.update({
          where: { id: runId },
          data: {
            status: 'failed',
            errorTail: message,
            completedAt: new Date(),
            statusSource: 'launcher',
            lastEventAt: new Date(),
          },
        });

        return jsonResponse({ error: message }, 500);
      }
    }

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

      await db.pipelineRun.update({
        where: { id: runId },
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

      return jsonResponse({
        success: true,
        status: 'running',
        pid: childProcess.pid,
        runFolder: prepResult.runFolder,
        executionMode: executionPolicy.mode,
        message: 'Pipeline started in background. Check the Analysis dashboard for status.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Local execution failed';
      await db.pipelineRun.update({
        where: { id: runId },
        data: {
          status: 'failed',
          errorTail: message,
          completedAt: new Date(),
          statusSource: 'launcher',
          lastEventAt: new Date(),
        },
      });

      return jsonResponse({ error: message }, 500);
    }
  }

  return jsonResponse({
    success: true,
    runId: run.id,
    runFolder: prepResult.runFolder,
    executionMode: executionPolicy.mode,
  });
}
