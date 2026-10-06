/**
 * "Which one?" (identity sheet 97 f5): when several pipelines fit the same goal, or someone types a question instead of
 * a name, a short comparison from the catalogue and the study's data summary — and nothing else. The web's assistant
 * may answer in pencil from exactly these rows (`sources`); it explains and offers actions, it never installs or adds.
 */
import { flowError } from "@/lib/integration/flow-contract";
import { pipelineStore, type StoreEntry, type StoreListing } from "./pipeline-lab";
import type { PipelineAccess } from "./pipeline-steps";

export interface WhichRow { key: "answers" | "makes" | "reads" | "time" | "here" | "fit" | "needs" | "cite"; label: string; values: Record<string, string> }
export interface WhichView {
  goal: string | null;
  question: string | null;
  /** The pipelines compared, in the finder's order. */
  pipelines: Array<{ id: string; name: string; version: string; state: StoreEntry["state"]; action: StoreEntry["action"]; source: StoreEntry["source"] }>;
  rows: WhichRow[];
  /** Pipelines meant for other data, with the reason (an answer may name them). */
  notForData: Array<{ id: string; name: string; version: string; words: string }>;
  data: StoreListing["data"];
  /** What an answer may cite: these catalogue entries and the data summary; nothing else. */
  sources: Array<{ kind: "catalogue"; id: string; name: string; version: string } | { kind: "data"; words: string }>;
  /** What an answer may offer (one per pipeline): never performed by the assistant. */
  actions: Array<{ pipelineId: string; kind: StoreEntry["action"]["kind"]; label: string }>;
}

const words = (value: string | null | undefined) => (value ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((part) => part.length > 2);

/** How well an entry answers a question: shared words over its name, description, goals, tables and tags. */
export function questionScore(entry: Pick<StoreEntry, "name" | "description" | "goals" | "makes" | "tags" | "category">, question: string): number {
  const asked = new Set(words(question));
  if (!asked.size) return 0;
  const own = words([entry.name, entry.description, ...entry.goals, ...entry.makes, ...entry.tags, entry.category ?? ""].join(" "));
  return own.filter((part) => asked.has(part)).length + entry.goals.filter((goal) => words(goal).every((part) => asked.has(part))).length * 3;
}

/** The comparison rows for some store entries (pure). */
export function whichRows(entries: StoreEntry[]): WhichRow[] {
  const by = (pick: (entry: StoreEntry) => string) => Object.fromEntries(entries.map((entry) => [entry.id, pick(entry)]));
  const rows: WhichRow[] = [
    { key: "answers", label: "Answers", values: by((entry) => entry.answers ?? entry.goals.join(", ") ?? "") },
    { key: "makes", label: "Makes", values: by((entry) => [...entry.makes, ...(entry.files ?? []).map((file) => file.label)].join(", ") || "—") },
    { key: "reads", label: "Reads", values: by((entry) => (entry.inputs ?? []).map((input) => input.label).join(", ") || (entry.reads ? `${entry.reads.kind === "any" ? "any" : entry.reads.kind} reads` : "not described yet")) },
    { key: "time", label: "On your data", values: by((entry) => entry.estimate?.words ?? "no estimate yet") },
    { key: "here", label: "Here", values: by((entry) => entry.installed ? `installed${entry.labUse?.runs ? `, used ${entry.labUse.runs}×` : ""}` : entry.source.kind === "lab" ? `lab pipeline${entry.labUse?.runs ? `, used ${entry.labUse.runs}×` : ""}` : "in the store") },
    { key: "fit", label: "Fits", values: by((entry) => entry.fit?.words || (entry.described === false ? "fit with your data: not described yet" : "—")) },
  ];
  if (entries.some((entry) => entry.missing.length)) rows.push({ key: "needs", label: "Needs first", values: by((entry) => entry.missing.join(", ") || "nothing") });
  if (entries.some((entry) => entry.citation)) rows.push({ key: "cite", label: "Cite", values: by((entry) => entry.citation ?? "—") });
  return rows;
}

export async function whichPipelines(input: { targetKey: string | null; labKey: string | null; access: PipelineAccess; goal?: string | null; question?: string | null; ids?: string[] | null; listing?: StoreListing }): Promise<WhichView> {
  const goal = input.goal?.trim().slice(0, 120) || null;
  const question = input.question?.trim().slice(0, 1000) || null;
  if (!goal && !question && !input.ids?.length) throw flowError("invalid_request", "Name a goal, a question or the pipelines to compare.");
  const listing = input.listing ?? await pipelineStore({ targetKey: input.targetKey, labKey: input.labKey, access: input.access });
  const usable = listing.pipelines.filter((entry) => entry.state !== "not-for-data");
  let chosen: StoreEntry[];
  if (input.ids?.length) chosen = input.ids.map((id) => listing.pipelines.find((entry) => entry.id === id)).filter((entry): entry is StoreEntry => Boolean(entry));
  else if (goal) chosen = usable.filter((entry) => entry.goals.some((candidate) => candidate.toLowerCase() === goal.toLowerCase()));
  else chosen = usable.map((entry) => ({ entry, score: questionScore(entry, question!) })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).map((item) => item.entry);
  chosen = chosen.slice(0, 4);
  const notForData = listing.pipelines.filter((entry) => entry.state === "not-for-data" && (!goal || entry.goals.includes(goal)) && !chosen.includes(entry)).slice(0, 6)
    .map((entry) => ({ id: entry.id, name: entry.name, version: entry.version, words: entry.fit?.lines.find((line) => line.ok === false)?.words ?? entry.fit?.words ?? "not for this data" }));
  return {
    goal, question,
    pipelines: chosen.map((entry) => ({ id: entry.id, name: entry.name, version: entry.version, state: entry.state, action: entry.action, source: entry.source })),
    rows: whichRows(chosen), notForData, data: listing.data,
    sources: [...[...chosen, ...listing.pipelines.filter((entry) => notForData.some((other) => other.id === entry.id))].map((entry) => ({ kind: "catalogue" as const, id: entry.id, name: entry.name, version: entry.version })),
      ...(listing.data ? [{ kind: "data" as const, words: listing.data.words }] : [])],
    actions: chosen.filter((entry) => ["add", "ask-install", "install"].includes(entry.action.kind)).map((entry) => ({ pipelineId: entry.id, kind: entry.action.kind, label: `${entry.action.label} ${entry.name.replace(/^nf-core\//, "")}` })),
  };
}
