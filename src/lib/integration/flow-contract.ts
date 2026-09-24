/**
 * The Flow redesign's wire contract on the Analysis integration API: the
 * capability strings `/info` advertises and the error codes the Flow routes
 * send. The client-facing description lives in the web repository's
 * `Web/design/continual/SERVER-API.md`, section "Flow (analysis service)".
 */
import { ExploreRouteError } from "@/lib/explore/route-error";

/** Every Flow capability. `/info` lists the ones whose code is present (FLOW_CAPABILITIES_BUILT). */
export const FLOW_CAPABILITIES = [
  "explore.recipe",
  "explore.flow-runs",
  "explore.ledger",
  "explore.proposals",
  "explore.glosses",
  "explore.values",
  "explore.capsules",
  "explore.events",
  "explore.projects",
  "explore.private",
] as const;
export type FlowCapability = (typeof FLOW_CAPABILITIES)[number];

/** The Flow capabilities this build implements; `explore.events` is added at runtime when pushing is configured. */
export const FLOW_CAPABILITIES_BUILT: readonly FlowCapability[] = ["explore.ledger", "explore.flow-runs"];

export const FLOW_ERROR_CODES = [
  "invalid_request",
  "forbidden",
  "not_found",
  "revision_conflict",
  "step_conflict",
  "run_active",
  "environment_missing",
  "not_completed",
  "proposal_settled",
  "binding_lost",
  "incompatible",
  "output_not_ready",
  "region_mismatch",
] as const;
export type FlowErrorCode = (typeof FLOW_ERROR_CODES)[number];

const DEFAULT_STATUS: Record<FlowErrorCode, number> = {
  invalid_request: 400,
  forbidden: 403,
  not_found: 404,
  revision_conflict: 409,
  step_conflict: 409,
  run_active: 409,
  environment_missing: 409,
  not_completed: 409,
  proposal_settled: 409,
  binding_lost: 422,
  incompatible: 422,
  output_not_ready: 422,
  region_mismatch: 422,
};

/** A Flow API error: `{error, code, ...extra}` with the code's HTTP status. */
export function flowError(code: FlowErrorCode, message: string, extra?: Record<string, unknown>): ExploreRouteError {
  return new ExploreRouteError(DEFAULT_STATUS[code], message, code, extra);
}

/** The code an error without one gets on the Flow routes, from its status. */
export function codeForStatus(status: number): FlowErrorCode {
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "step_conflict";
  if (status === 422) return "incompatible";
  return "invalid_request";
}

/** The collaboration references (FLOW-GAPS D21). Id segments must match [A-Za-z0-9_.-]{1,128}. */
export const flowRef = (flowId: string) => `labdesk://flow/${flowId}`;
export const runRef = (flowRunId: string) => `labdesk://run/${flowRunId}`;
export const valueRef = (flowRunId: string, analysisId: string, key: string) => `labdesk://value/${flowRunId}/${analysisId}/${encodeURIComponent(key)}`;
export const outputRef = (flowRunId: string, artifactId: string) => `labdesk://output/${flowRunId}/${artifactId}`;

/** `labdesk://value/<run>/<step>/<key>` -> its parts, or null. */
export function parseValueRef(ref: string): { runId: string; analysisId: string; key: string } | null {
  const match = /^labdesk:\/\/value\/([A-Za-z0-9_.-]{1,128})\/([A-Za-z0-9_.-]{1,128})\/(.{1,256})$/.exec(ref);
  if (!match) return null;
  try {
    return { runId: match[1], analysisId: match[2], key: decodeURIComponent(match[3]) };
  } catch {
    return null;
  }
}

/** Idempotency ids the client may send with Flow mutations. */
export function requestIdOf(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !/^flow_[a-zA-Z0-9_-]{16,80}$/.test(value)) throw flowError("invalid_request", "Invalid request ID.");
  return value;
}
