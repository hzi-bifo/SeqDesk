/**
 * The hook the flow runner calls on every change of a flow run (queued,
 * started, step progress, finished, failed, cancelled, made current). The
 * collaboration server push (integration/events.ts) plugs in here; without it
 * the hook does nothing.
 */
export type FlowRunChange = "queued" | "started" | "progress" | "finished" | "failed" | "cancelled" | "current";

type Listener = (flowRunId: string, change: FlowRunChange) => Promise<void>;
const listeners: Listener[] = [];

export function onFlowRunChange(listener: Listener): void {
  if (!listeners.includes(listener)) listeners.push(listener);
}

/** Never throws: pushing is best effort and must not fail a run. */
export async function flowRunChanged(flowRunId: string, change: FlowRunChange): Promise<void> {
  for (const listener of listeners) {
    try {
      await listener(flowRunId, change);
    } catch (error) {
      console.error("[flow] run change listener failed", flowRunId, change, error);
    }
  }
}
