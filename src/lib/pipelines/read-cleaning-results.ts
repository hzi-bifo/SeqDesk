import {
  listPendingWritebacks,
  promotePendingWritebacks,
  type PendingReadCandidate,
  type PendingWritebackReportFile,
  type PendingWritebackSummary,
  type PromotePendingWritebacksResult,
} from "./pending-writebacks";
import { READ_CLEANING_PIPELINE_ID } from "./simulate-reads-config";

export const READ_CLEANING_CANDIDATE_OUTPUT_ID = "cleaned_read_candidates";

export type ReadCleaningCandidateStatus = PendingReadCandidate["status"];
export type ReadCleaningCandidate = PendingReadCandidate;
export type ReadCleaningReportFile = PendingWritebackReportFile;

export interface ReadCleaningCandidateSummary {
  run: {
    id: string;
    runNumber: string;
    status: string;
    orderId: string | null;
  };
  candidates: ReadCleaningCandidate[];
  reports: ReadCleaningReportFile[];
}

export type PromoteReadCleaningCandidatesResult = PromotePendingWritebacksResult;

async function listReadCleaningPendingWritebacks(
  runId: string
): Promise<PendingWritebackSummary> {
  const summary = await listPendingWritebacks(runId);
  if (summary.run.pipelineId !== READ_CLEANING_PIPELINE_ID) {
    throw new Error("Pipeline run is not a read-cleaning run");
  }
  return summary;
}

export async function listReadCleaningCandidates(
  runId: string
): Promise<ReadCleaningCandidateSummary> {
  const summary = await listReadCleaningPendingWritebacks(runId);
  return {
    run: {
      id: summary.run.id,
      runNumber: summary.run.runNumber,
      status: summary.run.status,
      orderId: summary.run.orderId,
    },
    candidates: summary.readCandidates,
    reports: summary.reports,
  };
}

export async function promoteReadCleaningCandidates(args: {
  runId: string;
  sampleIds?: string[];
  userId?: string | null;
}): Promise<PromoteReadCleaningCandidatesResult> {
  await listReadCleaningPendingWritebacks(args.runId);
  return promotePendingWritebacks(args);
}
