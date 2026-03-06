import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestError,
  TestResult,
} from "@playwright/test/reporter";
import {
  createDashboardModuleEntry,
  createDashboardStatus,
  refreshDashboardModule,
  type DashboardCaseState,
  type DashboardMode,
  type DashboardModuleEntry,
  type DashboardModuleState,
  type DashboardRunState,
  type DashboardStatus,
  type DashboardTestCase,
  type DashboardTier,
} from "../src/lib/testing/dashboard";
import { writeDashboardStatus } from "../src/lib/testing/dashboard-status";

function getErrorMessage(error: TestError | undefined): string | null {
  if (!error) {
    return null;
  }

  return error.message ?? error.value ?? error.stack ?? "Unknown Playwright error";
}

function collectDescribeTitles(suite: Suite): string[] {
  const titles: string[] = [];
  let current: Suite | undefined = suite;

  while (current && current.type !== "file" && current.type !== "project" && current.type !== "root") {
    if (current.title) {
      titles.unshift(current.title);
    }
    current = current.parent;
  }

  return titles;
}

function buildCaseIdentity(test: TestCase): { fullName: string; suitePath: string | null } {
  const projectName = test.parent.project()?.name ?? "playwright";
  const suiteTitles = [projectName, ...collectDescribeTitles(test.parent)].filter(Boolean);

  return {
    fullName: [...suiteTitles, test.title].join(" > "),
    suitePath: suiteTitles.length > 0 ? suiteTitles.join(" > ") : null,
  };
}

function mapResultState(
  status: TestResult["status"] | null,
  running: boolean = false
): DashboardCaseState {
  if (running) {
    return "running";
  }

  if (status == null) {
    return "pending";
  }
  if (status === "passed") {
    return "passed";
  }
  if (status === "skipped") {
    return "skipped";
  }
  if (status === "failed" || status === "timedOut" || status === "interrupted") {
    return "failed";
  }
  return "pending";
}

function buildDashboardCase(test: TestCase, result?: TestResult, running: boolean = false): DashboardTestCase {
  const identity = buildCaseIdentity(test);

  return {
    id: test.id,
    name: test.title,
    fullName: identity.fullName,
    suitePath: identity.suitePath,
    state: mapResultState(result?.status ?? null, running),
    durationMs: result?.duration ?? null,
    errorMessage: getErrorMessage(result?.error ?? result?.errors?.[0]),
  };
}

function upsertCase(cases: DashboardTestCase[], nextCase: DashboardTestCase): DashboardTestCase[] {
  const nextCases = [...cases];
  const existingIndex = nextCases.findIndex((testCase) => testCase.id === nextCase.id);

  if (existingIndex >= 0) {
    nextCases[existingIndex] = nextCase;
    return nextCases;
  }

  nextCases.push(nextCase);
  return nextCases;
}

function calculateDuration(cases: DashboardTestCase[]): number | null {
  const durations = cases
    .map((testCase) => testCase.durationMs)
    .filter((durationMs): durationMs is number => durationMs != null);

  if (durations.length === 0) {
    return null;
  }

  return durations.reduce((total, durationMs) => total + durationMs, 0);
}

function inferEntryState(entry: DashboardModuleEntry, fallback: DashboardModuleState = "pending"): DashboardModuleState {
  if (entry.counts.failed > 0) {
    return "failed";
  }
  if (entry.counts.running > 0) {
    return "running";
  }
  if (entry.counts.pending > 0) {
    return fallback === "queued" ? "queued" : "pending";
  }
  if (entry.counts.total > 0 && entry.counts.skipped === entry.counts.total) {
    return "skipped";
  }
  if (entry.counts.total > 0 && entry.counts.passed + entry.counts.skipped === entry.counts.total) {
    return "passed";
  }
  return fallback;
}

export default class PlaywrightDashboardReporter implements Reporter {
  private readonly modules = new Map<string, DashboardModuleEntry>();
  private readonly cwd = process.env.SEQDESK_DASHBOARD_CWD || process.cwd();
  private readonly filters = JSON.parse(process.env.SEQDESK_DASHBOARD_FILTERS || "[]") as string[];
  private readonly mode = (process.env.SEQDESK_DASHBOARD_MODE || "run") as DashboardMode;
  private readonly statusFilePath = process.env.SEQDESK_DASHBOARD_STATUS_FILE || "";
  private readonly tier = (process.env.SEQDESK_DASHBOARD_TIER || "ui") as DashboardTier;
  private writeChain: Promise<void> = Promise.resolve();
  private runState: DashboardRunState = "idle";
  private startedAt: string | null = null;
  private finishedAt: string | null = null;
  private reason: string | null = null;
  private note: string | null = null;
  private errorCount = 0;

  printsToStdio(): boolean {
    return false;
  }

  private ensureModule(moduleId: string, updatedAt: string): DashboardModuleEntry {
    const existing = this.modules.get(moduleId);
    if (existing) {
      return existing;
    }

    const nextEntry = createDashboardModuleEntry(moduleId, this.cwd, updatedAt);
    this.modules.set(moduleId, nextEntry);
    return nextEntry;
  }

  private setModule(entry: DashboardModuleEntry): void {
    this.modules.set(entry.moduleId, entry);
  }

  private flushStatus(updatedAt: string = new Date().toISOString()): Promise<void> {
    if (!this.statusFilePath) {
      return Promise.resolve();
    }

    const status: DashboardStatus = createDashboardStatus({
      state: this.runState,
      tier: this.tier,
      mode: this.mode,
      filters: this.filters,
      modules: Array.from(this.modules.values()),
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      reason: this.reason,
      errorCount: this.errorCount,
      note: this.note,
      updatedAt,
    });

    this.writeChain = this.writeChain
      .then(() => writeDashboardStatus(status, this.statusFilePath))
      .catch((error) => {
        console.error("Failed to write Playwright dashboard status:", error);
      });

    return this.writeChain;
  }

  onBegin(_config: FullConfig, suite: Suite): void {
    const now = new Date().toISOString();
    this.modules.clear();

    for (const test of suite.allTests()) {
      const moduleId = test.location.file;
      const entry = this.ensureModule(moduleId, now);
      const nextCases = upsertCase(entry.cases, buildDashboardCase(test));
      const nextEntry = refreshDashboardModule(
        {
          ...entry,
          state: "pending",
          cases: nextCases,
        },
        {
          state: "pending",
          durationMs: calculateDuration(nextCases),
          lastError: null,
        },
        now
      );
      this.setModule(nextEntry);
    }

    this.startedAt = now;
    this.finishedAt = null;
    this.reason = null;
    this.errorCount = 0;
    this.note =
      this.modules.size === 0 ? "No matching Playwright tests were discovered for this run." : null;
    this.runState = "collecting";
    void this.flushStatus(now);
  }

  onTestBegin(test: TestCase, result: TestResult): void {
    const now = new Date().toISOString();
    const entry = this.ensureModule(test.location.file, now);
    const nextCases = upsertCase(entry.cases, buildDashboardCase(test, result, true));
    const nextEntry = refreshDashboardModule(
      {
        ...entry,
        state: "running",
        cases: nextCases,
      },
      {
        state: "running",
        durationMs: calculateDuration(nextCases),
        lastError: null,
      },
      now
    );

    this.runState = "running";
    this.note = null;
    this.setModule(nextEntry);
    void this.flushStatus(now);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const now = new Date().toISOString();
    const entry = this.ensureModule(test.location.file, now);
    const nextCases = upsertCase(entry.cases, buildDashboardCase(test, result));
    const refreshedEntry = refreshDashboardModule(
      {
        ...entry,
        cases: nextCases,
      },
      {
        durationMs: calculateDuration(nextCases),
      },
      now
    );
    const nextEntry = refreshDashboardModule(
      {
        ...refreshedEntry,
        state: inferEntryState(refreshedEntry),
      },
      {
        state: inferEntryState(refreshedEntry),
        durationMs: calculateDuration(nextCases),
      },
      now
    );

    this.setModule(nextEntry);
    void this.flushStatus(now);
  }

  onError(error: TestError): void {
    this.errorCount += 1;
    this.note = getErrorMessage(error) ?? "Playwright reported an unhandled error.";
    void this.flushStatus();
  }

  async onEnd(result: FullResult): Promise<void> {
    const now = new Date().toISOString();
    this.finishedAt = now;
    this.reason = result.status;

    if (this.modules.size === 0) {
      this.runState = "idle";
      this.note = "No matching Playwright tests were found for this run.";
      await this.flushStatus(now);
      return;
    }

    const hasFailedModule = Array.from(this.modules.values()).some(
      (moduleEntry) => moduleEntry.state === "failed" || moduleEntry.counts.failed > 0
    );

    if (result.status === "interrupted") {
      this.runState = "cancelled";
      this.note = "Run cancelled from Playwright.";
    } else if (result.status === "timedout") {
      this.runState = "failed";
      this.note = "Playwright hit the global timeout.";
    } else if (result.status === "failed" || hasFailedModule || this.errorCount > 0) {
      this.runState = "failed";
      this.note = null;
    } else {
      this.runState = "passed";
      this.note = null;
    }

    await this.flushStatus(now);
  }
}
