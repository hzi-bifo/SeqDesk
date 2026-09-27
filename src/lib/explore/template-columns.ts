/**
 * Column roles of a template (bring your own data): a template names the columns it needs per input
 * ("the sample id", "the condition and its two levels", "an optional pairing column") instead of
 * hardcoding airway's names. For each mapped table the roles are guessed from the columns (name,
 * type, number of levels, overlap with the counts' sample names), the person can change each one,
 * and the choices are written into the step params through `{{role}}` and `{{role.level}}`.
 * Pure: the callers load the tables.
 */
import { z } from "zod";

const Key = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);

export const ColumnRoleSchema = z.object({
  key: Key,
  /** The template input whose table has the column. */
  input: Key,
  label: z.string().min(1).max(80),
  /** feature: a counts/taxonomy row id; sample: the sheet's sample id; group: the compared condition;
   *  block: pairing or batch; subject: who a sample came from; text: any other named column. */
  kind: z.enum(["feature", "sample", "group", "block", "subject", "text"]),
  optional: z.boolean().default(false),
  /** The column name of the real example; a table that has it gets it first. */
  default: z.string().max(120).optional(),
  hint: z.string().max(200).optional(),
  /** For sample: the counts input whose number columns are the sample ids. */
  countsInput: Key.optional(),
  /** For group: the levels the steps compare (numerator and reference, or the two sites). */
  levels: z.array(z.object({ key: Key, label: z.string().min(1).max(60), default: z.string().max(120).optional(), reference: z.boolean().default(false) }).strict()).max(4).default([]),
}).strict();
export type ColumnRole = z.infer<typeof ColumnRoleSchema>;

export type TableFacts = { columns: Array<{ key: string; type: string }>; rows: Array<Record<string, unknown>> };
export type ColumnFact = { key: string; type: string; distinct: number; unique: boolean; filled: number; levels: Array<{ value: string; n: number }> | null; values: Set<string> };

export interface ResolvedRole {
  key: string; input: string; label: string; kind: ColumnRole["kind"]; optional: boolean; hint: string | null;
  column: string | null; guessed: boolean; options: string[];
  levels: Array<{ key: string; label: string; value: string | null; reference: boolean; options: string[] }>;
}
export interface Resolution { roles: ResolvedRole[]; problems: string[]; values: Record<string, string> }

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim());
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const listWords = (words: string[]) => (words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`);
const shortList = (words: string[], n = 3) => `${words.slice(0, n).join(", ")}${words.length > n ? ", …" : ""}`;

export function describeColumns(facts: TableFacts): ColumnFact[] {
  return facts.columns.map((column) => {
    const counts = new Map<string, number>();
    let filled = 0;
    for (const row of facts.rows) {
      const value = text(row[column.key]);
      if (!value) continue;
      filled += 1;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    const levels = counts.size <= 24 ? [...counts].map(([value, n]) => ({ value, n })).sort((a, b) => a.value.localeCompare(b.value)) : null;
    return { key: column.key, type: column.type, distinct: counts.size, unique: filled > 0 && counts.size === filled, filled, levels, values: new Set(counts.keys()) };
  });
}

const NAME: Record<ColumnRole["kind"], RegExp> = {
  feature: /^(gene|feature|otu|asv|ensembl|symbol|id)|(_id|id)$/i,
  sample: /sample|^id$|name|library|run/i,
  group: /group|condition|treat|dex|status|site|type|arm|disease|genotype|state|class/i,
  block: /cell|line|batch|block|donor|patient|pair|subject|individual|lane|plate/i,
  subject: /subject|donor|patient|individual|host|mouse|animal|participant/i,
  text: /taxon|taxonomy|lineage|classification/i,
};
const REFERENCE = /^(control|ctrl|untreated|untrt|mock|vehicle|veh|wt|wild.?type|baseline|normal|healthy|placebo|none|naive|pre|day.?0|t0|0h|dmso|reference|ref)$/i;

function score(role: ColumnRole, fact: ColumnFact, context: { counts: Set<string> | null; taken: Set<string> }): number {
  if (context.taken.has(fact.key)) return -100;
  let points = 0;
  if (role.default && fact.key === role.default) points += 6;
  else if (role.default && fact.key.toLowerCase() === role.default.toLowerCase()) points += 5;
  if (NAME[role.kind].test(fact.key)) points += 3;
  const isText = fact.type !== "number";
  switch (role.kind) {
    case "feature":
      if (!isText) return -50;
      if (fact.unique) points += 2;
      break;
    case "sample":
      if (context.counts?.size) {
        const hits = [...context.counts].filter((sample) => fact.values.has(sample)).length;
        points += hits ? 10 * (hits / context.counts.size) : -5;
      }
      if (fact.unique) points += 2; else points -= 8;
      break;
    case "group":
    case "block":
    case "subject": {
      const levels = fact.levels ?? [];
      const usable = levels.length >= 2 && levels.length <= 12 && !fact.unique;
      if (!usable) return -50;
      if (role.kind === "group" && levels.length <= 10 && levels.filter((level) => level.n >= 2).length >= 2) points += 3;
      if (isText) points += 1;
      break;
    }
    case "text":
      if (!isText) points -= 3;
      break;
  }
  return points;
}

/** The chosen or guessed level of each level slot of a group role. */
function chooseLevels(role: ColumnRole, fact: ColumnFact | null, given: Record<string, string>): ResolvedRole["levels"] {
  const options = (fact?.levels ?? []).map((level) => level.value);
  const used = new Set<string>();
  const out: ResolvedRole["levels"] = role.levels.map((slot) => ({ key: slot.key, label: slot.label, value: null, reference: slot.reference, options }));
  // Given choices first, then the example's names, then reference words for the reference slot, then the rest in order.
  out.forEach((slot) => { const value = given[`${role.key}.${slot.key}`]; if (value && options.includes(value) && !used.has(value)) { slot.value = value; used.add(value); } });
  out.forEach((slot, i) => { const value = role.levels[i].default; if (!slot.value && value && options.includes(value) && !used.has(value)) { slot.value = value; used.add(value); } });
  out.forEach((slot) => { if (!slot.value && slot.reference) { const value = options.find((option) => REFERENCE.test(option) && !used.has(option)); if (value) { slot.value = value; used.add(value); } } });
  const rest = [...options].sort((a, b) => Number(REFERENCE.test(a)) - Number(REFERENCE.test(b)) || (fact?.levels?.find((l) => l.value === b)?.n ?? 0) - (fact?.levels?.find((l) => l.value === a)?.n ?? 0));
  out.forEach((slot) => { if (!slot.value && !slot.reference) { const value = rest.find((option) => !used.has(option)); if (value) { slot.value = value; used.add(value); } } });
  out.forEach((slot) => { if (!slot.value) { const value = [...rest].reverse().find((option) => !used.has(option)); if (value) { slot.value = value; used.add(value); } } });
  return out;
}

/**
 * Guess or take each role's column for the mapped tables and check them together. An input with no table keeps the
 * template's default names (the steps get them; Run stays off until a table is chosen).
 */
export function resolveColumns(roles: ColumnRole[], tables: Record<string, TableFacts | null>, given: Record<string, string> = {}): Resolution {
  const facts = Object.fromEntries(Object.entries(tables).map(([key, table]) => [key, table ? describeColumns(table) : null]));
  const problems: string[] = [];
  const resolved: ResolvedRole[] = [];
  const values: Record<string, string> = {};
  const taken = new Map<string, Set<string>>();
  // Samples before groups so the group guess skips the id column; ids first overall.
  const order: ColumnRole["kind"][] = ["feature", "sample", "group", "block", "subject", "text"];
  const sorted = [...roles].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  for (const role of sorted) {
    const table = facts[role.input];
    const counts = role.countsInput && tables[role.countsInput] ? new Set(tables[role.countsInput]!.columns.filter((column) => column.type === "number").map((column) => column.key)) : null;
    const used = taken.get(role.input) ?? new Set<string>();
    if (!table) {
      const levels = role.levels.map((slot) => ({ key: slot.key, label: slot.label, value: slot.default ?? null, reference: slot.reference, options: [] as string[] }));
      resolved.push({ key: role.key, input: role.input, label: role.label, kind: role.kind, optional: role.optional, hint: role.hint ?? null, column: role.optional ? null : role.default ?? null, guessed: true, options: [], levels });
      continue;
    }
    const options = table.filter((fact) => score(role, fact, { counts, taken: new Set() }) > -50).map((fact) => fact.key);
    const wanted = given[role.key];
    let column: string | null = null;
    let guessed = false;
    if (wanted !== undefined && (wanted === "" ? role.optional : table.some((fact) => fact.key === wanted))) column = wanted || null;
    else {
      const ranked = table.map((fact) => ({ fact, points: score(role, fact, { counts, taken: used }) })).filter((entry) => entry.points > -50).sort((a, b) => b.points - a.points);
      const best = ranked[0];
      // An optional role is only guessed when the name says so (or it is the example's column).
      if (best && (!role.optional || best.points >= 4)) column = best.fact.key;
      guessed = true;
    }
    if (column) used.add(column);
    taken.set(role.input, used);
    const fact = column ? table.find((candidate) => candidate.key === column) ?? null : null;
    const levels = role.kind === "group" ? chooseLevels(role, fact, given) : [];
    resolved.push({ key: role.key, input: role.input, label: role.label, kind: role.kind, optional: role.optional, hint: role.hint ?? null, column, guessed, options, levels });
    problems.push(...checkRole(role, fact, column, levels, counts));
  }
  // Two roles of one table on the same column (the group is also the pairing) is a design the steps cannot fit.
  for (const input of new Set(resolved.map((role) => role.input))) {
    const columns = resolved.filter((role) => role.input === input && role.column);
    const twice = columns.find((role, i) => columns.findIndex((other) => other.column === role.column) !== i);
    if (twice) problems.push(`${twice.column} is chosen twice; ${columns.filter((role) => role.column === twice.column).map((role) => role.label.toLowerCase()).join(" and ")} need different columns.`);
  }
  for (const role of roles) {
    const entry = resolved.find((candidate) => candidate.key === role.key)!;
    values[role.key] = entry.column ?? "";
    for (const level of entry.levels) values[`${role.key}.${level.key}`] = level.value ?? "";
  }
  return { roles: roles.map((role) => resolved.find((candidate) => candidate.key === role.key)!), problems, values };
}

function checkRole(role: ColumnRole, fact: ColumnFact | null, column: string | null, levels: ResolvedRole["levels"], counts: Set<string> | null): string[] {
  if (!column || !fact) return role.optional ? [] : [`Choose the ${role.label.toLowerCase()} column.`];
  const out: string[] = [];
  if (role.kind === "sample") {
    if (!fact.unique) out.push(`Sample ids in ${column} must be unique; some appear twice.`);
    if (counts?.size) {
      const ids = fact.values;
      const noRow = [...counts].filter((sample) => !ids.has(sample));
      const noColumn = [...ids].filter((sample) => !counts.has(sample));
      if (noRow.length === counts.size) out.push(`None of the ${plural(counts.size, "count column")} (${shortList([...counts])}) is a sample in ${column}. Choose the column that holds these names.`);
      else {
        if (noRow.length) out.push(`${plural(noRow.length, "count column")} ${noRow.length === 1 ? "has" : "have"} no row in ${column}: ${shortList(noRow)}.`);
        if (noColumn.length) out.push(`${plural(noColumn.length, "sample")} in ${column} ${noColumn.length === 1 ? "has" : "have"} no count column: ${shortList(noColumn)}.`);
      }
    }
  }
  if (role.kind === "group" || role.kind === "block") {
    if (!/^[A-Za-z][A-Za-z0-9._]*$/.test(column)) out.push(`${column} cannot go into the model formula; rename it in Data to letters, digits, dots or underscores.`);
  }
  if (role.kind === "group") {
    const all = fact.levels ?? [];
    const enough = all.filter((level) => level.n >= 2);
    if (all.length < 2) out.push(`${column} has ${all.length ? `only one value (${all[0].value})` : "no values"}; the comparison needs two groups.`);
    else if (enough.length < 2) out.push(`${column} needs at least two groups with two samples each; it has ${listWords(all.map((level) => `${level.value} ${level.n}`))}.`);
    const chosen = levels.filter((level) => level.value);
    if (chosen.length < levels.length) out.push(`Choose which values of ${column} to compare.`);
    for (const level of chosen) {
      const n = all.find((candidate) => candidate.value === level.value)?.n ?? 0;
      if (n < 2) out.push(`${level.label} ${level.value} has ${plural(n, "sample")}; each compared group needs at least two.`);
    }
  }
  if ((role.kind === "block" || role.kind === "subject") && (fact.levels?.length ?? 0) < 2) out.push(`${column} has one value only; leave ${role.label.toLowerCase()} empty or choose another column.`);
  return out;
}

/** The sentence under a mapped table: which columns play which role ("id SampleName · condition Treatment: treated vs control"). */
export function rolesLine(roles: ResolvedRole[], input: string): string {
  return roles.filter((role) => role.input === input && role.column).map((role) => {
    const levels = role.levels.filter((level) => level.value).map((level) => level.value);
    return `${role.label.toLowerCase()} ${role.column}${levels.length === 2 ? `: ${levels[0]} vs ${levels[1]}` : ""}`;
  }).join(" · ");
}

/**
 * Put the column choices into step params. A param that is exactly `{{role}}` becomes the column; inside text
 * (a model formula "~ {{block}} + {{group}}") an empty optional role drops out with its "+"; list entries that
 * end up empty are left out.
 */
export function fillColumnParams(params: Record<string, unknown>, values: Record<string, string>): Record<string, unknown> {
  const known = (key: string) => key in values;
  const fill = (value: unknown): unknown => {
    if (typeof value === "string") {
      if (!value.includes("{{")) return value;
      const whole = /^\{\{([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?)\}\}$/.exec(value);
      if (whole && known(whole[1])) return values[whole[1]];
      let out = value.replace(/\{\{([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?)\}\}(\s*\+\s*)?/g, (match, key: string, plus: string | undefined) => {
        if (!known(key)) return match;
        return values[key] ? `${values[key]}${plus ?? ""}` : "";
      });
      out = out.replace(/\+\s*$/, "").replace(/~\s*\+\s*/, "~ ").replace(/\s{2,}/g, " ").trim();
      return out;
    }
    if (Array.isArray(value)) return value.map(fill).filter((entry) => entry !== "");
    return value;
  };
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, fill(value)]));
}

/** The columns a mapped table must have for its check: the roles' columns, sample id first. */
export function roleColumns(roles: ResolvedRole[], input: string): string[] {
  const own = roles.filter((role) => role.input === input && role.column);
  return [...own.filter((role) => role.kind === "sample" || role.kind === "feature"), ...own.filter((role) => role.kind !== "sample" && role.kind !== "feature")].map((role) => role.column!);
}

