/**
 * Pure recipe arithmetic shared by the flow runner and the recipe routes:
 * fractional order keys, step numbering (1, 2, 4b, 3a) and the dependency
 * graph between steps. Nothing here touches the database.
 */

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;

function digit(char: string | undefined): number {
  if (char === undefined) return 0;
  const index = DIGITS.indexOf(char);
  if (index < 0) throw new Error(`Invalid order key digit: ${char}`);
  return index;
}

/**
 * A key strictly between `a` and `b` (fractional digits in base 62; "" is the
 * start, null the end). Keys never end in "0", so there is always room.
 */
export function keyBetween(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`Order keys out of order: ${a} >= ${b}`);
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? "0") === b[n]) n += 1;
    if (n > 0) return b.slice(0, n) + keyBetween(a.slice(n), b.slice(n));
  }
  const low = digit(a[0]);
  const high = b !== null ? digit(b[0]) : BASE;
  if (high - low > 1) return DIGITS[Math.round((low + high) / 2)];
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[low] + keyBetween(a.slice(1), null);
}

/** `count` evenly spread keys for a fresh ordering. */
export function spreadKeys(count: number): string[] {
  if (count <= 0) return [];
  if (count < BASE - 1) return Array.from({ length: count }, (_, index) => DIGITS[Math.floor(((index + 1) * BASE) / (count + 1))]);
  const keys: string[] = [];
  let previous = "";
  for (let index = 0; index < count; index += 1) {
    previous = keyBetween(previous, null);
    keys.push(previous);
  }
  return keys;
}

export interface OrderableStep {
  id: string;
  position: string;
  createdAt: Date;
  laneKind: string | null;
  laneOf: string | null;
}

const byPosition = <T extends OrderableStep>(a: T, b: T) =>
  a.position === b.position ? a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id) : a.position < b.position ? -1 : 1;

/** Steps in recipe order: position, then creation. */
export function sortSteps<T extends OrderableStep>(steps: T[]): T[] {
  return [...steps].sort(byPosition);
}

/**
 * Order for a fresh recipe (steps without a position yet): lineage first, so a
 * step comes after the steps it reads from, then creation time.
 */
export function lineageOrder<T extends OrderableStep>(steps: T[], upstream: Map<string, Set<string>>): T[] {
  const byCreation = [...steps].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const ids = new Set(steps.map((step) => step.id));
  const done = new Set<string>();
  const out: T[] = [];
  while (out.length < byCreation.length) {
    const next = byCreation.find((step) => !done.has(step.id) && [...(upstream.get(step.id) ?? [])].every((dep) => done.has(dep) || !ids.has(dep)))
      ?? byCreation.find((step) => !done.has(step.id))!; // a cycle: fall back to creation order
    done.add(next.id);
    out.push(next);
  }
  return out;
}

/**
 * Labels: main-lane steps 1..n; an alternative to step N is Nb, Nc...; a
 * "repeat for each" lane of step N is Na, Nb... A lane whose anchor is gone
 * counts as a main-lane step.
 */
export function labelSteps<T extends OrderableStep>(ordered: T[]): Map<string, string> {
  const ids = new Set(ordered.map((step) => step.id));
  const isLane = (step: T) => Boolean(step.laneKind && step.laneOf && step.laneOf !== step.id && ids.has(step.laneOf));
  const labels = new Map<string, string>();
  let number = 0;
  for (const step of ordered) if (!isLane(step)) labels.set(step.id, String(++number));
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const alternatives = new Map<string, number>();
  const forEach = new Map<string, number>();
  const anchorLabel = (step: T, seen = new Set<string>()): string => {
    if (labels.has(step.id)) return labels.get(step.id)!;
    const anchor = ordered.find((entry) => entry.id === step.laneOf);
    if (!anchor || seen.has(anchor.id)) return "?";
    seen.add(step.id);
    return anchorLabel(anchor, seen);
  };
  for (const step of ordered) {
    if (!isLane(step)) continue;
    const anchor = ordered.find((entry) => entry.id === step.laneOf)!;
    const base = anchorLabel(anchor).replace(/[a-z]+$/, "");
    if (step.laneKind === "forEach") {
      const index = forEach.get(anchor.id) ?? 0;
      forEach.set(anchor.id, index + 1);
      labels.set(step.id, `${base}${letters[index % 26]}`);
    } else {
      const index = alternatives.get(anchor.id) ?? 1;
      alternatives.set(anchor.id, index + 1);
      labels.set(step.id, `${base}${letters[index % 26]}`);
    }
  }
  return labels;
}

/** Every step downstream of `roots` (inclusive), following the reads-from graph. */
export function downstreamOf(roots: Iterable<string>, upstream: Map<string, Set<string>>): Set<string> {
  const result = new Set(roots);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [step, deps] of upstream) {
      if (result.has(step)) continue;
      if ([...deps].some((dep) => result.has(dep))) {
        result.add(step);
        grew = true;
      }
    }
  }
  return result;
}

/** Every step upstream of `roots` (exclusive). */
export function upstreamOf(roots: Iterable<string>, upstream: Map<string, Set<string>>): Set<string> {
  const result = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const step = queue.pop()!;
    for (const dep of upstream.get(step) ?? []) {
      if (result.has(dep)) continue;
      result.add(dep);
      queue.push(dep);
    }
  }
  return result;
}

/**
 * Execution order: a step only after the steps it reads from, recipe order
 * among the rest. Cycles (a step reading its own descendant's table) fall back
 * to recipe order.
 */
export function executionOrder<T extends OrderableStep>(ordered: T[], upstream: Map<string, Set<string>>): T[] {
  const ids = new Set(ordered.map((step) => step.id));
  const done = new Set<string>();
  const out: T[] = [];
  while (out.length < ordered.length) {
    const next = ordered.find((step) => !done.has(step.id) && [...(upstream.get(step.id) ?? [])].every((dep) => done.has(dep) || !ids.has(dep)))
      ?? ordered.find((step) => !done.has(step.id))!;
    done.add(next.id);
    out.push(next);
  }
  return out;
}
