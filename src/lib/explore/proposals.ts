/**
 * What the assistant proposed for a flow, in pencil until a person accepts or
 * discards it (FLOW-GAPS A5, D12). The web client calls the model; SeqDesk
 * only keeps the proposals.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

type ProposalRecord = Prisma.ExploreStepProposalGetPayload<object>;

export function serializeProposal(proposal: ProposalRecord) {
  return {
    id: proposal.id, flowId: proposal.flowId, kind: proposal.kind, state: proposal.state,
    afterStepId: proposal.afterAnalysisId, laneOf: proposal.laneOf, position: proposal.position, canvas: proposal.canvas,
    purpose: proposal.purpose, why: proposal.why, assumes: proposal.assumes, notChecked: proposal.notChecked, refusals: proposal.refusals,
    inputs: proposal.inputs, outputs: proposal.outputs, code: proposal.code, language: proposal.language, kitId: proposal.kitId, params: proposal.params,
    values: proposal.values, text: proposal.text, analysisId: proposal.analysisId, glossId: proposal.glossId, flowRunId: proposal.flowRunId,
    goal: proposal.goal, origin: proposal.origin, requestedBy: { userId: proposal.requestedById, memberId: proposal.requestedByMemberId },
    activityId: proposal.activityId, acceptedById: proposal.acceptedById, acceptedAnalysisId: proposal.acceptedAnalysisId, acceptedFindingId: proposal.acceptedFindingId,
    discardReason: proposal.discardReason, createdAt: proposal.createdAt.toISOString(), updatedAt: proposal.updatedAt.toISOString(),
  };
}

export type Proposal = ReturnType<typeof serializeProposal>;

export async function pendingProposals(flowId: string): Promise<Proposal[]> {
  const proposals = await db.exploreStepProposal.findMany({ where: { flowId, state: "pending" }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: 200 });
  return proposals.map(serializeProposal);
}
