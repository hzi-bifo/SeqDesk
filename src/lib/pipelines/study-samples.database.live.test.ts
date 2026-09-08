import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';

// Real PostgreSQL queries, within an always-rolled-back transaction. These are
// internal records/files, not fabricated scientific results or external APIs.
const delegates = vi.hoisted(() => ({ samples: vi.fn(), runs: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { sample: { findMany: delegates.samples }, pipelineRun: { findMany: delegates.runs } } }));
import { loadStudyPipelineSamples, loadStudyRunSamples } from './study-samples';
import { stagePriorRunArtifacts } from './prior-run-artifact-staging';

const url = process.env.SEQDESK_COHORT_DATABASE_URL;
it.skipIf(!url)('selects and stages real primary/cohort memberships without crossing ownership, then rolls back', async () => {
  const parsed = new URL(url!);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || !/^\/seqdesk_.*(?:dev|test)/.test(parsed.pathname)) {
    throw new Error('Use an explicitly configured local SeqDesk development/test database');
  }
  const client = new PrismaClient({ datasourceUrl: url });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'seqdesk-cohort-db-test-'));
  const rollback = new Error('Intentional regression-test rollback');
  const suffix = randomUUID();
  let completed = false;
  try {
    await expect(client.$transaction(async tx => {
      delegates.samples.mockImplementation(args => tx.sample.findMany(args));
      delegates.runs.mockImplementation(args => tx.pipelineRun.findMany(args));
      const createUser = (label: string) => tx.user.create({ data: { email: `cohort-${label}-${suffix}@example.invalid`, password: '!disabled-internal-fixture', firstName: 'Internal', lastName: 'Cohort test', isActive: false } });
      const owner = await createUser('owner'), foreign = await createUser('foreign');
      const analysis = await tx.study.create({ data: { title: 'Internal analysis fixture', userId: owner.id } });
      const source = await tx.study.create({ data: { title: 'Internal source fixture', userId: owner.id } });
      const otherSource = await tx.study.create({ data: { title: 'Internal inaccessible fixture', userId: foreign.id } });
      const primary = await tx.sample.create({ data: { sampleId: 'INTERNAL_CASE', studyId: analysis.id } });
      const control = await tx.sample.create({ data: { sampleId: 'INTERNAL_CONTROL', studyId: source.id } });
      const inaccessible = await tx.sample.create({ data: { sampleId: 'INTERNAL_PRIVATE', studyId: otherSource.id } });
      await tx.studySample.createMany({ data: [primary, control, inaccessible].map(sample => ({ studyId: analysis.id, sampleId: sample.id, role: sample.id === primary.id ? 'case' : 'control' })) });
      const target = { type: 'study' as const, studyId: analysis.id };
      const actor = { userId: owner.id, installation: false };
      const visible = await loadStudyPipelineSamples(target, actor);
      expect(visible.map(sample => sample.id).sort()).toEqual([primary.id, control.id].sort());
      expect((await loadStudyPipelineSamples(target, { ...actor, installation: true })).length).toBe(3);
      expect((await loadStudyPipelineSamples({ ...target, primaryOnly: true }, actor)).map(sample => sample.id)).toEqual([primary.id]);
      expect((await loadStudyPipelineSamples({ ...target, sampleIds: [] }, actor))).toEqual([]);

      const priorFolder = path.join(directory, 'prior'), nextFolder = path.join(directory, 'next');
      await fs.mkdir(priorFolder); await fs.mkdir(nextFolder);
      const profile = path.join(priorFolder, 'internal-control.profile');
      const privateProfile = path.join(priorFolder, 'internal-private.profile');
      await fs.writeFile(profile, 'Internal file-copy fixture, not a scientific result.');
      await fs.writeFile(privateProfile, 'Internal unselected fixture.');
      const prior = await tx.pipelineRun.create({ data: { runNumber: `COHORT-TEST-${suffix}`, pipelineId: 'metaphlan', status: 'completed', targetType: 'study', studyId: source.id, userId: owner.id, runFolder: priorFolder, inputSampleIds: JSON.stringify([control.id, inaccessible.id]) } });
      await tx.pipelineArtifact.createMany({ data: [
        { type: 'artifact', pipelineRunId: prior.id, outputId: 'cami_profile', sampleId: control.id, path: profile },
        { type: 'artifact', pipelineRunId: prior.id, outputId: 'cami_profile', sampleId: inaccessible.id, path: privateProfile },
      ] });
      const staged = await stagePriorRunArtifacts({ currentRunId: 'internal-not-yet-created', studyId: analysis.id, sampleIds: [control.id], runFolder: nextFolder, spec: { scope: 'study', configKey: 'profilesDir', sources: { metaphlan: ['cami_profile'] } } });
      expect(staged.artifacts.map(artifact => artifact.sampleId)).toEqual([control.id]);
      expect(await fs.readFile(staged.artifacts[0].stagedPath, 'utf8')).toBe(await fs.readFile(profile, 'utf8'));

      await tx.studySample.delete({ where: { studyId_sampleId: { studyId: analysis.id, sampleId: control.id } } });
      expect((await loadStudyPipelineSamples(target, actor)).map(sample => sample.id)).toEqual([primary.id]);
      expect((await loadStudyRunSamples({ inputSampleIds: JSON.stringify([control.id]) })).map(sample => sample.id)).toEqual([control.id]);
      expect((await tx.sample.findUniqueOrThrow({ where: { id: control.id } })).studyId).toBe(source.id);
      completed = true;
      throw rollback;
    }, { timeout: 30_000 })).rejects.toBe(rollback);
    expect(completed).toBe(true);
    expect(await client.user.count({ where: { email: { contains: suffix } } })).toBe(0);
  } finally {
    await client.$disconnect();
    await fs.rm(directory, { recursive: true, force: true });
  }
}, 45_000);
