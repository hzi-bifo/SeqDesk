/**
 * A small in-memory stand-in for the Prisma client, for fast tests of code that reads and writes a handful of models
 * (pipeline steps). It understands what those modules use: equality, in/notIn/not/gt/gte/lt/lte/contains/startsWith,
 * OR/AND/NOT, compound unique keys (`a_b: {a, b}`), select of scalar fields, orderBy on one field, take, increment.
 * Relation filters and nested selects are ignored (a nested select answers undefined). Not a database.
 */
type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

let counter = 0;
export const memoryId = (prefix = "id") => `${prefix}_${(counter += 1).toString(36).padStart(4, "0")}`;

function compare(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : a, y = b instanceof Date ? b.getTime() : b;
  if (x === y) return 0;
  if (x === null || x === undefined) return -1;
  if (y === null || y === undefined) return 1;
  return (x as number) < (y as number) ? -1 : 1;
}

function matchesValue(value: unknown, condition: unknown): boolean {
  if (condition === null) return value === null || value === undefined;
  if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
  if (typeof condition !== "object") return value === condition;
  const ops = condition as Record<string, unknown>;
  const known = ["in", "notIn", "not", "gt", "gte", "lt", "lte", "contains", "startsWith", "endsWith", "equals"];
  if (!Object.keys(ops).some((key) => known.includes(key))) return true; // a relation filter: ignored
  if ("equals" in ops && !matchesValue(value, ops.equals)) return false;
  if ("in" in ops && !(ops.in as unknown[]).includes(value)) return false;
  if ("notIn" in ops && (ops.notIn as unknown[]).includes(value)) return false;
  if ("not" in ops) {
    if (ops.not !== null && typeof ops.not === "object" && !(ops.not instanceof Date)) { if (matchesValue(value, ops.not)) return false; }
    else if (ops.not === null ? value === null || value === undefined : value === ops.not || value === null || value === undefined) return false;
  }
  if ("gt" in ops && !(compare(value, ops.gt) > 0)) return false;
  if ("gte" in ops && !(compare(value, ops.gte) >= 0)) return false;
  if ("lt" in ops && !(compare(value, ops.lt) < 0)) return false;
  if ("lte" in ops && !(compare(value, ops.lte) <= 0)) return false;
  if ("contains" in ops && !(typeof value === "string" && value.includes(String(ops.contains)))) return false;
  if ("startsWith" in ops && !(typeof value === "string" && value.startsWith(String(ops.startsWith)))) return false;
  if ("endsWith" in ops && !(typeof value === "string" && value.endsWith(String(ops.endsWith)))) return false;
  return true;
}

export function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  for (const [key, condition] of Object.entries(where)) {
    if (condition === undefined) continue;
    if (key === "OR") { if (!(condition as Where[]).some((part) => matches(row, part))) return false; continue; }
    if (key === "AND") { if (!(Array.isArray(condition) ? condition : [condition]).every((part) => matches(row, part as Where))) return false; continue; }
    if (key === "NOT") { if ((Array.isArray(condition) ? condition : [condition]).some((part) => matches(row, part as Where))) return false; continue; }
    // A compound unique key: {a_b: {a, b}}.
    if (!(key in row) && condition && typeof condition === "object" && !(condition instanceof Date) && key.includes("_") && Object.keys(condition).every((part) => key.split("_").includes(part))) {
      if (!matches(row, condition as Where)) return false;
      continue;
    }
    if (!matchesValue(row[key], condition)) return false;
  }
  return true;
}

function apply(row: Row, data: Row): Row {
  const next = { ...row };
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (value && typeof value === "object" && !(value instanceof Date) && !Array.isArray(value) && "increment" in (value as Row)) next[key] = Number(next[key] ?? 0) + Number((value as Row).increment);
    else if (value && typeof value === "object" && !(value instanceof Date) && !Array.isArray(value) && "set" in (value as Row)) next[key] = (value as Row).set;
    else next[key] = value;
  }
  return next;
}

function pick(row: Row | undefined, select: Record<string, unknown> | undefined): Row | null {
  if (!row) return null;
  if (!select) return { ...row };
  const out: Row = {};
  for (const [key, wanted] of Object.entries(select)) if (wanted === true) out[key] = row[key];
  return out;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- a test double answers whatever shape the code under test asks for */
/** One model of the stand-in: the Prisma calls the code under test makes, typed loosely on purpose. */
export interface MemoryModel {
  findUnique(args: any): Promise<any>;
  findUniqueOrThrow(args: any): Promise<any>;
  findFirst(args?: any): Promise<any>;
  findMany(args?: any): Promise<any[]>;
  create(args: any): Promise<any>;
  update(args: any): Promise<any>;
  updateMany(args: any): Promise<{ count: number }>;
  upsert(args: any): Promise<any>;
  count(args?: any): Promise<number>;
  delete(args: any): Promise<any>;
  deleteMany(args?: any): Promise<{ count: number }>;
  groupBy(args?: any): Promise<any[]>;
}
export type MemoryClient = Record<string, MemoryModel> & { $transaction: (work: any) => Promise<any>; $queryRaw: (...args: any[]) => Promise<any[]> };
/* eslint-enable @typescript-eslint/no-explicit-any */

export type MemoryDb = ReturnType<typeof createMemoryDb>;

/** `defaults` per model fill fields Prisma would default (status, timestamps …). */
export function createMemoryDb(defaults: Record<string, Row> = {}) {
  const tables: Record<string, Row[]> = {};
  const table = (name: string) => (tables[name] ??= []);
  const sorted = (rows: Row[], orderBy: unknown) => {
    const orders = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Array<Record<string, "asc" | "desc">>;
    return [...rows].sort((a, b) => {
      for (const order of orders) for (const [key, direction] of Object.entries(order)) {
        const result = compare(a[key], b[key]);
        if (result) return direction === "desc" ? -result : result;
      }
      return 0;
    });
  };
  const model = (name: string) => ({
    findUnique: async (args: { where: Where; select?: Record<string, unknown> }) => pick(table(name).find((row) => matches(row, args.where)), args.select),
    findUniqueOrThrow: async (args: { where: Where; select?: Record<string, unknown> }) => { const row = table(name).find((entry) => matches(entry, args.where)); if (!row) throw new Error(`${name} not found`); return pick(row, args.select); },
    findFirst: async (args: { where?: Where; orderBy?: unknown; select?: Record<string, unknown> } = {}) => pick(sorted(table(name).filter((row) => matches(row, args.where)), args.orderBy)[0], args.select),
    findMany: async (args: { where?: Where; orderBy?: unknown; take?: number; select?: Record<string, unknown>; distinct?: string[] } = {}) => {
      let rows = sorted(table(name).filter((row) => matches(row, args.where)), args.orderBy);
      if (args.distinct?.length) { const seen = new Set<string>(); rows = rows.filter((row) => { const key = JSON.stringify(args.distinct!.map((field) => row[field])); if (seen.has(key)) return false; seen.add(key); return true; }); }
      return rows.slice(0, args.take ?? rows.length).map((row) => pick(row, args.select)!);
    },
    create: async (args: { data: Row; select?: Record<string, unknown> }) => {
      const now = new Date();
      const row: Row = { id: memoryId(name), createdAt: now, updatedAt: now, ...(defaults[name] ?? {}), ...Object.fromEntries(Object.entries(args.data).filter(([, value]) => value !== undefined)) };
      const unique = (defaults[name]?.__unique as string[][] | undefined) ?? [];
      // Like PostgreSQL: a unique key with a null part never collides.
      for (const fields of [["id"], ...unique]) if (fields.every((field) => row[field] !== null && row[field] !== undefined) && table(name).some((other) => fields.every((field) => other[field] === row[field]))) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      delete row.__unique;
      table(name).push(row);
      return pick(row, args.select);
    },
    update: async (args: { where: Where; data: Row; select?: Record<string, unknown> }) => {
      const rows = table(name);
      const index = rows.findIndex((row) => matches(row, args.where));
      if (index < 0) throw Object.assign(new Error(`${name} not found`), { code: "P2025" });
      rows[index] = apply(rows[index], { ...args.data, updatedAt: new Date() });
      return pick(rows[index], args.select);
    },
    updateMany: async (args: { where?: Where; data: Row }) => {
      const rows = table(name);
      let count = 0;
      rows.forEach((row, index) => { if (matches(row, args.where)) { rows[index] = apply(row, { ...args.data, updatedAt: new Date() }); count += 1; } });
      return { count };
    },
    upsert: async (args: { where: Where; update: Row; create: Row }) => {
      const rows = table(name);
      const index = rows.findIndex((row) => matches(row, args.where));
      if (index >= 0) { rows[index] = apply(rows[index], { ...args.update, updatedAt: new Date() }); return { ...rows[index] }; }
      const now = new Date();
      const row = { id: memoryId(name), createdAt: now, updatedAt: now, ...(defaults[name] ?? {}), ...args.create };
      delete (row as Row).__unique;
      rows.push(row);
      return { ...row };
    },
    count: async (args: { where?: Where } = {}) => table(name).filter((row) => matches(row, args.where)).length,
    delete: async (args: { where: Where }) => { const rows = table(name); const index = rows.findIndex((row) => matches(row, args.where)); const [row] = rows.splice(index, 1); return row; },
    deleteMany: async (args: { where?: Where } = {}) => { const rows = table(name); const keep = rows.filter((row) => !matches(row, args.where)); const count = rows.length - keep.length; tables[name] = keep; return { count }; },
    groupBy: async () => [],
  });
  const models = new Map<string, ReturnType<typeof model>>();
  const db = new Proxy({} as Record<string, unknown>, {
    get(_target, property: string) {
      if (property === "$transaction") return async (work: unknown) => (typeof work === "function" ? (work as (client: unknown) => unknown)(db) : Promise.all(work as unknown[]));
      if (property === "$queryRaw") return async () => [{ n: 3 }];
      if (property === "$executeRaw") return async () => 0;
      if (property === "then") return undefined;
      if (!models.has(property)) models.set(property, model(property));
      return models.get(property);
    },
  });
  /** Empty every table (between tests). */
  const reset = () => { for (const name of Object.keys(tables)) tables[name] = []; };
  return { db: db as unknown as MemoryClient, tables, table, reset };
}
