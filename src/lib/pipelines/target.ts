import type { Prisma } from '@prisma/client';
import type {
  OrderPipelineTarget,
  PipelineDefinition,
  PipelineTarget,
  StudyPipelineTarget,
} from './types';

export function isStudyTarget(target: PipelineTarget): target is StudyPipelineTarget {
  return target.type === 'study';
}

export function isOrderTarget(target: PipelineTarget): target is OrderPipelineTarget {
  return target.type === 'order';
}

export function getPipelineTargetId(target: PipelineTarget): string {
  return isStudyTarget(target) ? target.studyId : target.orderId;
}

export function getPipelineTargetWhere(target: PipelineTarget): { studyId?: string; orderId?: string } {
  return isStudyTarget(target)
    ? { studyId: target.studyId }
    : { orderId: target.orderId };
}

export function getPipelineSampleWhere(
  target: PipelineTarget
): Prisma.SampleWhereInput {
  const where = isStudyTarget(target)
    ? (target.primaryOnly ? { studyId: target.studyId } : {
        OR: [{ studyId: target.studyId }, { studyMemberships: { some: { studyId: target.studyId } } }],
      }) as Prisma.SampleWhereInput
    : { orderId: target.orderId };

  if (target.sampleIds && (isStudyTarget(target) || target.sampleIds.length > 0)) {
    where.id = { in: [...new Set(target.sampleIds)] };
  }

  return where;
}

export function supportsPipelineTarget(
  definition: Pick<PipelineDefinition, 'input'>,
  target: PipelineTarget
): boolean {
  const scopes = definition.input.supportedScopes;

  if (isOrderTarget(target)) {
    return scopes.includes('order');
  }

  return scopes.includes('study') || scopes.includes('samples') || scopes.includes('sample');
}

/** Preparation must not silently shrink a frozen cohort after a concurrent unlink. */
export function studySampleSelectionIssues(target: PipelineTarget, samples: Array<{ id: string; sampleId: string }>): string[] {
  if (!isStudyTarget(target)) return [];
  const issues: string[] = [];
  const available = new Set(samples.map(sample => sample.id));
  if (target.sampleIds?.some(id => !available.has(id))) issues.push('Selected samples are no longer available in this study. Create a new run with the current selection.');
  if (new Set(samples.map(sample => sample.sampleId)).size !== samples.length) issues.push('Selected samples have duplicate sample codes. Select uniquely named samples before running the pipeline.');
  return issues;
}
