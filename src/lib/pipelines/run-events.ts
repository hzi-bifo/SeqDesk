/** The run event log's row for a change of state. Its own module so the launcher can write one without loading the reconciler. */
export function transitionEvent(runId: string, from: string, to: string, source: string, detail?: string | null) {
  return {
    pipelineRunId: runId, eventType: 'state', status: to, source,
    message: `${from} → ${to}${detail ? ` · ${detail}` : ''}`.slice(0, 500),
    payload: JSON.stringify({ from, to, ...(detail ? { detail: detail.slice(0, 300) } : {}) }),
  };
}

export const LOCAL_VANISHED_NOTE = 'The run\'s process on this server ended without writing its exit code (the server restarted, the host rebooted or the process was killed).';
