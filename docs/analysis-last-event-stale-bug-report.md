# Bug Report: "Last event" timestamp appears stale on Analysis Run Detail

## Summary

On the Analysis Run detail page, the header sometimes shows a stale relative timestamp like:

`Last event: 26m ago`

even when there is evidence that the run is still updating "right now".

Example page:

`https://broker-dev2.bifo.helmholtz-hzi.de/dashboard/analysis/cmlhy1kbl0005y8y9xaj62rve`

Observed on: **February 11, 2026**.
## Expected vs Actual

- Expected: `Last event` should refresh to near-real-time (seconds/minutes) while the run is actively updating.
- Actual: `Last event` can remain stale (e.g. 26 minutes) despite active run updates.

## Impact

- Operators may misclassify active runs as stalled.
- Triage becomes slower because the UI appears inconsistent with actual pipeline activity.

## Reproduction (current)

1. Open a running analysis detail page.
2. Confirm the pipeline/queue/logs indicate fresh activity.
3. Observe the header badge still showing an old relative value (e.g. `26m ago`).
4. Manual browser refresh may not reliably fix it.

## Relevant Code Paths

### Frontend timestamp display and candidate selection

- `src/app/dashboard/analysis/[id]/page.tsx:737` builds `latestEventSnapshot` from:
  - `run.lastEventAt`
  - `run.lastWeblogAt`
  - `run.lastTraceAt`
  - `run.queueUpdatedAt`
  - `queueHeartbeatAt` (ephemeral client heartbeat)
  - fallbacks like `startedAt`, `queuedAt`, `updatedAt`, `createdAt`
- `src/app/dashboard/analysis/[id]/page.tsx:906` renders:
  - `Last event: {formatRelativeTime(lastEventAt)}`

### Frontend sync behavior

- `src/app/dashboard/analysis/[id]/page.tsx:529` only starts periodic sync when `run.status === "running"`.
- `src/app/dashboard/analysis/[id]/page.tsx:514` calls `POST /api/pipelines/runs/${id}/sync`.
- The sync call currently does not verify `res.ok`; non-2xx responses are effectively silent in UI logic.

### Backend sync authorization

- `src/app/api/pipelines/runs/[id]/sync/route.ts:24` restricts sync to `FACILITY_ADMIN`.
- Non-admin study owners can view runs, but may be blocked from triggering this sync endpoint.

### Backend sync timestamp updates

- `src/app/api/pipelines/runs/[id]/sync/route.ts:329` updates `lastEventAt` from parsed trace task timestamps.
- `src/app/api/pipelines/runs/[id]/sync/route.ts:117` updates `queueUpdatedAt` from queue checks when no trace is available.

## Senior Engineer Code Map (read in this order)

1. `src/app/dashboard/analysis/[id]/page.tsx`
2. `src/app/api/pipelines/runs/[id]/sync/route.ts`
3. `src/app/api/pipelines/runs/[id]/queue/route.ts`
4. `src/app/api/pipelines/weblog/route.ts`
5. `src/app/api/pipelines/runs/[id]/route.ts`
6. `prisma/schema.prisma`
7. `src/app/dashboard/analysis/page.tsx`

## Key Code Excerpts

### 1) Detail page sync is only active for `running` status

File: `src/app/dashboard/analysis/[id]/page.tsx:514`

```ts
const syncRun = useCallback(async () => {
  try {
    await fetch(`/api/pipelines/runs/${id}/sync`, { method: "POST" });
  } catch (err) {
    console.error("Failed to sync run:", err);
  }
}, [id]);

useEffect(() => {
  if (run?.status !== "running") return;
  let active = true;

  const tick = async () => {
    await syncRun();
    if (active) {
      mutate();
    }
  };

  void tick();
  const interval = setInterval(tick, 15000);
  return () => {
    active = false;
    clearInterval(interval);
  };
}, [run?.status, mutate, syncRun]);
```

### 2) Detail page queue heartbeat is conditional on `queueJobId`

File: `src/app/dashboard/analysis/[id]/page.tsx:659`

```ts
const fetchQueueStatus = useCallback(async () => {
  const runId = run?.id;
  const queueJobId = run?.queueJobId;
  if (!runId || !queueJobId) return;

  const res = await fetch(`/api/pipelines/runs/${runId}/queue`);
  const data = (await res.json()) as QueueStatus;
  setQueueStatus(data);
  if (data.available && data.status) {
    setQueueHeartbeatAt(new Date().toISOString());
  }
}, [run?.id, run?.queueJobId]);
```

### 3) `Last event` chooses the max timestamp from multiple candidates

File: `src/app/dashboard/analysis/[id]/page.tsx:745`

```ts
const candidates = [
  { timestamp: run.lastEventAt, source: run.statusSource || null },
  { timestamp: run.lastWeblogAt, source: "weblog" },
  { timestamp: run.lastTraceAt, source: "trace" },
  { timestamp: run.queueUpdatedAt, source: "queue" },
  {
    timestamp: ["running", "queued", "pending"].includes(run.status)
      ? queueHeartbeatAt
      : null,
    source: "queue",
  },
  { timestamp: run.startedAt, source: "launcher" },
  { timestamp: run.queuedAt, source: "queue" },
  { timestamp: run.updatedAt, source: null },
  { timestamp: run.createdAt, source: null },
];
```

### 4) Sync endpoint is admin-only

File: `src/app/api/pipelines/runs/[id]/sync/route.ts:24`

```ts
if (!session || session.user.role !== 'FACILITY_ADMIN') {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
}
```

### 5) Sync updates `queueUpdatedAt` and sometimes `lastEventAt`

File: `src/app/api/pipelines/runs/[id]/sync/route.ts:114`

```ts
if (queueState) {
  updateData.queueStatus = queueState;
  updateData.queueReason = queueReason || undefined;
  updateData.queueUpdatedAt = now;
}

if (isRunningQueueState && run.status === 'queued') {
  updateData.status = 'running';
  updateData.startedAt = run.startedAt || now;
  updateData.lastEventAt = now;
  updateData.statusSource = 'queue';
}
```

### 6) Trace-based sync only advances `lastEventAt` if newer

File: `src/app/api/pipelines/runs/[id]/sync/route.ts:329`

```ts
if (latestEventAt && (!run.lastEventAt || latestEventAt > run.lastEventAt)) {
  updateData.lastEventAt = latestEventAt;
}
if (latestEventAt && (!run.lastTraceAt || latestEventAt > run.lastTraceAt)) {
  updateData.lastTraceAt = latestEventAt;
}
```

### 7) Queue route updates DB `queueUpdatedAt` independently

File: `src/app/api/pipelines/runs/[id]/queue/route.ts:116`

```ts
await db.pipelineRun.update({
  where: { id },
  data: {
    queueStatus: state || "UNKNOWN",
    queueReason: reason || null,
    queueUpdatedAt: new Date(),
  },
});
```

### 8) Weblog route sets `lastEventAt` from server receipt time

File: `src/app/api/pipelines/weblog/route.ts:244`

```ts
const eventAt = new Date();

if (!run.lastEventAt || eventAt >= run.lastEventAt) {
  runUpdates.lastEventAt = eventAt;
}
if (!run.lastWeblogAt || eventAt >= run.lastWeblogAt) {
  runUpdates.lastWeblogAt = eventAt;
}
```

### 9) API returns event stream, but `Last event` label does not consume it

File: `src/app/api/pipelines/runs/[id]/route.ts:170`

```ts
events: {
  orderBy: { occurredAt: 'desc' },
  take: 100,
  select: { occurredAt: true, eventType: true, source: true, ... },
},
```

File: `src/app/dashboard/analysis/[id]/page.tsx:225`

```ts
events?: {
  occurredAt: string;
  ...
}[];
```

### 10) Schema fields involved in recency calculation

File: `prisma/schema.prisma:232`

```prisma
lastEventAt   DateTime?
lastWeblogAt  DateTime?
lastTraceAt   DateTime?
statusSource  String?
queueUpdatedAt DateTime?
updatedAt     DateTime @updatedAt
```

### 11) List page also syncs only `running` runs

File: `src/app/dashboard/analysis/page.tsx:170`

```ts
const runningRuns = data.runs.filter((run) => run.status === "running");
await Promise.allSettled(
  runningRuns.map((run) =>
    fetch(`/api/pipelines/runs/${run.id}/sync`, { method: "POST" })
  )
);
```

## Working Hypotheses

1. **Role mismatch (high confidence):**
   Non-admin users can access the run detail page, but `POST /sync` returns 403, so `lastEventAt`/`queueUpdatedAt` may not advance.

2. **Status gate too narrow (medium confidence):**
   Detail page only auto-syncs when status is `running`; queued/pending active transitions may not get frequent updates.

3. **Silent sync failure handling (medium confidence):**
   Frontend `syncRun()` does not check HTTP status; failures can go unnoticed and UI appears stale.

4. **Data-source race/priority issue (low-medium confidence):**
   Timestamp candidate precedence may still select an older persisted source when expected live source is unavailable.

## Evidence to Collect for Confirmation

1. Browser Network tab for run detail page:
   - `POST /api/pipelines/runs/<id>/sync` status codes and response bodies
   - `GET /api/pipelines/runs/<id>/queue` status codes and payload
   - `GET /api/pipelines/runs/<id>` payload values for:
     - `lastEventAt`
     - `lastTraceAt`
     - `lastWeblogAt`
     - `queueUpdatedAt`
     - `updatedAt`

2. Session/role of reproducing user:
   - `FACILITY_ADMIN` vs study owner role

3. Server logs around sync attempts:
   - 403/500 occurrences for `/sync`
   - trace parsing errors / queue command errors (`squeue`/`sacct`)

## Suggested Fix Direction

1. Decide authorization model:
   - allow study owners to call `/sync`, or
   - run sync server-side independent of caller role, and keep endpoint read-only for clients.

2. Expand auto-sync trigger in detail page:
   - include `queued` and `pending`, not only `running`.

3. Make sync failures explicit in frontend:
   - check `res.ok` and surface warning/debug state for repeated failures.

4. Add regression test coverage:
   - role-based access case (admin vs non-admin),
   - stale timestamp UI behavior when sync endpoint is forbidden/failing.

## Open Questions for Senior Engineer

1. Should the UI be responsible for triggering run-state sync at all, or should this move to a backend worker/cron path?
2. Is `/sync` intentionally admin-only, and if so, what is the intended freshness mechanism for non-admin viewers?
3. Is `lastEventAt` intended to represent trace-only activity, or "any pipeline liveness signal" (trace, weblog, queue)?
