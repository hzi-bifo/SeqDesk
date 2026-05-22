import { db } from "@/lib/db";

export type PipelineRunAccessUser = {
  id: string;
  role: string;
};

export type PipelineRunVisibilitySnapshot = {
  study?: { userId: string } | null;
  order?: { userId: string } | null;
  selectedResultSelections?: Array<{ id: string }> | null;
};

export function isPipelineRunPublished(
  run: PipelineRunVisibilitySnapshot
): boolean {
  return (run.selectedResultSelections?.length ?? 0) > 0;
}

export function userOwnsPipelineRun(
  user: PipelineRunAccessUser,
  run: PipelineRunVisibilitySnapshot
): boolean {
  return run.study?.userId === user.id || run.order?.userId === user.id;
}

export function canReadPipelineRun(
  user: PipelineRunAccessUser,
  run: PipelineRunVisibilitySnapshot
): boolean {
  if (user.role === "FACILITY_ADMIN") return true;
  return userOwnsPipelineRun(user, run) && isPipelineRunPublished(run);
}

export async function assertPipelineRunReadAccess(
  runId: string,
  session: { user: PipelineRunAccessUser }
) {
  const run = await db.pipelineRun.findUnique({
    where: { id: runId },
    select: {
      study: { select: { userId: true } },
      order: { select: { userId: true } },
      selectedResultSelections: {
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!run) {
    return { status: 404 as const, body: { error: "Run not found" } };
  }

  if (!canReadPipelineRun(session.user, run)) {
    return { status: 403 as const, body: { error: "Forbidden" } };
  }

  return null;
}
