#!/usr/bin/env node

import http from "node:http";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import path from "node:path";
import {
  startVitest,
  type Vitest,
  type Reporter,
  type TestCase,
  type TestModule,
  type TestRunEndReason,
  type TestSpecification,
} from "vitest/node";
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
import {
  clearDashboardStatus,
  getDashboardStatusFilePath,
  readDashboardStatus,
  writeDashboardStatus,
} from "../src/lib/testing/dashboard-status";

interface CliOptions {
  tier: DashboardTier;
  mode: DashboardMode;
  coverage: boolean;
  host: string;
  port: number;
  openBrowser: boolean;
  filters: string[];
}

const DEFAULT_HOST = "127.0.0.1";
const PLAYWRIGHT_CLI_PATH = path.join(process.cwd(), "node_modules", "playwright", "cli.js");
const PLAYWRIGHT_REPORTER_PATH = path.join(process.cwd(), "scripts", "playwright-dashboard-reporter.ts");
const TERMINAL_RUN_STATES = new Set<DashboardRunState>(["passed", "failed", "cancelled"]);

function printHelp(): void {
  process.stdout.write(`Usage: node scripts/test-dashboard.ts [options] [filters...]

Options:
  --tier <fast|risk|live|ui|all>  Test tier to run (default: fast)
  --watch                      Keep Vitest running in watch mode
  --coverage                   Enable coverage for the run
  --host <host>                Dashboard host (default: ${DEFAULT_HOST})
  --port <port>                Dashboard port (default: random free port)
  --no-open                    Do not open the browser automatically
  --help                       Show this help
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    tier: "fast",
    mode: "run",
    coverage: false,
    host: DEFAULT_HOST,
    port: 0,
    openBrowser: true,
    filters: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (!value.startsWith("--")) {
      options.filters.push(value);
      continue;
    }

    if (value === "--help") {
      printHelp();
      process.exit(0);
    }

    if (value === "--watch") {
      options.mode = "watch";
      continue;
    }

    if (value === "--coverage") {
      options.coverage = true;
      continue;
    }

    if (value === "--no-open") {
      options.openBrowser = false;
      continue;
    }

    if (value === "--tier") {
      const tier = argv[index + 1];
      if (!tier || !["fast", "risk", "live", "ui", "all"].includes(tier)) {
        throw new Error("Expected --tier to be one of: fast, risk, live, ui, all.");
      }
      options.tier = tier as DashboardTier;
      index += 1;
      continue;
    }

    if (value === "--host") {
      const host = argv[index + 1];
      if (!host) {
        throw new Error("Expected a host after --host.");
      }
      options.host = host;
      index += 1;
      continue;
    }

    if (value === "--port") {
      const port = Number.parseInt(argv[index + 1] ?? "", 10);
      if (Number.isNaN(port) || port < 0) {
        throw new Error("Expected a valid port after --port.");
      }
      options.port = port;
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${value}`);
  }

  if (options.tier === "ui" && options.mode === "watch") {
    throw new Error("The ui tier does not support --watch. Use the dashboard rerun button instead.");
  }

  return options;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function getCaseState(testCase: TestCase, stateOverride?: DashboardCaseState): DashboardCaseState {
  if (stateOverride) {
    return stateOverride;
  }

  const state = testCase.result().state;
  if (state === "passed" || state === "failed" || state === "skipped") {
    return state;
  }
  return "pending";
}

function mapModuleState(state: string): DashboardModuleState {
  if (
    state === "queued" ||
    state === "pending" ||
    state === "running" ||
    state === "passed" ||
    state === "failed" ||
    state === "skipped"
  ) {
    return state;
  }
  return "pending";
}

function buildDashboardCase(testCase: TestCase, stateOverride?: DashboardCaseState): DashboardTestCase {
  const fullName = testCase.fullName;
  const suitePath = fullName.includes(" > ") ? fullName.split(" > ").slice(0, -1).join(" > ") : null;
  const diagnostic = testCase.diagnostic();

  return {
    id: testCase.id,
    name: testCase.name,
    fullName,
    suitePath,
    state: getCaseState(testCase, stateOverride),
    durationMs: diagnostic?.duration ?? null,
    errorMessage: testCase.result().errors?.[0] ? getErrorMessage(testCase.result().errors?.[0]) : null,
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

function syncCasesFromModule(
  existingCases: DashboardTestCase[],
  testModule: TestModule
): DashboardTestCase[] {
  return Array.from(testModule.children.allTests()).reduce<DashboardTestCase[]>(
    (cases, testCase) => upsertCase(cases, buildDashboardCase(testCase)),
    existingCases
  );
}

function inferEntryState(
  entry: DashboardModuleEntry,
  preferredState: DashboardModuleState
): DashboardModuleState {
  if (entry.counts.failed > 0) {
    return "failed";
  }
  if (preferredState === "collecting" || preferredState === "queued") {
    return preferredState;
  }
  if (entry.counts.running > 0) {
    return "running";
  }
  if (entry.counts.pending > 0) {
    return preferredState === "running" ? "running" : "pending";
  }
  if (entry.counts.total > 0 && entry.counts.skipped === entry.counts.total) {
    return "skipped";
  }
  if (entry.counts.total > 0 && entry.counts.passed + entry.counts.skipped === entry.counts.total) {
    return "passed";
  }
  return preferredState;
}

function isPlaywrightTier(tier: DashboardTier): boolean {
  return tier === "ui";
}

function resetModulesForNewRun(
  modules: DashboardModuleEntry[],
  updatedAt: string
): DashboardModuleEntry[] {
  return modules.map((moduleEntry) =>
    refreshDashboardModule(
      {
        ...moduleEntry,
        state: "queued",
        durationMs: null,
        lastError: null,
        cases: moduleEntry.cases.map((testCase) => ({
          ...testCase,
          state: "pending",
          durationMs: null,
          errorMessage: null,
        })),
      },
      {
        state: "queued",
        durationMs: null,
        lastError: null,
      },
      updatedAt
    )
  );
}

function createQueuedRunStatus(
  status: DashboardStatus,
  options: CliOptions,
  note: string
): DashboardStatus {
  const now = new Date().toISOString();

  return createDashboardStatus({
    state: "collecting",
    tier: options.tier,
    mode: options.mode,
    filters: options.filters,
    modules: resetModulesForNewRun(status.modules, now),
    startedAt: now,
    finishedAt: null,
    reason: null,
    errorCount: 0,
    note,
    updatedAt: now,
  });
}

class LiveDashboardReporter implements Reporter {
  private readonly modules = new Map<string, DashboardModuleEntry>();
  private writeChain: Promise<void> = Promise.resolve();
  private runState: DashboardRunState = "idle";
  private startedAt: string | null = null;
  private finishedAt: string | null = null;
  private reason: string | null = null;
  private note: string | null = null;
  private errorCount = 0;
  private started = false;
  private readonly options: {
    tier: DashboardTier;
    mode: DashboardMode;
    filters: string[];
    cwd: string;
    statusFilePath: string;
  };

  constructor(options: {
    tier: DashboardTier;
    mode: DashboardMode;
    filters: string[];
    cwd: string;
    statusFilePath: string;
  }) {
    this.options = options;
  }

  hasStartedRun(): boolean {
    return this.started;
  }

  async flush(): Promise<void> {
    const status = createDashboardStatus({
      state: this.runState,
      tier: this.options.tier,
      mode: this.options.mode,
      filters: this.options.filters,
      modules: Array.from(this.modules.values()),
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      reason: this.reason,
      errorCount: this.errorCount,
      note: this.note,
    });

    this.writeChain = this.writeChain
      .then(() => writeDashboardStatus(status, this.options.statusFilePath))
      .catch((error) => {
        console.error("Failed to write test dashboard status:", error);
      });

    return this.writeChain;
  }

  async waitForWrites(): Promise<void> {
    await this.writeChain;
  }

  private ensureModule(moduleId: string, updatedAt: string = new Date().toISOString()): DashboardModuleEntry {
    const existing = this.modules.get(moduleId);
    if (existing) {
      return existing;
    }

    const nextEntry = createDashboardModuleEntry(moduleId, this.options.cwd, updatedAt);
    this.modules.set(moduleId, nextEntry);
    return nextEntry;
  }

  private setModule(entry: DashboardModuleEntry): void {
    this.modules.set(entry.moduleId, entry);
  }

  private resetModulesForNewRun(updatedAt: string): void {
    const moduleIds = Array.from(this.modules.keys());
    this.modules.clear();

    for (const moduleId of moduleIds) {
      this.modules.set(
        moduleId,
        createDashboardModuleEntry(moduleId, this.options.cwd, updatedAt)
      );
    }
  }

  async onWatcherRerun(_files: string[], trigger?: string): Promise<void> {
    const now = new Date().toISOString();
    this.resetModulesForNewRun(now);
    this.note = trigger ? `Rerunning after ${trigger}.` : "Rerunning tests.";
    this.runState = "collecting";
    this.finishedAt = null;
    this.reason = null;
    this.errorCount = 0;
    await this.flush();
  }

  async onTestRunStart(specifications: ReadonlyArray<TestSpecification>): Promise<void> {
    const now = new Date().toISOString();
    this.modules.clear();
    for (const specification of specifications) {
      this.modules.set(
        specification.moduleId,
        createDashboardModuleEntry(specification.moduleId, this.options.cwd, now)
      );
    }

    this.started = true;
    this.startedAt = now;
    this.finishedAt = null;
    this.reason = null;
    this.errorCount = 0;
    this.note =
      specifications.length === 0 ? "No matching Vitest files were discovered for this run." : null;
    this.runState = "collecting";
    await this.flush();
  }

  async onTestModuleQueued(testModule: TestModule): Promise<void> {
    const now = new Date().toISOString();
    const entry = refreshDashboardModule(
      {
        ...this.ensureModule(testModule.moduleId, now),
        state: "queued",
      },
      {
        state: "queued",
        durationMs: null,
      },
      now
    );

    this.setModule(entry);
    await this.flush();
  }

  async onTestModuleCollected(testModule: TestModule): Promise<void> {
    const now = new Date().toISOString();
    const entry = this.ensureModule(testModule.moduleId, now);
    const nextEntry = refreshDashboardModule(
      {
        ...entry,
        state: "pending",
        cases: syncCasesFromModule(entry.cases, testModule),
      },
      {
        state: "pending",
        durationMs: null,
      },
      now
    );

    this.setModule(nextEntry);
    await this.flush();
  }

  async onTestModuleStart(testModule: TestModule): Promise<void> {
    const now = new Date().toISOString();
    const entry = this.ensureModule(testModule.moduleId, now);
    const nextEntry = refreshDashboardModule(
      {
        ...entry,
        state: "running",
        cases: syncCasesFromModule(entry.cases, testModule),
      },
      {
        state: "running",
      },
      now
    );

    this.runState = "running";
    this.note = null;
    this.setModule(nextEntry);
    await this.flush();
  }

  async onTestCaseReady(testCase: TestCase): Promise<void> {
    const now = new Date().toISOString();
    const entry = this.ensureModule(testCase.module.moduleId, now);
    const nextEntry = refreshDashboardModule(
      {
        ...entry,
        cases: upsertCase(entry.cases, buildDashboardCase(testCase, "running")),
      },
      {
        state: "running",
      },
      now
    );

    this.runState = "running";
    this.setModule(nextEntry);
    await this.flush();
  }

  async onTestCaseResult(testCase: TestCase): Promise<void> {
    const now = new Date().toISOString();
    const entry = this.ensureModule(testCase.module.moduleId, now);
    const refreshedEntry = refreshDashboardModule(
      {
        ...entry,
        cases: upsertCase(entry.cases, buildDashboardCase(testCase)),
      },
      {},
      now
    );
    const nextEntry = refreshDashboardModule(
      {
        ...refreshedEntry,
        state: inferEntryState(refreshedEntry, refreshedEntry.state),
      },
      {
        state: inferEntryState(refreshedEntry, refreshedEntry.state),
      },
      now
    );

    this.setModule(nextEntry);
    await this.flush();
  }

  async onTestModuleEnd(testModule: TestModule): Promise<void> {
    const now = new Date().toISOString();
    const entry = this.ensureModule(testModule.moduleId, now);
    const collectedEntry = refreshDashboardModule(
      {
        ...entry,
        cases: syncCasesFromModule(entry.cases, testModule),
      },
      {},
      now
    );
    const nextEntry = refreshDashboardModule(
      {
        ...collectedEntry,
        state: mapModuleState(testModule.state()),
      },
      {
        state: inferEntryState(collectedEntry, mapModuleState(testModule.state())),
        durationMs: testModule.diagnostic().duration || null,
        lastError: testModule.errors()[0] ? getErrorMessage(testModule.errors()[0]) : collectedEntry.lastError,
      },
      now
    );

    this.setModule(nextEntry);
    await this.flush();
  }

  async onTestRunEnd(
    testModules: ReadonlyArray<TestModule>,
    unhandledErrors: ReadonlyArray<unknown>,
    reason: TestRunEndReason
  ): Promise<void> {
    const now = new Date().toISOString();

    for (const testModule of testModules) {
      const entry = this.ensureModule(testModule.moduleId, now);
      const collectedEntry = refreshDashboardModule(
        {
          ...entry,
          cases: syncCasesFromModule(entry.cases, testModule),
        },
        {},
        now
      );
      const nextEntry = refreshDashboardModule(
        {
          ...collectedEntry,
          state: mapModuleState(testModule.state()),
        },
        {
          state: inferEntryState(collectedEntry, mapModuleState(testModule.state())),
          durationMs: testModule.diagnostic().duration || null,
          lastError: testModule.errors()[0] ? getErrorMessage(testModule.errors()[0]) : collectedEntry.lastError,
        },
        now
      );
      this.setModule(nextEntry);
    }

    this.errorCount = unhandledErrors.length;
    this.finishedAt = now;
    this.reason = String(reason);
    this.note = null;

    const hasFailedModule = Array.from(this.modules.values()).some(
      (moduleEntry) => moduleEntry.state === "failed" || moduleEntry.counts.failed > 0
    );
    if (reason === "interrupted") {
      this.runState = "cancelled";
      this.note = "Run interrupted before completion.";
    } else if (hasFailedModule || unhandledErrors.length > 0) {
      this.runState = "failed";
    } else {
      this.runState = "passed";
    }

    await this.flush();
  }
}

function renderDashboardPage(statusPath: string): string {
  const escapedStatusPath = JSON.stringify(statusPath);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SeqDesk Test Dashboard</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5efe3;
        --panel: rgba(255, 251, 245, 0.84);
        --panel-strong: rgba(255, 255, 255, 0.92);
        --ink: #1f1d19;
        --muted: #6f675d;
        --line: rgba(99, 84, 63, 0.16);
        --accent: #1a4635;
        --accent-soft: rgba(26, 70, 53, 0.1);
        --pass: #2f7d46;
        --fail: #b53a2d;
        --run: #b7791f;
        --pending: #7c7f85;
        --queued: #8a6a3f;
        --shadow: 0 20px 40px rgba(58, 43, 24, 0.08);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top left, rgba(228, 196, 149, 0.38), transparent 32%),
          radial-gradient(circle at top right, rgba(118, 148, 122, 0.18), transparent 26%),
          linear-gradient(180deg, #f7f3eb 0%, var(--bg) 100%);
        color: var(--ink);
        font-family: "SF Pro Display", "Segoe UI", sans-serif;
      }

      .shell {
        width: min(1400px, calc(100vw - 32px));
        margin: 24px auto 40px;
      }

      .hero {
        display: grid;
        gap: 18px;
        grid-template-columns: minmax(0, 1.6fr) minmax(280px, 0.8fr);
        align-items: stretch;
      }

      .panel {
        background: var(--panel);
        backdrop-filter: blur(20px);
        border: 1px solid var(--line);
        border-radius: 24px;
        box-shadow: var(--shadow);
      }

      .hero-copy {
        padding: 28px;
      }

      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      h1 {
        margin: 18px 0 10px;
        font-size: clamp(2rem, 4vw, 3.4rem);
        line-height: 0.98;
        letter-spacing: -0.04em;
      }

      .hero-copy p,
      .hero-meta,
      .panel-note,
      .empty-state,
      .case-details summary,
      .case-row,
      table {
        color: var(--muted);
      }

      .hero-copy p {
        margin: 0;
        max-width: 62ch;
        font-size: 1rem;
        line-height: 1.6;
      }

      .hero-meta {
        margin-top: 18px;
        display: flex;
        flex-wrap: wrap;
        gap: 10px 14px;
        font-size: 13px;
      }

      .hero-status {
        padding: 24px;
        display: grid;
        gap: 14px;
        align-content: start;
      }

      .status-chip {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        border-radius: 16px;
        font-size: 14px;
        font-weight: 700;
        width: fit-content;
      }

      .status-chip::before,
      .status-pill::before,
      .case-state::before {
        content: "";
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: currentColor;
        box-shadow: 0 0 0 5px color-mix(in srgb, currentColor 14%, transparent);
      }

      .state-passed {
        color: var(--pass);
        background: color-mix(in srgb, var(--pass) 12%, white);
      }

      .state-failed {
        color: var(--fail);
        background: color-mix(in srgb, var(--fail) 12%, white);
      }

      .state-running {
        color: var(--run);
        background: color-mix(in srgb, var(--run) 14%, white);
      }

      .state-pending,
      .state-collecting,
      .state-idle {
        color: var(--pending);
        background: color-mix(in srgb, var(--pending) 10%, white);
      }

      .state-queued {
        color: var(--queued);
        background: color-mix(in srgb, var(--queued) 10%, white);
      }

      .state-skipped,
      .state-cancelled {
        color: #63543f;
        background: color-mix(in srgb, #63543f 10%, white);
      }

      .summary-grid {
        margin-top: 18px;
        display: grid;
        gap: 14px;
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .summary-card {
        padding: 18px 20px;
      }

      .summary-card h2 {
        margin: 0 0 10px;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .summary-value {
        font-size: clamp(1.6rem, 2vw, 2.3rem);
        font-weight: 800;
        letter-spacing: -0.04em;
        color: var(--ink);
      }

      .summary-meta {
        margin-top: 8px;
        font-size: 13px;
        color: var(--muted);
      }

      .control-panel {
        margin-top: 4px;
        display: grid;
        gap: 10px;
      }

      .control-row {
        display: grid;
        gap: 10px;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: end;
      }

      .control-field {
        display: grid;
        gap: 6px;
      }

      .control-label {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .control-select {
        width: 100%;
        min-height: 42px;
        border-radius: 14px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.75);
        color: var(--ink);
        padding: 0 12px;
        font: inherit;
      }

      .control-button {
        min-height: 42px;
        border: 0;
        border-radius: 14px;
        background: var(--accent);
        color: white;
        font: inherit;
        font-weight: 700;
        padding: 0 16px;
        cursor: pointer;
        transition: transform 120ms ease, opacity 120ms ease;
      }

      .control-button:hover {
        transform: translateY(-1px);
      }

      .control-button:disabled {
        cursor: wait;
        opacity: 0.6;
        transform: none;
      }

      .modules-panel {
        margin-top: 18px;
        overflow: hidden;
      }

      .modules-head {
        padding: 18px 24px 12px;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: baseline;
        justify-content: space-between;
      }

      .modules-head h2 {
        margin: 0;
        font-size: 1.15rem;
        letter-spacing: -0.02em;
      }

      .section-list {
        padding: 0 18px 18px;
        display: grid;
        gap: 16px;
      }

      .section-block {
        padding: 18px;
        display: grid;
        gap: 16px;
        background: rgba(255, 255, 255, 0.42);
        border: 1px solid rgba(99, 84, 63, 0.1);
      }

      .section-header {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: baseline;
        justify-content: space-between;
      }

      .section-header h3 {
        margin: 0;
        font-size: 1rem;
        letter-spacing: -0.02em;
      }

      .section-summary {
        font-size: 13px;
        color: var(--muted);
      }

      .module-grid {
        display: grid;
        gap: 14px;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      }

      .module-card {
        padding: 18px;
        display: grid;
        gap: 12px;
        border-radius: 20px;
        border: 1px solid var(--line);
        background: var(--panel-strong);
        box-shadow: 0 10px 24px rgba(58, 43, 24, 0.06);
      }

      .module-card.module-state-failed {
        border-color: color-mix(in srgb, var(--fail) 42%, white);
        box-shadow: 0 14px 28px rgba(181, 58, 45, 0.12);
      }

      .module-card.module-state-running {
        border-color: color-mix(in srgb, var(--run) 38%, white);
        box-shadow: 0 14px 28px rgba(183, 121, 31, 0.12);
      }

      .module-card.module-state-queued,
      .module-card.module-state-pending,
      .module-card.module-state-collecting {
        border-color: color-mix(in srgb, var(--pending) 22%, white);
      }

      .module-card.module-state-passed {
        border-color: color-mix(in srgb, var(--pass) 24%, white);
      }

      .module-card.module-state-skipped {
        border-color: color-mix(in srgb, #63543f 22%, white);
      }

      .module-top {
        display: flex;
        gap: 12px;
        align-items: flex-start;
        justify-content: space-between;
      }

      .module-title {
        margin: 0;
        color: var(--ink);
        font-size: 1.05rem;
        line-height: 1.2;
        letter-spacing: -0.03em;
      }

      .module-path {
        margin-top: 6px;
        word-break: break-word;
      }

      .module-count {
        min-width: 86px;
        display: grid;
        gap: 4px;
        justify-items: end;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }

      .module-count strong {
        color: var(--ink);
        font-size: 1.55rem;
        line-height: 1;
        letter-spacing: -0.04em;
      }

      .metric-strip {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .metric-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 7px 10px;
        border-radius: 999px;
        border: 1px solid rgba(99, 84, 63, 0.12);
        background: rgba(255, 255, 255, 0.68);
        color: var(--muted);
        font-size: 12px;
      }

      .metric-chip strong {
        color: var(--ink);
      }

      .subtle {
        font-size: 12px;
        color: var(--muted);
      }

      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 700;
        text-transform: capitalize;
      }

      .description-preview {
        color: var(--ink);
        line-height: 1.5;
      }

      .module-description {
        min-height: 3.2em;
      }

      .case-details {
        margin-top: 2px;
      }

      .case-details summary {
        cursor: pointer;
        user-select: none;
        color: var(--muted);
        font-size: 13px;
      }

      .case-list {
        margin: 10px 0 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 10px;
      }

      .case-row {
        display: grid;
        gap: 4px;
        padding: 10px 12px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.6);
        border: 1px solid rgba(99, 84, 63, 0.1);
      }

      .case-title {
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--ink);
        font-weight: 600;
      }

      .case-state {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .case-meta {
        font-size: 12px;
      }

      .case-error {
        color: var(--fail);
      }

      .panel-note,
      .empty-state {
        padding: 0 24px 22px;
        font-size: 13px;
        line-height: 1.6;
      }

      code {
        font-family: "SF Mono", "JetBrains Mono", monospace;
        font-size: 0.92em;
        background: rgba(99, 84, 63, 0.08);
        padding: 0.16rem 0.4rem;
        border-radius: 8px;
      }

      @media (max-width: 1000px) {
        .hero,
        .summary-grid {
          grid-template-columns: 1fr;
        }

        .shell {
          width: min(100vw - 20px, 1400px);
          margin-top: 10px;
        }
      }

      @media (max-width: 720px) {
        .module-top {
          flex-direction: column;
        }

        .module-count {
          justify-items: start;
          text-align: left;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <article class="panel hero-copy">
          <span class="eyebrow">SeqDesk Local Test Dashboard</span>
          <h1>Watch what the suite is proving while it runs.</h1>
          <p>
            This view tracks the local test run, groups files by area, and shows which cases are
            already green, still pending, or failing across Vitest and Playwright. Use it as a quick
            map of what is covered instead of reading raw runner output line by line.
          </p>
          <div class="hero-meta">
            <span>Status file: <code id="status-path"></code></span>
            <span>Refresh: every second while the run is active</span>
          </div>
        </article>
        <aside class="panel hero-status">
          <div id="run-chip" class="status-chip state-idle">Waiting for tests</div>
          <div class="summary-meta" id="run-meta">Starting dashboard...</div>
          <div class="summary-meta" id="run-note"></div>
          <div class="control-panel">
            <div class="control-row">
              <label class="control-field">
                <span class="control-label">Tier</span>
                <select id="tier-select" class="control-select">
                  <option value="fast">Fast</option>
                  <option value="all">All</option>
                  <option value="risk">Risk</option>
                  <option value="live">Live</option>
                  <option value="ui">UI</option>
                </select>
              </label>
              <button id="run-button" class="control-button" type="button">Run Tests</button>
            </div>
            <div class="summary-meta" id="control-note">
              Rerun the current dashboard or start another tier in a new dashboard page.
            </div>
          </div>
        </aside>
      </section>

      <section class="summary-grid" id="summary-grid"></section>

      <section class="panel modules-panel">
        <div class="modules-head">
          <h2>Tracked Test Files</h2>
          <div class="subtle" id="updated-at">Waiting for the first status update…</div>
        </div>
        <div class="section-list" id="module-sections">
          <div class="empty-state">Waiting for the runner to discover test files…</div>
        </div>
        <div class="panel-note">
          Suggested entry points:
          <code>npm run test:dashboard</code>,
          <code>npm run test:dashboard:all</code>,
          <code>npm run test:dashboard:watch</code>,
          <code>npm run test:dashboard:ui</code>.
        </div>
      </section>
    </main>

    <script>
      const statusPath = ${escapedStatusPath};
      const statusPathElement = document.getElementById("status-path");
      const runChip = document.getElementById("run-chip");
      const runMeta = document.getElementById("run-meta");
      const runNote = document.getElementById("run-note");
      const summaryGrid = document.getElementById("summary-grid");
      const moduleSections = document.getElementById("module-sections");
      const updatedAt = document.getElementById("updated-at");
      const tierSelect = document.getElementById("tier-select");
      const runButton = document.getElementById("run-button");
      const controlNote = document.getElementById("control-note");
      let stopped = false;
      let latestStatus = null;

      statusPathElement.textContent = statusPath;

      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      }

      function statusClass(state) {
        return "state-" + (state || "idle");
      }

      function formatTimestamp(value) {
        if (!value) return "not started";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString();
      }

      function formatDuration(durationMs) {
        if (durationMs == null) return "n/a";
        if (durationMs < 1000) return durationMs + " ms";
        return (durationMs / 1000).toFixed(2) + " s";
      }

      function formatCaseCounts(moduleEntry) {
        if (moduleEntry.counts.total === 0) {
          return "No collected cases yet";
        }

        const parts = [];
        parts.push(moduleEntry.counts.passed + "/" + moduleEntry.counts.total + " passed");
        if (moduleEntry.counts.failed > 0) parts.push(moduleEntry.counts.failed + " failed");
        if (moduleEntry.counts.running > 0) parts.push(moduleEntry.counts.running + " running");
        if (moduleEntry.counts.pending > 0) parts.push(moduleEntry.counts.pending + " pending");
        if (moduleEntry.counts.skipped > 0) parts.push(moduleEntry.counts.skipped + " skipped");
        return parts.join(" • ");
      }

      function moduleStateRank(state) {
        switch (state) {
          case "failed":
            return 0;
          case "running":
            return 1;
          case "queued":
            return 2;
          case "collecting":
          case "pending":
            return 3;
          case "passed":
            return 4;
          case "skipped":
            return 5;
          default:
            return 6;
        }
      }

      function sortModulesForDisplay(modules) {
        return [...modules].sort((left, right) => {
          const stateResult = moduleStateRank(left.state) - moduleStateRank(right.state);
          if (stateResult !== 0) {
            return stateResult;
          }

          const failedResult = right.counts.failed - left.counts.failed;
          if (failedResult !== 0) {
            return failedResult;
          }

          const runningResult = right.counts.running - left.counts.running;
          if (runningResult !== 0) {
            return runningResult;
          }

          const pendingResult = right.counts.pending - left.counts.pending;
          if (pendingResult !== 0) {
            return pendingResult;
          }

          return (
            left.title.localeCompare(right.title) ||
            left.relativePath.localeCompare(right.relativePath)
          );
        });
      }

      function summarizeSection(modules) {
        const totals = modules.reduce(
          (summary, moduleEntry) => {
            summary.files += 1;
            summary.cases += moduleEntry.counts.total;
            if (moduleEntry.state === "failed") summary.failed += 1;
            if (moduleEntry.state === "running") summary.running += 1;
            if (moduleEntry.state === "passed") summary.passed += 1;
            return summary;
          },
          { files: 0, cases: 0, failed: 0, running: 0, passed: 0 }
        );

        const parts = [
          totals.files + " file" + (totals.files === 1 ? "" : "s"),
          totals.cases + " case" + (totals.cases === 1 ? "" : "s"),
        ];

        if (totals.failed > 0) {
          parts.push(totals.failed + " failing");
        } else if (totals.running > 0) {
          parts.push(totals.running + " running");
        } else if (totals.passed === totals.files && totals.files > 0) {
          parts.push("all green");
        }

        return parts.join(" • ");
      }

      function groupModulesBySection(modules) {
        const sections = new Map();

        for (const moduleEntry of modules) {
          if (!sections.has(moduleEntry.section)) {
            sections.set(moduleEntry.section, []);
          }
          sections.get(moduleEntry.section).push(moduleEntry);
        }

        return Array.from(sections.entries()).sort((left, right) => {
          const leftRank = Math.min(...left[1].map((moduleEntry) => moduleStateRank(moduleEntry.state)));
          const rightRank = Math.min(...right[1].map((moduleEntry) => moduleStateRank(moduleEntry.state)));
          if (leftRank !== rightRank) {
            return leftRank - rightRank;
          }
          return left[0].localeCompare(right[0]);
        });
      }

      function renderSummary(status) {
        const cards = [
          {
            title: "Run",
            value: status.run.state,
            meta: status.run.tier + " tier • " + status.run.mode,
          },
          {
            title: "Files",
            value: status.totals.modules,
            meta:
              status.totals.passedModules +
              " passed • " +
              status.totals.failedModules +
              " failed • " +
              status.totals.runningModules +
              " running",
          },
          {
            title: "Cases",
            value: status.totals.total,
            meta:
              status.totals.passed +
              " passed • " +
              status.totals.failed +
              " failed • " +
              status.totals.pending +
              " pending",
          },
          {
            title: "Updated",
            value: formatTimestamp(status.run.updatedAt),
            meta:
              status.run.finishedAt
                ? "Finished at " + formatTimestamp(status.run.finishedAt)
                : "Started at " + formatTimestamp(status.run.startedAt),
          },
        ];

        summaryGrid.innerHTML = cards
          .map(
            (card) => \`
              <article class="panel summary-card">
                <h2>\${escapeHtml(card.title)}</h2>
                <div class="summary-value">\${escapeHtml(card.value)}</div>
                <div class="summary-meta">\${escapeHtml(card.meta)}</div>
              </article>
            \`
          )
          .join("");
      }

      function renderModules(status) {
        if (!status.modules.length) {
          moduleSections.innerHTML =
            '<div class="empty-state">No test files have been collected yet for this run.</div>';
          return;
        }

        moduleSections.innerHTML = groupModulesBySection(status.modules)
          .map(([sectionName, sectionModules]) => {
            const orderedModules = sortModulesForDisplay(sectionModules);

            return \`
              <section class="panel section-block">
                <div class="section-header">
                  <h3>\${escapeHtml(sectionName)}</h3>
                  <div class="section-summary">\${escapeHtml(summarizeSection(orderedModules))}</div>
                </div>
                <div class="module-grid">
                  \${orderedModules
                    .map((moduleEntry) => {
                      const details = moduleEntry.cases.length
                        ? \`
                          <details class="case-details">
                            <summary>Show \${moduleEntry.cases.length} case\${moduleEntry.cases.length === 1 ? "" : "s"}</summary>
                            <ul class="case-list">
                              \${moduleEntry.cases
                                .map(
                                  (testCase) => \`
                                    <li class="case-row">
                                      <div class="case-title">
                                        <span class="case-state \${statusClass(testCase.state)}">\${escapeHtml(testCase.fullName)}</span>
                                      </div>
                                      <div class="case-meta">
                                        \${testCase.suitePath ? escapeHtml(testCase.suitePath) + " • " : ""}
                                        \${escapeHtml(formatDuration(testCase.durationMs))}
                                      </div>
                                      \${testCase.errorMessage ? '<div class="case-meta case-error">' + escapeHtml(testCase.errorMessage) + "</div>" : ""}
                                    </li>
                                  \`
                                )
                                .join("")}
                            </ul>
                          </details>
                        \`
                        : "";

                      return \`
                        <article class="module-card module-state-\${escapeHtml(moduleEntry.state)}">
                          <div class="module-top">
                            <div>
                              <h4 class="module-title">\${escapeHtml(moduleEntry.title)}</h4>
                              <div class="subtle module-path"><code>\${escapeHtml(moduleEntry.relativePath)}</code></div>
                            </div>
                            <div class="module-count">
                              <span class="status-pill \${statusClass(moduleEntry.state)}">\${escapeHtml(moduleEntry.state)}</span>
                              <strong>\${escapeHtml(String(moduleEntry.counts.total))}</strong>
                              <div class="subtle">cases</div>
                            </div>
                          </div>
                          <div class="metric-strip">
                            <span class="metric-chip"><strong>\${escapeHtml(formatCaseCounts(moduleEntry))}</strong></span>
                            <span class="metric-chip">Tier <strong>\${escapeHtml(moduleEntry.tier)}</strong></span>
                            <span class="metric-chip">Duration <strong>\${escapeHtml(formatDuration(moduleEntry.durationMs))}</strong></span>
                          </div>
                          <div class="description-preview module-description">\${escapeHtml(moduleEntry.description)}</div>
                          \${details}
                        </article>
                      \`;
                    })
                    .join("")}
                </div>
              </section>
            \`;
          })
          .join("");
      }

      function renderStatus(status) {
        latestStatus = status;
        runChip.className = "status-chip " + statusClass(status.run.state);
        runChip.textContent = status.run.state + " • " + status.run.tier + " tier";
        runMeta.textContent =
          "Mode: " +
          status.run.mode +
          " • Started: " +
          formatTimestamp(status.run.startedAt) +
          " • Finished: " +
          formatTimestamp(status.run.finishedAt);
        runNote.textContent = status.note || (status.run.errorCount > 0 ? status.run.errorCount + " unhandled errors reported." : "");
        updatedAt.textContent = "Last status write: " + formatTimestamp(status.run.updatedAt);
        if (tierSelect && document.activeElement !== tierSelect) {
          tierSelect.value = status.run.tier;
        }
        if (runButton) {
          const runBusy = status.run.state === "collecting" || status.run.state === "running";
          runButton.disabled = runBusy;
          runButton.textContent = runBusy ? "Running..." : "Run Tests";
        }
        renderSummary(status);
        renderModules(status);
      }

      async function triggerRun() {
        if (!tierSelect || !runButton) {
          return;
        }

        const tier = tierSelect.value;
        runButton.disabled = true;
        runButton.textContent = "Starting...";
        if (controlNote) {
          controlNote.textContent = "Submitting run request...";
        }

        try {
          const response = await fetch("/control/run", {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({ tier }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload.error || "Run request failed.");
          }

          if (controlNote) {
            controlNote.textContent = payload.message || "Run request accepted.";
          }

          if (!payload.reused && payload.url) {
            if (controlNote) {
              controlNote.textContent = (payload.message || "Starting new dashboard.") + " Opening...";
            }
            window.setTimeout(() => {
              window.location.assign(payload.url);
            }, 900);
            return;
          }
        } catch (error) {
          if (controlNote) {
            controlNote.textContent = String(error);
          }
        } finally {
          if (!latestStatus || (latestStatus.run.state !== "collecting" && latestStatus.run.state !== "running")) {
            runButton.disabled = false;
            runButton.textContent = "Run Tests";
          }
        }
      }

      runButton?.addEventListener("click", () => {
        void triggerRun();
      });

      async function poll() {
        try {
          const response = await fetch("/status.json?ts=" + Date.now(), { cache: "no-store" });
          if (!response.ok) {
            throw new Error("Dashboard status request failed with " + response.status);
          }
          const status = await response.json();
          renderStatus(status);
          if (
            status.run.mode === "run" &&
            status.run.tier !== "ui" &&
            ["passed", "failed", "cancelled"].includes(status.run.state)
          ) {
            stopped = true;
            return;
          }
        } catch (error) {
          runNote.textContent = String(error);
        }

        if (!stopped) {
          window.setTimeout(poll, 1000);
        }
      }

      poll();
    </script>
  </body>
</html>`;
}

async function readOrCreateStatus(options: CliOptions, statusFilePath: string): Promise<DashboardStatus> {
  const existing = await readDashboardStatus(statusFilePath);
  if (existing) {
    return existing;
  }

  return createDashboardStatus({
    state: "idle",
    tier: options.tier,
    mode: options.mode,
    filters: options.filters,
    note: "Waiting for tests to start.",
  });
}

async function listen(server: http.Server, host: string, port: number): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });

  return (server.address() as AddressInfo).port;
}

function openBrowser(url: string): void {
  const [command, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];

  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function findAvailablePort(host: string): Promise<number> {
  const probe = http.createServer((_req, res) => {
    res.writeHead(204);
    res.end();
  });

  const port = await listen(probe, host, 0);
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  return port;
}

function launchDashboardProcess(options: {
  host: string;
  port: number;
  tier: DashboardTier;
  mode: DashboardMode;
}): string {
  const args = [
    "--no-warnings",
    "scripts/test-dashboard.ts",
    "--tier",
    options.tier,
    "--host",
    options.host,
    "--port",
    String(options.port),
    "--no-open",
  ];

  if (options.mode === "watch") {
    args.push("--watch");
  }

  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  return `http://${options.host}:${options.port}`;
}

async function startPlaywrightProcess(options: {
  cli: CliOptions;
  statusFilePath: string;
  resetNote: string;
}): Promise<void> {
  const existingStatus = await readOrCreateStatus(options.cli, options.statusFilePath);
  await writeDashboardStatus(
    createQueuedRunStatus(existingStatus, options.cli, options.resetNote),
    options.statusFilePath
  );

  if (!process.env.CI) {
    process.stdout.write("Starting Playwright dashboard run...\n");
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        PLAYWRIGHT_CLI_PATH,
        "test",
        "--pass-with-no-tests",
        "--reporter",
        `list,${PLAYWRIGHT_REPORTER_PATH}`,
        ...options.cli.filters,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SEQDESK_DASHBOARD_CWD: process.cwd(),
          SEQDESK_DASHBOARD_FILTERS: JSON.stringify(options.cli.filters),
          SEQDESK_DASHBOARD_MODE: options.cli.mode,
          SEQDESK_DASHBOARD_STATUS_FILE: options.statusFilePath,
          SEQDESK_DASHBOARD_TIER: options.cli.tier,
        },
        stdio: "inherit",
      }
    );

    child.once("error", (error) => {
      reject(error);
    });
    child.once("exit", () => {
      resolve();
    });
  }).catch(async (error) => {
    await writeDashboardStatus(
      createDashboardStatus({
        state: "failed",
        tier: options.cli.tier,
        mode: options.cli.mode,
        filters: options.cli.filters,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        reason: "playwright-start-error",
        errorCount: 1,
        note: `Failed to start Playwright: ${getErrorMessage(error)}`,
      }),
      options.statusFilePath
    );
    throw error;
  });
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  process.env.SEQDESK_TEST_TIER = cli.tier;
  let actualPort = cli.port;
  let vitest: Vitest | null = null;
  let playwrightRun: Promise<void> | null = null;
  const statusFilePath = getDashboardStatusFilePath(`status-${cli.tier}-${process.pid}.json`);

  await clearDashboardStatus(statusFilePath);
  await writeDashboardStatus(
    createDashboardStatus({
      state: "idle",
      tier: cli.tier,
      mode: cli.mode,
      filters: cli.filters,
      note: isPlaywrightTier(cli.tier)
        ? "Starting Playwright dashboard."
        : "Starting Vitest dashboard.",
    }),
    statusFilePath
  );

  const server = http.createServer((req, res) => {
    void (async () => {
      const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? `${cli.host}:${cli.port}`}`);

      if (requestUrl.pathname === "/") {
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(renderDashboardPage(statusFilePath));
        return;
      }

      if (requestUrl.pathname === "/status.json") {
        const status = await readOrCreateStatus(cli, statusFilePath);
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(JSON.stringify(status));
        return;
      }

      if (requestUrl.pathname === "/control/run" && req.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }

        const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf-8")) as {
          tier?: string;
        } : {};

        const requestedTier = body.tier;
        if (!requestedTier || !["fast", "risk", "live", "ui", "all"].includes(requestedTier)) {
          res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Invalid tier." }));
          return;
        }

        const status = await readOrCreateStatus(cli, statusFilePath);
        const currentDashboardUrl = `http://${cli.host}:${actualPort}`;
        const currentRunBusy = status.run.state === "collecting" || status.run.state === "running";

        if (requestedTier === cli.tier && cli.mode === "watch" && vitest) {
          if (currentRunBusy) {
            res.writeHead(409, { "content-type": "application/json; charset=utf-8" });
            res.end(
              JSON.stringify({
                error: "A test run is already in progress.",
                url: currentDashboardUrl,
              })
            );
            return;
          }

          const specifications = await vitest.getRelevantTestSpecifications(cli.filters);
          void vitest.rerunTestSpecifications(specifications, true);

          res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
          res.end(
            JSON.stringify({
              ok: true,
              reused: true,
              url: currentDashboardUrl,
              message: `Rerunning ${requestedTier} tests in the current dashboard.`,
            })
          );
          return;
        }

        if (requestedTier === cli.tier && isPlaywrightTier(cli.tier)) {
          if (currentRunBusy || playwrightRun) {
            res.writeHead(409, { "content-type": "application/json; charset=utf-8" });
            res.end(
              JSON.stringify({
                error: "A test run is already in progress.",
                url: currentDashboardUrl,
              })
            );
            return;
          }

          playwrightRun = startPlaywrightProcess({
            cli,
            statusFilePath,
            resetNote: "Rerunning Playwright tests.",
          })
            .catch((error) => {
              console.error(getErrorMessage(error));
            })
            .finally(() => {
              playwrightRun = null;
            });
          void playwrightRun;

          res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
          res.end(
            JSON.stringify({
              ok: true,
              reused: true,
              url: currentDashboardUrl,
              message: "Rerunning UI tests in the current dashboard.",
            })
          );
          return;
        }

        const port = await findAvailablePort(cli.host);
        const url = launchDashboardProcess({
          host: cli.host,
          port,
          tier: requestedTier as DashboardTier,
          mode: requestedTier === "ui" ? "run" : "watch",
        });

        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            ok: true,
            reused: false,
            url,
            message: `Starting a new ${requestedTier} dashboard.`,
          })
        );
        return;
      }

      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
    })().catch((error) => {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(getErrorMessage(error));
    });
  });

  actualPort = await listen(server, cli.host, cli.port);
  const dashboardUrl = `http://${cli.host}:${actualPort}`;
  const reporter = new LiveDashboardReporter({
    tier: cli.tier,
    mode: cli.mode,
    filters: cli.filters,
    cwd: process.cwd(),
    statusFilePath,
  });

  process.stdout.write(`Test dashboard: ${dashboardUrl}\n`);
  process.stdout.write(`Status file: ${statusFilePath}\n`);

  if (cli.openBrowser) {
    openBrowser(dashboardUrl);
  }

  if (isPlaywrightTier(cli.tier)) {
    playwrightRun = startPlaywrightProcess({
      cli,
      statusFilePath,
      resetNote: "Starting Playwright tests.",
    }).finally(() => {
      playwrightRun = null;
    });

    try {
      await playwrightRun;
    } catch (error) {
      console.error(getErrorMessage(error));
    }
    return;
  }

  const vitestCliOptions: Parameters<typeof startVitest>[2] = {
    run: cli.mode === "run",
    watch: cli.mode === "watch",
  };
  const vitestOverrides: Parameters<typeof startVitest>[3] = {
    test: {
      coverage: cli.coverage ? { enabled: true } : undefined,
      reporters: ["default", reporter],
    },
  };

  vitest = await startVitest("test", cli.filters, vitestCliOptions, vitestOverrides);

  if (!reporter.hasStartedRun()) {
    await writeDashboardStatus(
      createDashboardStatus({
        state: "idle",
        tier: cli.tier,
        mode: cli.mode,
        filters: cli.filters,
        note: "No matching Vitest files were found for this run.",
      }),
      statusFilePath
    );
  } else {
    await reporter.waitForWrites();
  }

  if (cli.mode === "run" && !isPlaywrightTier(cli.tier)) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

main().catch((error) => {
  console.error(getErrorMessage(error));
  process.exitCode = 1;
});
