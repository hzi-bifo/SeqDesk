import path from "path";

export type DashboardTier = "fast" | "risk" | "live" | "ui" | "all";
export type DashboardModuleTier = Exclude<DashboardTier, "all">;
export type DashboardMode = "run" | "watch";
export type DashboardRunState =
  | "idle"
  | "collecting"
  | "running"
  | "passed"
  | "failed"
  | "cancelled";
export type DashboardModuleState =
  | "queued"
  | "collecting"
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "skipped";
export type DashboardCaseState = "pending" | "running" | "passed" | "failed" | "skipped";

export interface DashboardTestCase {
  id: string;
  name: string;
  fullName: string;
  suitePath: string | null;
  state: DashboardCaseState;
  durationMs: number | null;
  errorMessage: string | null;
}

export interface DashboardModuleCounts {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  pending: number;
  running: number;
}

export interface DashboardModuleEntry {
  moduleId: string;
  relativePath: string;
  section: string;
  title: string;
  tier: DashboardModuleTier;
  state: DashboardModuleState;
  description: string;
  counts: DashboardModuleCounts;
  durationMs: number | null;
  cases: DashboardTestCase[];
  lastError: string | null;
  updatedAt: string;
}

export interface DashboardTotals extends DashboardModuleCounts {
  modules: number;
  passedModules: number;
  failedModules: number;
  skippedModules: number;
  runningModules: number;
  queuedModules: number;
  pendingModules: number;
}

export interface DashboardStatus {
  version: 1;
  run: {
    state: DashboardRunState;
    tier: DashboardTier;
    mode: DashboardMode;
    filters: string[];
    startedAt: string | null;
    finishedAt: string | null;
    updatedAt: string;
    reason: string | null;
    errorCount: number;
  };
  totals: DashboardTotals;
  modules: DashboardModuleEntry[];
  note: string | null;
}

const TOKEN_LABELS: Record<string, string> = {
  api: "API",
  ena: "ENA",
  id: "ID",
  ids: "IDs",
  url: "URL",
  urls: "URLs",
  qc: "QC",
  mixs: "MIxS",
  submg: "SubMG",
};

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function stripQueryAndHash(value: string): string {
  return value.split("?")[0]?.split("#")[0] ?? value;
}

export function normalizeRelativeModulePath(moduleId: string, cwd: string = process.cwd()): string {
  const sanitized = stripQueryAndHash(moduleId).replace(/^file:\/\//, "");
  if (!path.isAbsolute(sanitized)) {
    return toPosixPath(sanitized);
  }

  const relative = path.relative(cwd, sanitized);
  if (relative.startsWith("..")) {
    return toPosixPath(sanitized);
  }

  return toPosixPath(relative);
}

function stripTestSuffix(value: string): string {
  return value.replace(/\.(risk|live)\.test\.[cm]?[tj]sx?$/i, "").replace(/\.test\.[cm]?[tj]sx?$/i, "").replace(/\.spec\.[cm]?[tj]sx?$/i, "").replace(/\.[cm]?[tj]sx?$/i, "");
}

function humanizeToken(token: string): string {
  const raw = stripTestSuffix(token)
    .replace(/^\[(.+)\]$/, "$1")
    .replace(/\.+/g, " ")
    .replace(/[-_]/g, " ")
    .trim();

  if (!raw) {
    return "General";
  }

  return raw
    .split(/\s+/)
    .map((part) => {
      const lower = part.toLowerCase();
      if (TOKEN_LABELS[lower]) {
        return TOKEN_LABELS[lower];
      }
      if (/^[A-Z0-9]+$/.test(part)) {
        return part;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    output.push(trimmed);
  }

  return output;
}

export function resolveDashboardModuleTier(relativePath: string): DashboardModuleTier {
  const normalized = normalizeRelativeModulePath(relativePath);

  if (normalized.startsWith("playwright/tests/")) {
    return "ui";
  }

  if (/\.risk\.test\.[cm]?[tj]sx?$/i.test(normalized)) {
    return "risk";
  }
  if (/\.live\.test\.[cm]?[tj]sx?$/i.test(normalized)) {
    return "live";
  }
  return "fast";
}

export function resolveDashboardSection(relativePath: string): string {
  const parts = normalizeRelativeModulePath(relativePath).split("/");

  if (parts[0] === "playwright" && parts[1] === "tests") {
    return "Playwright E2E";
  }

  if (parts[0] === "src" && parts[1] === "app" && parts[2] === "api") {
    const apiParts = parts.slice(3, -1).filter((part) => !part.startsWith("["));
    if (apiParts[0] === "admin") {
      const meaningful = apiParts.filter((part) => part !== "admin" && part !== "settings");
      return `Admin API / ${humanizeToken(meaningful[0] ?? "general")}`;
    }
    return `API / ${humanizeToken(apiParts[0] ?? "general")}`;
  }

  if (parts[0] === "src" && parts[1] === "lib") {
    const libParts = parts.slice(2, -1).filter((part) => !part.startsWith("["));
    if (libParts[0] === "pipelines") {
      return libParts[1]
        ? `Pipelines / ${humanizeToken(libParts[1])}`
        : "Pipelines";
    }
    return humanizeToken(libParts[0] ?? "general");
  }

  return "Other";
}

export function resolveDashboardTitle(relativePath: string): string {
  const normalized = normalizeRelativeModulePath(relativePath);
  const parts = normalized.split("/");
  const fileName = parts.at(-1) ?? normalized;

  if (fileName.startsWith("route.test.")) {
    const routeParts = parts
      .slice(0, -1)
      .filter((part) => !part.startsWith("["))
      .filter((part) => !["src", "app", "api", "admin", "settings"].includes(part));
    const titleParts = routeParts.slice(-2);
    return `${titleParts.map(humanizeToken).join(" ") || "Route"} route`;
  }

  return humanizeToken(fileName);
}

export function buildDashboardDescription(caseNames: string[]): string {
  const uniqueNames = uniqueStrings(caseNames);
  if (uniqueNames.length === 0) {
    return "Waiting for test cases to be collected.";
  }

  const preview = uniqueNames.slice(0, 3);
  const remaining = uniqueNames.length - preview.length;
  const suffix = remaining > 0 ? `; +${remaining} more` : "";

  return `${preview.join("; ")}${suffix}`;
}

export function calculateDashboardModuleCounts(cases: DashboardTestCase[]): DashboardModuleCounts {
  return cases.reduce<DashboardModuleCounts>(
    (totals, testCase) => {
      totals.total += 1;
      if (testCase.state === "passed") totals.passed += 1;
      if (testCase.state === "failed") totals.failed += 1;
      if (testCase.state === "skipped") totals.skipped += 1;
      if (testCase.state === "pending") totals.pending += 1;
      if (testCase.state === "running") totals.running += 1;
      return totals;
    },
    {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      pending: 0,
      running: 0,
    }
  );
}

export function refreshDashboardModule(
  entry: DashboardModuleEntry,
  overrides: Partial<Omit<DashboardModuleEntry, "moduleId" | "relativePath" | "section" | "title" | "tier" | "cases">> = {},
  updatedAt: string = new Date().toISOString()
): DashboardModuleEntry {
  const counts = calculateDashboardModuleCounts(entry.cases);
  const lastCaseError = entry.cases.find((testCase) => testCase.errorMessage)?.errorMessage ?? null;

  return {
    ...entry,
    counts,
    description: buildDashboardDescription(entry.cases.map((testCase) => testCase.fullName)),
    lastError: overrides.lastError ?? entry.lastError ?? lastCaseError,
    updatedAt,
    ...overrides,
  };
}

export function sortDashboardModules(modules: DashboardModuleEntry[]): DashboardModuleEntry[] {
  return [...modules].sort((left, right) => {
    const sectionResult = left.section.localeCompare(right.section);
    if (sectionResult !== 0) {
      return sectionResult;
    }

    const titleResult = left.title.localeCompare(right.title);
    if (titleResult !== 0) {
      return titleResult;
    }

    return left.relativePath.localeCompare(right.relativePath);
  });
}

export function calculateDashboardTotals(modules: DashboardModuleEntry[]): DashboardTotals {
  return modules.reduce<DashboardTotals>(
    (totals, moduleEntry) => {
      totals.modules += 1;
      totals.total += moduleEntry.counts.total;
      totals.passed += moduleEntry.counts.passed;
      totals.failed += moduleEntry.counts.failed;
      totals.skipped += moduleEntry.counts.skipped;
      totals.pending += moduleEntry.counts.pending;
      totals.running += moduleEntry.counts.running;

      if (moduleEntry.state === "passed") totals.passedModules += 1;
      if (moduleEntry.state === "failed") totals.failedModules += 1;
      if (moduleEntry.state === "skipped") totals.skippedModules += 1;
      if (moduleEntry.state === "running") totals.runningModules += 1;
      if (moduleEntry.state === "queued") totals.queuedModules += 1;
      if (moduleEntry.state === "pending" || moduleEntry.state === "collecting") totals.pendingModules += 1;

      return totals;
    },
    {
      modules: 0,
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      pending: 0,
      running: 0,
      passedModules: 0,
      failedModules: 0,
      skippedModules: 0,
      runningModules: 0,
      queuedModules: 0,
      pendingModules: 0,
    }
  );
}

export function createDashboardModuleEntry(
  moduleId: string,
  cwd: string = process.cwd(),
  updatedAt: string = new Date().toISOString()
): DashboardModuleEntry {
  const relativePath = normalizeRelativeModulePath(moduleId, cwd);

  return {
    moduleId,
    relativePath,
    section: resolveDashboardSection(relativePath),
    title: resolveDashboardTitle(relativePath),
    tier: resolveDashboardModuleTier(relativePath),
    state: "queued",
    description: "Waiting for test cases to be collected.",
    counts: {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      pending: 0,
      running: 0,
    },
    durationMs: null,
    cases: [],
    lastError: null,
    updatedAt,
  };
}

export function createDashboardStatus(options: {
  state: DashboardRunState;
  tier: DashboardTier;
  mode: DashboardMode;
  filters?: string[];
  modules?: DashboardModuleEntry[];
  startedAt?: string | null;
  finishedAt?: string | null;
  reason?: string | null;
  errorCount?: number;
  note?: string | null;
  updatedAt?: string;
}): DashboardStatus {
  const updatedAt = options.updatedAt ?? new Date().toISOString();
  const modules = sortDashboardModules(options.modules ?? []);

  return {
    version: 1,
    run: {
      state: options.state,
      tier: options.tier,
      mode: options.mode,
      filters: options.filters ?? [],
      startedAt: options.startedAt ?? null,
      finishedAt: options.finishedAt ?? null,
      updatedAt,
      reason: options.reason ?? null,
      errorCount: options.errorCount ?? 0,
    },
    totals: calculateDashboardTotals(modules),
    modules,
    note: options.note ?? null,
  };
}
