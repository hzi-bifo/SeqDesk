import { createHash } from "node:crypto";
import { stepPackagesOf } from "./step-environments";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getKit, type LoadedKit } from "./kits/loader";
import { stepSlug } from "./variables";
import { inputContractSnapshot, serializeInputs } from "./input-validation";
import { generationSnapshot, type GenerationSnapshot } from "./report-generation";
import { parseStoredFileBindings, type AnalysisFileBinding } from "@/lib/files/library-types";
import { bumpRecipeRevision } from "./recipe-revision";
import { keyBetween } from "./recipe-order";

export type AnalysisLanguage = "python" | "r" | "shell";

/** A language from a request: "r", "shell", or Python for anything else. */
export function analysisLanguageOf(value: unknown): AnalysisLanguage {
  return value === "r" ? "r" : value === "shell" ? "shell" : "python";
}

/** The base environment a new step of each language starts from. */
export function baseEnvironmentFor(language: AnalysisLanguage): string {
  return language === "r" ? "seqdesk-explore-r" : language === "shell" ? "seqdesk-explore-shell" : "seqdesk-explore-python";
}

export interface AnalysisInputBinding {
  alias: string;
  datasetId: string;
  /** Pinned version; null means "current version at run time". */
  versionId: string | null;
}

export interface RevisionSummary {
  id: string;
  number: number;
  /** sha256 hex of the code. */
  codeHash: string;
  /** Present on analysis detail payloads only. */
  code?: string;
  author: string;
  authorUserId: string | null;
  message: string | null;
  prompt: string | null;
  createdAt: string;
  params: Record<string, unknown>;
  inputs: AnalysisInputBinding[];
  fileInputs: AnalysisFileBinding[];
}

export interface RunSummary {
  id: string;
  runNumber: string;
  /** The numbered recipe run ("Run #8") this step run belongs to; null for a step run outside one. */
  flowRunNumber?: number | null;
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
  /** The code revision an assistant-written description was made from; null when a person wrote it. */
  descriptionRevisionId: string | null;
  kitId: string | null;
  /** The report this analysis is a step of. */
  reportId: string | null;
  /** The flow whose canvas this analysis is a step of. */
  flowId: string | null;
  language: AnalysisLanguage;
  environmentName: string;
  /** Extra conda packages on top of the base environment (explore.packages). */
  packages: { packages: string[]; channels: string[] };
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

const BLANK_R = `# Blank analysis (R). \`sx\` reads the inputs and records what the step writes.
table <- sx$input("table")
sx$output("summary", data.frame(column = names(table), missing = vapply(table, function(x) sum(is.na(x)), numeric(1))), title = "Missing values per column")
sx$metric("n_rows", nrow(table), label = "Rows")
sx$finish()
`;

const BLANK_SHELL = `# Blank shell step (bash, run with -euo pipefail). Inputs are $INPUT_<alias>, parameters $PARAM_<key>;
# write everything the step makes under $OUT (tables as .tsv/.csv, figures as .png/.svg).
# Tools come from the step's environment: add packages such as fastp or samtools below.
for input in $(compgen -v INPUT_); do
  printf '%s\\t%s\\n' "\${input#INPUT_}" "$(wc -l < "\${!input}")"
done | { printf 'input\\tlines\\n'; cat; } > "$OUT/line_counts.tsv"
sx metric n_inputs "$(($(wc -l < "$OUT/line_counts.tsv") - 1))" --label "Inputs read"
`;

/** The hash recipes and runs pin a step's code by. */
export function codeHashOf(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

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
    const value = JSON.parse(raw);
    const parsed: unknown = value?.version === 1 ? value.bindings : value;
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
    codeHash: revision.codeHash || codeHashOf(revision.code),
    author: revision.author,
    authorUserId: revision.authorUserId,
    message: revision.message,
    prompt: revision.prompt,
    createdAt: revision.createdAt.toISOString(),
    params: parseJsonObject(revision.params),
    inputs: parseInputBindings(revision.inputs),
    fileInputs: parseStoredFileBindings(revision.fileInputs),
  };
}

export function serializeRun(run: RunRecord & { flowRun?: { number: number | null } | null }): RunSummary {
  return {
    id: run.id,
    runNumber: run.runNumber,
    // The numbered recipe run this step run belongs to ("Run #8"), when it was loaded.
    ...(run.flowRun !== undefined ? { flowRunNumber: run.flowRun?.number ?? null } : {}),
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
    include: { revision: { select: { number: true } }, _count: { select: { artifacts: true } }, flowRun: { select: { number: true } } },
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
    descriptionRevisionId: analysis.descriptionRevisionId ?? null,
    kitId: analysis.kitId,
    reportId: analysis.reportId,
    flowId: analysis.flowId,
    language: analysis.language as AnalysisLanguage,
    environmentName: analysis.environmentName,
    packages: stepPackagesOf(analysis.packages),
    currentRevision: current ? serializeRevision(current) : null,
    latestRun: analysis.runs[0] ? serializeRun(analysis.runs[0]) : null,
    createdAt: analysis.createdAt.toISOString(),
    updatedAt: analysis.updatedAt.toISOString(),
  };
}

export async function listAnalyses(targetKey: string, reportId: string | null = null, flowId: string | null = null): Promise<AnalysisSummary[]> {
  const analyses = await db.exploreAnalysis.findMany({
    where: flowId ? { targetKey, flowId } : reportId ? { targetKey, reportId } : { targetKey },
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
        include: { revision: { select: { number: true } }, _count: { select: { artifacts: true } }, flowRun: { select: { number: true } } },
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
  /** The flow this analysis is a step of; must belong to the same scope. */
  flowId?: string | null;
  language?: AnalysisLanguage;
  environmentName?: string | null;
  inputs: AnalysisInputBinding[];
  fileInputs?: AnalysisFileBinding[];
  params?: Record<string, unknown>;
  createdById: string;
  /** The collaboration member who added the step (recipe revision author). */
  createdByMemberId?: string | null;
  /** Recipe placement when the step joins a flow; defaults to the end of the main lane. */
  position?: string | null;
  laneKind?: string | null;
  laneOf?: string | null;
  laneLabel?: string | null;
  purpose?: string | null;
  /** Meaning of the settings (label, unit, meaning, consequence...), when the creator knows it. */
  paramMeta?: Record<string, unknown> | null;
  /** Code for a step that is not made from a kit (a template step, a proposal). */
  code?: string;
  /** A stable id the client chose (request idempotency). */
  id?: string;
}

/**
 * Create an analysis with its first revision, from a kit (code copied from the
 * kit's entrypoint) or blank. The kit stays the template; the copy is what
 * runs and what the user edits.
 */
export async function createAnalysis(input: CreateAnalysisInput, generation?: { id: string; kit: LoadedKit; snapshot: GenerationSnapshot }): Promise<AnalysisSummary> {
  let kit: LoadedKit | null = generation?.kit ?? null;
  if (input.kitId && !kit) {
    kit = await getKit(input.kitId);
    if (!kit) throw new Error(`Unknown kit: ${input.kitId}`);
  }
  const language: AnalysisLanguage = kit?.manifest.language ?? input.language ?? "python";
  const environmentName = kit?.manifest.environment ?? input.environmentName ?? baseEnvironmentFor(language);
  const fileOnlyCode = input.fileInputs?.length && input.inputs.length === 0
    ? `from seqdesk_explore import file_path, note, finish\n\nsource = file_path(${JSON.stringify(input.fileInputs[0].alias)})\n# Read source with the library for your file format, then save figures or tables.\nnote(f"Input file: {source.name} ({source.stat().st_size} bytes)")\nfinish()\n`
    : BLANK_PYTHON;
  const code = input.code ?? kit?.code ?? (language === "r" ? BLANK_R : language === "shell" ? BLANK_SHELL : fileOnlyCode);
  const params = { ...defaultParams(kit), ...(input.params ?? {}) };
  let reportId: string | null = null;
  if (input.reportId) {
    const report = await db.exploreReport.findUnique({ where: { id: input.reportId }, select: { id: true, targetKey: true } });
    if (!report || report.targetKey !== input.targetKey) throw new Error("The report does not belong to this scope");
    reportId = report.id;
  }
  let flowId: string | null = null;
  if (input.flowId) {
    const flow = await db.exploreFlow.findUnique({ where: { id: input.flowId }, select: { id: true, targetKey: true } });
    if (!flow || flow.targetKey !== input.targetKey) throw new Error("The flow does not belong to this scope");
    flowId = flow.id;
  }

  const name = input.name?.trim() || kit?.manifest.name || "Untitled analysis";
  // The slug the page cites the step by, unique within the scope, kept for good.
  const taken = new Set((await db.exploreAnalysis.findMany({ where: { targetKey: input.targetKey }, select: { slug: true } })).map((entry) => entry.slug).filter((entry): entry is string => Boolean(entry)));
  let slug = stepSlug(name);
  for (let index = 2; taken.has(slug); index += 1) slug = `${stepSlug(name)}_${index}`;

  // The stable guided-request id and its first revision commit together. A retry
  // can never observe an analysis that has lost its input/manifest snapshot.
  const write = async (client: Prisma.TransactionClient) => {
  // A step joining a flow goes to the end of its recipe unless placed.
  let position = input.position ?? "";
  if (flowId && !position) {
    const last = await client.exploreAnalysis.findFirst({ where: { flowId, position: { not: "" } }, orderBy: { position: "desc" }, select: { position: true } });
    position = keyBetween(last?.position ?? "", null);
  }
  const analysis = await client.exploreAnalysis.create({
    data: {
      ...(generation ? { id: generation.id } : input.id ? { id: input.id } : {}),
      targetKey: input.targetKey,
      name,
      slug,
      description: input.description ?? kit?.manifest.description ?? null,
      kitId: kit?.manifest.id ?? null,
      reportId,
      flowId,
      language,
      environmentName,
      createdById: input.createdById,
      position,
      laneKind: input.laneKind ?? null,
      laneOf: input.laneOf ?? null,
      laneLabel: input.laneLabel ?? null,
      purpose: input.purpose ?? null,
      ...(input.paramMeta ? { paramMeta: input.paramMeta as Prisma.InputJsonValue } : {}),
    },
  });
  const revision = await client.exploreAnalysisRevision.create({
    data: {
      analysisId: analysis.id,
      number: 1,
      code,
      codeHash: codeHashOf(code),
      params: JSON.stringify(params),
      inputs: serializeInputs(input.inputs, kit?.manifest.inputs ?? null, generation?.snapshot),
      fileInputs: JSON.stringify(input.fileInputs ?? []),
      author: "user",
      authorUserId: input.createdById,
      message: kit ? `Created from kit ${kit.manifest.id}` : "Created",
    },
  });
  await client.exploreAnalysis.update({ where: { id: analysis.id }, data: { currentRevisionId: revision.id } });
  if (flowId) await bumpRecipeRevision(client, flowId, { userId: input.createdById, memberId: input.createdByMemberId }, `Added step ${name}`);
  const record = await client.exploreAnalysis.findUnique({ where: { id: analysis.id }, include: analysisInclude });
  if (!record) throw new Error("Analysis vanished after creation");
  return serializeAnalysis(record);
  };
  return db.$transaction(write);
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

export class RevisionConflict extends Error { readonly status = 409; }

export interface CreateRevisionInput {
  expectedRevisionId?: string;
  revisionId?: string;
  analysisId: string;
  code?: string;
  params?: Record<string, unknown>;
  inputs?: AnalysisInputBinding[];
  fileInputs?: AnalysisFileBinding[];
  author: "user" | "agent";
  authorUserId: string;
  authorMemberId?: string | null;
  message?: string | null;
  prompt?: string | null;
}

/** A new revision copies whatever the caller did not change from the current one. */
export async function createRevision(input: CreateRevisionInput): Promise<RevisionSummary> {
  return db.$transaction(async (tx) => {
  // The stable operation ID lets a disconnected caller recover a committed save.
  if (input.revisionId) {
    const saved = await tx.exploreAnalysisRevision.findUnique({ where: { id: input.revisionId } });
    if (saved) {
      if (saved.analysisId !== input.analysisId || saved.authorUserId !== input.authorUserId || (input.code !== undefined && saved.code !== input.code)) throw new RevisionConflict("This save request no longer matches the step.");
      return serializeRevision(saved);
    }
  }
  const analysis = await tx.exploreAnalysis.findUnique({
    where: { id: input.analysisId },
    include: { revisions: { orderBy: { number: "desc" }, take: 1 } },
  });
  if (!analysis) throw new Error("Analysis not found");
  if (input.expectedRevisionId !== undefined && input.expectedRevisionId !== analysis.currentRevisionId) throw new RevisionConflict("This step changed in another session. Reopen it before saving your changes.");
  // Compare and lock before allocating a revision; all writers use this path.
  const claimed = await tx.exploreAnalysis.updateMany({ where: { id: analysis.id, currentRevisionId: analysis.currentRevisionId }, data: { currentRevisionId: analysis.currentRevisionId } });
  if (claimed.count !== 1) throw new RevisionConflict("This step changed in another session. Reopen it before saving your changes.");
  const latest = analysis.revisions[0] ?? null;
  const current = analysis.currentRevisionId
    ? await tx.exploreAnalysisRevision.findUnique({ where: { id: analysis.currentRevisionId } })
    : latest;
  const revision = await tx.exploreAnalysisRevision.create({
    data: {
      ...(input.revisionId ? { id: input.revisionId } : {}),
      analysisId: analysis.id,
      number: (latest?.number ?? 0) + 1,
      code: input.code ?? current?.code ?? "",
      codeHash: codeHashOf(input.code ?? current?.code ?? ""),
      params: JSON.stringify(input.params ?? parseJsonObject(current?.params)),
      inputs: serializeInputs(input.inputs ?? parseInputBindings(current?.inputs), inputContractSnapshot(current?.inputs), generationSnapshot(current?.inputs)),
      fileInputs: JSON.stringify(input.fileInputs ?? parseStoredFileBindings(current?.fileInputs)),
      author: input.author,
      authorUserId: input.authorUserId,
      message: input.message ?? null,
      prompt: input.prompt ?? null,
    },
  });
  await tx.exploreAnalysis.update({ where: { id: analysis.id }, data: { currentRevisionId: revision.id } });
  // A new code or params revision of a step is a new recipe revision (D6).
  if (analysis.flowId) await bumpRecipeRevision(tx, analysis.flowId, { userId: input.authorUserId, memberId: input.authorMemberId }, `${analysis.name}: revision ${revision.number}${input.message ? ` · ${input.message}` : ""}`);
  return serializeRevision(revision);
  });
}

export async function updateAnalysis(id: string, data: { name?: string; description?: string | null; descriptionRevisionId?: string | null; environmentName?: string; purpose?: string | null; paramMeta?: Prisma.InputJsonValue | typeof Prisma.DbNull; methodsSentence?: Prisma.InputJsonValue | typeof Prisma.DbNull }) {
  if (data.descriptionRevisionId) {
    const result = await db.exploreAnalysis.updateMany({ where: { id, currentRevisionId: data.descriptionRevisionId }, data });
    if (result.count !== 1) throw new RevisionConflict("The code changed before its explanation could be saved.");
    return result;
  }
  return db.exploreAnalysis.update({ where: { id }, data });
}

export async function deleteAnalysis(id: string, actor?: { userId: string; memberId?: string | null }) {
  await db.$transaction(async (tx) => {
    const analysis = await tx.exploreAnalysis.findUnique({ where: { id }, select: { flowId: true, name: true, createdById: true } });
    await tx.exploreAnalysis.delete({ where: { id } });
    // Removing a step from a flow is a new recipe revision; lanes that hung off it move to the main lane.
    if (analysis?.flowId) {
      await tx.exploreAnalysis.updateMany({ where: { flowId: analysis.flowId, laneOf: id }, data: { laneOf: null, laneKind: null } });
      await bumpRecipeRevision(tx, analysis.flowId, { userId: actor?.userId ?? analysis.createdById, memberId: actor?.memberId }, `Removed step ${analysis.name}`);
    }
  });
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
