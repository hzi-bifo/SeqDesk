# Live Event Feed Bug: Stale Relative Times + Duplicate Weblog Cards

## Issue Summary

On the Analysis run detail page (`Live Event Feed`), newly arriving events can appear as old (for example `26m ago`) and some cards appear twice.

Observed symptom example:
- `NFCORE_MAG:MAG:FASTQC_TRIMMED started` shown twice
- `NFCORE_MAG:MAG:FASTQC_TRIMMED completed` shown twice
- both shown with an unexpectedly old relative age (`26m ago`) even when the pipeline was just started

## Root Cause (Code-Level)

### 1) Event timestamp source was server receipt time only

In `/src/app/api/pipelines/weblog/route.ts`, `occurredAt` was always set from `new Date()` (API host clock).

That means feed age depended on the app server clock and request arrival timing, not the event timestamp emitted by Nextflow.

Impact:
- if app server clock drifts from compute node/browser time, cards can look stale immediately
- if deliveries are delayed, displayed ages can be misleading

### 2) No idempotency/duplicate suppression

The weblog endpoint inserted every POST as a new `pipelineRunEvent` row, even when it was the same event delivered twice.

Impact:
- duplicate cards in `Live Event Feed`

## Proposed and Implemented Fix

File changed:
- `/src/app/api/pipelines/weblog/route.ts`

### A) Use payload-derived event time when valid

Added:
- `resolveEventAt(parsedEventTime, receivedAt)`
- sanity bounds to reject absurd timestamps (very far past/future)

Behavior now:
1. Parse event time from payload (`utcTime`/`timestamp`/trace fields)
2. Prefer that parsed value when within sane skew bounds
3. Fall back to server receipt time if payload time is missing or unreasonable

### B) Suppress duplicate event inserts

Before creating `pipelineRunEvent`, the transaction now checks for an existing near-identical event in a ±2s window using:
- `pipelineRunId`
- `eventType`
- `processName`
- `stepId`
- `status`
- `message`
- `payload`
- `source`
- `occurredAt` window

If found, insertion is skipped.

## Code Snippets (ready for review)

### 1) Timestamp resolution (payload time preferred)

```ts
const MAX_EVENT_FUTURE_SKEW_MS = 6 * 60 * 60 * 1000;
const MAX_EVENT_PAST_SKEW_MS = 30 * 24 * 60 * 60 * 1000;

function resolveEventAt(parsedEventTime: Date | undefined, receivedAt: Date): Date {
  if (!parsedEventTime) return receivedAt;
  const deltaMs = parsedEventTime.getTime() - receivedAt.getTime();
  if (deltaMs > MAX_EVENT_FUTURE_SKEW_MS) return receivedAt;
  if (deltaMs < -MAX_EVENT_PAST_SKEW_MS) return receivedAt;
  return parsedEventTime;
}
```

```ts
const parsedEventTime =
  parseDate(payload.utcTime) ||
  parseDate(payload.timestamp) ||
  parseDate(trace?.complete) ||
  parseDate(trace?.start) ||
  parseDate(trace?.submit);
const receivedAt = new Date();
const eventAt = resolveEventAt(parsedEventTime, receivedAt);
```

### 2) Duplicate suppression before insert

```ts
const DUPLICATE_EVENT_WINDOW_MS = 2000;

const duplicateWindowStart = new Date(eventAt.getTime() - DUPLICATE_EVENT_WINDOW_MS);
const duplicateWindowEnd = new Date(eventAt.getTime() + DUPLICATE_EVENT_WINDOW_MS);
const duplicate = await tx.pipelineRunEvent.findFirst({
  where: {
    pipelineRunId: runId,
    eventType,
    processName: processName ?? null,
    stepId: stepId ?? null,
    status: statusValue ?? null,
    message: eventMessage ?? null,
    payload: eventPayload ?? null,
    source: 'weblog',
    occurredAt: {
      gte: duplicateWindowStart,
      lte: duplicateWindowEnd,
    },
  },
  select: { id: true },
});

if (!duplicate) {
  await tx.pipelineRunEvent.create({ data: eventRecord });
}
```

## Why this should fix the reported behavior

- Relative age (`0s ago`, `1s ago`, etc.) will follow Nextflow event timestamps instead of app-host-only receipt time.
- Duplicate `started/completed` cards from repeated webhook deliveries are filtered out.

## Exact Code Anchors (for review)

In `/src/app/api/pipelines/weblog/route.ts`:
- Added constants:
  - `MAX_EVENT_FUTURE_SKEW_MS`
  - `MAX_EVENT_PAST_SKEW_MS`
  - `DUPLICATE_EVENT_WINDOW_MS`
- Added helper:
  - `resolveEventAt(parsedEventTime, receivedAt)`
- Changed event timestamp selection:
  - from `const eventAt = new Date();`
  - to parsed+validated event time fallback logic
- Added duplicate check inside transaction before `pipelineRunEvent.create`

## Validation Checklist

1. Start a new run and open:
   - `/dashboard/analysis/<runId>`
2. Confirm new feed cards show near-real-time age (`0s ago` to a few seconds).
3. Trigger duplicate webhook delivery (same payload twice).
4. Confirm only one event card is persisted for that duplicate delivery window.
5. Confirm run status/progress updates still work (running/completed/failed paths).

## Risk Notes

- If a webhook payload has a truly incorrect timestamp but still inside sanity bounds, the UI can still reflect that wrong source timestamp.
- Duplicate suppression window is intentionally narrow (2s) to avoid collapsing legitimate repeated events from different tasks.
