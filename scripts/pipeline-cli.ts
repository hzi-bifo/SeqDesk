#!/usr/bin/env node
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { createInterface } from 'node:readline/promises';
import type { DebugBundle } from '../src/lib/pipelines/pipeline-run-ops-service';

type PipelineCommand =
  | 'list'
  | 'install'
  | 'setup'
  | 'enable'
  | 'run'
  | 'status'
  | 'sync'
  | 'logs'
  | 'outputs'
  | 'debug'
  | 'cancel';

type ParsedArgs = {
  command: PipelineCommand | 'help';
  commandFamily: 'pipeline' | 'pipelines' | 'direct';
  dir: string;
  dirExplicit: boolean;
  json: boolean;
  help: boolean;
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
};

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const PIPELINE_INSTALL_GUIDE_URL =
  'https://seqdesk.org/docs/pipelines/installing-pipelines';

export type ManagedPipelineDisplay = {
  pipelineId?: string;
  id?: string;
  name?: string;
  installed?: boolean;
  targets?: string[] | { supported?: string[] } | null;
  packageState?: string;
  setupState?: string;
  activationState?: string;
  enabled?: boolean;
  nextActions?: unknown[];
  readiness?: {
    status?: string;
    summary?: string;
    canEnable?: boolean;
    items?: Array<{
      id?: string;
      label?: string;
      status?: string;
      detail?: string;
      action?: string;
      blocking?: boolean;
    }>;
  } | null;
};

type ManagedRuntimeSetupPaths = {
  configPath: string;
  dataPath: string;
  runDirectory: string;
  condaPath?: string;
  condaEnvironment?: string;
};

const USAGE = `Usage:
  seqdesk pipelines list [--dir <install>] [--catalog study|order|all] [--installed] [--enabled] [--json]
  seqdesk pipelines install <pipelineId> [--dir <install>] [--source <sourceId>] [--version <version>] [--sha256 <digest>] [--runtime] [--yes] [--json]
  seqdesk pipelines setup <pipelineId> [--dir <install>] [--config-file file|--config-json json] [--runtime] [--yes] [--json]
  seqdesk pipelines enable <pipelineId> [--dir <install>] [--json]
  seqdesk pipelines status <pipelineId> [--dir <install>] [--json]
  seqdesk pipeline run <pipelineId> --dir <install> (--study <id>|--order <id>) [--samples id,id] [--config-file file|--config-json json] [--execution default|local|slurm] [--watch] [--json] [--user-email email]
  seqdesk pipeline status <runId> --dir <install> [--watch] [--json]
  seqdesk pipeline sync <runId> --dir <install> [--json]
  seqdesk pipeline logs <runId> --dir <install> [--type output|error] [--tail 200] [--json]
  seqdesk pipeline outputs <runId> --dir <install> [--json]
  seqdesk pipeline debug <runId> --dir <install> [--format text|json] [--out file]
  seqdesk pipeline cancel <runId> --dir <install> [--json]

Local shell access to the installed SeqDesk directory is treated as operator access.
The singular "seqdesk pipeline" form remains an alias.
`;

function takeValue(argv: string[], index: number, token: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${token} requires a value`);
  }
  return value;
}

function setValue(
  parsed: ParsedArgs,
  key: string,
  value: string | boolean | undefined
): void {
  parsed.values[key] = value;
}

export function parsePipelineArgs(rawArgv: string[]): ParsedArgs {
  const commandFamily =
    rawArgv[0] === 'pipeline' || rawArgv[0] === 'pipelines'
      ? rawArgv[0]
      : 'direct';
  const argv =
    rawArgv[0] === 'pipeline' || rawArgv[0] === 'pipelines'
      ? rawArgv.slice(1)
      : rawArgv.slice();
  const parsed: ParsedArgs = {
    command: 'help',
    commandFamily,
    dir: process.cwd(),
    dirExplicit: false,
    json: false,
    help: false,
    values: {},
    positionals: [],
  };

  if (argv.length === 0) {
    parsed.help = true;
    return parsed;
  }

  const command = argv[0];
  if (command === '--help' || command === '-h' || command === 'help') {
    parsed.help = true;
    return parsed;
  }
  if (
    ![
      'list',
      'install',
      'setup',
      'enable',
      'run',
      'status',
      'sync',
      'logs',
      'outputs',
      'debug',
      'cancel',
    ].includes(command)
  ) {
    throw new Error(`Unknown pipeline command: ${command}`);
  }
  parsed.command = command as PipelineCommand;

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--help' || token === '-h') {
      parsed.help = true;
      continue;
    }

    if (token === '--json') {
      parsed.json = true;
      continue;
    }

    if (token === '--watch') {
      setValue(parsed, 'watch', true);
      continue;
    }

    if (token === '--enabled') {
      setValue(parsed, 'enabled', true);
      continue;
    }

    if (token === '--installed') {
      setValue(parsed, 'installed', true);
      continue;
    }

    if (token === '--yes' || token === '-y') {
      setValue(parsed, 'yes', true);
      continue;
    }

    if (token === '--runtime') {
      setValue(parsed, 'runtime', true);
      continue;
    }

    const split = token.match(/^(--[a-z0-9-]+)=(.*)$/i);
    const flag = split ? split[1] : token;
    const inlineValue = split ? split[2] : undefined;

    if (flag === '--dir' || flag === '-d') {
      const value = inlineValue ?? takeValue(argv, index, token);
      parsed.dir = value;
      parsed.dirExplicit = true;
      if (inlineValue === undefined) index += 1;
      continue;
    }

    const valueFlags = new Set([
      '--catalog',
      '--command-family',
      '--source',
      '--version',
      '--sha256',
      '--study',
      '--order',
      '--samples',
      '--config-file',
      '--config-json',
      '--execution',
      '--user-email',
      '--type',
      '--tail',
      '--format',
      '--out',
    ]);

    if (valueFlags.has(flag)) {
      const value = inlineValue ?? takeValue(argv, index, token);
      if (flag === '--command-family') {
        if (value !== 'pipeline' && value !== 'pipelines') {
          throw new Error(
            '--command-family must be either pipeline or pipelines'
          );
        }
        parsed.commandFamily = value;
      } else {
        setValue(parsed, flag.slice(2).replace(/-/g, '_'), value);
      }
      if (inlineValue === undefined) index += 1;
      continue;
    }

    if (token.startsWith('-')) {
      throw new Error(`Unknown pipeline option: ${token}`);
    }

    parsed.positionals.push(token);
  }

  parsed.dir = path.resolve(parsed.dir);
  return parsed;
}

function readString(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readBoolean(value: string | boolean | undefined): boolean {
  return value === true;
}

function assertOneTarget(values: Record<string, string | boolean | undefined>): {
  studyId?: string;
  orderId?: string;
} {
  const studyId = readString(values.study);
  const orderId = readString(values.order);
  if ((!studyId && !orderId) || (studyId && orderId)) {
    throw new Error('Exactly one of --study or --order is required');
  }
  return { studyId, orderId };
}

async function readConfig(values: Record<string, string | boolean | undefined>): Promise<Record<string, unknown>> {
  const configFile = readString(values.config_file);
  const configJson = readString(values.config_json);
  if (configFile && configJson) {
    throw new Error('Use either --config-file or --config-json, not both');
  }
  if (!configFile && !configJson) {
    return {};
  }

  const raw = configFile
    ? await fs.readFile(path.resolve(configFile), 'utf-8')
    : configJson!;
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Pipeline config must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function readRuntimeString(source: unknown): string {
  return typeof source === 'string' && source.trim() ? source.trim() : '';
}

function readRuntimeRecord(source: unknown): Record<string, unknown> {
  return source &&
    typeof source === 'object' &&
    !Array.isArray(source)
    ? (source as Record<string, unknown>)
    : {};
}

async function readInstalledSettings(
  installDir: string
): Promise<{ config: Record<string, unknown>; configPath: string }> {
  const resolvedInstallDir = path.resolve(installDir);
  const candidates = [
    path.join(resolvedInstallDir, 'settings.json'),
    path.join(resolvedInstallDir, 'seqdesk.config.json'),
    path.join(resolvedInstallDir, 'current', 'settings.json'),
    path.join(resolvedInstallDir, 'current', 'seqdesk.config.json'),
  ];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(await fs.readFile(candidate, 'utf-8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('the JSON root must be an object');
      }
      return {
        config: parsed as Record<string, unknown>,
        configPath: candidate,
      };
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: unknown }).code === 'ENOENT'
      ) {
        continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Cannot read the installed SeqDesk settings at ${candidate}: ${message}`
      );
    }
  }

  return {
    config: {},
    configPath: path.join(resolvedInstallDir, 'settings.json'),
  };
}

/**
 * Resolve the storage values which the external runtime installer must keep.
 *
 * setup-conda-env.sh writes both values back to settings.json, so passing its
 * old hard-coded defaults here would silently move an existing installation.
 * Keep environment overrides and every installer-supported legacy key too.
 */
export async function resolveManagedRuntimeSetupPaths(
  installDir: string
): Promise<ManagedRuntimeSetupPaths> {
  const resolvedInstallDir = path.resolve(installDir);
  const { config, configPath } = await readInstalledSettings(
    resolvedInstallDir
  );
  const site = readRuntimeRecord(config.site);
  const pipelines = readRuntimeRecord(config.pipelines);
  const execution = readRuntimeRecord(pipelines.execution);
  const conda = readRuntimeRecord(execution.conda);

  const dataPath =
    readRuntimeString(process.env.SEQDESK_DATA_PATH) ||
    readRuntimeString(site.dataBasePath) ||
    readRuntimeString(config.dataBasePath) ||
    readRuntimeString(config.sequencingDataDir) ||
    readRuntimeString(config.sequencingDataPath) ||
    path.join(resolvedInstallDir, 'data');
  const runDirectory =
    readRuntimeString(process.env.SEQDESK_PIPELINE_RUN_DIR) ||
    readRuntimeString(execution.runDirectory) ||
    readRuntimeString(execution.pipelineRunDir) ||
    readRuntimeString(config.pipelineRunDir) ||
    readRuntimeString(config.runDirectory) ||
    path.join(resolvedInstallDir, 'pipeline_runs');
  const condaPath =
    readRuntimeString(process.env.SEQDESK_CONDA_PATH) ||
    readRuntimeString(process.env.SEQDESK_EXEC_CONDA_PATH) ||
    readRuntimeString(conda.path) ||
    readRuntimeString(execution.condaPath);
  const condaEnvironment =
    readRuntimeString(process.env.SEQDESK_CONDA_ENV) ||
    readRuntimeString(process.env.SEQDESK_EXEC_CONDA_ENV) ||
    readRuntimeString(conda.environment) ||
    readRuntimeString(execution.condaEnv);

  return {
    configPath,
    dataPath,
    runDirectory,
    ...(condaPath ? { condaPath } : {}),
    ...(condaEnvironment ? { condaEnvironment } : {}),
  };
}

export async function loadRuntimeEnvironment(
  installDir: string,
  options: { explicitDir?: boolean } = {}
): Promise<void> {
  let config: Record<string, unknown> = {};
  let configPath: string | null = null;
  try {
    // A13: prefer canonical settings.json, fall back to legacy seqdesk.config.json.
    let raw = '{}';
    for (const name of ['settings.json', 'seqdesk.config.json']) {
      try {
        const candidate = path.join(installDir, name);
        raw = await fs.readFile(candidate, 'utf-8');
        configPath = candidate;
        break;
      } catch {
        // try the next candidate
      }
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      config = parsed as Record<string, unknown>;
    }
  } catch {
    // Environment variables may still provide DATABASE_URL/DIRECT_URL.
  }

  const runtime =
    config.runtime && typeof config.runtime === 'object' && !Array.isArray(config.runtime)
      ? (config.runtime as Record<string, unknown>)
      : {};

  const configuredDatabaseUrl = readRuntimeString(
    runtime.databaseUrl ?? config.databaseUrl
  );
  const configuredDirectUrl = readRuntimeString(
    runtime.directUrl ?? runtime.databaseDirectUrl ?? config.directUrl
  );

  if (options.explicitDir) {
    if (!configPath || !configuredDatabaseUrl) {
      throw new Error(
        `The selected SeqDesk install does not provide a database URL in settings.json: ${installDir}`
      );
    }
    // An operator may have DATABASE_URL exported for another checkout. An
    // explicit --dir is an unambiguous selection and must never inherit that
    // unrelated database connection.
    process.env.DATABASE_URL = configuredDatabaseUrl;
    process.env.DIRECT_URL = configuredDirectUrl || configuredDatabaseUrl;
  } else {
    if (!process.env.DATABASE_URL && configuredDatabaseUrl) {
      process.env.DATABASE_URL = configuredDatabaseUrl;
    }
    if (!process.env.DIRECT_URL) {
      process.env.DIRECT_URL =
        configuredDirectUrl || process.env.DATABASE_URL;
    }
  }

  if (!process.env.DATABASE_URL) {
    throw new Error(
      `DATABASE_URL is not configured. Pass --dir for an installed SeqDesk directory with seqdesk.config.json.`
    );
  }

  if (
    !process.env.DATABASE_URL.startsWith('postgresql://') &&
    !process.env.DATABASE_URL.startsWith('postgres://')
  ) {
    throw new Error('Unsupported DATABASE_URL. SeqDesk pipeline CLI requires PostgreSQL.');
  }

  process.chdir(installDir);
}

function jsonPrint(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function managedPipelineId(pipeline: ManagedPipelineDisplay): string {
  return String(pipeline.pipelineId || pipeline.id || '');
}

function managedPipelineTargets(pipeline: ManagedPipelineDisplay): string[] {
  if (Array.isArray(pipeline.targets)) {
    return pipeline.targets.map(String);
  }
  if (
    pipeline.targets &&
    typeof pipeline.targets === 'object' &&
    Array.isArray(pipeline.targets.supported)
  ) {
    return pipeline.targets.supported.map(String);
  }
  return [];
}

function commandForManagedAction(
  pipelineId: string,
  action: string
): string | null {
  if (action === 'install' || action === 'sync') {
    return `seqdesk pipelines install ${pipelineId}`;
  }
  if (action === 'enable') {
    return `seqdesk pipelines enable ${pipelineId}`;
  }
  if (action === 'configure-runtime') {
    return `seqdesk pipelines setup ${pipelineId} --runtime`;
  }
  if (action === 'configure-storage') {
    return 'seqdesk storage configure /absolute/path/to/sequencing-data';
  }
  if (
    action === 'configure' ||
    action === 'download-db'
  ) {
    return `seqdesk pipelines setup ${pipelineId}`;
  }
  return null;
}

function managedNextAction(pipeline: ManagedPipelineDisplay): string {
  const first = pipeline.nextActions?.[0];
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object') {
    const action = first as Record<string, unknown>;
    if (typeof action.action === 'string') {
      const command = commandForManagedAction(
        managedPipelineId(pipeline),
        action.action
      );
      if (command) return command;
    }
    for (const key of ['command', 'label', 'detail']) {
      if (typeof action[key] === 'string' && action[key]) {
        return action[key] as string;
      }
    }
  }
  return '-';
}

function managedPipelineForJson(
  pipeline: ManagedPipelineDisplay
): ManagedPipelineDisplay {
  const pipelineId = managedPipelineId(pipeline);
  return {
    ...pipeline,
    nextActions: (pipeline.nextActions || []).map((action) => {
      if (!action || typeof action !== 'object') return action;
      const item = action as Record<string, unknown>;
      const command =
        typeof item.action === 'string'
          ? commandForManagedAction(pipelineId, item.action)
          : null;
      return command ? { ...item, command } : item;
    }),
  };
}

export function reconcileManagedInstallMessage(
  message: string,
  setupRequired: boolean
): string {
  if (setupRequired) return message;
  return message.replace(/; setup is still required$/, '');
}

function managedPipelineNeedsRuntime(
  pipeline: ManagedPipelineDisplay | null | undefined
): boolean {
  return Boolean(
    pipeline?.readiness?.items?.some(
      (item) =>
        item.status !== 'ready' &&
        item.blocking !== false &&
        item.action === 'configure-runtime'
    )
  );
}

type PipelineListTone =
  | 'accent'
  | 'muted'
  | 'success'
  | 'warning'
  | 'danger';

type PipelineListRenderOptions = {
  color?: boolean;
  width?: number;
};

const PIPELINE_LIST_ANSI: Record<PipelineListTone, string> = {
  accent: '1;36',
  muted: '2',
  success: '1;32',
  warning: '1;33',
  danger: '1;31',
};

function stylePipelineListText(
  value: string,
  tone: PipelineListTone,
  color: boolean
): string {
  if (!color) return value;
  return `\u001b[${PIPELINE_LIST_ANSI[tone]}m${value}\u001b[0m`;
}

function humanizePipelineValue(value: string): string {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function managedPipelineTargetLabel(pipeline: ManagedPipelineDisplay): string {
  const targets = new Set(managedPipelineTargets(pipeline));
  if (targets.has('study') && targets.has('order')) return 'Study + Order';
  if (targets.has('study')) return 'Study';
  if (targets.has('order')) return 'Order';
  const values = Array.from(targets).map(humanizePipelineValue);
  return values.join(' + ') || '—';
}

function managedPipelinePackageLabel(pipeline: ManagedPipelineDisplay): string {
  if (pipeline.packageState === 'bundled') return 'Built in';
  if (pipeline.packageState === 'installed') return 'Installed';
  if (!pipeline.packageState || pipeline.packageState === 'available') {
    return 'Available';
  }
  return humanizePipelineValue(pipeline.packageState);
}

function managedPipelineActivationState(
  pipeline: ManagedPipelineDisplay
): 'enabled' | 'disabled' {
  if (pipeline.activationState === 'enabled') return 'enabled';
  if (pipeline.activationState === 'disabled') return 'disabled';
  return pipeline.enabled ? 'enabled' : 'disabled';
}

function managedPipelineSetupState(pipeline: ManagedPipelineDisplay): string {
  return (
    pipeline.setupState ||
    pipeline.readiness?.status ||
    (pipeline.packageState === 'available' ? 'not-installed' : 'needs-setup')
  );
}

function managedPipelineIsInstalled(
  pipeline: ManagedPipelineDisplay
): boolean {
  if (typeof pipeline.installed === 'boolean') return pipeline.installed;
  return (
    (pipeline.packageState || 'available') !== 'available' &&
    managedPipelineSetupState(pipeline) !== 'not-installed'
  );
}

function managedPipelineStatusTargetLabel(
  pipeline: ManagedPipelineDisplay
): string {
  const targets = new Set(managedPipelineTargets(pipeline));
  if (targets.has('study') && targets.has('order')) {
    return 'Studies and sequencing orders';
  }
  if (targets.has('study')) return 'Studies';
  if (targets.has('order')) return 'Sequencing orders';
  return managedPipelineTargetLabel(pipeline);
}

function managedPipelineInstalledLabel(
  pipeline: ManagedPipelineDisplay,
  installed: boolean
): string {
  if (!installed) return 'No · available from Pipeline Store';
  if (pipeline.packageState === 'bundled') {
    return 'Yes · built in';
  }
  if (pipeline.packageState === 'installed') {
    return 'Yes · Pipeline Store';
  }
  return 'Yes';
}

function managedPipelineSetupLabel(setupState: string): string {
  if (setupState === 'ready') return 'Complete';
  if (setupState === 'not-installed') return 'Not started';
  const labels: Record<string, string> = {
    'needs-package': 'Package required',
    'needs-config': 'Configuration required',
    'needs-db': 'Database required',
    'needs-runtime': 'Runtime required',
    'needs-storage': 'Data storage required',
    'needs-attention': 'Attention required',
    'needs-setup': 'Setup required',
  };
  if (labels[setupState]) return labels[setupState];
  return humanizePipelineValue(setupState);
}

function managedPipelineOverallStatus(
  pipeline: ManagedPipelineDisplay
): {
  label: string;
  tone: PipelineListTone;
  installed: boolean;
  setupState: string;
  setupReady: boolean;
  enabled: boolean;
  usable: boolean;
  summary: string;
} {
  const installed = managedPipelineIsInstalled(pipeline);
  const setupState = managedPipelineSetupState(pipeline);
  const setupReady =
    typeof pipeline.readiness?.canEnable === 'boolean'
      ? pipeline.readiness.canEnable
      : setupState === 'ready';
  const enabled = managedPipelineActivationState(pipeline) === 'enabled';
  const usable = installed && setupReady && enabled;

  if (!installed) {
    return {
      label: '✗ NOT USABLE NOW · NOT INSTALLED',
      tone: 'danger',
      installed,
      setupState,
      setupReady,
      enabled,
      usable,
      summary:
        'This pipeline is available, but users cannot run it until it is installed.',
    };
  }
  if (!setupReady) {
    return {
      label: '✗ NOT USABLE NOW · SETUP REQUIRED',
      tone: 'danger',
      installed,
      setupState,
      setupReady,
      enabled,
      usable,
      summary:
        'This pipeline is installed, but users cannot run it until setup is complete.',
    };
  }
  if (!enabled) {
    return {
      label: '✗ NOT USABLE NOW · DISABLED',
      tone: 'danger',
      installed,
      setupState,
      setupReady,
      enabled,
      usable,
      summary:
        'This pipeline is installed and configured, but users cannot run it until it is enabled.',
    };
  }
  return {
    label: '✓ USABLE NOW',
    tone: 'success',
    installed,
    setupState,
    setupReady,
    enabled,
    usable,
    summary: 'Users can run this pipeline now.',
  };
}

function managedPipelineStateLabel(pipeline: ManagedPipelineDisplay): {
  label: string;
  tone: PipelineListTone;
} {
  const packageState = pipeline.packageState || 'available';
  const setupState = managedPipelineSetupState(pipeline);
  const activationState = managedPipelineActivationState(pipeline);

  if (packageState === 'available' || setupState === 'not-installed') {
    return { label: '○ Not installed', tone: 'muted' };
  }
  if (setupState === 'ready') {
    return activationState === 'enabled'
      ? { label: '✓ Ready', tone: 'success' }
      : { label: '○ Ready · disabled', tone: 'accent' };
  }

  const setupLabels: Record<string, string> = {
    'needs-package': 'needs package',
    'needs-config': 'needs configuration',
    'needs-db': 'needs database',
    'needs-runtime': 'needs runtime',
    'needs-storage': 'needs data storage',
    'needs-attention': 'needs attention',
    'needs-setup': 'needs setup',
  };
  const reason =
    setupLabels[setupState] || humanizePipelineValue(setupState).toLowerCase();
  const activation =
    activationState === 'enabled' ? 'Enabled' : 'Disabled';
  return {
    label: `! ${activation} · ${reason}`,
    tone: 'warning',
  };
}

function truncatePipelineListCell(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width <= 1) return '…';
  return `${value.slice(0, width - 1)}…`;
}

function formatPipelineListCell(
  value: string,
  width: number,
  options: {
    color: boolean;
    tone?: PipelineListTone;
  }
): string {
  const truncated = truncatePipelineListCell(value, width);
  const styled = options.tone
    ? stylePipelineListText(truncated, options.tone, options.color)
    : truncated;
  return `${styled}${' '.repeat(Math.max(0, width - truncated.length))}`;
}

export function pipelineListColorEnabled(
  options: {
    isTTY?: boolean;
    env?: Record<string, string | undefined>;
  } = {}
): boolean {
  const env = options.env || process.env;
  const isTTY = options.isTTY ?? Boolean(process.stdout.isTTY);
  return (
    isTTY &&
    !Object.prototype.hasOwnProperty.call(env, 'NO_COLOR') &&
    env.TERM !== 'dumb'
  );
}

function formatManagedPipelineCards(
  pipelines: ManagedPipelineDisplay[],
  color: boolean
): string[] {
  const lines: string[] = [];
  for (const pipeline of pipelines) {
    const state = managedPipelineStateLabel(pipeline);
    lines.push(
      stylePipelineListText(
        managedPipelineId(pipeline),
        'accent',
        color
      ),
      `  Use with  ${managedPipelineTargetLabel(pipeline)}`,
      `  Package   ${managedPipelinePackageLabel(pipeline)}`,
      `  State     ${stylePipelineListText(state.label, state.tone, color)}`
    );
    const next = managedNextAction(pipeline);
    if (next !== '-') {
      lines.push(
        `  ${stylePipelineListText('→', 'accent', color)} ${stylePipelineListText(
          next,
          'accent',
          color
        )}`
      );
    }
    lines.push('');
  }
  return lines;
}

export function formatManagedPipelineList(
  pipelines: ManagedPipelineDisplay[],
  options: PipelineListRenderOptions = {}
): string {
  const color = options.color === true;
  const width = Math.max(40, Math.floor(options.width || 100));
  const installed = pipelines.filter(
    (pipeline) => (pipeline.packageState || 'available') !== 'available'
  ).length;
  const enabled = pipelines.filter(
    (pipeline) => managedPipelineActivationState(pipeline) === 'enabled'
  ).length;
  const pipelineCountLabel =
    pipelines.length === 1 ? '1 pipeline' : `${pipelines.length} pipelines`;
  const lines = [
    stylePipelineListText('SeqDesk pipelines', 'accent', color),
    stylePipelineListText(
      `${pipelineCountLabel} · ${installed} installed · ${enabled} enabled`,
      'muted',
      color
    ),
    '',
  ];

  if (pipelines.length === 0) {
    lines.push('No pipelines match these filters.', '');
    return lines.join('\n');
  }

  const longestPipelineId = Math.max(
    'PIPELINE'.length,
    ...pipelines.map((pipeline) => managedPipelineId(pipeline).length)
  );
  const useCards = width < 86 || longestPipelineId > 26;
  if (useCards) {
    lines.push(...formatManagedPipelineCards(pipelines, color));
    return lines.join('\n');
  }

  const targetWidth = 13;
  const packageWidth = 10;
  const gapWidth = 6;
  const pipelineWidth = Math.min(longestPipelineId, 26);
  const stateWidth =
    width - pipelineWidth - targetWidth - packageWidth - gapWidth;
  const header = [
    'PIPELINE'.padEnd(pipelineWidth),
    'USE WITH'.padEnd(targetWidth),
    'PACKAGE'.padEnd(packageWidth),
    'STATE',
  ].join('  ');
  lines.push(
    stylePipelineListText(header, 'muted', color),
    stylePipelineListText('─'.repeat(width), 'muted', color)
  );

  for (const pipeline of pipelines) {
    const state = managedPipelineStateLabel(pipeline);
    const pipelineCell = formatPipelineListCell(
      managedPipelineId(pipeline),
      pipelineWidth,
      { color, tone: 'accent' }
    );
    const targetCell = formatPipelineListCell(
      managedPipelineTargetLabel(pipeline),
      targetWidth,
      { color }
    );
    const packageCell = formatPipelineListCell(
      managedPipelinePackageLabel(pipeline),
      packageWidth,
      { color }
    );
    const stateCell = truncatePipelineListCell(state.label, stateWidth);
    lines.push(
      [
        pipelineCell,
        targetCell,
        packageCell,
        stylePipelineListText(stateCell, state.tone, color),
      ]
        .join('  ')
    );
    const next = managedNextAction(pipeline);
    if (next !== '-') {
      lines.push(
        `  ${stylePipelineListText('→', 'accent', color)} ${stylePipelineListText(
          next,
          'accent',
          color
        )}`
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function formatManagedPipelineListGuidance(
  options: {
    showSimulateReadsExample?: boolean;
    color?: boolean;
  } = {}
): string {
  const color = options.color === true;
  const row = (label: string, value: string) =>
    `  ${label.padEnd(20)} ${stylePipelineListText(value, 'accent', color)}`;
  const lines = [
    '',
    stylePipelineListText('Start here', 'accent', color),
    row('Install a pipeline', 'seqdesk pipelines install <pipeline-id>'),
    row('Inspect details', 'seqdesk pipelines status <pipeline-id>'),
  ];
  if (options.showSimulateReadsExample) {
    lines.push(
      row(
        'Safe order example',
        'seqdesk pipelines install simulate-reads --runtime'
      )
    );
  }
  lines.push(row('Guide', PIPELINE_INSTALL_GUIDE_URL), '');
  return lines.join('\n');
}

export function formatManagedPipelineStatus(
  pipeline: ManagedPipelineDisplay,
  options: { showNextActions?: boolean; color?: boolean } = {}
): string {
  const id = managedPipelineId(pipeline);
  const overall = managedPipelineOverallStatus(pipeline);
  const color = options.color === true;
  const missing = (pipeline.readiness?.items || []).filter(
    (item) =>
      item.status !== 'ready' &&
      item.blocking !== false &&
      item.id !== 'enabled'
  );
  const warnings = (pipeline.readiness?.items || []).filter(
    (item) =>
      item.status !== 'ready' &&
      item.blocking === false &&
      item.id !== 'enabled'
  );
  const checkRow = (
    symbol: '✓' | '✗' | '–',
    label: string,
    value: string,
    tone: PipelineListTone
  ) =>
    `  ${stylePipelineListText(symbol, tone, color)} ${label.padEnd(
      19
    )} ${stylePipelineListText(value, tone, color)}`;
  const warningSummary =
    overall.usable && warnings.length > 0
      ? ` · ${stylePipelineListText(
          `! ${warnings.length} ${
            warnings.length === 1 ? 'WARNING' : 'WARNINGS'
          }`,
          'warning',
          color
        )}`
      : '';
  const lines = [
    stylePipelineListText(
      `${id}${pipeline.name && pipeline.name !== id ? ` — ${pipeline.name}` : ''}`,
      'accent',
      color
    ),
    `${stylePipelineListText(
      overall.label,
      overall.tone,
      color
    )}${warningSummary}`,
    stylePipelineListText(overall.summary, 'muted', color),
    '',
    'Checks',
    checkRow(
      overall.installed ? '✓' : '✗',
      'Installed',
      managedPipelineInstalledLabel(pipeline, overall.installed),
      overall.installed ? 'success' : 'danger'
    ),
    checkRow(
      overall.setupReady ? '✓' : overall.installed ? '✗' : '–',
      'Setup ready',
      overall.setupReady
        ? 'Yes'
        : overall.installed
          ? `No · ${managedPipelineSetupLabel(overall.setupState)}`
          : 'Not started',
      overall.setupReady
        ? 'success'
        : overall.installed
          ? 'danger'
          : 'muted'
    ),
    checkRow(
      overall.enabled ? '✓' : overall.installed ? '✗' : '–',
      'Enabled',
      overall.enabled
        ? 'Yes'
        : overall.installed
          ? 'No'
          : 'Available after installation',
      overall.enabled
        ? 'success'
        : overall.installed
          ? 'danger'
          : 'muted'
    ),
    checkRow(
      '–',
      'Applies to',
      managedPipelineStatusTargetLabel(pipeline),
      'muted'
    ),
  ];

  if (missing.length > 0) {
    lines.push(
      '',
      stylePipelineListText('Blocked by', 'danger', color)
    );
    for (const item of missing) {
      lines.push(
        `  ${stylePipelineListText('✗', 'danger', color)} ${stylePipelineListText(
          `${item.label || item.id || 'Setup'}${
            item.detail ? `: ${item.detail}` : ''
          }`,
          'danger',
          color
        )}`
      );
    }
  }

  if (warnings.length > 0) {
    lines.push(
      '',
      stylePipelineListText(
        'Warnings · does not block use',
        'warning',
        color
      )
    );
    for (const item of warnings) {
      lines.push(
        `  ${stylePipelineListText('!', 'warning', color)} ${stylePipelineListText(
          `${item.label || item.id || 'Warning'}${
            item.detail ? `: ${item.detail}` : ''
          }`,
          'warning',
          color
        )}`
      );
    }
  }

  if (
    options.showNextActions !== false &&
    (pipeline.nextActions?.length || 0) > 0
  ) {
    const commands: string[] = [];
    const seenCommands = new Set<string>();
    for (const action of pipeline.nextActions || []) {
      let text: string | undefined;
      if (typeof action === 'string') {
        text = action;
      } else if (action && typeof action === 'object') {
        const candidate = action as Record<string, unknown>;
        const command =
          typeof candidate.action === 'string'
            ? commandForManagedAction(id, candidate.action)
            : null;
        const candidateText =
          command || candidate.command || candidate.label;
        text =
          typeof candidateText === 'string' && candidateText
            ? candidateText
            : undefined;
      }
      if (text && !seenCommands.has(text)) {
        seenCommands.add(text);
        commands.push(text);
      }
    }
    if (commands.length > 0) {
      lines.push(
        '',
        stylePipelineListText(
          commands.length === 1 ? 'Next step:' : 'Next steps:',
          'accent',
          color
        ),
        ...commands.map(
          (command) =>
            `  ${stylePipelineListText('→', 'accent', color)} ${stylePipelineListText(
              command,
              'accent',
              color
            )}`
        )
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

function printManagedPipelineStatus(
  pipeline: ManagedPipelineDisplay,
  options: { showNextActions?: boolean } = {}
): void {
  process.stdout.write(
    formatManagedPipelineStatus(pipeline, {
      ...options,
      color: pipelineListColorEnabled(),
    })
  );
}

export function getManagedSetupGuidance(
  pipeline: ManagedPipelineDisplay
): string[] {
  const pipelineId = managedPipelineId(pipeline);
  const missing = (pipeline.readiness?.items || []).filter(
    (item) =>
      item.status !== 'ready' &&
      item.blocking !== false &&
      item.id !== 'enabled'
  );
  const guidance: string[] = [];
  const actions = new Set(missing.map((item) => item.action));

  if (actions.has('configure')) {
    const requiredConfig = missing
      .filter(
        (item) =>
          item.id === 'required-config' ||
          item.id === 'pipeline-config'
      )
      .map((item) => item.detail)
      .filter((detail): detail is string => Boolean(detail));
    guidance.push(
      `Provide the pipeline-specific values with \`seqdesk pipelines setup ${pipelineId} --config-file /path/to/pipeline-config.json\`, or configure them under Admin → Pipelines → ${pipelineId}${
        requiredConfig.length > 0
          ? ` (${requiredConfig.join(' ')})`
          : ''
      }.`
    );
  }

  if (actions.has('download-db')) {
    guidance.push(
      `Database assets are not downloaded automatically. Review and install or link them under Admin → Pipelines → ${pipelineId} → Databases.`
    );
  }

  if (actions.has('configure-storage')) {
    guidance.push(
      'Run `seqdesk storage configure /absolute/path/to/sequencing-data` on the SeqDesk host, or configure an existing readable data directory under Admin → Data Storage.'
    );
  }

  if (actions.has('configure-runtime')) {
    guidance.push(
      `Run \`seqdesk pipelines setup ${pipelineId} --runtime\` to install the managed runtime, or configure the existing Nextflow/Java/Conda/SLURM runtime under Admin → Pipeline Runtime.`
    );
  }

  if (guidance.length === 0 && !pipeline.readiness?.canEnable) {
    guidance.push(
      `Review the remaining readiness checks under Admin → Pipelines → ${pipelineId}.`
    );
  }
  return guidance;
}

function printManagedPipelineSetupResult(
  pipeline: ManagedPipelineDisplay
): void {
  printManagedPipelineStatus(pipeline, { showNextActions: false });
  const guidance = getManagedSetupGuidance(pipeline);
  if (guidance.length > 0) {
    process.stdout.write('To finish setup:\n');
    for (const item of guidance) {
      process.stdout.write(`  - ${item}\n`);
    }
  }
}

function resolveInstalledAppDir(installDir: string): string {
  const currentDir = path.join(installDir, 'current');
  return currentDir;
}

async function pathIsFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function findManagedRuntimeSetupScript(
  installDir: string
): Promise<{ appDir: string; scriptPath: string }> {
  const candidates = [resolveInstalledAppDir(installDir), installDir];
  for (const appDir of candidates) {
    const scriptPath = path.join(appDir, 'scripts', 'setup-conda-env.sh');
    if (await pathIsFile(scriptPath)) {
      return { appDir, scriptPath };
    }
  }
  throw new Error(
    `Managed pipeline runtime setup is unavailable in ${installDir}. Update SeqDesk or configure the runtime under Admin → Pipeline Runtime.`
  );
}

async function confirmManagedRuntimeSetup(): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await prompt.question(
      'Set up the managed Conda, Nextflow, and Java runtime now? [y/N] '
    );
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}

export async function invalidateManagedRuntimeSetupCaches(): Promise<void> {
  const [configLoader, prerequisiteCheck] = await Promise.all([
    import('../src/lib/config/loader'),
    import('../src/lib/pipelines/prerequisite-check'),
  ]);
  configLoader.clearConfigCache();
  prerequisiteCheck.clearPipelineRuntimePrerequisiteCache();
}

export async function runManagedRuntimeSetup(
  installDir: string,
  options: { json?: boolean } = {}
): Promise<void> {
  const { scriptPath } = await findManagedRuntimeSetupScript(installDir);
  const storage = await resolveManagedRuntimeSetupPaths(installDir);
  const args = [
    scriptPath,
    '--yes',
    '--install-miniconda',
    '--write-config',
    '--config-path',
    storage.configPath,
    '--pipelines-enabled',
    '--create-dirs',
    '--data-path',
    storage.dataPath,
    '--run-dir',
    storage.runDirectory,
  ];
  if (storage.condaPath) {
    args.push('--conda-path', storage.condaPath);
  }
  if (storage.condaEnvironment) {
    args.push('--env', storage.condaEnvironment);
  }
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn('bash', args, {
      // Relative paths in settings.json are relative to the installation root,
      // not to current/releases/<version>.
      cwd: path.resolve(installDir),
      env: process.env,
      stdio: options.json
        ? ['inherit', process.stderr, process.stderr]
        : 'inherit',
    });
    child.once('error', reject);
    child.once('close', (exitCode, signal) => {
      if (signal) {
        reject(
          new Error(`Managed runtime setup exited with signal ${signal}.`)
        );
        return;
      }
      resolve(exitCode ?? 1);
    });
  });
  if (code !== 0) {
    throw new Error(`Managed runtime setup failed with exit code ${code}.`);
  }
  await invalidateManagedRuntimeSetupCaches();
}

function printError(error: unknown, json: boolean): void {
  const message = error instanceof Error ? error.message : String(error);
  const details =
    error &&
    typeof error === 'object' &&
    'details' in error
      ? (error as { details?: unknown }).details
      : undefined;
  const status =
    error &&
    typeof error === 'object' &&
    'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : undefined;
  if (json) {
    jsonPrint({
      success: false,
      error: message,
      ...(details !== undefined && details !== '' ? { details } : {}),
      ...(status !== undefined ? { status } : {}),
    });
  } else {
    process.stderr.write(`[seqdesk pipelines] ${message}\n`);
    if (Array.isArray(details)) {
      for (const detail of details) {
        process.stderr.write(`  - ${String(detail)}\n`);
      }
    } else if (details) {
      process.stderr.write(`  ${String(details)}\n`);
    }
  }
}

function outputServiceResult(
  result: { status: number; body: Record<string, unknown> },
  json: boolean
): number {
  const success = result.status < 400;
  if (json) {
    jsonPrint(success ? { success: true, ...result.body } : { success: false, ...result.body });
  } else if (!success) {
    process.stderr.write(`[seqdesk pipeline] ${String(result.body.error || 'Command failed')}\n`);
  }
  return success ? 0 : 1;
}

function humanStatus(run: Record<string, unknown>): string {
  return [
    `Run ${run.id}`,
    `pipeline=${run.pipelineId}`,
    `target=${run.targetType}`,
    `status=${run.status}`,
    run.progress != null ? `progress=${run.progress}%` : '',
    run.currentStep ? `step=${run.currentStep}` : '',
    run.queueJobId ? `job=${run.queueJobId}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function watchRun(
  runId: string,
  services: Awaited<ReturnType<typeof loadServices>>,
  json: boolean
): Promise<number> {
  let lastRun: Record<string, unknown> | null = null;
  for (;;) {
    await services.ops.syncPipelineRunForOperator(runId).catch(() => null);
    const details = await services.ops.getPipelineRunDetailsForOperator(runId);
    if (details.status >= 400) {
      return outputServiceResult(details, json);
    }

    const run = (details.body as { run: Record<string, unknown> }).run;
    lastRun = run;
    if (!json) {
      process.stdout.write(`${humanStatus(run)}\n`);
    }
    if (TERMINAL_STATUSES.has(String(run.status))) {
      break;
    }
    await sleep(5000);
  }

  if (json) {
    jsonPrint({ success: true, run: lastRun });
  }
  return String(lastRun?.status) === 'completed' ? 0 : 1;
}

async function loadServices() {
  const runService = await import('../src/lib/pipelines/pipeline-run-service');
  const ops = await import('../src/lib/pipelines/pipeline-run-ops-service');
  const management = await import(
    '../src/lib/pipelines/pipeline-management-service'
  );
  const installer = await import(
    '../src/lib/pipelines/pipeline-install-service'
  );
  return { runService, ops, management, installer };
}

async function runCommand(parsed: ParsedArgs): Promise<number> {
  if (parsed.help) {
    process.stdout.write(`${USAGE.trim()}\n`);
    return 0;
  }

  await loadRuntimeEnvironment(parsed.dir, {
    explicitDir: parsed.dirExplicit,
  });
  const services = await loadServices();

  if (parsed.command === 'list') {
    const catalog = readString(parsed.values.catalog) || 'all';
    if (!['study', 'order', 'all'].includes(catalog)) {
      throw new Error('--catalog must be one of: study, order, all');
    }
    const installedOnly = readBoolean(parsed.values.installed);
    const enabledOnly = readBoolean(parsed.values.enabled);
    const result = await services.management.listManagedPipelineCatalog({
      catalog: catalog as 'study' | 'order' | 'all',
      installedOnly,
      enabledOnly,
    });
    if (parsed.json) {
      jsonPrint({
        success: true,
        ...result,
        pipelines: result.pipelines.map((pipeline) =>
          managedPipelineForJson(pipeline as ManagedPipelineDisplay)
        ),
      });
      return 0;
    }
    const color = pipelineListColorEnabled();
    process.stdout.write(
      formatManagedPipelineList(
        result.pipelines as ManagedPipelineDisplay[],
        {
          color,
          width: process.stdout.columns,
        }
      )
    );
    process.stdout.write(
      formatManagedPipelineListGuidance({
        color,
        showSimulateReadsExample:
          catalog !== 'study' &&
          !installedOnly &&
          !enabledOnly &&
          result.pipelines.some(
            (pipeline) =>
              managedPipelineId(
                pipeline as ManagedPipelineDisplay
              ) === 'simulate-reads'
          ),
      })
    );
    for (const warning of result.registryErrors) {
      process.stderr.write(
        `[seqdesk pipelines] Registry ${warning.label || warning.sourceId}: ${warning.error}\n`
      );
    }
    return 0;
  }

  if (parsed.command === 'install') {
    const pipelineId = parsed.positionals[0];
    if (!pipelineId) throw new Error('Missing pipelineId');
    if (parsed.positionals.length > 1) {
      throw new Error('Install accepts exactly one pipelineId');
    }

    let result = await services.installer.installManagedPipeline({
      pipelineId,
      sourceId: readString(parsed.values.source),
      version: readString(parsed.values.version),
      credentials: {
        accessKey:
          readRuntimeString(process.env.SEQDESK_PIPELINE_ACCESS_KEY) ||
          undefined,
        token:
          readRuntimeString(process.env.SEQDESK_PIPELINE_GITHUB_TOKEN) ||
          readRuntimeString(process.env.GITHUB_TOKEN) ||
          undefined,
        sha256: readString(parsed.values.sha256),
      },
      autoEnable: true,
    });

    let pipeline = result.status;
    if (managedPipelineNeedsRuntime(pipeline as ManagedPipelineDisplay)) {
      const runtimeAccepted =
        readBoolean(parsed.values.runtime) ||
        readBoolean(parsed.values.yes) ||
        (!parsed.json && (await confirmManagedRuntimeSetup()));
      if (runtimeAccepted) {
        await runManagedRuntimeSetup(parsed.dir, { json: parsed.json });
        pipeline = await services.management.getManagedPipelineStatus(
          pipelineId,
          { includeAvailable: false }
        );
        if (pipeline?.readiness?.canEnable) {
          await services.management.updateManagedPipeline({
            pipelineId,
            enabled: true,
          });
          pipeline = await services.management.getManagedPipelineStatus(
            pipelineId,
            { includeAvailable: false }
          );
        }
        if (pipeline) {
          const setupRequired = !Boolean(pipeline.readiness?.canEnable);
          result = {
            ...result,
            message: reconcileManagedInstallMessage(
              result.message,
              setupRequired
            ),
            status: pipeline,
            packageState: pipeline.packageState,
            setupState: pipeline.setupState,
            activationState: pipeline.activationState,
            setupRequired,
            enabled: pipeline.enabled,
            readiness: pipeline.readiness,
            nextActions: pipeline.nextActions,
            autoEnabled:
              result.autoEnabled ||
              pipeline.activationState === 'enabled',
          };
        }
      }
    }

    if (parsed.json) {
      const jsonStatus = result.status
        ? managedPipelineForJson(
            result.status as ManagedPipelineDisplay
          )
        : null;
      jsonPrint({
        ...result,
        status: jsonStatus,
        pipeline: jsonStatus,
        nextActions: jsonStatus?.nextActions || result.nextActions,
      });
    } else {
      process.stdout.write(`${result.message}\n`);
      if (result.status) {
        printManagedPipelineStatus(
          result.status as ManagedPipelineDisplay
        );
      }
    }
    return 0;
  }

  if (parsed.command === 'setup') {
    const pipelineId = parsed.positionals[0];
    if (!pipelineId) throw new Error('Missing pipelineId');
    if (parsed.positionals.length > 1) {
      throw new Error('Setup accepts exactly one pipelineId');
    }
    const hasConfig =
      Boolean(readString(parsed.values.config_file)) ||
      Boolean(readString(parsed.values.config_json));
    const config = hasConfig ? await readConfig(parsed.values) : undefined;
    await services.management.updateManagedPipeline({
      pipelineId,
      config,
      enabled: false,
    });

    let pipeline = await services.management.getManagedPipelineStatus(
      pipelineId,
      { includeAvailable: false }
    );
    if (!pipeline) {
      throw new Error(`Pipeline "${pipelineId}" is not installed.`);
    }

    const runtimeRequested = readBoolean(parsed.values.runtime);
    const runtimeNeeded = managedPipelineNeedsRuntime(
      pipeline as ManagedPipelineDisplay
    );
    const runtimeAccepted =
      runtimeRequested ||
      (runtimeNeeded &&
        (readBoolean(parsed.values.yes) ||
          (!parsed.json && (await confirmManagedRuntimeSetup()))));
    if (runtimeAccepted) {
      await runManagedRuntimeSetup(parsed.dir, { json: parsed.json });
      pipeline = await services.management.getManagedPipelineStatus(
        pipelineId,
        { includeAvailable: false }
      );
      if (!pipeline) {
        throw new Error(`Pipeline "${pipelineId}" is not installed.`);
      }
    }

    if (pipeline.readiness?.canEnable) {
      await services.management.updateManagedPipeline({
        pipelineId,
        enabled: true,
      });
      pipeline = await services.management.getManagedPipelineStatus(
        pipelineId,
        { includeAvailable: false }
      );
    }

    if (parsed.json) {
      const setupGuidance = getManagedSetupGuidance(
        pipeline as ManagedPipelineDisplay
      );
      jsonPrint({
        success: true,
        pipeline: managedPipelineForJson(
          pipeline as ManagedPipelineDisplay
        ),
        setupGuidance,
      });
    } else {
      printManagedPipelineSetupResult(
        pipeline as ManagedPipelineDisplay
      );
    }
    return 0;
  }

  if (parsed.command === 'enable') {
    const pipelineId = parsed.positionals[0];
    if (!pipelineId) throw new Error('Missing pipelineId');
    await services.management.updateManagedPipeline({
      pipelineId,
      enabled: true,
    });
    const pipeline = await services.management.getManagedPipelineStatus(
      pipelineId,
      { includeAvailable: false }
    );
    if (!pipeline) {
      throw new Error(`Pipeline "${pipelineId}" is not installed.`);
    }
    if (parsed.json) {
      jsonPrint({
        success: true,
        pipeline: managedPipelineForJson(
          pipeline as ManagedPipelineDisplay
        ),
      });
    } else {
      printManagedPipelineStatus(pipeline as ManagedPipelineDisplay);
    }
    return 0;
  }

  if (
    parsed.command === 'status' &&
    parsed.commandFamily === 'pipelines' &&
    !readBoolean(parsed.values.watch)
  ) {
    const pipelineId = parsed.positionals[0];
    if (!pipelineId) throw new Error('Missing pipelineId');
    const pipeline = await services.management.getManagedPipelineStatus(
      pipelineId,
      {
        includeAvailable: true,
        sourceId: readString(parsed.values.source),
        version: readString(parsed.values.version),
      }
    );
    if (!pipeline) {
      throw new Error(`Pipeline "${pipelineId}" was not found.`);
    }
    if (parsed.json) {
      jsonPrint({
        success: true,
        pipeline: managedPipelineForJson(
          pipeline as ManagedPipelineDisplay
        ),
      });
    } else {
      printManagedPipelineStatus(pipeline as ManagedPipelineDisplay);
    }
    return 0;
  }

  if (parsed.command === 'run') {
    const pipelineId = parsed.positionals[0];
    if (!pipelineId) throw new Error('Missing pipelineId');
    const { studyId, orderId } = assertOneTarget(parsed.values);
    const operator = await services.ops.resolvePipelineOperator(
      readString(parsed.values.user_email)
    );
    if (operator.status >= 400) return outputServiceResult(operator, parsed.json);

    const config = await readConfig(parsed.values);
    const execution = readString(parsed.values.execution);
    if (execution && !['default', 'local', 'slurm'].includes(execution)) {
      throw new Error('--execution must be one of: default, local, slurm');
    }
    const samples = readString(parsed.values.samples)
      ?.split(',')
      .map((sample) => sample.trim())
      .filter(Boolean);
    const user = (operator.body as { user: { id: string } }).user;
    const create = await services.runService.createPipelineRunForOperator({
      userId: user.id,
      body: {
        pipelineId,
        studyId,
        orderId,
        sampleIds: samples,
        config,
        executionMode: execution,
      },
    });
    if (create.status >= 400) return outputServiceResult(create, parsed.json);

    const run = (create.body as { run: { id: string } }).run;
    const start = await services.runService.startPipelineRunForOperator({
      runId: run.id,
      userId: user.id,
      body: execution ? { executionMode: execution } : {},
    });
    if (start.status >= 400) return outputServiceResult(start, parsed.json);
    if (readBoolean(parsed.values.watch)) {
      return watchRun(run.id, services, parsed.json);
    }
    if (parsed.json) {
      jsonPrint({ success: true, run, start: start.body });
    } else {
      process.stdout.write(`Created and started ${run.id}: ${String(start.body.status || 'started')}\n`);
    }
    return 0;
  }

  const runId = parsed.positionals[0];
  if (!runId) throw new Error(`Missing runId for ${parsed.command}`);

  if (parsed.command === 'status') {
    if (readBoolean(parsed.values.watch)) {
      return watchRun(runId, services, parsed.json);
    }
    const installedPipeline =
      await services.management.getManagedPipelineStatus(runId, {
        includeAvailable: false,
      });
    if (installedPipeline) {
      if (parsed.json) {
        jsonPrint({
          success: true,
          pipeline: managedPipelineForJson(
            installedPipeline as ManagedPipelineDisplay
          ),
        });
      } else {
        printManagedPipelineStatus(
          installedPipeline as ManagedPipelineDisplay
        );
      }
      return 0;
    }
    const result = await services.ops.getPipelineRunDetailsForOperator(runId);
    if (result.status >= 400) {
      const availablePipeline =
        await services.management.getManagedPipelineStatus(runId, {
          includeAvailable: true,
          sourceId: readString(parsed.values.source),
          version: readString(parsed.values.version),
        });
      if (availablePipeline) {
        if (parsed.json) {
          jsonPrint({
            success: true,
            pipeline: managedPipelineForJson(
              availablePipeline as ManagedPipelineDisplay
            ),
          });
        } else {
          printManagedPipelineStatus(
            availablePipeline as ManagedPipelineDisplay
          );
        }
        return 0;
      }
      return outputServiceResult(result, parsed.json);
    }
    if (parsed.json) return outputServiceResult(result, true);
    process.stdout.write(`${humanStatus((result.body as { run: Record<string, unknown> }).run)}\n`);
    return 0;
  }

  if (parsed.command === 'sync') {
    return outputServiceResult(await services.ops.syncPipelineRunForOperator(runId), parsed.json);
  }

  if (parsed.command === 'logs') {
    const tail = Number(readString(parsed.values.tail) || '100');
    if (!Number.isFinite(tail) || tail <= 0) throw new Error('--tail must be a positive number');
    const type = readString(parsed.values.type) || 'output';
    if (!['output', 'error'].includes(type)) throw new Error('--type must be output or error');
    const result = await services.ops.getPipelineRunLogsForOperator(runId, { type, tail });
    if (parsed.json) return outputServiceResult(result, true);
    if (result.status >= 400) return outputServiceResult(result, false);
    process.stdout.write(String(result.body.content || ''));
    if (!String(result.body.content || '').endsWith('\n')) process.stdout.write('\n');
    return 0;
  }

  if (parsed.command === 'outputs') {
    return outputServiceResult(await services.ops.getPipelineRunOutputsForOperator(runId), parsed.json);
  }

  if (parsed.command === 'debug') {
    const format = readString(parsed.values.format) || 'text';
    if (!['text', 'json'].includes(format)) throw new Error('--format must be text or json');
    const result = await services.ops.getPipelineDebugBundleForOperator(runId);
    if (result.status >= 400) return outputServiceResult(result, parsed.json || format === 'json');
    const output =
      format === 'json'
        ? `${JSON.stringify(result.body, null, 2)}\n`
        : services.ops.buildDebugBundleText(result.body as DebugBundle);
    const outPath = readString(parsed.values.out);
    if (outPath) {
      await fs.writeFile(path.resolve(outPath), output);
    } else {
      process.stdout.write(output);
    }
    return 0;
  }

  if (parsed.command === 'cancel') {
    return outputServiceResult(await services.ops.cancelPipelineRunForOperator(runId), parsed.json);
  }

  throw new Error(`Unhandled pipeline command: ${parsed.command}`);
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const jsonMode = argv.includes('--json');
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  if (jsonMode) {
    const diagnostic = (...values: unknown[]) => {
      process.stderr.write(
        `[seqdesk pipelines] ${values.map(String).join(' ')}\n`
      );
    };
    // Package discovery and some runtime probes predate the CLI and log to the
    // console. Keep machine-readable stdout as one JSON document while still
    // preserving those diagnostics on stderr.
    console.log = diagnostic;
    console.warn = diagnostic;
  }
  try {
    const parsed = parsePipelineArgs(argv);
    return await runCommand(parsed);
  } catch (error) {
    printError(error, jsonMode);
    return 1;
  } finally {
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
  }
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      printError(error, process.argv.includes('--json'));
      process.exitCode = 1;
    });
}
