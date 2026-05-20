import { db } from '@/lib/db';
import { PIPELINE_REGISTRY } from '@/lib/pipelines';
import {
  resolveOrderPlatform,
  resolveOrderSequencingTechnology,
} from '@/lib/pipelines/order-platform';
import { getPipelineSampleWhere } from '@/lib/pipelines/target';
import type {
  PipelineConfigDeriveRule,
  PipelineConfigProperty,
  PipelineTarget,
} from '@/lib/pipelines/types';

export interface DerivedPipelineSetting {
  key: string;
  title: string;
  value: string;
  message: string;
  source: string;
}

export interface DerivedPipelineConfigIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface DerivedPipelineConfigResult {
  config: Record<string, unknown>;
  settings: DerivedPipelineSetting[];
  issues: DerivedPipelineConfigIssue[];
}

type DerivedSample = {
  id: string;
  sampleId: string;
  order: {
    id: string;
    orderNumber?: string | null;
    name?: string | null;
    platform?: string | null;
    customFields?: string | Record<string, unknown> | null;
  } | null;
};

function getDerivedProperties(pipelineId: string) {
  const definition = PIPELINE_REGISTRY[pipelineId];
  const properties = definition?.configSchema?.properties || {};
  return Object.entries(properties)
    .map(([key, property]) => ({
      key,
      property,
      derive: property['x-seqdesk']?.derive,
    }))
    .filter(
      (entry): entry is {
        key: string;
        property: PipelineConfigProperty;
        derive: PipelineConfigDeriveRule;
      } => Boolean(entry.derive)
    );
}

function normalizeMapKey(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s]+/g, '-');
}

function buildNormalizedMap(map: Record<string, string> | undefined): Map<string, string> {
  const normalized = new Map<string, string>();
  for (const [key, value] of Object.entries(map || {})) {
    const raw = key.trim().toLowerCase();
    if (!raw) continue;
    normalized.set(raw, value);
    normalized.set(normalizeMapKey(key), value);
    normalized.set(key.trim().toLowerCase().replace(/[-\s]+/g, '_'), value);
    normalized.set(key.trim().toLowerCase().replace(/[_-]+/g, ' '), value);
  }
  return normalized;
}

function firstMappedValue(
  rawValues: Array<string | null | undefined>,
  map: Record<string, string> | undefined
): string | null {
  const normalizedMap = buildNormalizedMap(map);
  for (const rawValue of rawValues) {
    const value = rawValue?.trim();
    if (!value) continue;
    const candidates = [
      value.toLowerCase(),
      normalizeMapKey(value),
      value.toLowerCase().replace(/[-\s]+/g, '_'),
      value.toLowerCase().replace(/[_-]+/g, ' '),
    ];
    for (const candidate of candidates) {
      const mapped = normalizedMap.get(candidate);
      if (mapped) return mapped;
    }
  }
  return null;
}

function getSourceValuesForSample(sample: DerivedSample, source: string): string[] {
  const order = sample.order;
  if (!order) return [];

  if (source === 'order.sequencingTechnology.platformFamily') {
    const selection = resolveOrderSequencingTechnology(order);
    return [
      selection?.platformFamily,
      selection?.technologyId,
      selection?.technologyName,
      resolveOrderPlatform(order),
      order.platform,
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  }

  if (source === 'order.platform') {
    return [resolveOrderPlatform(order), order.platform].filter(
      (value): value is string => typeof value === 'string' && value.trim().length > 0
    );
  }

  return [];
}

function formatSampleList(sampleIds: string[]): string {
  const visible = sampleIds.slice(0, 5);
  const suffix = sampleIds.length > visible.length ? `, +${sampleIds.length - visible.length} more` : '';
  return `${visible.join(', ')}${suffix}`;
}

function getPipelineName(pipelineId: string): string {
  return PIPELINE_REGISTRY[pipelineId]?.name || pipelineId;
}

export async function resolvePipelineDerivedConfig(args: {
  pipelineId: string;
  target: PipelineTarget;
}): Promise<DerivedPipelineConfigResult> {
  const derivedProperties = getDerivedProperties(args.pipelineId);
  if (derivedProperties.length === 0) {
    return { config: {}, settings: [], issues: [] };
  }

  const samples = await db.sample.findMany({
    where: getPipelineSampleWhere(args.target),
    select: {
      id: true,
      sampleId: true,
      order: {
        select: {
          id: true,
          orderNumber: true,
          name: true,
          platform: true,
          customFields: true,
        },
      },
    },
    orderBy: { sampleId: 'asc' },
  }) as DerivedSample[];

  const config: Record<string, unknown> = {};
  const settings: DerivedPipelineSetting[] = [];
  const issues: DerivedPipelineConfigIssue[] = [];
  const pipelineName = getPipelineName(args.pipelineId);

  if (samples.length === 0) {
    for (const { key, property } of derivedProperties) {
      issues.push({
        field: key,
        message: `${pipelineName} cannot derive ${property.title || key} because no samples are selected.`,
        severity: 'error',
      });
    }
    return { config, settings, issues };
  }

  for (const { key, property, derive } of derivedProperties) {
    const valuesBySample = new Map<string, string>();
    const missingSamples: string[] = [];

    for (const sample of samples) {
      const sourceValues = getSourceValuesForSample(sample, derive.source);
      const mappedValue = firstMappedValue(sourceValues, derive.map);
      if (!mappedValue) {
        missingSamples.push(sample.sampleId);
      } else {
        valuesBySample.set(sample.sampleId, mappedValue);
      }
    }

    if (missingSamples.length > 0) {
      issues.push({
        field: key,
        message: `${pipelineName} needs ${property.title || key} from order sequencing technology. The selected sample(s) are missing a supported Nanopore or PacBio technology: ${formatSampleList(missingSamples)}.`,
        severity: 'error',
      });
      continue;
    }

    const uniqueValues = Array.from(new Set(valuesBySample.values()));
    if (derive.requireSingleValue !== false && uniqueValues.length > 1) {
      issues.push({
        field: key,
        message: `${pipelineName} selected samples resolve to mixed ${property.title || key} values (${uniqueValues.join(', ')}). Select samples from one sequencing mode for a single run.`,
        severity: 'error',
      });
      continue;
    }

    const value = uniqueValues[0];
    if (!value) continue;

    config[key] = value;
    settings.push({
      key,
      title: property.title || key,
      value,
      source: derive.source,
      message: `${pipelineName} will run in ${value} mode.`,
    });
  }

  return { config, settings, issues };
}

export async function mergePipelineDerivedConfig(args: {
  pipelineId: string;
  target: PipelineTarget;
  config: Record<string, unknown>;
}): Promise<DerivedPipelineConfigResult> {
  const derived = await resolvePipelineDerivedConfig({
    pipelineId: args.pipelineId,
    target: args.target,
  });

  return {
    ...derived,
    config: {
      ...args.config,
      ...derived.config,
    },
  };
}
