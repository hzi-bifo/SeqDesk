#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import type { DebugBundle } from '../src/lib/pipelines/pipeline-run-ops-service';

type PipelineCommand =
  | 'list'
  | 'run'
  | 'status'
  | 'sync'
  | 'logs'
  | 'outputs'
  | 'debug'
  | 'cancel';

type ParsedArgs = {
  command: PipelineCommand | 'help';
  dir: string;
  json: boolean;
  help: boolean;
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
};

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

const USAGE = `Usage:
  seqdesk pipeline list --dir <install> [--catalog study|order|all] [--enabled] [--json]
  seqdesk pipeline run <pipelineId> --dir <install> (--study <id>|--order <id>) [--samples id,id] [--config-file file|--config-json json] [--execution default|local|slurm] [--watch] [--json] [--user-email email]
  seqdesk pipeline status <runId> --dir <install> [--watch] [--json]
  seqdesk pipeline sync <runId> --dir <install> [--json]
  seqdesk pipeline logs <runId> --dir <install> [--type output|error] [--tail 200] [--json]
  seqdesk pipeline outputs <runId> --dir <install> [--json]
  seqdesk pipeline debug <runId> --dir <install> [--format text|json] [--out file]
  seqdesk pipeline cancel <runId> --dir <install> [--json]

Local shell access to the installed SeqDesk directory is treated as operator access.
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
  const argv = rawArgv[0] === 'pipeline' ? rawArgv.slice(1) : rawArgv.slice();
  const parsed: ParsedArgs = {
    command: 'help',
    dir: process.cwd(),
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
  if (!['list', 'run', 'status', 'sync', 'logs', 'outputs', 'debug', 'cancel'].includes(command)) {
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

    const split = token.match(/^(--[a-z0-9-]+)=(.*)$/i);
    const flag = split ? split[1] : token;
    const inlineValue = split ? split[2] : undefined;

    if (flag === '--dir' || flag === '-d') {
      const value = inlineValue ?? takeValue(argv, index, token);
      parsed.dir = value;
      if (inlineValue === undefined) index += 1;
      continue;
    }

    const valueFlags = new Set([
      '--catalog',
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
      setValue(parsed, flag.slice(2).replace(/-/g, '_'), value);
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

async function loadRuntimeEnvironment(installDir: string): Promise<void> {
  let config: Record<string, unknown> = {};
  try {
    // A13: prefer canonical settings.json, fall back to legacy seqdesk.config.json.
    let raw = '{}';
    for (const name of ['settings.json', 'seqdesk.config.json']) {
      try {
        raw = await fs.readFile(path.join(installDir, name), 'utf-8');
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

  if (!process.env.DATABASE_URL) {
    const databaseUrl = readRuntimeString(runtime.databaseUrl ?? config.databaseUrl);
    if (databaseUrl) {
      process.env.DATABASE_URL = databaseUrl;
    }
  }

  if (!process.env.DIRECT_URL) {
    const directUrl = readRuntimeString(runtime.directUrl ?? runtime.databaseDirectUrl ?? config.directUrl);
    process.env.DIRECT_URL = directUrl || process.env.DATABASE_URL;
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

function printError(error: unknown, json: boolean): void {
  const message = error instanceof Error ? error.message : String(error);
  if (json) {
    jsonPrint({ success: false, error: message });
  } else {
    process.stderr.write(`[seqdesk pipeline] ${message}\n`);
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
  return { runService, ops };
}

async function runCommand(parsed: ParsedArgs): Promise<number> {
  if (parsed.help) {
    process.stdout.write(`${USAGE.trim()}\n`);
    return 0;
  }

  await loadRuntimeEnvironment(parsed.dir);
  const services = await loadServices();

  if (parsed.command === 'list') {
    const catalog = readString(parsed.values.catalog) || 'all';
    if (!['study', 'order', 'all'].includes(catalog)) {
      throw new Error('--catalog must be one of: study, order, all');
    }
    const result = await services.ops.listPipelineCatalogForOperator({
      catalog: catalog as 'study' | 'order' | 'all',
      enabledOnly: readBoolean(parsed.values.enabled),
    });
    if (parsed.json) return outputServiceResult(result, true);
    if (result.status >= 400) return outputServiceResult(result, false);
    const pipelines = result.body.pipelines as Array<Record<string, unknown>>;
    for (const pipeline of pipelines) {
      process.stdout.write(
        `${pipeline.id}\t${pipeline.enabled ? 'enabled' : 'disabled'}\t${pipeline.name}\tstudy=${Boolean(
          (pipeline.catalog as Record<string, unknown>).study
        )}\torder=${Boolean((pipeline.catalog as Record<string, unknown>).order)}\n`
      );
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
    const result = await services.ops.getPipelineRunDetailsForOperator(runId);
    if (parsed.json) return outputServiceResult(result, true);
    if (result.status >= 400) return outputServiceResult(result, false);
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
  try {
    const parsed = parsePipelineArgs(argv);
    return await runCommand(parsed);
  } catch (error) {
    let json = false;
    try {
      json = argv.includes('--json');
    } catch {
      json = false;
    }
    printError(error, json);
    return 1;
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
