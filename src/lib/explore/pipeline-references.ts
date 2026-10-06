/**
 * Reference databases of a pipeline as the web sees them (identity sheets 96 f2, 97): installed, being installed (with
 * progress), or missing, and whether an admin can install one from here. Installing reuses SeqDesk's own managed
 * resource installer (checksum-verified archives, the same as Admin › Pipelines); a database that SeqDesk only knows as
 * a legacy download is installed in SeqDesk's admin settings, and the answer says so instead of pretending.
 */
import { flowError } from "@/lib/integration/flow-contract";
import { getExecutionSettings } from "@/lib/pipelines/execution-settings";
import { getPipelineDatabaseDefinition, getPipelineDatabaseStatuses, type PipelineDatabaseStatus } from "@/lib/pipelines/database-downloads";
import { pipelineInfo, storedPipelineConfig, type PipelineAccess } from "./pipeline-steps";

export interface PipelineReferenceView {
  pipelineId: string;
  id: string;
  /** "SILVA 138" (without the word database). */
  label: string;
  description: string | null;
  version: string | null;
  sizeBytes: number | null;
  status: "installed" | "installing" | "missing" | "failed";
  /** 0–100 while it installs, when known. */
  progress: number | null;
  /** "Installed", "Installing · 42 %", "Not installed on this server", "The last install failed: …". */
  words: string;
  /** An admin can install it from the web (a managed resource); otherwise `why` says where it is installed. */
  canInstallHere: boolean;
  why: string | null;
}

const ADMIN_ONLY = "Only this Compute server’s admin installs reference databases.";
export const LEGACY_REFERENCE_WORDS = (label: string) => `${label} is installed from SeqDesk’s admin settings (Admin › Pipelines › Databases); installing it from here is not possible yet.`;
const cleanLabel = (label: string) => label.replace(/\s+database$/i, "");

function viewOf(pipelineId: string, status: PipelineDatabaseStatus): PipelineReferenceView {
  const definition = getPipelineDatabaseDefinition(pipelineId, status.id);
  const managed = Boolean(definition?.resource ?? status.managedResource);
  const job = status.job ?? null;
  const running = job?.state === "running";
  const failed = !running && job?.state === "error" && status.status !== "downloaded";
  const label = cleanLabel(status.label);
  const progress = running ? (typeof job?.progressPercent === "number" ? Math.round(job.progressPercent) : null) : null;
  const state: PipelineReferenceView["status"] = status.status === "downloaded" ? "installed" : running ? "installing" : failed ? "failed" : "missing";
  return {
    pipelineId, id: status.id, label, description: status.description ?? null, version: status.version ?? null, sizeBytes: status.sizeBytes ?? null, status: state, progress,
    words: state === "installed" ? "Installed" : state === "installing" ? `Installing${progress !== null ? ` · ${progress} %` : ""}` : state === "failed" ? `The last install failed: ${job?.error ?? "see the admin log"}` : "Not installed on this server",
    canInstallHere: managed, why: managed ? null : LEGACY_REFERENCE_WORDS(label),
  };
}

/** The reference databases of a pipeline installed here, with their state. */
export async function pipelineReferences(pipelineId: string): Promise<PipelineReferenceView[]> {
  if (!pipelineInfo(pipelineId)) return [];
  const [settings, stored] = await Promise.all([getExecutionSettings().catch(() => null), storedPipelineConfig(pipelineId).catch(() => ({}))]);
  const statuses = await getPipelineDatabaseStatuses(pipelineId, stored, settings?.pipelineRunDir, (settings as { pipelineDatabaseDir?: string | null } | null)?.pipelineDatabaseDir).catch(() => []);
  return statuses.map((status) => viewOf(pipelineId, status));
}

/**
 * An admin installs a reference database from the web: a managed resource starts SeqDesk's own installer (download,
 * checksum, unpack, then the pipeline's setting points at it); a legacy download is refused with where to install it.
 */
export async function installReference(pipelineId: string, referenceId: string, access: PipelineAccess, start?: (pipelineId: string, resource: unknown) => Promise<{ status: number; body: Record<string, unknown> }>): Promise<{ reference: PipelineReferenceView; started: boolean }> {
  if (!access.canManage) throw flowError("forbidden", ADMIN_ONLY);
  if (!pipelineInfo(pipelineId)) throw flowError("not_found", `${pipelineId} is not installed on this server.`);
  const definition = getPipelineDatabaseDefinition(pipelineId, referenceId);
  if (!definition) throw flowError("not_found", `${pipelineId} has no reference database ${referenceId}.`);
  const before = (await pipelineReferences(pipelineId)).find((reference) => reference.id === referenceId);
  if (before?.status === "installed" || before?.status === "installing") return { reference: before, started: false };
  if (!definition.resource) throw flowError("invalid_request", LEGACY_REFERENCE_WORDS(cleanLabel(definition.label)), { fix: { kind: "open-admin", label: "Open SeqDesk’s pipeline settings", path: "/admin/settings/pipelines" } });
  const run = start ?? (async (id: string, resource: unknown) => {
    const { resourceApiAction } = await import("@/lib/pipelines/resource-service");
    const response = await resourceApiAction("start", id, resource as Parameters<typeof resourceApiAction>[2]);
    return { status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, unknown> };
  });
  const result = await run(pipelineId, definition.resource);
  if (result.status >= 300) throw flowError("invalid_request", `${cleanLabel(definition.label)} could not be installed: ${String(result.body.error ?? "the installer refused")}`);
  const after = (await pipelineReferences(pipelineId)).find((reference) => reference.id === referenceId);
  return { reference: after ?? { pipelineId, id: referenceId, label: cleanLabel(definition.label), description: definition.description ?? null, version: definition.version ?? null, sizeBytes: null, status: "installing", progress: null, words: "Installing", canInstallHere: true, why: null }, started: true };
}

/** A reference database's state, for a request that waits for it. */
export async function referenceState(pipelineId: string, referenceId: string): Promise<PipelineReferenceView | null> {
  return (await pipelineReferences(pipelineId).catch(() => [])).find((reference) => reference.id === referenceId) ?? null;
}
