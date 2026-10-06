import { currentRuntimeFingerprint, runtimeOfResults } from "@/lib/explore/runtime-fingerprint";
import fs from "fs/promises";
import { inputToken } from "@/lib/explore/input-token";
import { editTable } from "@/lib/explore/table-edit";
import { createReadStream } from "fs";
import path from "path";
import { Readable } from "stream";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { packagesConflictError, stepConflictError } from "@/lib/explore/step-conflict";
import { RevisionConflict, analysisLanguageOf, createAnalysis, createRevision, deleteAnalysis, getAnalysisDetail, listAnalyses, listRuns, serializeRun, updateAnalysis, type AnalysisInputBinding } from "@/lib/explore/analyses";
import { listEnvironments } from "@/lib/explore/environments";
import { listBaseEnvironments, normalizeStepPackages, PackageSpecError, prepareStepEnvironment, resolveStepEnvironment, stepPackagesOf, type StepEnvironmentState } from "@/lib/explore/step-environments";
import { loadKits, serializeKit } from "@/lib/explore/kits/loader";
import { cascadeFromRun } from "@/lib/explore/run-cascade";
import { cancelRun, createAndStartRun, ExploreRunError } from "@/lib/explore/runner";
import { collectHostFacts } from "@/lib/explore/sandbox/host";
import { getSandboxSettings } from "@/lib/explore/sandbox/settings";
import { EXPLORE_ROLES, EXPLORE_SENSITIVITIES, type ExploreRole, type ExploreRoleMap, type ExploreSensitivity } from "@/lib/explore/types";
import { readTail } from "@/lib/pipelines/nextflow";
import { ExploreAuthorizationError, requireExplorePrincipal, requireTargetAccess, resolveTargetAccess } from "@/lib/explore/authorization";
import { decideServerCapability } from "@/lib/authorization/api";
import { parseTargetKey, type ExploreTargetKey } from "@/lib/explore/target-key";
import { ExploreBuildInputError } from "@/lib/explore/builders/types";
import { loadCanvasGraph } from "@/lib/explore/canvas";
import { importDatasetFromForm, isImportInputError } from "@/lib/explore/dataset-import";
import { cancelImportJob, getImportJob, serializeImportJob } from "@/lib/explore/import-jobs";
import { readTablePage } from "@/lib/explore/table-page";
import { QueryInputError } from "@/lib/explore/table-query";
import { openTableDownload } from "@/lib/explore/table-download";
import { computeDatasetCacheToken, deleteDataset, fetchDatasetRows, getDatasetDetail, getDatasetRecord, listDatasets, updateDatasetRoles } from "@/lib/explore/datasets";
import { applyEditsToRows, listActiveEdits } from "@/lib/explore/edits";
import { createFlow, deleteFlow, getFlow, getFlowRecord, listFlows, updateFlow } from "@/lib/explore/flows";
import { flowCitations, housekeepingCounts, processCleanupJobs, pruneRuns } from "@/lib/explore/housekeeping";
import { isExploreModuleEnabled } from "@/lib/explore/module";
import { renderReportHtml } from "@/lib/explore/report-export";
import { changeReportChecks, getReportReview, reviewSummaries, importReportReview, recordReportVersion, ReportReviewError } from "@/lib/explore/report-review";
import { createReport, deleteReport, ExploreReportError, getReportRecord, getReportView, listReports, renameReport, resetReport, saveReport, setShareMode, shareModeOf, shareReport, unshareReport, type ReportViewOptions } from "@/lib/explore/reports";
import { readFailureWords } from "@/lib/explore/import-words";
import { ExploreRouteError } from "@/lib/explore/route-error";
import { readRunIsolation, summarizeIsolation } from "@/lib/explore/sandbox/prepare";
import { resolveContainedPath } from "@/lib/explore/storage";
import type { ExploreScope } from "@/lib/explore/types";
import { FileLibraryError, getLibraryFile, listLibraryFiles, readLibraryFile, removeLibraryFile, storeLibraryFile, storeLibraryFileStream, updateLibraryFile, validateFileBindings } from "@/lib/files/library";
import { MAX_FILE_DESCRIPTION_LENGTH, MAX_LIBRARY_FILE_BYTES, normalizeFileTags } from "@/lib/files/library-types";
import { IntegrationAccessError, type IntegrationSession } from "./identity";
import { codeForStatus, flowError, FLOW_CAPABILITIES_BUILT } from "./flow-contract";
import { parseParamMeta } from "@/lib/explore/recipe-view";
import { parseMethodsMismatch } from "@/lib/explore/sentence-change";
import { methodsAcceptedBy, type MethodsPerson } from "@/lib/explore/methods-draft";
import { Prisma } from "@prisma/client";
import { flowChanged, handleFlowRequest, isFlowPath } from "./explore-flow";
import { prepareFlowRemoval } from "./events";

/** Capabilities advertised by /info while the Explore module is on. */
/** explore.large-tables: streamed uploads (POST files/stream), background imports with progress (datasets/imports/{job}), paged and searchable table reads. */
export const EXPLORE_INTEGRATION_CAPABILITIES = ["explore.files", "explore.datasets", "explore.reports", "explore.flows", "explore.large-tables"] as const;

/** Everything /info advertises while the Explore module is on: the base surface plus the Flow features built so far. */
export function exploreIntegrationCapabilities(options: { eventsConfigured?: boolean; pipelineSteps?: boolean } = {}): string[] {
  // explore.events means "this installation pushes to its collaboration server", so it needs that to be configured.
  const flow = FLOW_CAPABILITIES_BUILT.filter((capability) => capability !== "explore.events" || options.eventsConfigured);
  // explore.pipeline-steps needs the pipeline-steps migration in the database and the client (pipelineStepsAvailable).
  // explore.samples-steps and explore.pipeline-records (sheets 96–97) ride on the same migration.
  return [...EXPLORE_INTEGRATION_CAPABILITIES, ...flow, ...(options.pipelineSteps ? ["explore.pipeline-steps", "explore.samples-steps", "explore.pipeline-records"] : [])];
}

/** Flow pages read every flow of their study and start empty; the author composes them. */
const FLOW_REPORT_VIEW: ReportViewOptions = { outputs: "scope", suggest: false };

const ARTIFACT_CONTENT_TYPES: Record<string, string> = {
  "plotly-json": "application/json; charset=utf-8",
  json: "application/json; charset=utf-8",
  png: "image/png",
  svg: "image/svg+xml",
  html: "text/html; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  pdf: "application/pdf",
};

const STUDY_NAME_MAX = 200;
const STUDY_DESCRIPTION_MAX = 2000;

/** A Flow study as the client sees it: an Explore project scope plus its link. */
export type FlowStudy = ExploreScope & { id: string; description: string | null; createdAt: string; projectId: string; visibility: "lab" | "private"; ownerMemberId: string };

type ScopeLink = { projectId: string; visibility: string; ownerMemberId: string };

function studyOf(project: { id: string; name: string; description: string | null; createdAt: Date }, access: "read" | "write", link?: ScopeLink | null): FlowStudy {
  return { id: project.id, targetKey: `project:${project.id}`, type: "project", label: project.name, description: project.description, createdAt: project.createdAt.toISOString(), access,
    projectId: link?.projectId || "", visibility: link?.visibility === "private" ? "private" : "lab", ownerMemberId: link?.ownerMemberId || "" };
}

const PROJECT_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * The collaboration project a new or moved study belongs to. A handle minted
 * for one project may only use that project; "" is team-wide.
 */
function checkedProjectId(session: IntegrationSession, raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return session.integration.projectId || "";
  if (typeof raw !== "string" || !PROJECT_ID.test(raw)) throw new ExploreRouteError(400, "projectId must be a project id.", "invalid_request");
  if (session.integration.projectId && session.integration.projectId !== raw) throw new ExploreRouteError(403, "This access is for another project.", "forbidden");
  return raw;
}

function studyAccess(session: IntegrationSession): "read" | "write" {
  return decideServerCapability(session, "analysis.run").allowed ? "write" : "read";
}

/**
 * The studies a collaboration workspace shares: the Explore projects linked
 * to it, newest first. Only a session whose account may read Explore data
 * sees them; the link table, not project ownership, carries the access.
 */
export async function listFlowStudies(session: IntegrationSession, filter: { projectId?: string | null } = {}): Promise<FlowStudy[]> {
  requireExplorePrincipal(session);
  const { authority, workspaceId, memberId } = session.integration;
  // A project handle sees its project's studies; otherwise every study, or one project's when asked ("" = team-wide).
  const projectId = session.integration.projectId || (filter.projectId ?? null);
  const links = await db.integrationExploreScope.findMany({
    where: { authority, workspaceId, ...(projectId !== null ? { projectId } : {}), OR: [{ visibility: "lab" }, ...(memberId ? [{ visibility: "private", ownerMemberId: memberId }] : [])] },
    select: { targetKey: true, projectId: true, visibility: true, ownerMemberId: true },
  });
  const linkOf = new Map(links.map((link) => [link.targetKey, link] as const));
  const ids = links.map((link) => parseTargetKey(link.targetKey)).filter((target): target is ExploreTargetKey => !!target && target.type === "project").map((target) => target.id);
  if (!ids.length) return [];
  const projects = await db.exploreProject.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, description: true, createdAt: true }, orderBy: { createdAt: "desc" } });
  const access = studyAccess(session);
  return projects.map((project) => studyOf(project, access, linkOf.get(`project:${project.id}`)));
}

/** A new study: an Explore project owned by the caller's account, linked to the workspace. */
export async function createFlowStudy(session: IntegrationSession, name: string, description: string | null, options: { projectId?: unknown; visibility?: unknown } = {}): Promise<FlowStudy> {
  if (studyAccess(session) !== "write") throw new IntegrationAccessError(403, "Your SeqDesk account may not create studies.");
  const { authority, workspaceId, memberId } = session.integration;
  const projectId = checkedProjectId(session, options.projectId);
  if (options.visibility !== undefined && options.visibility !== "lab" && options.visibility !== "private") throw new ExploreRouteError(400, 'visibility must be "lab" or "private".', "invalid_request");
  const visibility = options.visibility === "private" ? "private" : "lab";
  if (visibility === "private" && !memberId) throw new ExploreRouteError(400, "A private study needs a member.", "invalid_request");
  const project = await db.exploreProject.create({
    data: { name, description, ownerId: session.user.id },
    select: { id: true, name: true, description: true, createdAt: true },
  });
  const link = { projectId, visibility, ownerMemberId: visibility === "private" ? memberId : memberId || "" };
  await db.integrationExploreScope.create({ data: { id: randomUUID(), authority, workspaceId, targetKey: `project:${project.id}`, createdBy: session.user.id, ...link } });
  return studyOf(project, "write", link);
}

export async function updateFlowStudy(session: IntegrationSession, id: string, changes: { name?: string; description?: string | null }, move: { projectId?: unknown } = {}): Promise<FlowStudy> {
  const targetKey = `project:${id}`;
  await requireTargetAccess(session, targetKey, "write");
  const { authority, workspaceId } = session.integration;
  if (move.projectId !== undefined) {
    const projectId = move.projectId === "" ? "" : checkedProjectId(session, move.projectId);
    await db.integrationExploreScope.updateMany({ where: { authority, workspaceId, targetKey }, data: { projectId } });
  }
  const project = Object.keys(changes).length
    ? await db.exploreProject.update({ where: { id }, data: changes, select: { id: true, name: true, description: true, createdAt: true } })
    : await db.exploreProject.findUniqueOrThrow({ where: { id }, select: { id: true, name: true, description: true, createdAt: true } });
  const link = await db.integrationExploreScope.findFirst({ where: { authority, workspaceId, targetKey }, select: { projectId: true, visibility: true, ownerMemberId: true } });
  return studyOf(project, "write", link);
}

export function statusOf(error: unknown): { status: number; message: string } | null {
  // A full disk or an exceeded quota while storing an upload or a table: say so instead of a generic failure.
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "ENOSPC" || code === "EDQUOT") return { status: 507, message: "The server has no space left to store this. Nothing was added." };
  if (typeof code === "string" && code.startsWith("Z_")) { const words = readFailureWords(error); if (words) return { status: 400, message: `${words}.` }; }
  if (error instanceof RevisionConflict) return { status: error.status, message: error.message };
  if (error instanceof ExploreBuildInputError) return { status: 422, message: error.message };
  if (error instanceof Error && !(error instanceof ExploreRouteError) && /Unknown kit/.test(error.message)) return { status: 400, message: error.message };
  if (error instanceof ExploreRouteError || error instanceof ExploreAuthorizationError || error instanceof FileLibraryError || error instanceof ExploreReportError || error instanceof ExploreRunError) {
    return { status: error.status, message: error.message };
  }
  if (isImportInputError(error)) return { status: 400, message: (error as Error).message };
  return null;
}

function operationId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^flow_[a-zA-Z0-9_-]{16,80}$/.test(value)) throw new ExploreRouteError(400, "Invalid operation ID.");
  return value;
}

function readJson(request: Request): Promise<Record<string, unknown>> {
  return request.json()
    .then((body) => (body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {}))
    .catch(() => ({}));
}

function requireString(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== "string" || !value.trim()) throw new ExploreRouteError(400, `${field} is required`);
  return value.trim().slice(0, maxLength);
}
function optionalString(value: unknown, maxLength = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}
const MAX_CODE_BYTES = 512 * 1024;

/** Input bindings as the client sends them; every table must belong to the analysis' own scope. */
async function parseBindings(raw: unknown, targetKey: string): Promise<AnalysisInputBinding[]> {
  if (!Array.isArray(raw)) return [];
  const bindings: AnalysisInputBinding[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const alias = typeof (entry as { alias?: unknown }).alias === "string" ? (entry as { alias: string }).alias.trim() : "";
    const datasetId = typeof (entry as { datasetId?: unknown }).datasetId === "string" ? (entry as { datasetId: string }).datasetId : "";
    const versionId = typeof (entry as { versionId?: unknown }).versionId === "string" ? (entry as { versionId: string }).versionId : null;
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(alias) || !datasetId) throw new ExploreRouteError(400, "Each input needs an alias and a datasetId");
    const dataset = await getDatasetRecord(datasetId);
    if (!dataset || dataset.targetKey !== targetKey) throw new ExploreRouteError(400, `Dataset for input ${alias} does not belong to this scope`);
    bindings.push({ alias, datasetId, versionId });
  }
  return bindings;
}
function parseRoles(raw: unknown): ExploreRoleMap {
  if (!raw || typeof raw !== "object") throw new ExploreRouteError(400, "roles is required");
  const roles: ExploreRoleMap = {};
  for (const [role, column] of Object.entries(raw as Record<string, unknown>)) {
    if (!EXPLORE_ROLES.includes(role as ExploreRole)) throw new ExploreRouteError(400, `Unknown role: ${role}`);
    if (typeof column === "string" && column.trim()) roles[role as ExploreRole] = column.trim().slice(0, 120);
  }
  return roles;
}

async function loadReport(session: IntegrationSession, id: string, level: "read" | "write") {
  const record = await getReportRecord(id);
  if (!record) throw new ExploreRouteError(404, "Report not found");
  await requireTargetAccess(session, record.targetKey, level);
  return record;
}

async function loadFlow(session: IntegrationSession, id: string, level: "read" | "write") {
  const record = await getFlowRecord(id);
  if (!record) throw new ExploreRouteError(404, "Flow not found");
  await requireTargetAccess(session, record.targetKey, level);
  return record;
}

async function loadDataset(session: IntegrationSession, id: string, level: "read" | "write") {
  const dataset = await getDatasetRecord(id);
  if (!dataset) throw new ExploreRouteError(404, "Not found");
  await requireTargetAccess(session, dataset.targetKey, level);
  return dataset;
}

/** A step's environment as the client sees it: no prefix paths, the log only as an excerpt. */
function environmentView(state: StepEnvironmentState) {
  return {
    name: state.name, base: state.baseName, derived: state.derived, status: state.status, specHash: state.specHash,
    packages: state.packages.packages, channels: state.packages.channels, lockDigest: state.lockDigest, builtAt: state.builtAt,
    log: state.log ? state.log.split("\n").slice(-20).join("\n").slice(-2000) : null,
    problem: state.problem ?? null,
  };
}

async function loadAnalysis(session: IntegrationSession, id: string, level: "read" | "write") {
  const analysis = await db.exploreAnalysis.findUnique({ where: { id }, select: { id: true, targetKey: true } });
  if (!analysis) throw new ExploreRouteError(404, "Not found");
  await requireTargetAccess(session, analysis.targetKey, level);
  return analysis;
}

async function loadRun(session: IntegrationSession, id: string, level: "read" | "write" = "read") {
  const run = await db.exploreAnalysisRun.findUnique({
    where: { id },
    include: {
      revision: { select: { number: true, code: true, params: true, inputs: true } },
      artifacts: { orderBy: { createdAt: "asc" } },
      analysis: { select: { id: true, name: true, targetKey: true, language: true } },
      _count: { select: { artifacts: true } },
      flowRun: { select: { number: true, outputsPrunedAt: true } },
    },
  });
  if (!run) throw new ExploreRouteError(404, "Not found");
  await requireTargetAccess(session, run.analysis.targetKey, level);
  return run;
}

/** A methods sentence a person accepted: kept with the code revision it describes (D32), and who saved it when. */
async function methodsSentenceOf(analysisId: string, raw: unknown, userId: string, by?: MethodsPerson): Promise<Prisma.InputJsonValue | typeof Prisma.DbNull> {
  if (raw === null) return Prisma.DbNull;
  const value = raw as { text?: unknown; tokens?: unknown; author?: unknown };
  if (!value || typeof value !== "object" || typeof value.text !== "string" || !value.text.trim()) throw flowError("invalid_request", "methodsSentence needs text.");
  if (value.text.length > 1000 || (value.tokens !== undefined && (!Array.isArray(value.tokens) || JSON.stringify(value.tokens).length > 20000))) throw flowError("invalid_request", "The methods sentence is too long.");
  const analysis = await db.exploreAnalysis.findUnique({ where: { id: analysisId }, select: { currentRevisionId: true } });
  // The code it describes (a settings change keeps the code hash; the tokens say which settings it names).
  const revision = analysis?.currentRevisionId ? await db.exploreAnalysisRevision.findUnique({ where: { id: analysis.currentRevisionId }, select: { codeHash: true } }) : null;
  const extra = raw as { prompt?: unknown; notVerified?: unknown };
  return { text: value.text.trim(), tokens: (value.tokens as Prisma.InputJsonValue[] | undefined) ?? [], revisionId: analysis?.currentRevisionId ?? null, ...(revision?.codeHash ? { codeHash: revision.codeHash } : {}),
    ...(typeof extra.prompt === "string" && extra.prompt ? { prompt: extra.prompt.slice(0, 12000) } : {}),
    ...(Array.isArray(extra.notVerified) && extra.notVerified.length ? { notVerified: extra.notVerified.slice(0, 10).map((note) => String(note).slice(0, 300)) } : {}),
    author: value.author === "assistant" ? "assistant" : "person", acceptedById: userId, acceptedAt: new Date().toISOString(), ...methodsAcceptedBy(by),
    // Sheet 94: words kept although the step does something else (◇ until the step or the words change).
    ...(parseMethodsMismatch((raw as { mismatch?: unknown }).mismatch) ? { mismatch: parseMethodsMismatch((raw as { mismatch?: unknown }).mismatch) as Prisma.InputJsonValue } : {}) };
}

/**
 * Explore for the Analysis integration API: `explore/*` under
 * /api/integration/v1. The caller has already verified the bearer token; the
 * scope of every request must be one the session may open, and the Explore
 * module must be on, otherwise the whole surface answers 404. Response
 * shapes match the browser routes so clients share one set of types.
 */
export async function handleExploreRequest(request: NextRequest, session: IntegrationSession, segments: string[], headers: Headers): Promise<Response> {
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
  const query = request.nextUrl.searchParams;
  const method = request.method;
  const [head, id, sub, subId] = segments;
  try {
    if (!(await isExploreModuleEnabled())) throw new ExploreRouteError(404, "Not found");

    // The Flow redesign's routes (recipe, numbered runs, proposals, glosses, values, capsules).
    const flowResponse = await handleFlowRequest({ request, session, segments, json });
    if (flowResponse) return flowResponse;

    if (head === "scopes") {
      if (segments.length === 1 && method === "GET") return json({ scopes: await listFlowStudies(session, { projectId: query.has("projectId") ? query.get("projectId") ?? "" : null }) });
      if (segments.length === 1 && method === "POST") {
        const body = await readJson(request);
        const name = requireString(body.name, "name", STUDY_NAME_MAX);
        const description = typeof body.description === "string" && body.description.trim() ? body.description.trim().slice(0, STUDY_DESCRIPTION_MAX) : null;
        return json({ scope: await createFlowStudy(session, name, description, { projectId: body.projectId, visibility: body.visibility }) }, 201);
      }
      if (segments.length === 2 && method === "PATCH") {
        const body = await readJson(request);
        const changes: { name?: string; description?: string | null } = {};
        if (body.name !== undefined) changes.name = requireString(body.name, "name", STUDY_NAME_MAX);
        if (body.description !== undefined) changes.description = typeof body.description === "string" && body.description.trim() ? body.description.trim().slice(0, STUDY_DESCRIPTION_MAX) : null;
        return json({ scope: await updateFlowStudy(session, id, changes, { projectId: body.projectId }) });
      }
    }

    if (head === "files") {
      if (segments.length === 1 && method === "GET") {
        const targetKey = query.get("targetKey") ?? "";
        const access = await resolveTargetAccess(session, targetKey);
        if (!access.target || access.level === "none") throw new ExploreAuthorizationError(404, "Not found");
        return json({ files: await listLibraryFiles(targetKey), canEdit: access.level === "write" });
      }
      if (segments.length === 1 && method === "POST") {
        if (Number(request.headers.get("content-length")) > MAX_LIBRARY_FILE_BYTES + 1024 * 1024) throw new FileLibraryError(413, "Files must be 100 MB or smaller.");
        const form = await request.formData();
        const targetKey = String(form.get("targetKey") ?? "");
        await requireTargetAccess(session, targetKey, "write");
        const file = form.get("file");
        if (!(file instanceof File)) throw new FileLibraryError(400, "Choose a file to upload.");
        const stored = await storeLibraryFile({ file, targetKey, createdById: session.user.id });
        return json({ file: { id: stored.id, originalName: stored.originalName } }, 201);
      }
      if (segments.length === 2 && id === "stream" && method === "POST") {
        // The raw body is the file (no multipart): streamed to disk, hashed on the way, never held in memory.
        const targetKey = query.get("targetKey") ?? "";
        await requireTargetAccess(session, targetKey, "write");
        if (!request.body) throw new FileLibraryError(400, "Choose a file to upload.");
        const stored = await storeLibraryFileStream({ targetKey, name: query.get("name") ?? "file", mimeType: request.headers.get("content-type"), body: request.body as unknown as AsyncIterable<Uint8Array>, createdById: session.user.id });
        return json({ file: { id: stored.id, originalName: stored.originalName, sizeBytes: Number(stored.sizeBytes) } }, 201);
      }
      if (segments.length === 2 && method === "GET") {
        const file = await getLibraryFile(id);
        await requireTargetAccess(session, file.targetKey, "read");
        if (query.get("download") === "1") {
          const bytes = await readLibraryFile(file);
          const combined = new Headers(headers);
          combined.set("Content-Type", "application/octet-stream");
          combined.set("Content-Length", String(bytes.length));
          combined.set("Content-Disposition", `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`);
          combined.set("X-Content-Type-Options", "nosniff");
          return new NextResponse(new Uint8Array(bytes), { headers: combined });
        }
        const files = await listLibraryFiles(file.targetKey);
        return json({ file: files.find((entry) => entry.id === id) ?? null });
      }
      if (segments.length === 2 && method === "PATCH") {
        const file = await getLibraryFile(id);
        await requireTargetAccess(session, file.targetKey, "write");
        const body = await readJson(request);
        const changes: { description?: string | null; tags?: string[]; sensitivity?: ExploreSensitivity } = {};
        if (body.description !== undefined) changes.description = optionalString(body.description, MAX_FILE_DESCRIPTION_LENGTH);
        if (body.tags !== undefined) {
          if (!Array.isArray(body.tags)) throw new ExploreRouteError(400, "tags must be a list");
          changes.tags = normalizeFileTags(body.tags);
        }
        if (body.sensitivity !== undefined) {
          if (!EXPLORE_SENSITIVITIES.includes(body.sensitivity as ExploreSensitivity)) throw new ExploreRouteError(400, "Unknown sensitivity");
          changes.sensitivity = body.sensitivity as ExploreSensitivity;
        }
        return json({ file: await updateLibraryFile(file.id, changes) });
      }
      if (segments.length === 2 && method === "DELETE") {
        const file = await getLibraryFile(id);
        await requireTargetAccess(session, file.targetKey, "write");
        await removeLibraryFile(file.id, session.user.id);
        return json({ deleted: true });
      }
    }

    if (head === "reports") {
      if (segments.length === 1 && method === "GET") {
        const targetKey = query.get("targetKey") ?? "";
        const access = await resolveTargetAccess(session, targetKey);
        if (!access.target || access.level === "none") throw new ExploreAuthorizationError(404, "Not found");
        const reports = await listReports(targetKey);
        const reviews = await reviewSummaries(reports.map((report) => report.id)).catch(() => new Map<string, { checks: Record<string, { by: string; at: string }>; version: number }>());
        return json({ reports: reports.map((report) => { const review = reviews.get(report.id); return review ? { ...report, review } : report; }), canEdit: access.level === "write" });
      }
      if (segments.length === 1 && method === "POST") {
        const body = await readJson(request);
        const targetKey = requireString(body.targetKey, "targetKey");
        await requireTargetAccess(session, targetKey, "write");
        const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 200) : null;
        return json({ report: await createReport(targetKey, session.user.id, title) }, 201);
      }
      if (segments.length === 2) {
        if (method === "GET") {
          const record = await loadReport(session, id, "read");
          return json({ report: await getReportView(record.id, FLOW_REPORT_VIEW) });
        }
        if (method === "PUT") {
          const record = await loadReport(session, id, "write");
          return json({ report: await saveReport(record.id, await readJson(request), FLOW_REPORT_VIEW) });
        }
        if (method === "PATCH") {
          const record = await loadReport(session, id, "write");
          const body = await readJson(request);
          return json({ report: await renameReport(record.id, requireString(body.title, "title", 200)) });
        }
        if (method === "DELETE") {
          const record = await loadReport(session, id, "write");
          await deleteReport(record.id);
          return json({ deleted: true });
        }
      }
      // The review of a page: section checks and versions, shared by every browser (report-review.ts).
      if (segments.length >= 3 && sub === "review") {
        const part = segments[3];
        if (segments.length === 3 && method === "GET") {
          const record = await loadReport(session, id, "read");
          return json({ review: await getReportReview(record.id) });
        }
        if (segments.length === 4 && part === "checks" && method === "PATCH") {
          const record = await loadReport(session, id, "write");
          const body = await readJson(request);
          if (!body.checks || typeof body.checks !== "object" || Array.isArray(body.checks)) throw new ExploreRouteError(400, "checks must be an object");
          return json({ review: await changeReportChecks(record.id, body.checks as Record<string, unknown>) });
        }
        if (segments.length === 4 && part === "versions" && method === "POST") {
          const record = await loadReport(session, id, "write");
          try { return json(await recordReportVersion(record.id, await readJson(request)), 201); }
          catch (error) { if (error instanceof ReportReviewError) throw new ExploreRouteError(error.status, error.message); throw error; }
        }
        if (segments.length === 4 && part === "import" && method === "POST") {
          const record = await loadReport(session, id, "write");
          return json({ review: await importReportReview(record.id, await readJson(request)) });
        }
      }
      if (segments.length === 3 && sub === "files") {
        if (method === "GET") {
          const record = await loadReport(session, id, "read");
          const files = await listLibraryFiles(record.targetKey);
          return json({ files: files.flatMap((file) => {
            const usage = file.reports.find((entry) => entry.id === record.id);
            return usage ? [{ ...file, attached: usage.attached, usedInReport: usage.usedInReport }] : [];
          }) });
        }
        if (method === "POST") {
          const record = await loadReport(session, id, "write");
          const body = await readJson(request);
          const file = await getLibraryFile(requireString(body.fileId, "fileId"));
          if (file.targetKey !== record.targetKey) throw new ExploreRouteError(400, "Choose a file from this report's workspace.");
          await db.exploreReportFile.upsert({
            where: { reportId_fileId: { reportId: record.id, fileId: file.id } },
            create: { reportId: record.id, fileId: file.id }, update: {},
          });
          return json({ linked: true });
        }
        if (method === "DELETE") {
          const record = await loadReport(session, id, "write");
          const fileId = requireString(query.get("fileId"), "fileId");
          await db.exploreReportFile.deleteMany({ where: { reportId: record.id, fileId } });
          return json({ unlinked: true });
        }
      }
      if (segments.length === 3 && sub === "share") {
        const record = await loadReport(session, id, "write");
        // The public page lives on this server; the link is absolute so the client can hand it on as is.
        const shareUrl = (token: string) => new URL(`/share/reports/${token}`, request.nextUrl.origin).toString();
        if (method === "POST") {
          const body = await readJson(request).catch(() => ({} as Record<string, unknown>));
          const share = await shareReport(record.id, body.mode === undefined ? undefined : shareModeOf(body.mode));
          return json({ share, url: shareUrl(share.token) }, 201);
        }
        if (method === "PATCH") {
          const body = await readJson(request);
          const share = await setShareMode(record.id, shareModeOf(body.mode));
          return json({ share, url: shareUrl(share.token) });
        }
        if (method === "DELETE") {
          await unshareReport(record.id);
          return json({ share: null, url: null });
        }
      }
      if (segments.length === 3 && sub === "export" && method === "GET") {
        const record = await loadReport(session, id, "read");
        const { html, title } = await renderReportHtml(record.id, { plotly: "inline", view: FLOW_REPORT_VIEW });
        const combined = new Headers(headers);
        combined.set("Content-Type", "text/html; charset=utf-8");
        combined.set("Content-Disposition", `attachment; filename="report.html"; filename*=UTF-8''${encodeURIComponent(`${title.replace(/[\\/:*?"<>|]+/g, "-").trim() || "report"}.html`)}`);
        combined.set("X-Content-Type-Options", "nosniff");
        return new NextResponse(html, { headers: combined });
      }
      if (segments.length === 3 && sub === "reset" && method === "POST") {
        const record = await loadReport(session, id, "write");
        return json({ report: await resetReport(record.id, FLOW_REPORT_VIEW) });
      }
    }

    if (head === "datasets") {
      if (segments.length === 2 && id === "import" && method === "POST") {
        const form = await request.formData();
        const result = await importDatasetFromForm(session, form, query.get("preview") === "1", { background: query.get("background") === "1" });
        return json(result.body, result.status);
      }
      if (segments.length === 3 && id === "imports" && (method === "GET" || method === "DELETE")) {
        const job = getImportJob(sub);
        if (!job) throw new ExploreRouteError(404, "Import not found");
        await requireTargetAccess(session, job.targetKey, method === "GET" ? "read" : "write");
        if (method === "DELETE") cancelImportJob(job);
        return json({ job: serializeImportJob(job) });
      }
      if (segments.length === 1 && method === "GET") {
        const targetKey = query.get("targetKey") ?? "";
        await requireTargetAccess(session, targetKey, "read");
        return json({ datasets: await listDatasets(targetKey, { lean: query.get("lean") === "1" }) });
      }
      if (segments.length === 2 && method === "GET") {
        await loadDataset(session, id, "read");
        return json({ dataset: await getDatasetDetail(id) });
      }
      if (segments.length === 2 && method === "DELETE") {
        await loadDataset(session, id, "write");
        await deleteDataset(id);
        return json({ ok: true });
      }
      if (segments.length === 2 && method === "PATCH") {
        await loadDataset(session, id, "write");
        const body = await readJson(request);
        await updateDatasetRoles(id, parseRoles(body.roles));
        return json({ dataset: await getDatasetDetail(id) });
      }
      if (segments.length === 3 && ((sub === "table" && method === "PATCH") || (sub === "copy" && method === "POST"))) {
        await loadDataset(session, id, "write");
        return json(await editTable(id, session.user.id, await readJson(request), sub === "copy"));
      }
      if (segments.length === 4 && sub === "table" && segments[3] === "download" && method === "GET") {
        // The table, or the current view of it (search, filters, sort), streamed as a file.
        const dataset = await loadDataset(session, id, "read");
        const version = dataset.versions.find((entry) => entry.id === (query.get("versionId") ?? dataset.currentVersionId)) ?? dataset.versions[0] ?? null;
        if (!version) throw new ExploreRouteError(404, "This table has no rows yet.");
        const format = query.get("format") === "csv" ? "csv" : "tsv";
        const download = await openTableDownload(version, await listActiveEdits(dataset.id), { columns: query.get("columns"), search: query.get("q"), sort: query.get("sort"), filters: query.get("filters"), format, signal: request.signal })
          .catch((error) => { throw error instanceof QueryInputError ? new ExploreRouteError(400, error.message) : error; });
        const combined = new Headers(headers);
        combined.set("Content-Type", download.contentType);
        const base = (dataset.name || "table").replace(/[\\/:*?"<>|]+/g, "-").trim() || "table";
        combined.set("Content-Disposition", `attachment; filename="download.${download.extension}"; filename*=UTF-8''${encodeURIComponent(`${base}.${download.extension}`)}`);
        combined.set("X-Content-Type-Options", "nosniff");
        if (download.rows !== null) combined.set("X-Table-Rows", String(download.rows));
        if (download.limited) combined.set("X-Table-Limited", download.limited);
        return new NextResponse(Readable.toWeb(Readable.from((async function* () { for await (const chunk of download.body) yield typeof chunk === "string" ? Buffer.from(chunk) : chunk; })(), { objectMode: false })) as ReadableStream, { headers: combined });
      }
      if (segments.length === 3 && sub === "table" && method === "GET") {
        const dataset = await loadDataset(session, id, "read");
        const artifactId = query.get("artifactId");
        const original = artifactId ? await db.exploreArtifact.findFirst({ where: { id: artifactId, derivedDatasetId: id }, select: { derivedVersionId: true } }) : null;
        const current = artifactId
          ? await db.exploreDatasetVersion.findFirst({ where: { datasetId: id, ...(original?.derivedVersionId ? { id: original.derivedVersionId } : { provenance: { contains: artifactId } }) }, orderBy: { number: "asc" } })
          : query.get("versionId") ? await db.exploreDatasetVersion.findFirst({ where: { datasetId: id, id: query.get("versionId")! } }) : dataset.versions.find((version) => version.id === dataset.currentVersionId) ?? dataset.versions[0] ?? null;
        if (query.get("versionId") && !current) throw new ExploreRouteError(404, "Input version not found.");
        if (artifactId && (!current || (!original?.derivedVersionId && !JSON.stringify(JSON.parse(current.provenance)).includes(JSON.stringify(artifactId))))) throw new ExploreRouteError(404, "The original result table is unavailable.");
        const activeEdits = artifactId ? [] : await listActiveEdits(dataset.id);
        const limitParam = Number.parseInt(query.get("limit") ?? "", 10);
        // A page, not the table: rows from the cursor on, bounded by a cell budget so a wide table gives fewer rows.
        const page = await readTablePage(current, activeEdits, {
          columns: query.get("columns"), limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 100_000,
          cursor: query.get("cursor"), search: query.get("q"), sort: query.get("sort"), filters: query.get("filters"), signal: request.signal,
        }).catch((error) => { throw error instanceof QueryInputError ? new ExploreRouteError(400, error.message) : error; });
        return json({ datasetId: dataset.id, inputToken: current ? inputToken(current.id, activeEdits) : null, version: current?.number ?? null, versionId: current?.id ?? null,
          editable: !artifactId && dataset.kind === "external" && activeEdits.length === 0 && !page.fileBacked, rowEntity: page.rowEntity, ...page.body });
      }
      if (segments.length === 3 && sub === "rows" && method === "GET") {
        const dataset = await loadDataset(session, id, "read");
        const versionId = dataset.currentVersionId ?? dataset.versions[0]?.id ?? null;
        const limit = Number.parseInt(query.get("limit") ?? "", 10);
        const [page, edits, cacheToken] = await Promise.all([
          versionId
            ? fetchDatasetRows(versionId, { cursor: query.get("cursor"), limit: Number.isFinite(limit) ? limit : undefined, sampleId: query.get("sampleId"), subjectId: query.get("subjectId"), key: query.get("key") })
            : Promise.resolve({ rows: [], nextCursor: null, total: 0 }),
          listActiveEdits(id),
          computeDatasetCacheToken(id),
        ]);
        const rows = applyEditsToRows(page.rows, edits, { includeExcluded: query.get("includeExcluded") === "1" });
        return json({ rows, nextCursor: page.nextCursor, total: page.total, cacheToken });
      }
    }

    if (head === "flows") {
      if (segments.length === 1 && method === "GET" && query.has("projectId") && !query.get("targetKey")) {
        // Every flow of the studies that belong to one project (explore.projects).
        const studies = await listFlowStudies(session, { projectId: query.get("projectId") ?? "" });
        const flows = (await Promise.all(studies.map(async (study) => (await listFlows(study.targetKey)).map((flow) => ({ ...flow, projectId: study.projectId, visibility: study.visibility }))))).flat();
        return json({ flows, canEdit: studyAccess(session) === "write" });
      }
      if (segments.length === 1 && method === "GET") {
        const targetKey = query.get("targetKey") ?? "";
        const access = await resolveTargetAccess(session, targetKey);
        if (!access.target || access.level === "none") throw new ExploreAuthorizationError(404, "Not found");
        const link = await db.integrationExploreScope.findFirst({ where: { authority: session.integration.authority, workspaceId: session.integration.workspaceId, targetKey }, select: { projectId: true, visibility: true } });
        return json({ flows: (await listFlows(targetKey)).map((flow) => ({ ...flow, projectId: link?.projectId ?? "", visibility: link?.visibility === "private" ? "private" : "lab" })), canEdit: access.level === "write" });
      }
      if (segments.length === 1 && method === "POST") {
        const body = await readJson(request);
        const targetKey = requireString(body.targetKey, "targetKey");
        await requireTargetAccess(session, targetKey, "write");
        const flow = await createFlow(targetKey, session.user.id, optionalString(body.name, 200), optionalString(body.description), session.integration.memberId || null);
        await flowChanged(flow.id);
        return json({ flow }, 201);
      }
      if (segments.length === 2) {
        if (method === "GET") {
          const record = await loadFlow(session, id, "read");
          return json({ flow: await getFlow(record.id) });
        }
        if (method === "PATCH") {
          const record = await loadFlow(session, id, "write");
          const body = await readJson(request);
          const changes: { name?: string; description?: string | null } = {};
          if (body.name !== undefined) changes.name = requireString(body.name, "name", 200);
          if (body.description !== undefined) changes.description = optionalString(body.description);
          const flow = await updateFlow(record.id, changes);
          await flowChanged(record.id);
          return json({ flow });
        }
        if (method === "DELETE") {
          const record = await loadFlow(session, id, "write");
          const removal = await prepareFlowRemoval(record.id, record.targetKey).catch(() => null);
          await deleteFlow(record.id);
          await removal?.().catch((error) => console.error("[flow] could not queue the removal", record.id, error));
          // The files go in the background; the monitor retries what this pass leaves.
          void processCleanupJobs().catch((error) => console.error("[flow] file cleanup failed", record.id, error));
          return json({ deleted: true });
        }
      }
    }

    if (head === "flows" && segments.length === 3 && sub === "citations" && method === "GET") {
      await loadFlow(session, id, "read");
      const { reports, holds } = await flowCitations(id);
      return json({ reports, holds, deletable: !reports.length && !holds.length });
    }

    if (head === "housekeeping") {
      // Counts for Data › a project: earlier runs, how many of them may be pruned, how many were.
      if (segments.length === 1 && method === "GET") {
        const targetKey = query.get("targetKey") ?? "";
        await requireTargetAccess(session, targetKey, "read");
        return json(await housekeepingCounts(targetKey));
      }
      // Prune now: a dry run lists what would go (anyone who can read the study); pruning is for admins.
      if (segments.length === 2 && id === "prune" && method === "POST") {
        const body = (await request.json().catch(() => ({}))) as { targetKey?: unknown; dryRun?: unknown; olderThanDays?: unknown };
        const targetKey = typeof body.targetKey === "string" && body.targetKey ? body.targetKey : null;
        const dryRun = body.dryRun !== false;
        if (targetKey) await requireTargetAccess(session, targetKey, dryRun ? "read" : "write");
        if (!dryRun || !targetKey) {
          if ((session.user as { role?: string }).role !== "FACILITY_ADMIN") throw new ExploreRouteError(403, "Pruning run outputs is for facility admins.");
        }
        const olderThanDays = typeof body.olderThanDays === "number" ? body.olderThanDays : undefined;
        const result = await pruneRuns({ targetKey, dryRun, olderThanDays });
        if (!dryRun) void processCleanupJobs().catch((error) => console.error("[housekeeping] file cleanup failed", error));
        return json(result);
      }
    }

    if (head === "analyses") {
      if (segments.length === 1 && method === "GET") {
        const targetKey = query.get("targetKey") ?? "";
        await requireTargetAccess(session, targetKey, "read");
        return json({ analyses: await listAnalyses(targetKey, query.get("reportId") || null, query.get("flowId") || null) });
      }
      if (segments.length === 1 && method === "POST") {
        const body = await readJson(request);
        const targetKey = requireString(body.targetKey, "targetKey");
        await requireTargetAccess(session, targetKey, "write");
        const analysis = await createAnalysis({
          targetKey, name: optionalString(body.name, 200), description: optionalString(body.description), kitId: optionalString(body.kitId, 80),
          reportId: optionalString(body.reportId, 80), flowId: optionalString(body.flowId, 80), language: analysisLanguageOf(body.language), environmentName: optionalString(body.environmentName, 120),
          inputs: await parseBindings(body.inputs, targetKey), fileInputs: await validateFileBindings(body.fileInputs, targetKey),
          params: body.params && typeof body.params === "object" ? (body.params as Record<string, unknown>) : undefined, createdById: session.user.id,
          createdByMemberId: session.integration.memberId || null,
        });
        return json({ analysis }, 201);
      }
      if (segments.length === 2 && method === "GET") {
        await loadAnalysis(session, id, "read");
        const analysis = await getAnalysisDetail(id);
        if (!analysis) throw new ExploreRouteError(404, "Not found");
        return json({ analysis });
      }
      if (segments.length === 2 && method === "PATCH") {
        await loadAnalysis(session, id, "write");
        const body = await readJson(request);
        const data: { name?: string; description?: string | null; descriptionRevisionId?: string | null; environmentName?: string } = {};
        const name = optionalString(body.name, 200);
        if (name) data.name = name;
        // A description written by a person clears the revision mark; the assistant sends the revision it read.
        if ("description" in body) { data.description = optionalString(body.description); data.descriptionRevisionId = optionalString(body.descriptionRevisionId, 64) ?? null; }
        const environmentName = optionalString(body.environmentName, 120);
        if (environmentName) data.environmentName = environmentName;
        // Flow recipe fields (explore.recipe): purpose, the meaning of settings, the accepted methods sentence.
        const flowFields: Parameters<typeof updateAnalysis>[1] = {};
        if ("purpose" in body) flowFields.purpose = optionalString(body.purpose, 200);
        if ("paramMeta" in body) { const meta = parseParamMeta(body.paramMeta); flowFields.paramMeta = meta === null ? Prisma.DbNull : meta as Prisma.InputJsonValue; }
        if ("methodsSentence" in body) flowFields.methodsSentence = await methodsSentenceOf(id, body.methodsSentence, session.user.id, { memberId: session.integration.memberId || null, name: session.user.name ?? null });
        await updateAnalysis(id, { ...data, ...flowFields });
        return json({ analysis: await getAnalysisDetail(id) });
      }
      if (segments.length === 2 && method === "DELETE") {
        await loadAnalysis(session, id, "write");
        // A step of a recipe run still going stays until the run ends or is stopped (as the demo says it).
        const busy = await db.exploreAnalysisRun.count({ where: { analysisId: id, flowRunId: { not: null }, status: { in: ["pending", "queued", "running"] } } });
        if (busy) throw new ExploreRouteError(409, "This step is running. Stop the run before removing it.");
        await deleteAnalysis(id, { userId: session.user.id, memberId: session.integration.memberId || null });
        return json({ ok: true });
      }
      if (segments.length === 3 && sub === "conversation" && (method === "GET" || method === "PUT")) {
        await loadAnalysis(session, id, method === "GET" ? "read" : "write");
        const where = { analysisId_userId: { analysisId: id, userId: session.user.id } };
        if (method === "GET") {
          const saved = await db.exploreStepConversation.findUnique({ where });
          return json({ version: saved?.version ?? 0, state: saved ? JSON.parse(saved.state) : null });
        }
        const body = await readJson(request);
        const state = JSON.stringify(body.state);
        if (!Number.isSafeInteger(body.version) || Number(body.version) < 0 || !state || state.length > 800000 || !body.state || typeof body.state !== "object" || Array.isArray(body.state)) throw new ExploreRouteError(400, "Invalid conversation.");
        // A stale tab cannot replace another tab's messages or checkpoint.
        if (body.version === 0) {
          try { await db.exploreStepConversation.create({ data: { analysisId: id, userId: session.user.id, version: 1, state } }); }
          catch (error) { if ((error as { code?: string }).code === "P2002") throw new ExploreRouteError(409, "This conversation changed in another tab. Reopen the step to continue."); throw error; }
        } else {
          const saved = await db.exploreStepConversation.updateMany({ where: { analysisId: id, userId: session.user.id, version: Number(body.version) }, data: { state, version: { increment: 1 } } });
          if (saved.count !== 1) throw new ExploreRouteError(409, "This conversation changed in another tab. Reopen the step to continue.");
        }
        return json({ version: Number(body.version) + 1 });
      }
      // explore.packages: a step's extra conda packages, its effective environment and a "prepare now".
      if (segments.length === 3 && sub === "packages" && (method === "GET" || method === "PUT")) {
        await loadAnalysis(session, id, method === "GET" ? "read" : "write");
        if (method === "PUT") {
          const body = await readJson(request);
          let packages;
          try { packages = normalizeStepPackages({ packages: body.packages ?? [], channels: body.channels ?? [] }); }
          catch (error) { if (error instanceof PackageSpecError) throw new ExploreRouteError(400, error.message); throw error; }
          // Optional optimistic concurrency: the packages the edit started from must still be the step's.
          if (body.expected !== undefined) {
            const stored = await db.exploreAnalysis.findUnique({ where: { id }, select: { packages: true } });
            const now = stepPackagesOf(stored?.packages);
            let expected;
            try { expected = normalizeStepPackages({ packages: (body.expected as Record<string, unknown> | null)?.packages ?? [], channels: (body.expected as Record<string, unknown> | null)?.channels ?? [] }); }
            catch { throw new ExploreRouteError(400, "Invalid expected packages."); }
            const channelsNamed = Array.isArray((body.expected as Record<string, unknown> | null)?.channels);
            if (JSON.stringify(expected.packages) !== JSON.stringify(now.packages) || (channelsNamed && JSON.stringify(expected.channels) !== JSON.stringify(now.channels))) throw packagesConflictError(id, now);
          }
          await db.exploreAnalysis.update({ where: { id }, data: { packages: packages.packages.length ? (packages as unknown as Prisma.InputJsonValue) : Prisma.DbNull } });
        }
        const step = await db.exploreAnalysis.findUnique({ where: { id }, select: { environmentName: true, packages: true } });
        if (!step) throw new ExploreRouteError(404, "Not found");
        return json({ ...stepPackagesOf(step.packages), base: step.environmentName, environment: environmentView(await resolveStepEnvironment(step)) });
      }
      if (segments.length === 3 && sub === "environment" && method === "GET") {
        await loadAnalysis(session, id, "read");
        const step = await db.exploreAnalysis.findUnique({ where: { id }, select: { environmentName: true, packages: true } });
        if (!step) throw new ExploreRouteError(404, "Not found");
        return json({ environment: environmentView(await resolveStepEnvironment(step)) });
      }
      if (segments.length === 4 && sub === "environment" && subId === "prepare" && method === "POST") {
        await loadAnalysis(session, id, "write");
        const step = await db.exploreAnalysis.findUnique({ where: { id }, select: { environmentName: true, packages: true } });
        if (!step) throw new ExploreRouteError(404, "Not found");
        const state = await prepareStepEnvironment(step, { retryFailed: true });
        return json({ environment: environmentView(state) }, state.status === "building" ? 202 : 200);
      }
      if (segments.length === 3 && sub === "revisions" && method === "GET") {
        await loadAnalysis(session, id, "read");
        const analysis = await getAnalysisDetail(id);
        if (!analysis) throw new ExploreRouteError(404, "Not found");
        return json({ revisions: analysis.revisions });
      }
      if (segments.length === 3 && sub === "revisions" && method === "POST") {
        const analysis = await loadAnalysis(session, id, "write");
        const body = await readJson(request);
        // A pipeline step has settings, not code: a settings save goes through the pipeline's own checks.
        const pipelineStep = await db.exploreAnalysis.findUnique({ where: { id } });
        if ((pipelineStep as { stepKind?: unknown } | null)?.stepKind === "pipeline" && pipelineStep?.flowId) {
          if (body.code !== undefined || body.inputs !== undefined || body.fileInputs !== undefined) throw new ExploreRouteError(400, "A pipeline step has no code; change its settings.", "invalid_request");
          const { updatePipelineStep } = await import("@/lib/explore/pipeline-steps");
          const expected = optionalString(body.expectedRevisionId, 80) ?? undefined;
          await updatePipelineStep(pipelineStep.flowId, id, { params: body.params && typeof body.params === "object" && !Array.isArray(body.params) ? (body.params as Record<string, unknown>) : {}, replaceParams: true, expectedRevisionId: expected,
            message: optionalString(body.message, 500), actor: { userId: session.user.id, memberId: session.integration.memberId || null } });
          await flowChanged(pipelineStep.flowId);
          const detail = await getAnalysisDetail(id);
          return json({ revision: detail?.currentRevision ?? null }, 201);
        }
        const code = typeof body.code === "string" ? body.code : undefined;
        if (code !== undefined && Buffer.byteLength(code, "utf8") > MAX_CODE_BYTES) throw new ExploreRouteError(400, "The code is larger than 512 KB");
        const expectedRevisionId = optionalString(body.expectedRevisionId, 80) ?? undefined;
        const revision = await createRevision({
          analysisId: id, expectedRevisionId, revisionId: operationId(body.revisionId), code, params: body.params && typeof body.params === "object" ? (body.params as Record<string, unknown>) : undefined,
          inputs: body.inputs === undefined ? undefined : await parseBindings(body.inputs, analysis.targetKey),
          fileInputs: body.fileInputs === undefined ? undefined : await validateFileBindings(body.fileInputs, analysis.targetKey),
          // A client marks code the assistant drafted for the user as agent-written and keeps the request it came from.
          author: body.author === "agent" ? "agent" : "user", authorUserId: session.user.id, authorMemberId: session.integration.memberId || null, message: optionalString(body.message, 500), prompt: body.author === "agent" ? optionalString(body.prompt, 4000) ?? null : null,
        }).catch(async (error) => {
          // A save based on an older revision of this step names both revisions, so the page can show what changed.
          if (error instanceof RevisionConflict && expectedRevisionId) throw await stepConflictError(id, expectedRevisionId, error.message);
          throw error;
        });
        return json({ revision }, 201);
      }
      if (segments.length === 3 && sub === "runs" && method === "GET") {
        await loadAnalysis(session, id, "read");
        return json({ runs: await listRuns(id) });
      }
      if (segments.length === 3 && sub === "runs" && method === "POST") {
        await loadAnalysis(session, id, "write");
        const body = await readJson(request);
        if (body.inputTokens !== undefined && (!body.inputTokens || typeof body.inputTokens !== "object" || Array.isArray(body.inputTokens) || Object.entries(body.inputTokens).some(([key, value]) => key.length > 100 || typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)))) throw new ExploreRouteError(400, "Invalid input snapshot.");
        const run = await createAndStartRun({ analysisId: id, inputTokens: body.inputTokens as Record<string, string> | undefined, runId: operationId(body.runId), revisionId: optionalString(body.revisionId, 80),
          executionMode: body.executionMode === "local" || body.executionMode === "slurm" ? body.executionMode : "default", createdById: session.user.id });
        return json({ run }, 201);
      }
    }

    if (head === "runs" && segments.length === 3 && sub === "logs" && method === "GET") {
      const run = await loadRun(session, id);
      const lines = Math.min(Math.max(Number.parseInt(query.get("lines") ?? "200", 10) || 200, 20), 2000);
      const [outputTail, errorTail] = run.runFolder
        ? await Promise.all([readTail(path.join(run.runFolder, "logs", "pipeline.out"), lines), readTail(path.join(run.runFolder, "logs", "pipeline.err"), lines)])
        : [null, null];
      return json({ status: run.status, outputTail: outputTail ?? run.outputTail, errorTail: errorTail ?? run.errorTail });
    }
    if (head === "runs" && segments.length === 3 && sub === "cancel" && method === "POST") {
      await loadRun(session, id, "write");
      const cancelled = await cancelRun(id);
      return json({ cancelled }, cancelled ? 200 : 409);
    }
    if (head === "runs" && segments.length === 3 && sub === "cascade" && method === "POST") {
      await loadRun(session, id, "write");
      return json(await cascadeFromRun(id, session.user.id));
    }
    if (head === "kits" && segments.length === 1 && method === "GET") {
      requireExplorePrincipal(session);
      const { kits, problems } = await loadKits();
      return json({ kits: kits.map(serializeKit), problems });
    }
    if (head === "environments" && segments.length === 2 && id === "bases" && method === "GET") {
      requireExplorePrincipal(session);
      return json({ bases: await listBaseEnvironments() });
    }
    if (head === "environments" && segments.length === 1 && method === "GET") {
      requireExplorePrincipal(session);
      return json({ environments: await listEnvironments() });
    }
    if (head === "sandbox" && segments.length === 1 && method === "GET") {
      requireExplorePrincipal(session);
      const [settings, facts] = await Promise.all([getSandboxSettings(), collectHostFacts()]);
      return json({ settings, host: { platform: facts.platform, tool: facts.toolName, problem: facts.problem } });
    }

    if (head === "runs" && segments.length === 2 && method === "GET") {
      const run = await loadRun(session, id);
      let results: unknown = null;
      try { results = run.results ? JSON.parse(run.results) : null; } catch { results = null; }
      const currentRuntime = currentRuntimeFingerprint();
      // Runs finalized before the results runtime was versioned read as current when their helper matches.
      if (results && typeof results === "object" && (results as { runtime?: unknown }).runtime) {
        results = { ...(results as Record<string, unknown>), runtime: runtimeOfResults(run.results, currentRuntime) };
      }
      const isolation = await readRunIsolation(run.runFolder);
      return json({ run: {
        ...serializeRun(run),
        analysis: run.analysis,
        results,
        // The finalizer code on disk now: results.runtime.finalizer differing from it means an older monitor finished the run.
        currentRuntime,
        isolation: isolation ? { ...isolation, summary: summarizeIsolation(isolation) } : null,
        outputTail: run.outputTail,
        errorTail: run.errorTail,
        code: run.revision.code,
        // Housekeeping removed the files; the list, names and checksums stay for provenance.
        outputsPrunedAt: run.flowRun?.outputsPrunedAt?.toISOString() ?? null,
        artifacts: run.artifacts.map((artifact) => ({
          id: artifact.id, kind: artifact.kind, format: artifact.format, name: artifact.name,
          fileName: artifact.path.split("/").pop(),
          size: artifact.size === null ? null : Number(artifact.size),
          derivedDatasetId: artifact.derivedDatasetId, checksum: artifact.checksum,
          // Relative to the integration base; the client adds the bearer.
          url: `explore/runs/${run.id}/artifacts/${artifact.id}`,
        })),
      } });
    }

    if (head === "runs" && segments.length === 4 && sub === "artifacts" && method === "GET") {
      const run = await loadRun(session, id);
      const artifact = await db.exploreArtifact.findFirst({ where: { id: subId, runId: id } });
      if (!artifact || !run.runFolder) throw new ExploreRouteError(404, "Not found");
      const filePath = await resolveContainedPath(run.runFolder, artifact.path).catch(() => null);
      if (!filePath) throw new ExploreRouteError(404, "Not found");
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat?.isFile() && run.flowRun?.outputsPrunedAt) throw new ExploreRouteError(410, `Outputs pruned on ${run.flowRun.outputsPrunedAt.toISOString().slice(0, 10)}; the checksum stays on record.`);
      if (!stat?.isFile()) throw new ExploreRouteError(404, "Not found");
      const combined = new Headers(headers);
      combined.set("Content-Type", ARTIFACT_CONTENT_TYPES[artifact.format] ?? "application/octet-stream");
      combined.set("Content-Length", String(stat.size));
      combined.set("Cache-Control", "private, max-age=60");
      combined.set("X-Content-Type-Options", "nosniff");
      const fileName = path.basename(filePath).replace(/[^A-Za-z0-9._-]+/g, "_");
      combined.set("Content-Disposition", `${query.get("download") === "1" ? "attachment" : "inline"}; filename="${fileName}"`);
      if (artifact.format === "html" || artifact.format === "svg") {
        combined.set("Content-Security-Policy", "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; sandbox allow-scripts");
      }
      return new NextResponse(Readable.toWeb(createReadStream(filePath)) as ReadableStream, { headers: combined });
    }

    if (head === "canvas" && segments.length === 1 && method === "GET") {
      const targetKey = query.get("targetKey") ?? "";
      await requireTargetAccess(session, targetKey, "read");
      return json(await loadCanvasGraph(targetKey, query.get("reportId") || null, query.get("flowId") || null));
    }

    return json({ error: "Unknown Flow operation." }, 404);
  } catch (error) {
    if (error instanceof IntegrationAccessError) return json({ error: error.message }, error.status);
    const known = statusOf(error);
    // Flow routes send a machine-readable code (SERVER-API "Flow (analysis service)"); older routes keep {error}.
    if (known && error instanceof ExploreRouteError && error.code) return json({ ...(error.extra ?? {}), error: known.message, code: error.code }, known.status);
    if (known && isFlowPath(segments)) return json({ error: known.message, code: codeForStatus(known.status) }, known.status);
    if (known) return json({ error: known.message }, known.status);
    console.error("[Analysis integration] Flow request failed", error);
    return json({ error: "The Analysis service is unavailable." }, 503);
  }
}
