import type { Prisma } from "@prisma/client";
import { getPipelineSampleWhere } from "@/lib/pipelines/target";
import { sequencingEntryScope } from "@/lib/sequencing/entry-access";
import type { BuildContext } from "./builders/types";

/** A cohort link never substitutes for access to the source sequencing entry. */
export function exploreSampleWhere(context: BuildContext): Prisma.SampleWhereInput {
  if (!context.userId || !["study", "order"].includes(context.target.type)) return { id: { in: [] } };
  const membership = context.target.type === "study"
    ? getPipelineSampleWhere({ type: "study", studyId: context.target.id })
    : { orderId: context.target.id };
  return { AND: [membership, sequencingEntryScope(context.userId, context.installation)] };
}

export const COHORT_LABELS = {
  source_study_id: "Source study",
  cohort_group: "Cohort group",
  cohort_role: "Cohort role",
};

export function cohortColumns(sample: {
  studyId: string | null;
  studyMemberships: Array<{ studyId: string; groupLabel: string | null; role: string }>;
}, context: BuildContext) {
  const membership = context.target.type === "study"
    ? sample.studyMemberships.find(member => member.studyId === context.target.id)
    : undefined;
  return {
    source_study_id: sample.studyId,
    cohort_group: membership?.groupLabel ?? null,
    cohort_role: membership?.role ?? null,
  };
}

export function cohortMembershipSelection(context: BuildContext) {
  return {
    // Groups are study-specific. Never expose memberships in other studies.
    where: { studyId: context.target.type === "study" ? context.target.id : { in: [] as string[] } },
    select: { studyId: true, groupLabel: true, role: true },
  } satisfies Prisma.Sample$studyMembershipsArgs;
}
