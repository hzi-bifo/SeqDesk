/**
 * The hook the flow runner calls on every change of a flow run (queued,
 * started, step progress, finished, failed, cancelled, made current). It
 * queues what the collaboration server should learn (integration/events.ts);
 * pushing is best effort and never fails a run.
 */
export type FlowRunChange = "queued" | "started" | "progress" | "finished" | "failed" | "cancelled" | "current";

export async function flowRunChanged(flowRunId: string, change: FlowRunChange): Promise<void> {
  try {
    // Loaded lazily: the push module reads runs through flow-runs, which calls this.
    const { enqueueFlowRunChange } = await import("@/lib/integration/events");
    await enqueueFlowRunChange(flowRunId, change);
  } catch (error) {
    console.error("[flow] could not queue the run change", flowRunId, change, error);
  }
}
