import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  samples: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    sample: { findMany: mocks.samples },
    pipelineRun: {
      findMany: mocks.findMany,
    },
  },
}));

import {
  stagePriorRunArtifacts,
  type PriorRunArtifactStagingSpec,
} from './prior-run-artifact-staging';

const SPEC: PriorRunArtifactStagingSpec = {
  scope: 'study',
  configKey: 'qcDir',
  sources: {
    fastqc: ['sample_qc_data'],
    nanoplot: ['sample_stats'],
  },
};

describe('stagePriorRunArtifacts', () => {
  let tempDir = '';
  let priorRunFolder = '';
  let newRunFolder = '';

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.samples.mockResolvedValue([{ id: 'sample-db-1' }]);
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'seqdesk-prior-artifacts-'));
    priorRunFolder = path.join(tempDir, 'prior-run');
    newRunFolder = path.join(tempDir, 'new-run');
    await fs.mkdir(priorRunFolder, { recursive: true });
    await fs.mkdir(newRunFolder, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('copies only declared artifacts from completed runs of the same study', async () => {
    const fastqcZip = path.join(priorRunFolder, 'S1_fastqc.zip');
    const unrelatedHtml = path.join(priorRunFolder, 'S1_fastqc.html');
    await fs.writeFile(fastqcZip, 'real-fastqc-zip');
    await fs.writeFile(unrelatedHtml, 'not-selected');
    mocks.findMany.mockResolvedValue([
      {
        id: 'run-fastqc',
        pipelineId: 'fastqc',
        studyId: null,
        runFolder: priorRunFolder,
        order: {
          samples: [{ id: 'sample-db-1' }],
        },
        artifacts: [
          {
            id: 'artifact-zip',
            outputId: 'sample_qc_data',
            path: fastqcZip,
            sampleId: 'sample-db-1',
          },
          {
            id: 'artifact-html',
            outputId: 'sample_qc_reports',
            path: unrelatedHtml,
            sampleId: 'sample-db-1',
          },
        ],
      },
    ]);

    const result = await stagePriorRunArtifacts({
      currentRunId: 'run-multiqc',
      studyId: 'study-1',
      runFolder: newRunFolder,
      spec: SPEC,
    });

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { not: 'run-multiqc' },
          status: 'completed',
          pipelineId: { in: ['fastqc', 'nanoplot'] },
          OR: [
            { studyId: 'study-1' },
            { artifacts: { some: { sampleId: { in: ['sample-db-1'] } } } },
          ],
        },
      })
    );
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({
      pipelineRunId: 'run-fastqc',
      pipelineId: 'fastqc',
      artifactId: 'artifact-zip',
      outputId: 'sample_qc_data',
      size: Buffer.byteLength('real-fastqc-zip'),
    });
    expect(path.basename(result.artifacts[0].stagedPath)).toBe('S1_fastqc.zip');
    expect(await fs.readFile(result.artifacts[0].stagedPath, 'utf8')).toBe(
      'real-fastqc-zip'
    );
    const inventory = JSON.parse(await fs.readFile(result.inventoryPath, 'utf8'));
    expect(inventory).toMatchObject({
      version: 1,
      studyId: 'study-1',
      currentRunId: 'run-multiqc',
      totalBytes: Buffer.byteLength('real-fastqc-zip'),
    });
    expect(inventory.artifacts).toHaveLength(1);
  });

  it('does not leak artifacts from another study in a mixed-study order run', async () => {
    mocks.samples.mockResolvedValue([{ id: 'sample-study-1' }]);
    const matching = path.join(priorRunFolder, 'study-1_fastqc.zip');
    const unrelated = path.join(priorRunFolder, 'study-2_fastqc.zip');
    await fs.writeFile(matching, 'matching-study');
    await fs.writeFile(unrelated, 'other-study');
    mocks.findMany.mockResolvedValue([
      {
        id: 'run-fastqc-mixed-order',
        pipelineId: 'fastqc',
        studyId: null,
        runFolder: priorRunFolder,
        order: {
          samples: [{ id: 'sample-study-1' }],
        },
        artifacts: [
          {
            id: 'artifact-study-1',
            outputId: 'sample_qc_data',
            path: matching,
            sampleId: 'sample-study-1',
          },
          {
            id: 'artifact-study-2',
            outputId: 'sample_qc_data',
            path: unrelated,
            sampleId: 'sample-study-2',
          },
          {
            id: 'artifact-run-level',
            outputId: 'sample_qc_data',
            path: unrelated,
            sampleId: null,
          },
        ],
      },
    ]);

    const result = await stagePriorRunArtifacts({
      currentRunId: 'run-multiqc',
      studyId: 'study-1',
      runFolder: newRunFolder,
      spec: SPEC,
    });

    expect(result.artifacts.map((artifact) => artifact.artifactId)).toEqual([
      'artifact-study-1',
    ]);
    expect(await fs.readFile(result.artifacts[0].stagedPath, 'utf8')).toBe(
      'matching-study'
    );
  });

  it('stages selected control profiles from another study but not its other samples', async () => {
    const control = path.join(priorRunFolder, 'control.cami.profile');
    const other = path.join(priorRunFolder, 'other.cami.profile');
    await fs.writeFile(control, 'internal control profile fixture');
    await fs.writeFile(other, 'internal unselected fixture');
    mocks.samples.mockResolvedValue([{ id: 'control' }]);
    mocks.findMany.mockResolvedValue([{
      id: 'prior-control-run', pipelineId: 'metaphlan', studyId: 'source-study', runFolder: priorRunFolder,
      inputSampleIds: JSON.stringify(['control', 'other']),
      artifacts: [
        { id: 'control-profile', sampleId: 'control', outputId: 'cami_profile', path: control },
        { id: 'other-profile', sampleId: 'other', outputId: 'cami_profile', path: other },
        { id: 'whole-source-study', sampleId: null, outputId: 'cami_profile', path: other },
      ],
    }]);
    const result = await stagePriorRunArtifacts({ currentRunId: 'benchmark', studyId: 'analysis-study', sampleIds: ['control'], runFolder: newRunFolder, spec: { ...SPEC, sources: { metaphlan: ['cami_profile'] } } });
    expect(result.artifacts.map(a => [a.artifactId, a.sampleId])).toEqual([['control-profile', 'control']]);
    expect(mocks.samples.mock.calls[0][0].where).toMatchObject({ id: { in: ['control'] }, OR: [{ studyId: 'analysis-study' }, { studyMemberships: { some: { studyId: 'analysis-study' } } }] });
  });

  it('does not stage an unselected sample even from a direct run of this study', async () => {
    const file = path.join(priorRunFolder, 'unselected.zip');
    await fs.writeFile(file, 'internal unselected fixture');
    mocks.samples.mockResolvedValue([{ id: 'selected' }]);
    mocks.findMany.mockResolvedValue([{
      id: 'same-study', pipelineId: 'fastqc', studyId: 'study-1', runFolder: priorRunFolder,
      inputSampleIds: JSON.stringify(['selected', 'unselected']),
      artifacts: [
        { id: 'unselected', sampleId: 'unselected', outputId: 'sample_qc_data', path: file },
        { id: 'mixed-aggregate', sampleId: null, outputId: 'sample_qc_data', path: file },
      ],
    }]);
    await expect(stagePriorRunArtifacts({ currentRunId: 'new-run', studyId: 'study-1', sampleIds: ['selected'], runFolder: newRunFolder, spec: SPEC })).rejects.toThrow('No usable artifacts');
  });

  it('fails if a selected membership was removed before staging', async () => {
    mocks.samples.mockResolvedValue([]);
    await expect(stagePriorRunArtifacts({ currentRunId: 'new-run', studyId: 'study-1', sampleIds: ['removed'], runFolder: newRunFolder, spec: SPEC })).rejects.toThrow('membership changed');
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it('allows a declared run-level artifact from a direct study run', async () => {
    const summary = path.join(priorRunFolder, 'summary.tsv');
    await fs.writeFile(summary, 'header\nvalue\n');
    mocks.findMany.mockResolvedValue([
      {
        id: 'run-study-qc',
        pipelineId: 'reads-qc',
        studyId: 'study-1',
        inputSampleIds: JSON.stringify(['sample-db-1']),
        runFolder: priorRunFolder,
        order: null,
        artifacts: [
          {
            id: 'artifact-summary',
            outputId: 'summary_tsv',
            path: summary,
            sampleId: null,
          },
        ],
      },
    ]);

    const result = await stagePriorRunArtifacts({
      currentRunId: 'run-multiqc',
      studyId: 'study-1',
      runFolder: newRunFolder,
      spec: {
        ...SPEC,
        sources: { 'reads-qc': ['summary_tsv'] },
      },
    });

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({
      pipelineId: 'reads-qc',
      outputId: 'summary_tsv',
      artifactId: 'artifact-summary',
    });
  });

  it('rejects an artifact path that escapes the prior run folder', async () => {
    const outside = path.join(tempDir, 'outside.zip');
    await fs.writeFile(outside, 'outside');
    mocks.findMany.mockResolvedValue([
      {
        id: 'run-fastqc',
        pipelineId: 'fastqc',
        studyId: 'study-1',
        runFolder: priorRunFolder,
        order: null,
        artifacts: [
          {
            id: 'artifact-escape',
            outputId: 'sample_qc_data',
            path: outside,
            sampleId: 'sample-db-1',
          },
        ],
      },
    ]);

    await expect(
      stagePriorRunArtifacts({
        currentRunId: 'run-multiqc',
        studyId: 'study-1',
        runFolder: newRunFolder,
        spec: SPEC,
      })
    ).rejects.toThrow('artifact escapes its prior run folder');
  });

  it('rejects symlink artifacts even when their target is inside the prior run', async () => {
    const target = path.join(priorRunFolder, 'S1_fastqc.zip');
    const link = path.join(priorRunFolder, 'linked_fastqc.zip');
    await fs.writeFile(target, 'real-fastqc-zip');
    await fs.symlink(target, link);
    mocks.findMany.mockResolvedValue([
      {
        id: 'run-fastqc',
        pipelineId: 'fastqc',
        studyId: 'study-1',
        runFolder: priorRunFolder,
        order: null,
        artifacts: [
          {
            id: 'artifact-link',
            outputId: 'sample_qc_data',
            path: link,
            sampleId: 'sample-db-1',
          },
        ],
      },
    ]);

    await expect(
      stagePriorRunArtifacts({
        currentRunId: 'run-multiqc',
        studyId: 'study-1',
        runFolder: newRunFolder,
        spec: SPEC,
      })
    ).rejects.toThrow('artifact must be a regular non-symlink file');
  });

  it('rejects empty artifacts instead of staging a content-free input', async () => {
    const empty = path.join(priorRunFolder, 'empty_fastqc.zip');
    await fs.writeFile(empty, '');
    mocks.findMany.mockResolvedValue([
      {
        id: 'run-fastqc',
        pipelineId: 'fastqc',
        studyId: 'study-1',
        runFolder: priorRunFolder,
        order: null,
        artifacts: [
          {
            id: 'artifact-empty',
            outputId: 'sample_qc_data',
            path: empty,
            sampleId: 'sample-db-1',
          },
        ],
      },
    ]);

    await expect(
      stagePriorRunArtifacts({
        currentRunId: 'run-multiqc',
        studyId: 'study-1',
        runFolder: newRunFolder,
        spec: SPEC,
      })
    ).rejects.toThrow('artifact is empty or has an invalid size');
  });

  it('fails with an actionable error instead of producing an empty input directory', async () => {
    mocks.findMany.mockResolvedValue([]);

    await expect(
      stagePriorRunArtifacts({
        currentRunId: 'run-multiqc',
        studyId: 'study-empty',
        runFolder: newRunFolder,
        spec: SPEC,
      })
    ).rejects.toThrow(
      'No usable artifacts from completed runs were found for study study-empty'
    );
  });
});
