import { pipelineRequiresPairedReads } from "@/lib/pipelines/read-mode";

export interface StudyPipelineLike {
  input?: {
    perSample?: {
      reads?: boolean;
      pairedEnd?: boolean;
      readMode?: "single_or_paired" | "paired_only";
    };
  } | null;
}

export interface StudyReadLike {
  file1: string | null;
  file2: string | null;
}

export interface StudySampleLike {
  id: string;
  sampleId: string;
  reads?: StudyReadLike[] | null;
}

export interface StudyRunArtifactLike {
  name?: string | null;
  path: string;
  type?: string | null;
  sampleId?: string | null;
}

export interface StudyRunResultsLike {
  errors?: string[] | null;
  warnings?: string[] | null;
}

export interface StudyPipelineRunLike {
  status: string;
  currentStep?: string | null;
  errorTail?: string | null;
  results?: StudyRunResultsLike | null;
  artifacts?: StudyRunArtifactLike[] | null;
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function pipelineRequiresReads(pipeline: StudyPipelineLike | null | undefined): boolean {
  return Boolean(pipeline?.input?.perSample?.reads);
}

function studyPipelineRequiresPairedReads(
  pipeline: StudyPipelineLike | null | undefined
): boolean {
  const perSample = pipeline?.input?.perSample;
  if (!perSample?.reads) {
    return false;
  }

  return pipelineRequiresPairedReads({
    reads: true,
    pairedEnd: perSample.pairedEnd ?? false,
    readMode: perSample.readMode,
  });
}

export function sampleHasAnyReads(sample: StudySampleLike): boolean {
  return sample.reads?.some((read) => hasText(read.file1)) ?? false;
}

export function sampleHasPairedReads(sample: StudySampleLike): boolean {
  return sample.reads?.some((read) => hasText(read.file1) && hasText(read.file2)) ?? false;
}

export function sampleHasRequiredReads(
  sample: StudySampleLike,
  pipeline: StudyPipelineLike | null | undefined
): boolean {
  if (!pipelineRequiresReads(pipeline)) {
    return true;
  }

  return studyPipelineRequiresPairedReads(pipeline)
    ? sampleHasPairedReads(sample)
    : sampleHasAnyReads(sample);
}

export function getEligibleStudySampleIds(
  samples: StudySampleLike[],
  pipeline: StudyPipelineLike | null | undefined
): Set<string> {
  return new Set(
    samples
      .filter((sample) => sampleHasRequiredReads(sample, pipeline))
      .map((sample) => sample.id)
  );
}

export function getStudySelectionEmptyMessage(
  pipeline: StudyPipelineLike | null | undefined
): string {
  if (studyPipelineRequiresPairedReads(pipeline)) {
    return "No samples with paired reads available.";
  }
  if (pipelineRequiresReads(pipeline)) {
    return "No samples with reads available.";
  }
  return "No eligible samples available.";
}

export function getStudySampleReadIssue(
  sample: StudySampleLike,
  pipeline: StudyPipelineLike | null | undefined
): string | null {
  if (!pipelineRequiresReads(pipeline)) {
    return null;
  }

  if (studyPipelineRequiresPairedReads(pipeline)) {
    if (sampleHasPairedReads(sample)) {
      return null;
    }
    return sampleHasAnyReads(sample) ? "Missing R2 file" : "Missing reads";
  }

  return sampleHasAnyReads(sample) ? null : "Missing reads";
}

export function getPreferredStudyRead(sample: StudySampleLike): StudyReadLike | null {
  if (!sample.reads || sample.reads.length === 0) {
    return null;
  }

  return (
    sample.reads.find((read) => hasText(read.file1) && hasText(read.file2)) ??
    sample.reads.find((read) => hasText(read.file1)) ??
    null
  );
}

function getFirstRunError(run: StudyPipelineRunLike): string | null {
  const errors = run.results?.errors;
  if (!Array.isArray(errors)) {
    return null;
  }

  return errors.find((error) => hasText(error)) ?? null;
}

export function runHasOutputErrors(run: StudyPipelineRunLike): boolean {
  return getFirstRunError(run) !== null;
}

export function getStudyPipelineRunDetails(run: StudyPipelineRunLike): string {
  const currentStep = hasText(run.currentStep) ? run.currentStep.trim() : null;

  if (run.status === "failed" && hasText(run.errorTail)) {
    return run.errorTail.trim();
  }

  if (run.status === "completed") {
    const outputError = getFirstRunError(run);
    if (outputError) {
      return outputError;
    }
    if (currentStep && !/^completed\b/i.test(currentStep)) {
      return currentStep;
    }
    return "Completed successfully";
  }

  if (currentStep) {
    return currentStep;
  }

  if (run.status === "queued") return "Waiting for execution";
  if (run.status === "running") return "Currently running";
  return "";
}

function getArtifactRank(artifact: StudyRunArtifactLike): number {
  let score = artifact.sampleId ? 20 : 0;

  if (artifact.type === "report") {
    score -= 5;
  }

  const searchText = `${artifact.name ?? ""} ${artifact.path}`.toLowerCase();
  if (searchText.includes("report") || searchText.includes("multiqc")) {
    score -= 2;
  }

  return score;
}

export function getStudyPipelineRunReportPath(
  run: StudyPipelineRunLike
): string | null {
  const artifacts = Array.isArray(run.artifacts) ? run.artifacts : [];
  const htmlArtifacts = artifacts.filter(
    (artifact) => hasText(artifact.path) && /\.html?$/i.test(artifact.path)
  );

  if (htmlArtifacts.length === 0) {
    return null;
  }

  return [...htmlArtifacts].sort((left, right) => getArtifactRank(left) - getArtifactRank(right))[0]
    .path;
}
