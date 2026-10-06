/**
 * Pipelines and a lab (identity sheets 96–97): the lab's presets for a pipeline, members' requests to install one,
 * the store as members may read it (with how each pipeline fits the study's data), and a summary of a study's data
 * ("708 samples · paired FASTQ 2×250 · 16S V4 amplicons").
 *
 * Where these live: a lab is the collaboration workspace an integration session belongs to (labKey
 * "<authority>|<workspaceId>"). Presets and requests are per lab records with an author and a lifecycle, edited
 * by several people at once, so they get their own tables (ExplorePipelinePreset, ExplorePipelineInstallRequest)
 * rather than PipelineConfig (one admin row per pipeline, installation-wide) or SiteSettings.extraSettings (one JSON
 * blob, last write wins).
 */
import { createHash } from "node:crypto";
import { createReadStream } from "fs";
import { open } from "fs/promises";
import path from "path";
import readline from "readline";
import zlib from "zlib";
import { db } from "@/lib/db";
import { flowError } from "@/lib/integration/flow-contract";
import { getAllPackages, getPackageRegistry } from "@/lib/pipelines/package-loader";
import { getPipelineEnabled } from "@/lib/pipelines/enablement";
import { loadPipelineStoreCatalog, type PipelineStoreCatalog } from "@/lib/pipelines/pipeline-store-service";
import { getExecutionSettings } from "@/lib/pipelines/execution-settings";
import { getPipelineDatabaseDefinition, getPipelineDatabaseStatuses } from "@/lib/pipelines/database-downloads";
import { dataStudyAlias, findDataStudy, linkedReadRecords, readsInData } from "@/lib/pipelines/data-study";
import { pastDurations } from "@/lib/pipelines/pipeline-data-service";
import { durationWords } from "@/lib/pipelines/plain-status";
import { resolveContainedPath, resolveExploreStorage } from "./storage";
import type { RecipeActor } from "./recipe";
import { NOT_STEPS, fileOutputsOf, pipelineInfo, pipelineSettings, settleWaitingStep, stagesOf, storedPipelineConfig, tableOutputsOf, validateStepParams, type PipelineAccess } from "./pipeline-steps";
import { changelogUrl, pipelineRecord, type PipelineFitSpec, type RegistryRecordFields } from "./pipeline-record";

const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const text = (value: unknown, max: number): string | null => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);
const plural = (count: number, word: string, many = `${word}s`) => `${count.toLocaleString("en-US")} ${count === 1 ? word : many}`;

export type LabActor = RecipeActor & { name?: string | null };

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export interface PresetView {
  id: string;
  pipelineId: string;
  versions: string[];
  params: Record<string, unknown>;
  name: string;
  note: string | null;
  author: { userId: string; memberId: string | null; name: string | null };
  createdAt: string;
  updatedAt: string;
  /** The viewer may change or remove it (its author, or the server's admin). */
  canEdit: boolean;
  /** The lab's quality thresholds for the pipeline's quality line ("at least 10,000 reads"); [] = the pipeline's own. */
  thresholds: Array<{ column: string; label: string; min: number | null; max: number | null; unit: string | null }>;
}

/** Thresholds are kept beside the preset's settings (key `_thresholds`), never as a setting of the pipeline. */
function presetParts(raw: unknown): { settings: Record<string, unknown>; thresholds: PresetView["thresholds"] } {
  const { _thresholds: list, ...settings } = record(raw);
  const thresholds = (Array.isArray(list) ? list : []).slice(0, 10).flatMap((entry) => {
    const value = record(entry);
    const column = typeof value.column === "string" && value.column.trim() ? value.column.trim().slice(0, 200) : null;
    const min = typeof value.min === "number" && Number.isFinite(value.min) ? value.min : null;
    const max = typeof value.max === "number" && Number.isFinite(value.max) ? value.max : null;
    if (!column || (min === null && max === null)) return [];
    return [{ column, label: typeof value.label === "string" && value.label.trim() ? value.label.trim().slice(0, 80) : column, min, max, unit: typeof value.unit === "string" ? value.unit.slice(0, 40) : null }];
  });
  return { settings, thresholds };
}

type PresetRow = { id: string; labKey: string; pipelineId: string; versions: unknown; params: unknown; name: string; note: string | null; authorId: string; authorMemberId: string | null; authorName: string | null; createdAt: Date; updatedAt: Date; archivedAt: Date | null };

function presetView(row: PresetRow, viewer: { userId: string; canManage: boolean }): PresetView {
  return {
    id: row.id, pipelineId: row.pipelineId, versions: Array.isArray(row.versions) ? row.versions.filter((value): value is string => typeof value === "string") : [], params: presetParts(row.params).settings, thresholds: presetParts(row.params).thresholds,
    name: row.name, note: row.note, author: { userId: row.authorId, memberId: row.authorMemberId, name: row.authorName },
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), canEdit: viewer.canManage || row.authorId === viewer.userId,
  };
}

export async function listPresets(labKey: string, pipelineId: string | null, viewer: { userId: string; canManage: boolean }): Promise<PresetView[]> {
  const rows = await db.explorePipelinePreset.findMany({ where: { labKey, archivedAt: null, ...(pipelineId ? { pipelineId } : {}) }, orderBy: [{ pipelineId: "asc" }, { updatedAt: "desc" }], take: 200 });
  return rows.map((row) => presetView(row, viewer));
}

export interface SavePresetInput { id?: string | null; pipelineId?: string | null; name?: unknown; note?: unknown; params?: unknown; versions?: unknown; thresholds?: unknown }

/** A new preset, or a change to one (its author or the admin). Its settings are checked like a step's. */
export async function savePreset(labKey: string, input: SavePresetInput, actor: LabActor, access: PipelineAccess): Promise<PresetView> {
  if (!labKey) throw flowError("forbidden", "Presets belong to a lab; this access has none.");
  const existing = input.id ? await db.explorePipelinePreset.findUnique({ where: { id: input.id } }) : null;
  if (input.id && (!existing || existing.labKey !== labKey || existing.archivedAt)) throw flowError("not_found", "Preset not found");
  if (existing && existing.authorId !== actor.userId && !access.canManage) throw flowError("forbidden", `Only ${existing.authorName ?? "its author"} or an admin changes this preset.`);
  const pipelineId = existing?.pipelineId ?? text(input.pipelineId, 80);
  if (!pipelineId) throw flowError("invalid_request", "Name the pipeline with pipelineId.");
  const info = pipelineInfo(pipelineId);
  if (!info) throw flowError("invalid_request", `${pipelineId} is not installed on this server.`);
  const name = text(input.name, 80) ?? existing?.name ?? null;
  if (!name) throw flowError("invalid_request", "A preset needs a name.");
  const settings = input.params === undefined ? presetParts(existing?.params).settings : presetParts(input.params).settings;
  const thresholds = input.thresholds !== undefined ? presetParts({ _thresholds: input.thresholds }).thresholds : presetParts(input.params ?? existing?.params).thresholds;
  if (Array.isArray(input.thresholds) && input.thresholds.length && !thresholds.length) throw flowError("invalid_request", "A threshold needs a column and a lowest or highest value.");
  const params = { ...settings, ...(thresholds.length ? { _thresholds: thresholds } : {}) };
  const { refused } = validateStepParams(info.definition, settings, await storedPipelineConfig(pipelineId));
  if (refused.length) throw flowError("invalid_request", refused.join(" "), { refused });
  const versions = Array.isArray(input.versions) ? input.versions.filter((value): value is string => typeof value === "string" && value.length <= 40).slice(0, 20) : existing ? (Array.isArray(existing.versions) ? existing.versions as string[] : []) : [info.version];
  const note = input.note === undefined ? existing?.note ?? null : text(input.note, 500);
  const row = existing
    ? await db.explorePipelinePreset.update({ where: { id: existing.id }, data: { name, note, params: params as object, versions } })
    : await db.explorePipelinePreset.create({ data: { labKey, pipelineId, name, note, params: params as object, versions, authorId: actor.userId, authorMemberId: actor.memberId ?? null, authorName: actor.name?.slice(0, 200) ?? null } });
  return presetView(row, { userId: actor.userId, canManage: access.canManage });
}

/** Remove a preset (kept archived: steps that used it still name it). */
export async function deletePreset(labKey: string, id: string, actor: LabActor, access: PipelineAccess): Promise<void> {
  const existing = await db.explorePipelinePreset.findUnique({ where: { id } });
  if (!existing || existing.labKey !== labKey || existing.archivedAt) throw flowError("not_found", "Preset not found");
  if (existing.authorId !== actor.userId && !access.canManage) throw flowError("forbidden", `Only ${existing.authorName ?? "its author"} or an admin removes this preset.`);
  await db.explorePipelinePreset.update({ where: { id }, data: { archivedAt: new Date() } });
}

// ---------------------------------------------------------------------------
// Install requests
// ---------------------------------------------------------------------------

export type RequestStatus = "pending" | "installed" | "declined" | "withdrawn" | "failed";
export type RequestKind = "install" | "wanted" | "reference";
export interface InstallRequestView {
  id: string;
  /** install: a store pipeline · wanted: one not in the store (free text or a link) · reference: a reference database
   *  of an installed pipeline. */
  kind: RequestKind;
  pipelineId: string | null;
  name: string;
  version: string | null;
  text: string | null;
  reason: string | null;
  /** kind reference: the database asked for. */
  referenceId: string | null;
  /** kind wanted: the first link in the text (an nf-core page). */
  link: string | null;
  targetKey: string | null;
  flowId: string | null;
  flowName: string | null;
  stepId: string | null;
  requestedBy: { userId: string; memberId: string | null; name: string | null };
  requestedAt: string;
  status: RequestStatus;
  decidedBy: { name: string | null } | null;
  decidedAt: string | null;
  note: string | null;
  canDecide: boolean;
  canWithdraw: boolean;
}

type RequestRow = Awaited<ReturnType<typeof db.explorePipelineInstallRequest.findUniqueOrThrow>>;

const kindOfRow = (row: { kind: string }): RequestKind => (row.kind === "wanted" ? "wanted" : row.kind === "reference" ? "reference" : "install");
const firstLink = (value: string | null) => /https?:\/\/[^\s<>"')]+/i.exec(value ?? "")?.[0]?.replace(/[.,;:]+$/, "") ?? null;
/** "SILVA 138" for a reference request (the database label without the word database), the pipeline's name otherwise. */
function requestName(row: RequestRow): string {
  const kind = kindOfRow(row);
  if (kind === "reference" && row.pipelineId && row.text) {
    const label = getPipelineDatabaseDefinition(row.pipelineId, row.text)?.label ?? row.text;
    return label.replace(/\s+database$/i, "");
  }
  return row.pipelineId ? pipelineInfo(row.pipelineId)?.name ?? row.pipelineId : (row.text ?? "A pipeline").slice(0, 80);
}

async function requestViews(rows: RequestRow[], viewer: { userId: string; canManage: boolean }): Promise<InstallRequestView[]> {
  const flowIds = [...new Set(rows.map((row) => row.flowId).filter((id): id is string => Boolean(id)))];
  const flows = flowIds.length ? await db.exploreFlow.findMany({ where: { id: { in: flowIds } }, select: { id: true, name: true } }) : [];
  return rows.map((row) => ({
    id: row.id, kind: kindOfRow(row), pipelineId: row.pipelineId,
    name: requestName(row), version: row.version, text: kindOfRow(row) === "reference" ? null : row.text, reason: row.reason,
    referenceId: kindOfRow(row) === "reference" ? row.text : null, link: kindOfRow(row) === "wanted" ? firstLink(row.text) : null,
    targetKey: row.targetKey, flowId: row.flowId, flowName: flows.find((flow) => flow.id === row.flowId)?.name ?? null, stepId: row.analysisId,
    requestedBy: { userId: row.requestedById, memberId: row.requestedByMemberId, name: row.requestedByName }, requestedAt: row.createdAt.toISOString(),
    status: (["pending", "installed", "declined", "withdrawn", "failed"].includes(row.status) ? row.status : "pending") as RequestStatus,
    decidedBy: row.decidedAt ? { name: row.decidedByName } : null, decidedAt: row.decidedAt?.toISOString() ?? null, note: row.decisionNote,
    canDecide: viewer.canManage && (row.status === "pending" || row.status === "failed"), canWithdraw: row.requestedById === viewer.userId && row.status === "pending",
  }));
}

export interface CreateRequestInput { labKey: string; kind?: RequestKind | "pipeline-wanted" | "install-reference"; pipelineId?: string | null; referenceId?: string | null; version?: string | null; text?: string | null; reason?: string | null; targetKey?: string | null; flowId?: string | null; stepPosition?: string | null; analysisId?: string | null; actor: LabActor }

/** Tell the server's admins in SeqDesk's own notifications (best effort; the web app shows the list too). */
async function notifyAdmins(row: RequestRow): Promise<void> {
  const admins = await db.user.findMany({ where: { isActive: true, OR: [{ systemRole: "ADMIN" }, { role: "FACILITY_ADMIN" }] }, select: { id: true }, take: 50 });
  const name = row.pipelineId ? pipelineInfo(row.pipelineId)?.name ?? row.pipelineId : "a pipeline";
  const kind = kindOfRow(row);
  for (const admin of admins) {
    await db.inAppNotification.create({ data: {
      userId: admin.id, eventType: "pipeline.install-request", severity: "info", sourceType: "pipeline-request", sourceId: row.id, dedupeKey: `pipeline-request:${row.id}:${admin.id}`,
      title: kind === "wanted" ? `${row.requestedByName ?? "A member"} asks for a pipeline` : kind === "reference" ? `Install ${requestName(row)} for ${name}?` : `Install ${name}${row.version ? ` ${row.version}` : ""}?`,
      body: [row.requestedByName, row.reason ? `“${row.reason}”` : null, kind === "reference" ? null : row.text].filter(Boolean).join(" · ").slice(0, 1000) || null,
    } }).catch(() => undefined);
  }
}

/** Tell the person who asked how an admin decided (installed, declined with the reason, failed). Best effort, once per outcome. */
async function notifyRequester(row: RequestRow, status: RequestStatus, note: string | null): Promise<void> {
  if (!row.requestedById || !["installed", "declined", "failed"].includes(status)) return;
  const kind = kindOfRow(row);
  const name = requestName(row);
  const flow = row.flowId ? await db.exploreFlow.findUnique({ where: { id: row.flowId }, select: { name: true } }).catch(() => null) : null;
  const title = status === "installed"
    ? kind === "wanted" ? "Your request for a pipeline was answered" : `${name} is installed`
    : status === "declined" ? kind === "wanted" ? "Your request for a pipeline was declined" : `${name} will not be installed` : `Installing ${name} failed`;
  const body = status === "installed"
    ? kind === "install" && row.analysisId ? `${flow?.name ? `${flow.name}: ` : ""}the step that waited for it is ready.` : kind === "reference" ? `${row.pipelineId ? pipelineInfo(row.pipelineId)?.name ?? row.pipelineId : "The pipeline"} can use it now.` : note
    : note;
  await db.inAppNotification.create({ data: {
    userId: row.requestedById, eventType: "pipeline.install-request.decided", severity: status === "installed" ? "info" : "warning", sourceType: "pipeline-request", sourceId: row.id,
    dedupeKey: `pipeline-request:${row.id}:decided:${status}`, title: title.slice(0, 200), body: body?.slice(0, 1000) ?? null,
  } }).catch(() => undefined);
}

/** A member asks to install a store pipeline, for one not in the store, or for a missing reference database of an
 *  installed pipeline. The same pending request is not repeated. */
export async function createInstallRequest(input: CreateRequestInput): Promise<RequestRow> {
  const kind: RequestKind = input.kind === "wanted" || input.kind === "pipeline-wanted" ? "wanted" : input.kind === "reference" || input.kind === "install-reference" ? "reference" : "install";
  const pipelineId = kind === "wanted" ? null : text(input.pipelineId, 120);
  const referenceId = kind === "reference" ? text(input.referenceId, 120) : null;
  const words = kind === "reference" ? referenceId : text(input.text, 1000);
  if (kind === "install" && !pipelineId) throw flowError("invalid_request", "Name the pipeline to install.");
  if (kind === "wanted" && !words) throw flowError("invalid_request", "Say what you need, or paste a link.");
  if (kind === "reference") {
    if (!pipelineId || !referenceId) throw flowError("invalid_request", "Name the pipeline and the reference database it needs.");
    if (!getPipelineDatabaseDefinition(pipelineId, referenceId)) throw flowError("not_found", `${pipelineId} has no reference database ${referenceId}.`);
    const pending = await db.explorePipelineInstallRequest.findFirst({ where: { labKey: input.labKey, kind: "reference", pipelineId, text: referenceId, status: "pending" }, orderBy: { createdAt: "asc" } });
    if (pending) return pending;
  } else if (pipelineId) {
    const pending = await db.explorePipelineInstallRequest.findFirst({ where: { labKey: input.labKey, kind: "install", pipelineId, status: "pending" }, orderBy: { createdAt: "asc" } });
    if (pending && !input.flowId) return pending;
  }
  const row = await db.explorePipelineInstallRequest.create({ data: {
    labKey: input.labKey, kind, pipelineId, version: text(input.version, 40), text: words, reason: text(input.reason, 500), targetKey: input.targetKey ?? null, flowId: input.flowId ?? null,
    analysisId: input.analysisId ?? null, stepPosition: input.stepPosition ?? null,
    requestedById: input.actor.userId, requestedByMemberId: input.actor.memberId ?? null, requestedByName: input.actor.name?.slice(0, 200) ?? null,
  } });
  await notifyAdmins(row);
  return row;
}

/** Reference requests settle by themselves once the database is there (installed from here or in SeqDesk's admin). */
async function settleReferenceRequests(rows: RequestRow[]): Promise<RequestRow[]> {
  const pending = rows.filter((row) => kindOfRow(row) === "reference" && row.status === "pending" && row.pipelineId && row.text);
  if (!pending.length) return rows;
  const { referenceState } = await import("./pipeline-references");
  const settled = new Map<string, RequestRow>();
  for (const row of pending) {
    const state = await referenceState(row.pipelineId!, row.text!).catch(() => null);
    if (state?.status !== "installed") continue;
    const updated = await db.explorePipelineInstallRequest.update({ where: { id: row.id }, data: { status: "installed", decisionNote: row.decisionNote ?? `${state.label} is installed.`, decidedAt: row.decidedAt ?? new Date() } }).catch(() => null);
    if (updated) { settled.set(row.id, updated); await notifyRequester(updated, "installed", updated.decisionNote); }
  }
  return rows.map((row) => settled.get(row.id) ?? row);
}

export async function listInstallRequests(labKey: string, viewer: { userId: string; canManage: boolean }, filter: { status?: string | null } = {}): Promise<InstallRequestView[]> {
  // The server's admin decides for every lab on it; members see their own lab's requests.
  const rows = await db.explorePipelineInstallRequest.findMany({
    where: { ...(viewer.canManage ? {} : { labKey }), ...(filter.status ? { status: filter.status } : {}) }, orderBy: { createdAt: "desc" }, take: 200,
  });
  const fresh = await settleReferenceRequests(rows);
  return requestViews(filter.status ? fresh.filter((row) => row.status === filter.status) : fresh, viewer);
}

export async function installRequestView(id: string, viewer: { userId: string; canManage: boolean }): Promise<InstallRequestView> {
  const row = await db.explorePipelineInstallRequest.findUnique({ where: { id } });
  if (!row) throw flowError("not_found", "Request not found");
  return (await requestViews([row], viewer))[0];
}

/**
 * The admin decides: install (through the store's own install service; the waiting steps then declare their tables)
 * or decline with a reason that replaces the waiting line. Only the server's admin (system.pipelines.manage).
 */
export async function decideInstallRequest(id: string, input: { decision: unknown; note?: unknown }, actor: LabActor, access: PipelineAccess, install?: (pipelineId: string, version: string | null) => Promise<{ version: string }>): Promise<InstallRequestView> {
  if (!access.canManage) throw flowError("forbidden", "Only this Compute server’s admin installs pipelines.");
  const row = await db.explorePipelineInstallRequest.findUnique({ where: { id } });
  if (!row) throw flowError("not_found", "Request not found");
  if (row.status === "withdrawn") throw flowError("invalid_request", `${row.requestedByName ?? "The person who asked"} withdrew this request.`);
  if (row.status !== "pending" && row.status !== "failed") throw flowError("invalid_request", "This request was already decided.");
  const note = text(input.note, 500);
  const decided = { decidedById: actor.userId, decidedByName: actor.name?.slice(0, 200) ?? null, decidedAt: new Date() };
  if (input.decision === "decline") {
    // Two admins deciding at once: only the first decision counts (and only the first tells the person who asked).
    const claimed = await db.explorePipelineInstallRequest.updateMany({ where: { id, status: { in: ["pending", "failed"] } }, data: { status: "declined", decisionNote: note ?? "Not now.", ...decided } });
    if (!claimed.count) throw flowError("invalid_request", "This request was already decided.");
    const declined = (await db.explorePipelineInstallRequest.findUnique({ where: { id } }))!;
    await notifyRequester(declined, "declined", declined.decisionNote);
    return installRequestView(id, access);
  }
  if (input.decision !== "install") throw flowError("invalid_request", 'decision must be "install" or "decline".');
  if (kindOfRow(row) === "reference" && row.pipelineId && row.text) {
    // A reference database: SeqDesk's own installer starts it; the request settles once the database is there.
    const { installReference } = await import("./pipeline-references");
    const { reference } = await installReference(row.pipelineId, row.text, access);
    if (reference.status === "installed") {
      const installed = await db.explorePipelineInstallRequest.update({ where: { id }, data: { status: "installed", decisionNote: note ?? `${reference.label} is installed.`, ...decided } });
      await notifyRequester(installed, "installed", installed.decisionNote);
    } else {
      await db.explorePipelineInstallRequest.update({ where: { id }, data: { decisionNote: note ?? `Installing ${reference.label}; the request is answered when it is in.`, ...decided } });
    }
    return installRequestView(id, access);
  }
  if (row.kind === "wanted" || !row.pipelineId) {
    // A pipeline that is not in the store: the admin handled it (asked the SeqDesk team, or found another).
    const handled = await db.explorePipelineInstallRequest.update({ where: { id }, data: { status: "installed", decisionNote: note ?? "Handled by an admin.", ...decided } });
    await notifyRequester(handled, "installed", handled.decisionNote);
    return installRequestView(id, access);
  }
  try {
    const run = install ?? (async (pipelineId: string, version: string | null) => {
      const { installManagedPipeline } = await import("@/lib/pipelines/pipeline-install-service");
      const result = await installManagedPipeline({ pipelineId, ...(version ? { version } : {}), autoEnable: true });
      return { version: result.version };
    });
    const result = await run(row.pipelineId, row.version);
    // Every pending request of this lab for the pipeline is answered; their waiting steps declare their tables.
    const answered = (await db.explorePipelineInstallRequest.findMany({ where: { pipelineId: row.pipelineId, status: { in: ["pending", "failed"] } } })).filter((entry) => kindOfRow(entry) === "install");
    await db.explorePipelineInstallRequest.updateMany({ where: { id: { in: answered.map((entry) => entry.id) } }, data: { status: "installed", decisionNote: note ?? `Installed ${result.version}.`, ...decided } });
    for (const entry of answered) if (entry.analysisId) await settleWaitingStep(entry.analysisId, actor).catch((error) => console.error("[pipeline-steps] could not settle a waiting step", entry.analysisId, error));
    // Both are told: everyone who asked for it.
    for (const entry of answered) await notifyRequester({ ...entry, status: "installed", decisionNote: note ?? `Installed ${result.version}.` }, "installed", note ?? `Installed ${result.version}.`);
  } catch (error) {
    const words = error instanceof Error ? error.message : String(error);
    const failed = await db.explorePipelineInstallRequest.update({ where: { id }, data: { status: "failed", decisionNote: `The install failed: ${words}`.slice(0, 500), ...decided } });
    await notifyRequester(failed, "failed", failed.decisionNote);
  }
  return installRequestView(id, access);
}

export async function withdrawInstallRequest(id: string, actor: LabActor): Promise<InstallRequestView> {
  const row = await db.explorePipelineInstallRequest.findUnique({ where: { id } });
  if (!row) throw flowError("not_found", "Request not found");
  if (row.requestedById !== actor.userId) throw flowError("forbidden", "Only the person who asked withdraws a request.");
  if (row.status === "pending") await db.explorePipelineInstallRequest.update({ where: { id }, data: { status: "withdrawn" } });
  return installRequestView(id, { userId: actor.userId, canManage: false });
}

// ---------------------------------------------------------------------------
// A study's data in one line
// ---------------------------------------------------------------------------

export interface DataSummary {
  targetKey: string;
  samples: number;
  reads: { files: number; pairs: number; single: number; records: number; layout: "paired" | "single" | "mixed" | null; length: { median: number | null; max: number | null } | null } | null;
  kind: "amplicon" | "shotgun" | "unknown" | null;
  region: string | null;
  primers: { forward: string | null; reverse: string | null; share: number | null } | null;
  tables: { count: number; names: Array<{ name: string; dims: string }> };
  tablesOnly: boolean;
  /** "708 samples · paired FASTQ 2×250 · 16S V4 amplicons (primers 515F/806R in 98% of reads)". */
  words: string;
  checkedAt: string;
}

/** Amplicon primers people use most, with their target region (IUPAC codes). */
export const PRIMERS: Array<{ region: string; forward: { name: string; seq: string }; reverse: { name: string; seq: string } }> = [
  { region: "16S V4", forward: { name: "515F", seq: "GTGYCAGCMGCCGCGGTAA" }, reverse: { name: "806R", seq: "GGACTACNVGGGTWTCTAAT" } },
  { region: "16S V3–V4", forward: { name: "341F", seq: "CCTACGGGNGGCWGCAG" }, reverse: { name: "805R", seq: "GACTACHVGGGTATCTAATCC" } },
  { region: "16S V1–V2", forward: { name: "27F", seq: "AGAGTTTGATCMTGGCTCAG" }, reverse: { name: "338R", seq: "TGCTGCCTCCCGTAGGAGT" } },
  { region: "16S V4–V5", forward: { name: "515F", seq: "GTGYCAGCMGCCGCGGTAA" }, reverse: { name: "926R", seq: "CCGYCAATTYMTTTRAGTTT" } },
  { region: "ITS1", forward: { name: "ITS1F", seq: "CTTGGTCATTTAGAGGAAGTAA" }, reverse: { name: "ITS2", seq: "GCTGCGTTCTTCATCGATGC" } },
  { region: "18S V9", forward: { name: "1391F", seq: "GTACACACCGCCCGTC" }, reverse: { name: "EukBr", seq: "TGATCCTTCTGCAGGTTCACCTAC" } },
];

const IUPAC: Record<string, string> = { A: "A", C: "C", G: "G", T: "T", U: "T", R: "[AG]", Y: "[CT]", S: "[GC]", W: "[AT]", K: "[GT]", M: "[AC]", B: "[CGT]", D: "[AGT]", H: "[ACT]", V: "[ACG]", N: "[ACGTN]" };
/** A primer as a pattern at the start of a read, after up to 8 bases of spacer. */
export function primerPattern(seq: string): RegExp {
  return new RegExp(`^[ACGTN]{0,8}${seq.toUpperCase().split("").map((base) => IUPAC[base] ?? base).join("")}`);
}

export interface ReadSample { r1: string[]; r2: string[] }

/**
 * What a few hundred reads say: read length, amplicon or shotgun, and the primers when amplicons still carry them.
 * Amplicons share their first bases (the primer or the conserved region after it); shotgun reads almost never do.
 */
export function sniffReads(sample: ReadSample): Pick<DataSummary, "kind" | "region" | "primers"> & { length: { median: number | null; max: number | null } } {
  const lengths = [...sample.r1, ...sample.r2].map((seq) => seq.length).sort((a, b) => a - b);
  const length = { median: lengths.length ? lengths[Math.floor((lengths.length - 1) / 2)] : null, max: lengths.length ? lengths[lengths.length - 1] : null };
  if (!sample.r1.length) return { kind: null, region: null, primers: null, length };
  let best: { region: string; forward: string; reverse: string | null; share: number } | null = null;
  for (const primer of PRIMERS) {
    const forward = primerPattern(primer.forward.seq), reverse = primerPattern(primer.reverse.seq);
    const fwd = sample.r1.filter((seq) => forward.test(seq)).length / sample.r1.length;
    const rev = sample.r2.length ? sample.r2.filter((seq) => reverse.test(seq)).length / sample.r2.length : null;
    const share = rev === null ? fwd : (fwd + rev) / 2;
    if (share >= 0.5 && (!best || share > best.share)) best = { region: primer.region, forward: primer.forward.name, reverse: rev !== null && rev >= 0.5 ? primer.reverse.name : null, share };
  }
  if (best) return { kind: "amplicon", region: best.region, primers: { forward: best.forward, reverse: best.reverse, share: Math.round(best.share * 100) / 100 }, length };
  // Trimmed amplicons: a handful of prefixes cover most reads.
  const prefixes = new Map<string, number>();
  for (const seq of sample.r1) if (seq.length >= 16) prefixes.set(seq.slice(0, 16), (prefixes.get(seq.slice(0, 16)) ?? 0) + 1);
  const top = Math.max(0, ...prefixes.values()) / sample.r1.length;
  if (top >= 0.25) return { kind: "amplicon", region: null, primers: null, length };
  if (top < 0.05 && (length.median ?? 0) >= 75) return { kind: "shotgun", region: null, primers: null, length };
  return { kind: "unknown", region: null, primers: null, length };
}

/** Whether a file is gzip-compressed, by its first two bytes: Data keeps its files under ids, without their extension. */
async function isGzip(file: string): Promise<boolean> {
  const handle = await open(file, "r").catch(() => null);
  if (!handle) return false;
  try {
    const { bytesRead, buffer } = await handle.read(Buffer.alloc(2), 0, 2, 0);
    return bytesRead === 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  } catch {
    return false;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** The first `count` sequences of a FASTQ file (gzip or not), reading as little as needed. */
export async function headSequences(file: string, count: number): Promise<string[]> {
  const gzip = /\.gz$/i.test(file) || (await isGzip(file));
  const stream = createReadStream(file, { start: 0, end: 32 * 1024 * 1024 });
  const source = gzip ? stream.pipe(zlib.createGunzip()) : stream;
  const lines = readline.createInterface({ input: source, crlfDelay: Infinity });
  const out: string[] = [];
  let index = 0;
  try {
    for await (const line of lines) {
      if (index % 4 === 1) out.push(line.trim().toUpperCase());
      index += 1;
      if (out.length >= count) break;
    }
  } catch { /* a truncated or damaged file reads as far as it goes */ } finally {
    lines.close();
    stream.destroy();
  }
  return out;
}

const summaryCache = new Map<string, { at: number; summary: DataSummary }>();

/** One line about the study's data: samples, read layout and length, amplicon or shotgun with the primers; else its tables. */
export async function dataSummary(targetKey: string, options: { now?: Date } = {}): Promise<DataSummary> {
  const [{ files, pairs }, study, datasets] = await Promise.all([
    readsInData(targetKey), findDataStudy(targetKey),
    db.exploreDataset.findMany({ where: { targetKey, kind: { notIn: ["derived"] }, currentVersionId: { not: null } }, select: { name: true, currentVersionId: true }, take: 200, orderBy: { createdAt: "asc" } }),
  ]);
  const records = study ? await linkedReadRecords(study.id) : [];
  const versions = datasets.length ? await db.exploreDatasetVersion.findMany({ where: { id: { in: datasets.map((dataset) => dataset.currentVersionId!) } }, select: { id: true, rowCount: true, schema: true } }) : [];
  const tables = datasets.map((dataset) => {
    const version = versions.find((entry) => entry.id === dataset.currentVersionId);
    let cols = 0;
    try { cols = (JSON.parse(version?.schema ?? "{}").columns ?? []).length; } catch { cols = 0; }
    return { name: dataset.name, dims: `${(version?.rowCount ?? 0).toLocaleString("en-US")} × ${cols}` };
  });
  const key = createHash("sha256").update(JSON.stringify([targetKey, files.map((file) => [file.id, file.sizeBytes]), records.map((entry) => entry.readId), tables])).digest("hex");
  const cached = summaryCache.get(key);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.summary;

  const samples = pairs.length + records.length;
  const paired = pairs.filter((pair) => pair.r2).length + records.filter((entry) => entry.paired).length;
  const single = samples - paired;
  const layout = !samples ? null : !single ? "paired" as const : !paired ? "single" as const : "mixed" as const;
  // A few files tell the read length and the library kind.
  const storage = pairs.length ? await resolveExploreStorage().catch(() => null) : null;
  const filePath = async (id: string) => {
    const row = await db.managedFile.findUnique({ where: { id }, select: { storagePath: true } });
    return row && storage ? resolveContainedPath(path.join(storage.importsRoot, "files"), row.storagePath).catch(() => null) : null;
  };
  const sample: ReadSample = { r1: [], r2: [] };
  for (const pair of pairs.slice(0, 3)) {
    const r1 = await filePath(pair.r1.id);
    if (r1) sample.r1.push(...await headSequences(r1, 400));
    const r2 = pair.r2 ? await filePath(pair.r2.id) : null;
    if (r2) sample.r2.push(...await headSequences(r2, 400));
  }
  const sniffed = sniffReads(sample);
  const lengthWords = sniffed.length.max ? (layout === "paired" ? `2×${sniffed.length.max}` : `${sniffed.length.max} bp`) : null;
  const kindWords = sniffed.kind === "amplicon" ? `${sniffed.region ? `${sniffed.region} ` : ""}amplicons` : sniffed.kind === "shotgun" ? "shotgun reads" : null;
  const primerWords = sniffed.primers?.forward ? ` (primers ${[sniffed.primers.forward, sniffed.primers.reverse].filter(Boolean).join("/")} in ${Math.round((sniffed.primers.share ?? 0) * 100)}% of reads)` : "";
  const tablesOnly = !samples && tables.length > 0;
  const words = samples
    ? [plural(samples, "sample"), `${layout === "paired" ? "paired" : layout === "single" ? "single-end" : "paired and single-end"} FASTQ${lengthWords ? ` ${lengthWords}` : ""}`, kindWords ? `${kindWords}${primerWords}` : null].filter(Boolean).join(" · ")
    : tables.length ? `${plural(tables.length, "table")} (${tables.slice(0, 2).map((table) => `${table.name} ${table.dims}`).join(", ")}${tables.length > 2 ? ", …" : ""}) · no reads` : "No data yet";
  const summary: DataSummary = {
    targetKey, samples, reads: samples ? { files: files.length, pairs: pairs.filter((pair) => pair.r2).length, single: pairs.filter((pair) => !pair.r2).length, records: records.length, layout, length: sniffed.length.max ? sniffed.length : null } : null,
    kind: samples ? sniffed.kind ?? "unknown" : null, region: sniffed.region, primers: sniffed.primers, tables: { count: tables.length, names: tables.slice(0, 20) }, tablesOnly, words,
    checkedAt: (options.now ?? new Date()).toISOString(),
  };
  summaryCache.set(key, { at: Date.now(), summary });
  if (summaryCache.size > 100) summaryCache.delete(summaryCache.keys().next().value!);
  return summary;
}

// ---------------------------------------------------------------------------
// The store as members read it, with fit to the study's data
// ---------------------------------------------------------------------------

/** What a pipeline needs of the data and what people want from it (goals in plain words). Unknown: "not described yet". */
export const FIT_HINTS: Record<string, { goals: string[]; reads: "any" | "amplicon" | "shotgun" | "long"; soft?: boolean; layouts?: Array<"paired" | "single">; makes?: string[] }> = {
  fastqc: { goals: ["Read quality"], reads: "any", makes: ["fastqc_summary"] },
  "reads-qc": { goals: ["Read quality"], reads: "any", makes: ["read_stats"] },
  multiqc: { goals: ["Read quality"], reads: "any" },
  nanoplot: { goals: ["Read quality"], reads: "long" },
  "read-cleaning": { goals: ["Clean reads"], reads: "any" },
  ampliseq: { goals: ["Taxa from amplicons"], reads: "amplicon", makes: ["asv_table", "taxonomy"] },
  "nf-core-ampliseq": { goals: ["Taxa from amplicons"], reads: "amplicon", makes: ["asv_table", "taxonomy"] },
  "kraken2-bracken": { goals: ["Species from shotgun reads"], reads: "shotgun", soft: true, makes: ["bracken_species"] },
  metaphlan: { goals: ["Species from shotgun reads"], reads: "shotgun" },
  taxprofiler: { goals: ["Species from shotgun reads"], reads: "shotgun" },
  mag: { goals: ["Genomes from shotgun reads"], reads: "shotgun", layouts: ["paired"] },
  metaxpath: { goals: ["Species from shotgun reads"], reads: "shotgun" },
};

export interface PipelineFit { state: "fits" | "needs" | "not-for-data" | "unknown"; lines: Array<{ ok: boolean | null; words: string }>; words: string }

/** How a pipeline fits a study's data, one line per requirement; never guessed for a pipeline that does not say. The
 *  pipeline's own description (`spec`, from its manifest, the registry or SeqDesk) wins over the built-in hints. */
export function fitOf(pipelineId: string, hintsFromTags: { reads?: "amplicon" | "shotgun" | "any" | "long" } | null, data: DataSummary | null, missing: string[] = [], spec?: PipelineFitSpec | null): PipelineFit {
  const described = spec?.reads ? { goals: spec.goals, reads: spec.reads.kind, soft: spec.reads.soft, ...(spec.reads.layouts.length === 1 ? { layouts: spec.reads.layouts } : {}) } : null;
  const hint = described ?? FIT_HINTS[pipelineId] ?? FIT_HINTS[pipelineId.replace(/^nf-core[/-]/, "")] ?? (hintsFromTags?.reads ? { goals: [], reads: hintsFromTags.reads } : null);
  const lines: PipelineFit["lines"] = [];
  if (!data) return { state: hint ? "fits" : "unknown", lines, words: "" };
  if (data.tablesOnly || !data.samples) {
    // A study with tables says so; an empty one is not "tables".
    const tables = data.tables.count > 0;
    lines.push({ ok: false, words: tables ? "needs reads; this study’s Data has tables only" : "needs reads; this study’s Data is empty" });
    return { state: "not-for-data", lines, words: tables ? "Pipelines start from reads; your data are tables" : "Pipelines start from reads; add reads in Data first" };
  }
  if (!hint) {
    lines.push({ ok: null, words: "fit with your data: not described yet" });
    return { state: "unknown", lines, words: "Fit with your data: not described yet" };
  }
  lines.push({ ok: true, words: `${data.reads?.layout === "single" ? "single-end" : "paired"} FASTQ` });
  let state: PipelineFit["state"] = "fits";
  if (hint.layouts && data.reads?.layout && !hint.layouts.includes(data.reads.layout === "mixed" ? "single" : data.reads.layout)) {
    lines[0] = { ok: false, words: `needs ${hint.layouts.join(" or ")} reads; yours are ${data.reads.layout === "single" ? "single-end" : "mixed"}` };
    state = "not-for-data";
  }
  if (hint.reads === "amplicon") {
    if (data.kind === "amplicon") lines.push({ ok: true, words: `amplicons${data.primers?.forward ? ` · primers ${[data.primers.forward, data.primers.reverse].filter(Boolean).join("/")} found` : ""}` });
    else if (data.kind === "shotgun") { lines.push({ ok: false, words: "needs amplicon reads; yours are shotgun reads" }); state = "not-for-data"; }
    else lines.push({ ok: null, words: "made for amplicon reads" });
  } else if (hint.reads === "shotgun") {
    if (data.kind === "shotgun") lines.push({ ok: true, words: "shotgun reads" });
    else if (data.kind === "amplicon") {
      lines.push({ ok: hint.soft ? null : false, words: hint.soft ? "meant for shotgun reads; works on amplicons with lower resolution" : "needs shotgun reads; yours are amplicons" });
      if (!hint.soft) state = "not-for-data";
    } else lines.push({ ok: null, words: "meant for shotgun reads" });
  } else if (hint.reads === "long") {
    const long = (data.reads?.length?.median ?? 0) >= 1000;
    lines.push({ ok: long, words: long ? "long reads" : "needs long reads (Nanopore, PacBio); yours are short" });
    if (!long) state = "not-for-data";
  }
  if (state === "fits" && missing.length) { state = "needs"; for (const words of missing) lines.push({ ok: false, words }); }
  const words = lines.map((line) => `${line.words}${line.ok === true ? " ✓" : ""}`).join(" · ");
  return { state, lines, words };
}

const tagsReads = (tags: string[], category: string | null | undefined): { reads?: "amplicon" | "shotgun" | "any" | "long" } | null => {
  const all = [...tags, category ?? ""].join(" ").toLowerCase();
  if (/amplicon|16s|its\b|metabarcod/.test(all)) return { reads: "amplicon" };
  if (/shotgun|metagenom/.test(all)) return { reads: "shotgun" };
  if (/nanopore|long[- ]read|pacbio/.test(all)) return { reads: "long" };
  if (/\bqc\b|quality/.test(all)) return { reads: "any" };
  return null;
};

export interface StoreEntry {
  id: string;
  name: string;
  version: string;
  latestVersion: string | null;
  versions: string[];
  description: string;
  category: string | null;
  tags: string[];
  /** Where it comes from: nf-core, verified, lab pipeline, private registry, installed. Never stars or downloads. */
  badges: string[];
  source: { kind: "seqdesk" | "nf-core" | "lab" | "registry" | "private"; label: string };
  installed: { version: string; enabled: boolean } | null;
  goals: string[];
  makes: string[];
  tables: string[];
  fit: PipelineFit | null;
  /** On this server: ready · needs something first · in the store · not for this data. */
  state: "ready" | "needs" | "store" | "not-for-data";
  missing: string[];
  action: { kind: "add" | "install" | "ask-install" | "asked" | "install-reference" | "ask-admin" | "details"; label: string };
  labUse: { runs: number; lastBy: string | null; lastAt: string | null; presets: number } | null;
  request: { id: string; status: string; requestedBy: string | null } | null;
  license: string | null;
  homepage: string | null;
  citation: string | null;
  /* Sheet 97's card and Details (optional; each only when known, never guessed). */
  /** What it reads in plain words: the reads, and a sample list for pipelines whose samplesheet takes more than reads. */
  inputs?: Array<{ id: string; label: string; kind: "reads" | "table"; detail: string | null }>;
  /** Outputs that stay files of the run (MultiQC report). */
  files?: Array<{ label: string; kind: "report" | "figure" | "file" }>;
  /** Its stages, top to bottom. */
  stages?: string[];
  /** Its reference databases, their size and whether this server has them. */
  references?: Array<{ id: string; label: string; sizeBytes: number | null; installed: boolean }>;
  /** The package's own download, without its reference databases (registry). */
  sizeBytes?: number | null;
  /** Time on the study's data, what it rests on (runs here, or registry statistics), and CPU hours when known. */
  estimate?: { seconds: number | null; words: string; samples: number; basis: string | null; cpuHours: number | null } | null;
  /** How many settings, and the basic ones by title. */
  settings?: { count: number; basic: string[] } | null;
  /** The question it answers ("Which taxa, how much"). */
  answers?: string | null;
  /** How often its paper is cited (registry). */
  citedBy?: number | null;
  /** Who made a lab or private pipeline. */
  author?: { name: string } | null;
  /** The registry gives a checksum the install verifies. */
  signed?: boolean;
  /** Installing it needs a licence key. */
  licenseKey?: boolean;
  /** The reads it is described for (the fit is judged against these): null when it does not say. */
  reads?: { kind: "amplicon" | "shotgun" | "long" | "any"; layouts: Array<"paired" | "single">; soft: boolean } | null;
  /** The tables it makes, typed. */
  outputs?: Array<{ name: string; tableKind: string | null }>;
  /** It says what data it fits (goals or typed reads); false: "fit not described yet". */
  described?: boolean;
  /** The changelog of the newest version. */
  changelogUrl?: string | null;
  /** A member asked an admin for a missing reference database of it. */
  referenceRequest?: { id: string; status: string; requestedBy: string | null; referenceId: string | null } | null;
}

export interface StoreListing { pipelines: StoreEntry[]; goals: string[]; sources: Array<{ id: string; label: string }>; storeError: string | null; canInstall: boolean; data: DataSummary | null }

let storeCache: { at: number; catalog: PipelineStoreCatalog } | null = null;
async function storeCatalog(load: typeof loadPipelineStoreCatalog = loadPipelineStoreCatalog): Promise<{ catalog: PipelineStoreCatalog | null; error: string | null }> {
  if (storeCache && Date.now() - storeCache.at < 10 * 60 * 1000) return { catalog: storeCache.catalog, error: null };
  try {
    const catalog = await load({ catalog: "study", timeoutMs: 6000 });
    if (!catalog.successfulRegistryCount && catalog.registryErrors.length) return { catalog: null, error: "The pipeline store could not be reached; only the pipelines on this server are listed." };
    storeCache = { at: Date.now(), catalog };
    return { catalog, error: null };
  } catch {
    return { catalog: null, error: "The pipeline store could not be reached; only the pipelines on this server are listed." };
  }
}

/** For tests. */
export function resetStoreCache(): void { storeCache = null; summaryCache.clear(); }

/** The newest version the store knows of a pipeline, from the cached catalogue only (never waits for a registry);
 *  a stale or missing cache is refreshed in the background. */
export function peekStoreLatest(pipelineId: string): string | null {
  if (!storeCache || Date.now() - storeCache.at > 10 * 60 * 1000) void storeCatalog().catch(() => undefined);
  const entry = storeCache?.catalog.pipelines.find((pipeline) => pipeline.id === pipelineId);
  return entry ? entry.latestVersion || entry.version || null : null;
}

/** The lab's runs per pipeline: count, last person and date, over every study the lab's workspace uses. */
async function labUse(labKey: string | null): Promise<Map<string, { runs: number; lastBy: string | null; lastAt: string | null }>> {
  const out = new Map<string, { runs: number; lastBy: string | null; lastAt: string | null }>();
  if (!labKey) return out;
  const [authority, workspaceId] = labKey.split("|");
  const scopes = await db.integrationExploreScope.findMany({ where: { authority, workspaceId }, select: { targetKey: true }, take: 500 });
  if (!scopes.length) return out;
  const studies = await db.study.findMany({ where: { alias: { in: scopes.map((scope) => dataStudyAlias(scope.targetKey)) } }, select: { id: true } });
  if (!studies.length) return out;
  const runs = await db.pipelineRun.findMany({ where: { studyId: { in: studies.map((study) => study.id) }, status: "completed" }, select: { pipelineId: true, completedAt: true, user: { select: { firstName: true, lastName: true, email: true } } }, orderBy: { completedAt: "desc" }, take: 2000 });
  for (const run of runs) {
    const entry = out.get(run.pipelineId) ?? { runs: 0, lastBy: run.user ? [run.user.firstName, run.user.lastName].filter(Boolean).join(" ") || run.user.email : null, lastAt: run.completedAt?.toISOString() ?? null };
    entry.runs += 1;
    out.set(run.pipelineId, entry);
  }
  return out;
}

/**
 * One list for members: the pipelines on this server and those in the store, each with where it comes from, how it
 * fits the study's data (when a study is named), what is missing, and one action. Admins see Install; members Ask.
 * Readable by any member (the admin store route needs system.pipelines.manage).
 */
export async function pipelineStore(input: { targetKey?: string | null; labKey?: string | null; access: PipelineAccess; load?: typeof loadPipelineStoreCatalog }): Promise<StoreListing> {
  const [data, { catalog, error }, use, settings] = await Promise.all([
    input.targetKey ? dataSummary(input.targetKey).catch(() => null) : Promise.resolve(null),
    storeCatalog(input.load), labUse(input.labKey ?? null), getExecutionSettings().catch(() => null),
  ]);
  const presets = input.labKey ? await db.explorePipelinePreset.groupBy({ by: ["pipelineId"], where: { labKey: input.labKey, archivedAt: null }, _count: { _all: true } }).catch(() => []) : [];
  const requests = input.labKey ? await db.explorePipelineInstallRequest.findMany({ where: { labKey: input.labKey, status: "pending" }, select: { id: true, kind: true, pipelineId: true, status: true, requestedByName: true, text: true } }) : [];
  const samples = data && !data.tablesOnly ? data.samples : 0;
  const readsLabel = data?.reads?.layout === "single" ? "single-end FASTQ" : data?.reads ? "paired FASTQ" : "FASTQ reads";
  const entries = new Map<string, StoreEntry>();
  const specs = new Map<string, PipelineFitSpec | null>();
  for (const pkg of getAllPackages()) {
    const info = pipelineInfo(pkg.id);
    if (!info || NOT_STEPS.has(pkg.id)) continue;
    const registry = getPackageRegistry(pkg.id) as { category?: string; tags?: string[] } | undefined;
    const enabled = await getPipelineEnabled(pkg.id).catch(() => false);
    const stored = await storedPipelineConfig(pkg.id).catch(() => ({}));
    const databases = settings ? await getPipelineDatabaseStatuses(pkg.id, stored, settings.pipelineRunDir, (settings as { pipelineDatabaseDir?: string | null }).pipelineDatabaseDir).catch(() => []) : [];
    const missing = [...(enabled ? [] : ["switched off on this server"]), ...databases.filter((database) => database.status !== "downloaded").map((database) => `needs the ${database.label.replace(/\s+database$/i, "")} database`)];
    const provider = pkg.manifest.package.provider ?? "";
    const source: StoreEntry["source"] = /nf-core/i.test(`${provider} ${pkg.id}`) ? { kind: "nf-core", label: "nf-core" } : provider && !/seqdesk/i.test(provider) ? { kind: "lab", label: provider } : { kind: "seqdesk", label: "SeqDesk" };
    const record = pipelineRecord(pkg.id);
    specs.set(pkg.id, record.fit);
    // Its own samplesheet: a sample list is offered when it takes more than the sample and its reads.
    const sheet = pkg.samplesheet?.samplesheet?.columns ?? [];
    const takesList = sheet.some((column) => column.source && !/^(sample\.sampleId|sample\.sampleAlias|read\.file[12])$/.test(column.source));
    const settingList = pipelineSettings(info.definition, {}, stored);
    const durations = await pastDurations(pkg.id, samples || null).catch(() => [] as number[]);
    const sorted = [...durations].sort((a, b) => a - b);
    const seconds = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
    entries.set(pkg.id, {
      id: pkg.id, name: info.name, version: info.version, latestVersion: null, versions: [info.version], description: info.description, category: registry?.category ?? null, tags: registry?.tags ?? [],
      badges: ["installed", ...(source.kind === "nf-core" ? ["nf-core"] : source.kind === "lab" ? ["lab pipeline"] : [])], source, installed: { version: info.version, enabled },
      goals: record.fit?.goals.length ? record.fit.goals : FIT_HINTS[pkg.id]?.goals ?? [], makes: tableOutputsOf(pkg.id).map((output) => output.name), tables: tableOutputsOf(pkg.id).map((output) => output.name),
      fit: null, state: "ready", missing, action: { kind: "add", label: "Add" }, labUse: null, request: null,
      license: (pkg.manifest.package as { license?: string }).license ?? null, homepage: pkg.manifest.package.website ?? null, citation: (pkg.manifest.package as { citation?: string }).citation ?? (record.citations.find((entry) => entry.kind === "pipeline")?.short ?? null),
      inputs: [{ id: "reads", label: readsLabel, kind: "reads", detail: sheet.length ? `the pipeline’s samplesheet: ${sheet.map((column) => column.name).join(", ")}` : null },
        ...(takesList ? [{ id: "samplesheet", label: "sample list", kind: "table" as const, detail: `columns ${sheet.map((column) => column.name).join(", ")}` }] : [])],
      files: fileOutputsOf(pkg.id).map((file) => ({ label: file.label, kind: file.kind })), stages: stagesOf(pkg.id),
      references: databases.map((database) => ({ id: database.id, label: database.label.replace(/\s+database$/i, ""), sizeBytes: database.sizeBytes ?? null, installed: database.status === "downloaded" })),
      estimate: samples ? { seconds, words: seconds == null ? "no estimate yet" : `about ${durationWords(seconds)}`, samples, basis: durations.length ? `from ${durations.length} finished run${durations.length === 1 ? "" : "s"} on this server` : null, cpuHours: null } : null,
      settings: { count: settingList.length, basic: settingList.filter((setting) => setting.placement === "basic").map((setting) => setting.title) },
      answers: record.fit?.answers ?? null, author: source.kind === "lab" ? { name: provider } : null,
      reads: record.fit?.reads ?? null, outputs: record.fit?.outputs.length ? record.fit.outputs : tableOutputsOf(pkg.id).map((output) => ({ name: output.name, tableKind: output.tableKind })),
      described: Boolean(record.fit), changelogUrl: changelogUrl(record, info.version),
    });
  }
  for (const pipeline of catalog?.pipelines ?? []) {
    const known = entries.get(pipeline.id);
    const badges = [...new Set([...(known?.badges ?? []), ...(/nf-core/i.test(`${pipeline.author} ${pipeline.id} ${pipeline.source.label}`) ? ["nf-core"] : []), ...(pipeline.verified ? ["verified"] : []), ...(pipeline.isPrivate ? ["private registry"] : [])])];
    const raw = (pipeline.record ?? {}) as Record<string, unknown>;
    const signed = Boolean(pipeline.source.sha256 || raw.signed === true);
    if (known) {
      known.latestVersion = pipeline.latestVersion || pipeline.version;
      known.versions = [...new Set([known.version, ...pipeline.versions.map((entry) => entry.version)])];
      known.badges = badges;
      known.tags = [...new Set([...known.tags, ...pipeline.tags])];
      known.signed = signed;
      known.licenseKey = pipeline.licenseRequired;
      if (typeof raw.citedBy === "number") known.citedBy = raw.citedBy;
      if (typeof raw.sizeBytes === "number") known.sizeBytes = raw.sizeBytes;
      known.changelogUrl = changelogUrl(pipelineRecord(pipeline.id, raw as RegistryRecordFields), known.latestVersion);
      continue;
    }
    const record = pipelineRecord(pipeline.id, raw as RegistryRecordFields);
    specs.set(pipeline.id, record.fit);
    const list = (value: unknown) => (Array.isArray(value) ? value : []);
    const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
    const typical = raw.estimate && typeof raw.estimate === "object" ? raw.estimate as { seconds?: unknown; samples?: unknown; runs?: unknown; cpuHours?: unknown } : null;
    const typicalSeconds = typeof typical?.seconds === "number" ? typical.seconds : null;
    const typicalSamples = typeof typical?.samples === "number" && typical.samples > 0 ? typical.samples : null;
    const scaled = typicalSeconds !== null && samples ? Math.round(typicalSeconds * (typicalSamples ? Math.max(0.3, Math.min(3, samples / typicalSamples)) : 1)) : null;
    const source: StoreEntry["source"] = pipeline.isPrivate ? { kind: "private", label: pipeline.source.label } : /nf-core/i.test(`${pipeline.author} ${pipeline.id}`) ? { kind: "nf-core", label: "nf-core" } : { kind: "registry", label: pipeline.source.label };
    entries.set(pipeline.id, {
      id: pipeline.id, name: pipeline.name, version: pipeline.latestVersion || pipeline.version, latestVersion: pipeline.latestVersion || null, versions: pipeline.versions.map((entry) => entry.version),
      description: pipeline.description, category: pipeline.category || null, tags: pipeline.tags, badges, source,
      installed: null, goals: record.fit?.goals.length ? record.fit.goals : FIT_HINTS[pipeline.id]?.goals ?? [], makes: record.fit?.outputs.length ? record.fit.outputs.map((output) => output.name) : FIT_HINTS[pipeline.id]?.makes ?? [], tables: [], fit: null, state: "store", missing: [],
      action: { kind: "ask-install", label: "Ask to install" }, labUse: null, request: null,
      license: str(raw.license), homepage: str(raw.homepage), citation: typeof raw.citation === "string" ? raw.citation : record.citations.find((entry) => entry.kind === "pipeline")?.short ?? null,
      ...(Array.isArray(raw.inputs) ? { inputs: list(raw.inputs).flatMap((entry) => { const value = entry as Record<string, unknown>; const id = str(value.id); return id ? [{ id, label: str(value.label) ?? id, kind: value.kind === "table" ? "table" as const : "reads" as const, detail: str(value.detail) }] : []; }) }
        : record.fit?.reads ? { inputs: [{ id: "reads", label: readsLabel, kind: "reads" as const, detail: null }] } : {}),
      ...(Array.isArray(raw.files) ? { files: list(raw.files).flatMap((entry) => { const value = entry as Record<string, unknown>; const label = str(value.label); return label ? [{ label, kind: value.kind === "report" || value.kind === "figure" ? value.kind : "file" as const }] : []; }) } : {}),
      ...(Array.isArray(raw.stages) ? { stages: list(raw.stages).map(str).filter((value): value is string => Boolean(value)) } : {}),
      ...(Array.isArray(raw.references) ? { references: list(raw.references).flatMap((entry) => { const value = entry as Record<string, unknown>; const id = str(value.id); return id ? [{ id, label: str(value.label) ?? id, sizeBytes: typeof value.sizeBytes === "number" ? value.sizeBytes : null, installed: false }] : []; }) } : {}),
      ...(typeof raw.sizeBytes === "number" ? { sizeBytes: raw.sizeBytes } : typeof raw.size === "number" ? { sizeBytes: raw.size } : {}),
      ...(scaled !== null ? { estimate: { seconds: scaled, words: `about ${durationWords(scaled)}`, samples, basis: typeof typical?.runs === "number" ? `from ${typical.runs} runs on other servers` : "from the registry", cpuHours: typeof typical?.cpuHours === "number" && typicalSamples ? Math.max(1, Math.round((typical.cpuHours as number) * samples / typicalSamples)) : null } } : {}),
      ...(raw.settings && typeof raw.settings === "object" ? { settings: { count: Number((raw.settings as Record<string, unknown>).count) || 0, basic: list((raw.settings as Record<string, unknown>).basic).map(str).filter((value): value is string => Boolean(value)) } } : {}),
      answers: record.fit?.answers ?? str(raw.answers), citedBy: typeof raw.citedBy === "number" ? raw.citedBy : null,
      author: source.kind === "private" || source.kind === "registry" ? (pipeline.author && pipeline.author !== "unknown" ? { name: pipeline.author } : null) : null,
      signed, licenseKey: pipeline.licenseRequired,
      reads: record.fit?.reads ?? null, outputs: record.fit?.outputs ?? [], described: Boolean(record.fit), changelogUrl: changelogUrl(record, pipeline.latestVersion || pipeline.version),
    });
  }
  for (const entry of entries.values()) {
    entry.fit = data ? fitOf(entry.id, tagsReads(entry.tags, entry.category), data, entry.installed ? entry.missing : [], specs.get(entry.id) ?? null) : null;
    const request = requests.find((row) => row.pipelineId === entry.id && row.kind !== "reference");
    entry.request = request ? { id: request.id, status: request.status, requestedBy: request.requestedByName } : null;
    const reference = requests.find((row) => row.pipelineId === entry.id && row.kind === "reference");
    entry.referenceRequest = reference ? { id: reference.id, status: reference.status, requestedBy: reference.requestedByName, referenceId: reference.text } : null;
    const lab = use.get(entry.id);
    const presetCount = presets.find((row) => row.pipelineId === entry.id)?._count._all ?? 0;
    entry.labUse = lab || presetCount ? { runs: lab?.runs ?? 0, lastBy: lab?.lastBy ?? null, lastAt: lab?.lastAt ?? null, presets: presetCount } : null;
    if (entry.fit?.state === "not-for-data") { entry.state = "not-for-data"; entry.action = { kind: "details", label: "Details" }; }
    else if (!entry.installed) { entry.state = "store"; entry.action = input.access.canManage ? { kind: "install", label: "Install" } : entry.request ? { kind: "asked", label: "Asked" } : { kind: "ask-install", label: "Ask to install" }; }
    else if (entry.missing.length) { entry.state = "needs"; entry.action = input.access.canManage ? { kind: "install-reference", label: entry.missing.some((words) => /database/.test(words)) ? "Install the database" : "Switch it on" } : entry.referenceRequest ? { kind: "asked", label: "Asked" } : { kind: "ask-admin", label: "Ask an admin" }; }
    else { entry.state = "ready"; entry.action = { kind: "add", label: "Add" }; }
  }
  const order = { ready: 0, needs: 1, store: 2, "not-for-data": 3 } as const;
  const fitOrder = (entry: StoreEntry) => (entry.fit?.state === "fits" ? 0 : entry.fit?.state === "unknown" ? 1 : 2);
  const pipelines = [...entries.values()].sort((a, b) => order[a.state] - order[b.state] || fitOrder(a) - fitOrder(b) || a.name.localeCompare(b.name));
  // Goals only the data could reach.
  const goals = [...new Set(pipelines.filter((entry) => entry.state !== "not-for-data").flatMap((entry) => entry.goals))];
  return { pipelines, goals, sources: (catalog?.registries ?? []).map((registry) => ({ id: registry.id, label: registry.label })), storeError: error, canInstall: input.access.canManage, data };
}

/** A study whose Data has reads this lab may use: the readiness line still comes from data-pipelines. */
export async function studyHasReads(targetKey: string): Promise<boolean> {
  const { pairs } = await readsInData(targetKey);
  return pairs.length > 0;
}
