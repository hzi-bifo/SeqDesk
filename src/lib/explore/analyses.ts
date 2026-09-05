import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getKit, type LoadedKit } from "./kits/loader";

export type AnalysisLanguage = "python" | "r";

export interface AnalysisInputBinding {
  alias: string;
  datasetId: string;
  /** Pinned version; null means "current version at run time". */
  versionId: string | null;
}

export interface RevisionSummary {
  id: string;
  number: number;
  /** Present on analysis detail payloads only. */
  code?: string;
  author: string;
  authorUserId: string | null;
  message: string | null;
  prompt: string | null;
  createdAt: string;
  params: Record<string, unknown>;
  inputs: AnalysisInputBinding[];
}

export interface RunSummary {
  id: string;
  runNumber: string;
  status: string;
  executionMode: string | null;
  revisionNumber: number;
  queuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  exitCode: number | null;
  artifactCount: number;
  createdAt: string;
}

export interface AnalysisSummary {
  id: string;
  targetKey: string;
  name: string;
  description: string | null;
  kitId: string | null;
  /** The report this analysis is a step of. */
  reportId: string | null;
  language: AnalysisLanguage;
  environmentName: string;
  currentRevision: RevisionSummary | null;
  latestRun: RunSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisDetail extends AnalysisSummary {
  code: string;
  revisions: RevisionSummary[];
  runs: RunSummary[];
}

const BLANK_PYTHON = `"""Blank analysis.

Datasets are loaded through the seqdesk_explore helper. Save figures and
tables with it so they appear in the Results.
"""
from seqdesk_explore import load_dataset, save_table, save_figure, params, finish

df = load_dataset("table")
save_table(df.describe(include="all").reset_index(), "describe", title="Descriptive statistics")
finish()
`;

const BLANK_R = `# Blank analysis (R). The seqdeskExplore helper is not shipped yet; read inputs.json directly.
inputs <- jsonlite::fromJSON("inputs.json")
`;

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function parseInputBindings(raw: string | null | undefined): AnalysisInputBinding[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((entry) => ({
        alias: String(entry.alias ?? ""),
        datasetId: String(entry.datasetId ?? ""),
        versionId: typeof entry.versionId === "string" ? entry.versionId : null,
      }))
      .filter((entry) => entry.alias && entry.datasetId);
  } catch {
    return [];
  }
}

type RevisionRecord = Prisma.ExploreAnalysisRevisionGetPayload<object>;
type RunRecord = Prisma.ExploreAnalysisRunGetPayload<{ include: { revision: { select: { number: true } }; _count: { select: { artifacts: true } } } }>;

function serializeRevision(revision: RevisionRecord): RevisionSummary {
  return {
    id: revision.id,
    number: revision.number,
    author: revision.author,
    authorUserId: revision.authorUserId,
    message: revision.message,
    prompt: revision.prompt,
    createdAt: revision.createdAt.toISOString(),
    params: parseJsonObject(revision.params),
    inputs: parseInputBindings(revision.inputs),
  };
}

export function serializeRun(run: RunRecord): RunSummary {
  return {
    id: run.id,
    runNumber: run.runNumber,
    status: run.status,
    executionMode: run.executionMode,
    revisionNumber: run.revision.number,
    queuedAt: run.queuedAt ? run.queuedAt.toISOString() : null,
    startedAt: run.startedAt ? run.startedAt.toISOString() : null,
    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
    exitCode: run.exitCode,
    artifactCount: run._count.artifacts,
    createdAt: run.createdAt.toISOString(),
  };
}

const analysisInclude = {
  revisions: { orderBy: { number: "desc" as const }, take: 1 },
  runs: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    include: { revision: { select: { number: true } }, _count: { select: { artifacts: true } } },
  },
};

type AnalysisRecord = Prisma.ExploreAnalysisGetPayload<{ include: typeof analysisInclude }>;

function serializeAnalysis(analysis: AnalysisRecord): AnalysisSummary {
  const current = analysis.revisions.find((revision) => revision.id === analysis.currentRevisionId) ?? analysis.revisions[0] ?? null;
  return {
    id: analysis.id,
    targetKey: analysis.targetKey,
    name: analysis.name,
    description: analysis.description,
    kitId: analysis.kitId,
    reportId: analysis.reportId,
    language: analysis.language as AnalysisLanguage,
    environmentName: analysis.environmentName,
    currentRevision: current ? serializeRevision(current) : null,
    latestRun: analysis.runs[0] ? serializeRun(analysis.runs[0]) : null,
    createdAt: analysis.createdAt.toISOString(),
    updatedAt: analysis.updatedAt.toISOString(),
  };
}

export async function listAnalyses(targetKey: string, reportId: string | null = null): Promise<AnalysisSummary[]> {
  const analyses = await db.exploreAnalysis.findMany({
    where: reportId ? { targetKey, reportId } : { targetKey },
    include: analysisInclude,
    orderBy: { updatedAt: "desc" },
  });
  return analyses.map(serializeAnalysis);
}

export async function getAnalysisRecord(id: string) {
  return db.exploreAnalysis.findUnique({ where: { id }, select: { id: true, targetKey: true, language: true, environmentName: true, kitId: true, currentRevisionId: true, name: true } });
}

export async function getAnalysisDetail(id: string): Promise<AnalysisDetail | null> {
  const analysis = await db.exploreAnalysis.findUnique({
    where: { id },
    include: {
      revisions: { orderBy: { number: "desc" } },
      runs: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { revision: { select: { number: true } }, _count: { select: { artifacts: true } } },
      },
    },
  });
  if (!analysis) return null;
  const current = analysis.revisions.find((revision) => revision.id === analysis.currentRevisionId) ?? analysis.revisions[0] ?? null;
  const summary = serializeAnalysis({ ...analysis, revisions: current ? [current] : [], runs: analysis.runs.slice(0, 1) });
  return {
    ...summary,
    code: current?.code ?? "",
    revisions: analysis.revisions.map((revision) => ({ ...serializeRevision(revision), code: revision.code })),
    runs: analysis.runs.map(serializeRun),
  };
}

export async function getRevision(analysisId: string, revisionId: string) {
  return db.exploreAnalysisRevision.findFirst({ where: { id: revisionId, analysisId } });
}

export interface CreateAnalysisInput {
  targetKey: string;
  name?: string | null;
  description?: string | null;
  kitId?: string | null;
  /** The report this analysis is a step of; must belong to the same scope. */
  reportId?: string | null;
  language?: AnalysisLanguage;
  environmentName?: string | null;
  inputs: AnalysisInputBinding[];
  params?: Record<string, unknown>;
  createdById: string;
}

/**
 * Create an analysis with its first revision, from a kit (code copied from the
 * kit's entrypoint) or blank. The kit stays the template; the copy is what
 * runs and what the user edits.
 */
export async function createAnalysis(input: CreateAnalysisInput): Promise<AnalysisSummary> {
  let kit: LoadedKit | null = null;
  if (input.kitId) {
    kit = await getKit(input.kitId);
    if (!kit) throw new Error(`Unknown kit: ${input.kitId}`);
  }
  const language: AnalysisLanguage = kit?.manifest.language ?? input.language ?? "python";
  const environmentName = kit?.manifest.environment ?? input.environmentName ?? (language === "r" ? "seqdesk-explore-r" : "seqdesk-explore-python");
  const code = kit?.code ?? (language === "r" ? BLANK_R : BLANK_PYTHON);
  const params = { ...defaultParams(kit), ...(input.params ?? {}) };
  let reportId: string | null = null;
  if (input.reportId) {
    const report = await db.exploreReport.findUnique({ where: { id: input.reportId }, select: { id: true, targetKey: true } });
    if (!report || report.targetKey !== input.targetKey) throw new Error("The report does not belong to this scope");
    reportId = report.id;
  }

  const analysis = await db.exploreAnalysis.create({
    data: {
      targetKey: input.targetKey,
      name: input.name?.trim() || kit?.manifest.name || "Untitled analysis",
      description: input.description ?? kit?.manifest.description ?? null,
      kitId: kit?.manifest.id ?? null,
      reportId,
      language,
      environmentName,
      createdById: input.createdById,
    },
  });
  const revision = await db.exploreAnalysisRevision.create({
    data: {
      analysisId: analysis.id,
      number: 1,
      code,
      params: JSON.stringify(params),
      inputs: JSON.stringify(input.inputs),
      author: "user",
      authorUserId: input.createdById,
      message: kit ? `Created from kit ${kit.manifest.id}` : "Created",
    },
  });
  await db.exploreAnalysis.update({ where: { id: analysis.id }, data: { currentRevisionId: revision.id } });
  const record = await db.exploreAnalysis.findUnique({ where: { id: analysis.id }, include: analysisInclude });
  if (!record) throw new Error("Analysis vanished after creation");
  return serializeAnalysis(record);
}

export function defaultParams(kit: LoadedKit | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const properties = kit?.manifest.params?.properties ?? {};
  for (const [key, definition] of Object.entries(properties)) {
    if (definition && typeof definition === "object" && "default" in (definition as object)) {
      out[key] = (definition as { default: unknown }).default;
    }
  }
  return out;
}

export interface CreateRevisionInput {
  analysisId: string;
  code?: string;
  params?: Record<string, unknown>;
  inputs?: AnalysisInputBinding[];
  author: "user" | "agent";
  authorUserId: string;
  message?: string | null;
  prompt?: string | null;
}

/** A new revision copies whatever the caller did not change from the current one. */
export async function createRevision(input: CreateRevisionInput): Promise<RevisionSummary> {
  const analysis = await db.exploreAnalysis.findUnique({
    where: { id: input.analysisId },
    include: { revisions: { orderBy: { number: "desc" }, take: 1 } },
  });
  if (!analysis) throw new Error("Analysis not found");
  const latest = analysis.revisions[0] ?? null;
  const current = analysis.currentRevisionId
    ? await db.exploreAnalysisRevision.findUnique({ where: { id: analysis.currentRevisionId } })
    : latest;
  const revision = await db.exploreAnalysisRevision.create({
    data: {
      analysisId: analysis.id,
      number: (latest?.number ?? 0) + 1,
      code: input.code ?? current?.code ?? "",
      params: JSON.stringify(input.params ?? parseJsonObject(current?.params)),
      inputs: JSON.stringify(input.inputs ?? parseInputBindings(current?.inputs)),
      author: input.author,
      authorUserId: input.authorUserId,
      message: input.message ?? null,
      prompt: input.prompt ?? null,
    },
  });
  await db.exploreAnalysis.update({ where: { id: analysis.id }, data: { currentRevisionId: revision.id } });
  return serializeRevision(revision);
}

export async function updateAnalysis(id: string, data: { name?: string; description?: string | null; environmentName?: string }) {
  return db.exploreAnalysis.update({ where: { id }, data });
}

export async function deleteAnalysis(id: string) {
  await db.exploreAnalysis.delete({ where: { id } });
}

/** EXP-YYYYMMDD-NNN, unique per day. */
export async function allocateRunNumber(): Promise<string> {
  const now = new Date();
  const day = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
  const prefix = `EXP-${day}-`;
  const latest = await db.exploreAnalysisRun.findFirst({
    where: { runNumber: { startsWith: prefix } },
    orderBy: { runNumber: "desc" },
    select: { runNumber: true },
  });
  const last = latest ? Number.parseInt(latest.runNumber.slice(prefix.length), 10) : 0;
  return `${prefix}${String((Number.isFinite(last) ? last : 0) + 1).padStart(3, "0")}`;
}

export async function listRuns(analysisId: string): Promise<RunSummary[]> {
  const runs = await db.exploreAnalysisRun.findMany({
    where: { analysisId },
    orderBy: { createdAt: "desc" },
    include: { revision: { select: { number: true } }, _count: { select: { artifacts: true } } },
  });
  return runs.map(serializeRun);
}
