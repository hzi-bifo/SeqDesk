import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { sequencingEntryScope } from '@/lib/sequencing/entry-access';
import { getPipelineSampleWhere } from './target';
import { getPackage } from './package-loader';
import type { PipelineTarget } from './types';

// Analysis membership does not transfer ownership or change the source study.
// Submission pipelines retain their existing primary-study-only semantics.
export function scopePipelineStudyTarget(target: PipelineTarget, pipelineId: string): PipelineTarget {
  return target.type === 'study' && (pipelineId === 'submg' || getPackage(pipelineId)?.registry?.category === 'submission')
    ? { ...target, primaryOnly: true }
    : target;
}

export function mergeStudySamples<T extends { id: string }>(study: {
  samples?: T[];
  cohortMembers?: Array<{ sample: T }>;
} | null | undefined, primaryOnly = false): T[] {
  const samples = [...(study?.samples ?? []), ...(primaryOnly ? [] : (study?.cohortMembers ?? []).map(member => member.sample))];
  return [...new Map(samples.map(sample => [sample.id, sample])).values()];
}

export const STUDY_PIPELINE_SAMPLE_INCLUDE = {
  reads: { where: { isActive: true }, orderBy: [{ dataClass: 'asc' }, { id: 'asc' }] },
  assemblies: {
    include: { createdByPipelineRun: { select: { id: true, runNumber: true, status: true, createdAt: true, completedAt: true } } },
  },
  bins: true,
  order: true,
  study: { select: { id: true, title: true } },
} satisfies Prisma.SampleInclude;

/** Call after authorizing the study; a membership never substitutes for sample access. */
export async function loadStudyPipelineSamples(
  target: Extract<PipelineTarget, { type: 'study' }>,
  actor: { userId: string; installation: boolean },
) {
  const membership = getPipelineSampleWhere(target);
  return db.sample.findMany({
    where: { AND: [membership, sequencingEntryScope(actor.userId, actor.installation)] },
    include: STUDY_PIPELINE_SAMPLE_INCLUDE,
    orderBy: [{ sampleId: 'asc' }, { id: 'asc' }],
  });
}

/** Historical output matching uses the frozen input IDs, not today's cohort. */
export async function loadStudyRunSamples(run: { inputSampleIds?: string | null }) {
  const ids: unknown = JSON.parse(run.inputSampleIds ?? 'null');
  if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !id)) {
    throw new Error('Run sample selection is invalid');
  }
  return db.sample.findMany({
    where: { id: { in: [...new Set(ids as string[])] } },
    include: STUDY_PIPELINE_SAMPLE_INCLUDE,
    orderBy: [{ sampleId: 'asc' }, { id: 'asc' }],
  });
}
