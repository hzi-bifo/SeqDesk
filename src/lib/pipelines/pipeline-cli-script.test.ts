import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatManagedPipelineListGuidance,
  getManagedSetupGuidance,
  loadRuntimeEnvironment,
  parsePipelineArgs,
  resolveManagedRuntimeSetupPaths,
  runManagedRuntimeSetup,
} from '../../../scripts/pipeline-cli';
import { clearConfigCache, loadConfig } from '../config/loader';
import * as prerequisiteCheck from './prerequisite-check';

const originalCwd = process.cwd();
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalDirectUrl = process.env.DIRECT_URL;
const originalDataPath = process.env.SEQDESK_DATA_PATH;
const originalPipelineRunDir = process.env.SEQDESK_PIPELINE_RUN_DIR;
const originalRuntimeArgsOut = process.env.SEQDESK_RUNTIME_ARGS_OUT;
const originalCondaPath = process.env.SEQDESK_CONDA_PATH;
const originalCondaEnv = process.env.SEQDESK_CONDA_ENV;
const originalExecCondaPath = process.env.SEQDESK_EXEC_CONDA_PATH;
const originalExecCondaEnv = process.env.SEQDESK_EXEC_CONDA_ENV;
const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  clearConfigCache();
  process.chdir(originalCwd);
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
  if (originalDirectUrl === undefined) {
    delete process.env.DIRECT_URL;
  } else {
    process.env.DIRECT_URL = originalDirectUrl;
  }
  if (originalDataPath === undefined) {
    delete process.env.SEQDESK_DATA_PATH;
  } else {
    process.env.SEQDESK_DATA_PATH = originalDataPath;
  }
  if (originalPipelineRunDir === undefined) {
    delete process.env.SEQDESK_PIPELINE_RUN_DIR;
  } else {
    process.env.SEQDESK_PIPELINE_RUN_DIR = originalPipelineRunDir;
  }
  if (originalRuntimeArgsOut === undefined) {
    delete process.env.SEQDESK_RUNTIME_ARGS_OUT;
  } else {
    process.env.SEQDESK_RUNTIME_ARGS_OUT = originalRuntimeArgsOut;
  }
  for (const [key, value] of [
    ['SEQDESK_CONDA_PATH', originalCondaPath],
    ['SEQDESK_CONDA_ENV', originalCondaEnv],
    ['SEQDESK_EXEC_CONDA_PATH', originalExecCondaPath],
    ['SEQDESK_EXEC_CONDA_ENV', originalExecCondaEnv],
  ] as const) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('parsePipelineArgs', () => {
  it('parses run command targets, config, samples, execution, and json flags', () => {
    const parsed = parsePipelineArgs([
      'run',
      'metaxpath',
      '--dir',
      '/opt/seqdesk',
      '--study',
      'study-1',
      '--samples',
      'sample-1,sample-2',
      '--config-json',
      '{"threads":4}',
      '--execution',
      'slurm',
      '--watch',
      '--json',
      '--user-email',
      'admin@example.org',
    ]);

    expect(parsed.command).toBe('run');
    expect(parsed.commandFamily).toBe('direct');
    expect(parsed.positionals).toEqual(['metaxpath']);
    expect(parsed.dir).toBe('/opt/seqdesk');
    expect(parsed.json).toBe(true);
    expect(parsed.values).toMatchObject({
      study: 'study-1',
      samples: 'sample-1,sample-2',
      config_json: '{"threads":4}',
      execution: 'slurm',
      watch: true,
      user_email: 'admin@example.org',
    });
  });

  it('parses status watch command with inline dir syntax', () => {
    const parsed = parsePipelineArgs([
      'status',
      'run-1',
      '--dir=/srv/seqdesk',
      '--watch',
    ]);

    expect(parsed.command).toBe('status');
    expect(parsed.positionals).toEqual(['run-1']);
    expect(parsed.dir).toBe('/srv/seqdesk');
    expect(parsed.dirExplicit).toBe(true);
    expect(parsed.values.watch).toBe(true);
  });

  it('accepts the plural command family and management flags', () => {
    const parsed = parsePipelineArgs([
      'pipelines',
      'list',
      '--catalog',
      'order',
      '--installed',
      '--json',
    ]);

    expect(parsed.command).toBe('list');
    expect(parsed.commandFamily).toBe('pipelines');
    expect(parsed.dirExplicit).toBe(false);
    expect(parsed.values).toMatchObject({
      catalog: 'order',
      installed: true,
    });
    expect(parsed.json).toBe(true);
  });

  it('parses install and guided setup commands', () => {
    const install = parsePipelineArgs([
      'pipelines',
      'install',
      'fastqc',
      '--yes',
    ]);
    const setup = parsePipelineArgs([
      'pipeline',
      'setup',
      'mag',
      '--runtime',
      '--config-json',
      '{"database":"/srv/gtdb"}',
    ]);

    expect(install.command).toBe('install');
    expect(install.positionals).toEqual(['fastqc']);
    expect(install.values.yes).toBe(true);
    expect(setup.command).toBe('setup');
    expect(setup.commandFamily).toBe('pipeline');
    expect(setup.positionals).toEqual(['mag']);
    expect(setup.values).toMatchObject({
      runtime: true,
      config_json: '{"database":"/srv/gtdb"}',
    });
  });

  it('accepts the launcher command-family marker', () => {
    const parsed = parsePipelineArgs([
      'status',
      'fastqc',
      '--command-family',
      'pipelines',
      '--dir',
      '/opt/seqdesk',
    ]);

    expect(parsed.commandFamily).toBe('pipelines');
    expect(parsed.positionals).toEqual(['fastqc']);
  });

  it('rejects unknown pipeline commands', () => {
    expect(() => parsePipelineArgs(['remove', 'run-1'])).toThrow(
      'Unknown pipeline command: remove'
    );
  });

  it('rejects options without values', () => {
    expect(() => parsePipelineArgs(['run', 'metaxpath', '--study'])).toThrow(
      '--study requires a value'
    );
  });
});

describe('loadRuntimeEnvironment', () => {
  it('uses the selected install settings instead of an inherited database URL', async () => {
    const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seqdesk-cli-env-'));
    tempDirs.push(installDir);
    fs.writeFileSync(
      path.join(installDir, 'settings.json'),
      JSON.stringify({
        runtime: {
          databaseUrl: 'postgresql://selected.example/seqdesk',
          directUrl: 'postgresql://selected.example/seqdesk-direct',
        },
      })
    );
    process.env.DATABASE_URL = 'postgresql://unrelated.example/other';
    process.env.DIRECT_URL = 'postgresql://unrelated.example/other-direct';

    await loadRuntimeEnvironment(installDir, { explicitDir: true });

    expect(process.env.DATABASE_URL).toBe(
      'postgresql://selected.example/seqdesk'
    );
    expect(process.env.DIRECT_URL).toBe(
      'postgresql://selected.example/seqdesk-direct'
    );
    expect(fs.realpathSync(process.cwd())).toBe(fs.realpathSync(installDir));
  });

  it('rejects an explicit install without its own database settings', async () => {
    const installDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'seqdesk-cli-env-missing-')
    );
    tempDirs.push(installDir);
    process.env.DATABASE_URL = 'postgresql://unrelated.example/other';

    await expect(
      loadRuntimeEnvironment(installDir, { explicitDir: true })
    ).rejects.toThrow('selected SeqDesk install does not provide a database URL');
  });
});

describe('managed runtime setup', () => {
  it('keeps custom data and run directories from the installed settings', async () => {
    const installDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'seqdesk-cli-runtime-paths-')
    );
    tempDirs.push(installDir);
    const customDataPath = '/srv/seqdesk/sequencing-data';
    const customRunDirectory = '/scratch/seqdesk/pipeline-runs';
    fs.writeFileSync(
      path.join(installDir, 'settings.json'),
      JSON.stringify({
        site: { dataBasePath: customDataPath },
        pipelines: {
          execution: { runDirectory: customRunDirectory },
        },
      })
    );
    delete process.env.SEQDESK_DATA_PATH;
    delete process.env.SEQDESK_PIPELINE_RUN_DIR;
    delete process.env.SEQDESK_CONDA_PATH;
    delete process.env.SEQDESK_CONDA_ENV;
    delete process.env.SEQDESK_EXEC_CONDA_PATH;
    delete process.env.SEQDESK_EXEC_CONDA_ENV;

    await expect(
      resolveManagedRuntimeSetupPaths(installDir)
    ).resolves.toEqual({
      configPath: path.join(installDir, 'settings.json'),
      dataPath: customDataPath,
      runDirectory: customRunDirectory,
    });
  });

  it('passes preserved storage paths to the external setup and clears both caches', async () => {
    const installDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'seqdesk-cli-runtime-run-')
    );
    tempDirs.push(installDir);
    const scriptDir = path.join(installDir, 'current', 'scripts');
    const argsOut = path.join(installDir, 'runtime-args.txt');
    const initialDataPath = path.join(installDir, 'data-before');
    const updatedDataPath = path.join(installDir, 'data-after');
    const customRunDirectory = path.join(installDir, 'custom-runs');
    const customCondaPath = path.join(installDir, 'managed-conda');
    const customCondaEnvironment = 'facility-pipelines';
    fs.mkdirSync(scriptDir, { recursive: true });
    fs.writeFileSync(
      path.join(scriptDir, 'setup-conda-env.sh'),
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'printf "cwd=%s\\n" "$PWD" > "$SEQDESK_RUNTIME_ARGS_OUT"',
        'printf "%s\\n" "$@" >> "$SEQDESK_RUNTIME_ARGS_OUT"',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(installDir, 'settings.json'),
      JSON.stringify({
        site: { dataBasePath: initialDataPath },
        pipelines: {
          execution: {
            runDirectory: customRunDirectory,
            conda: {
              path: customCondaPath,
              environment: customCondaEnvironment,
            },
          },
        },
      })
    );
    delete process.env.SEQDESK_DATA_PATH;
    delete process.env.SEQDESK_PIPELINE_RUN_DIR;
    delete process.env.SEQDESK_CONDA_PATH;
    delete process.env.SEQDESK_CONDA_ENV;
    delete process.env.SEQDESK_EXEC_CONDA_PATH;
    delete process.env.SEQDESK_EXEC_CONDA_ENV;
    process.env.SEQDESK_RUNTIME_ARGS_OUT = argsOut;
    process.chdir(installDir);

    expect(loadConfig(true).config.site?.dataBasePath).toBe(initialDataPath);
    fs.writeFileSync(
      path.join(installDir, 'settings.json'),
      JSON.stringify({
        site: { dataBasePath: updatedDataPath },
        pipelines: {
          execution: {
            runDirectory: customRunDirectory,
            conda: {
              path: customCondaPath,
              environment: customCondaEnvironment,
            },
          },
        },
      })
    );
    const prerequisiteCacheSpy = vi.spyOn(
      prerequisiteCheck,
      'clearPipelineRuntimePrerequisiteCache'
    );

    await runManagedRuntimeSetup(installDir);

    const lines = fs.readFileSync(argsOut, 'utf-8').trim().split('\n');
    expect(lines).toContain(`cwd=${fs.realpathSync(installDir)}`);
    expect(lines).toContain('--config-path');
    expect(lines).toContain(path.join(installDir, 'settings.json'));
    expect(lines).toContain('--data-path');
    expect(lines).toContain(updatedDataPath);
    expect(lines).toContain('--run-dir');
    expect(lines).toContain(customRunDirectory);
    expect(lines).toContain('--install-miniconda');
    expect(lines).toContain('--conda-path');
    expect(lines).toContain(customCondaPath);
    expect(lines).toContain('--env');
    expect(lines).toContain(customCondaEnvironment);
    expect(loadConfig().config.site?.dataBasePath).toBe(updatedDataPath);
    expect(prerequisiteCacheSpy).toHaveBeenCalledOnce();
  });
});

describe('guided setup output', () => {
  it('turns the pipeline catalog into an actionable installation handoff', () => {
    const guidance = formatManagedPipelineListGuidance();

    expect(guidance).toContain(
      'The NEXT column shows the exact action for each pipeline'
    );
    expect(guidance).toContain(
      'seqdesk pipelines install <pipeline-id>'
    );
    expect(guidance).toContain(
      'seqdesk pipelines install <pipeline-id> --runtime'
    );
    expect(guidance).toContain(
      'seqdesk pipelines status <pipeline-id>'
    );
    expect(guidance).toContain(
      'https://seqdesk.org/docs/pipelines/installing-pipelines'
    );
    expect(guidance).not.toContain('simulate-reads');
  });

  it('adds the safe Simulate Reads example only when the visible catalog supports it', () => {
    expect(
      formatManagedPipelineListGuidance({
        showSimulateReadsExample: true,
      })
    ).toContain(
      'seqdesk pipelines install simulate-reads --runtime'
    );
  });

  it('gives concrete config, database, storage, and runtime actions without promising downloads', () => {
    const guidance = getManagedSetupGuidance({
      pipelineId: 'mag',
      readiness: {
        canEnable: false,
        items: [
          {
            id: 'required-config',
            label: 'Required configuration',
            status: 'missing',
            detail: 'Configure: Kraken database.',
            action: 'configure',
            blocking: true,
          },
          {
            id: 'databases',
            label: 'Runtime databases',
            status: 'missing',
            detail: 'Kraken database is not installed.',
            action: 'download-db',
            blocking: true,
          },
          {
            id: 'data-storage-path',
            label: 'Data storage path',
            status: 'missing',
            detail: 'No path is configured.',
            action: 'configure-storage',
            blocking: true,
          },
          {
            id: 'runtime-nextflow',
            label: 'Nextflow',
            status: 'missing',
            detail: 'Not found.',
            action: 'configure-runtime',
            blocking: true,
          },
        ],
      },
    });

    expect(guidance).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'seqdesk pipelines setup mag --config-file'
        ),
        expect.stringContaining(
          'Database assets are not downloaded automatically'
        ),
        expect.stringContaining('Admin → Settings → Data storage'),
        expect.stringContaining(
          'seqdesk pipelines setup mag --runtime'
        ),
      ])
    );
    expect(guidance).not.toContain('seqdesk pipelines setup mag');
  });
});
