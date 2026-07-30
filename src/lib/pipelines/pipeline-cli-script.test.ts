import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatManagedPipelineList,
  formatManagedPipelineListGuidance,
  formatManagedPipelineStatus,
  getManagedSetupGuidance,
  loadRuntimeEnvironment,
  parsePipelineArgs,
  pipelineListColorEnabled,
  reconcileManagedInstallMessage,
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

describe('managed pipeline list output', () => {
  const pipelines = [
    {
      pipelineId: 'read-cleaning',
      targets: ['order'],
      packageState: 'bundled',
      setupState: 'needs-db',
      activationState: 'enabled',
      nextActions: [{ action: 'download-db' }],
    },
    {
      pipelineId: 'simulate-reads',
      targets: ['order'],
      packageState: 'bundled',
      setupState: 'needs-runtime',
      activationState: 'disabled',
      nextActions: [{ action: 'configure-runtime' }],
    },
    {
      pipelineId: 'fastq-checksum',
      targets: ['study', 'order'],
      packageState: 'installed',
      setupState: 'ready',
      activationState: 'enabled',
      nextActions: [],
    },
    {
      pipelineId: 'metaxpath',
      targets: ['study'],
      packageState: 'available',
      setupState: 'not-installed',
      activationState: 'disabled',
      nextActions: [{ action: 'install' }],
    },
  ];

  it('renders a compact table with readable state and exact next commands', () => {
    const output = formatManagedPipelineList(pipelines, {
      color: false,
      width: 100,
    });

    expect(output).toContain('SeqDesk pipelines');
    expect(output).toContain('4 pipelines · 3 installed · 2 enabled');
    expect(output).toContain('PIPELINE');
    expect(output).toContain('USE WITH');
    expect(output).toContain('PACKAGE');
    expect(output).toContain('STATE');
    expect(output).toContain('Built in');
    expect(output).toContain('Study + Order');
    expect(output).toContain('! Enabled · needs database');
    expect(output).toContain('! Disabled · needs runtime');
    expect(output).toContain('✓ Ready');
    expect(output).toContain('○ Not installed');
    expect(output).toContain('→ seqdesk pipelines setup read-cleaning');
    expect(output).toContain(
      '→ seqdesk pipelines setup simulate-reads --runtime'
    );
    expect(output).toContain('→ seqdesk pipelines install metaxpath');
    expect(output).not.toContain('\u001B[');
    expect(output).not.toContain('Loaded pipeline package');
  });

  it('uses a readable card layout on narrow terminals without shortening commands', () => {
    const output = formatManagedPipelineList(pipelines, {
      color: false,
      width: 60,
    });

    expect(output).not.toContain('USE WITH');
    expect(output).toContain('  Use with  Order');
    expect(output).toContain('  Package   Built in');
    expect(output).toContain('  State     ! Disabled · needs runtime');
    expect(output).toContain(
      'seqdesk pipelines setup simulate-reads --runtime'
    );
  });

  it('adds colors only when requested without changing the text', () => {
    const plain = formatManagedPipelineList(pipelines, {
      color: false,
      width: 100,
    });
    const colored = formatManagedPipelineList(pipelines, {
      color: true,
      width: 100,
    });

    expect(colored).toContain('\u001B[');
    expect(
      colored.replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, '')
    ).toBe(plain);
  });

  it('respects terminal capability, NO_COLOR, and dumb terminals', () => {
    expect(
      pipelineListColorEnabled({ isTTY: true, env: { TERM: 'xterm-256color' } })
    ).toBe(true);
    expect(
      pipelineListColorEnabled({
        isTTY: false,
        env: { TERM: 'xterm-256color' },
      })
    ).toBe(false);
    expect(
      pipelineListColorEnabled({
        isTTY: true,
        env: { TERM: 'xterm-256color', NO_COLOR: '' },
      })
    ).toBe(false);
    expect(
      pipelineListColorEnabled({ isTTY: true, env: { TERM: 'dumb' } })
    ).toBe(false);
  });

  it('handles an empty filtered catalog', () => {
    expect(
      formatManagedPipelineList([], { color: false, width: 100 })
    ).toContain('No pipelines match these filters.');
  });
});

describe('managed pipeline status output', () => {
  it('says explicitly when a bundled pipeline is installed and usable now', () => {
    const output = formatManagedPipelineStatus(
      {
        pipelineId: 'simulate-reads',
        name: 'Simulate Reads',
        installed: true,
        targets: ['order'],
        packageState: 'bundled',
        setupState: 'ready',
        activationState: 'enabled',
        nextActions: [],
      },
      { color: false }
    );

    expect(output).toContain('✓ USABLE NOW');
    expect(output).toContain('Users can run this pipeline now.');
    expect(output).toContain('✓ Installed');
    expect(output).toContain('Yes · built in');
    expect(output).toContain('✓ Setup ready');
    expect(output).toContain('✓ Enabled');
    expect(output).toContain('– Applies to');
    expect(output).toContain('Sequencing orders');
  });

  it('distinguishes an installed pipeline that still needs setup', () => {
    const output = formatManagedPipelineStatus(
      {
        pipelineId: 'mag',
        installed: true,
        targets: ['study'],
        packageState: 'bundled',
        setupState: 'needs-db',
        activationState: 'enabled',
        readiness: {
          canEnable: false,
          items: [
            {
              id: 'databases',
              label: 'Pipeline databases',
              status: 'missing',
              detail: 'Database assets are missing.',
              action: 'download-db',
              blocking: true,
            },
          ],
        },
        nextActions: [{ action: 'download-db' }],
      },
      { color: false }
    );

    expect(output).toContain('✗ NOT USABLE NOW · SETUP REQUIRED');
    expect(output).toContain('✓ Installed');
    expect(output).toContain('✗ Setup ready');
    expect(output).toContain('No · Database required');
    expect(output).toContain('✓ Enabled');
    expect(output).toContain('Blocked by');
    expect(output).toContain(
      'Pipeline databases: Database assets are missing.'
    );
    expect(output).toContain('seqdesk pipelines setup mag');
  });

  it('distinguishes a configured pipeline that is disabled', () => {
    const output = formatManagedPipelineStatus(
      {
        pipelineId: 'fastqc',
        installed: true,
        targets: ['order'],
        packageState: 'installed',
        setupState: 'ready',
        activationState: 'disabled',
        nextActions: [{ action: 'enable' }],
      },
      { color: false }
    );

    expect(output).toContain('✗ NOT USABLE NOW · DISABLED');
    expect(output).toContain('✓ Installed');
    expect(output).toContain('Yes · Pipeline Store');
    expect(output).toContain('✓ Setup ready');
    expect(output).toContain('✗ Enabled');
    expect(output).toContain('seqdesk pipelines enable fastqc');
  });

  it('distinguishes a store pipeline that has not been installed', () => {
    const output = formatManagedPipelineStatus(
      {
        pipelineId: 'metaxpath',
        installed: false,
        targets: ['study', 'order'],
        packageState: 'available',
        setupState: 'not-installed',
        activationState: 'disabled',
        nextActions: [{ action: 'install' }],
      },
      { color: false }
    );

    expect(output).toContain('✗ NOT USABLE NOW · NOT INSTALLED');
    expect(output).toContain('✗ Installed');
    expect(output).toContain('No · available from Pipeline Store');
    expect(output).toContain('– Setup ready');
    expect(output).toContain('Not started');
    expect(output).toContain('– Enabled');
    expect(output).toContain('Available after installation');
    expect(output).toContain('Studies and sequencing orders');
    expect(output).toContain('seqdesk pipelines install metaxpath');
  });

  it('stays usable when readiness contains only nonblocking warnings', () => {
    const output = formatManagedPipelineStatus(
      {
        pipelineId: 'fastqc',
        installed: true,
        targets: ['order'],
        packageState: 'bundled',
        activationState: 'enabled',
        readiness: {
          status: 'warning',
          canEnable: true,
          items: [
            {
              id: 'outputs',
              label: 'Output browsing',
              status: 'warning',
              blocking: false,
            },
          ],
        },
        nextActions: [],
      },
      { color: false }
    );

    expect(output).toContain('✓ USABLE NOW · ! 1 WARNING');
    expect(output).toContain('Warnings · does not block use');
    expect(output).toContain('! Output browsing');
    expect(output).not.toContain('Blocked by');
  });

  it('deduplicates next commands that represent multiple setup issues', () => {
    const output = formatManagedPipelineStatus(
      {
        pipelineId: 'mag',
        installed: true,
        packageState: 'bundled',
        setupState: 'needs-db',
        activationState: 'disabled',
        nextActions: [
          { action: 'configure' },
          { action: 'download-db' },
        ],
      },
      { color: false }
    );

    expect(
      output.match(/seqdesk pipelines setup mag/g)
    ).toHaveLength(1);
  });

  it('adds semantic colors without changing the plain text', () => {
    const pipeline = {
      pipelineId: 'simulate-reads',
      installed: true,
      targets: ['order'],
      packageState: 'bundled',
      setupState: 'ready',
      activationState: 'enabled',
      nextActions: [],
    };
    const plain = formatManagedPipelineStatus(pipeline, {
      color: false,
    });
    const colored = formatManagedPipelineStatus(pipeline, {
      color: true,
    });

    expect(colored).toContain('\u001B[1;32m');
    expect(colored).toContain('\u001B[1;36m');
    expect(
      colored.replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, '')
    ).toBe(plain);
  });

  it('uses red for blockers and yellow only for nonblocking warnings', () => {
    const blocked = formatManagedPipelineStatus(
      {
        pipelineId: 'mag',
        installed: true,
        packageState: 'bundled',
        setupState: 'needs-db',
        activationState: 'disabled',
        readiness: {
          canEnable: false,
          items: [
            {
              id: 'databases',
              label: 'Pipeline databases',
              status: 'missing',
              action: 'download-db',
              blocking: true,
            },
          ],
        },
      },
      { color: true }
    );
    const warning = formatManagedPipelineStatus(
      {
        pipelineId: 'fastqc',
        installed: true,
        packageState: 'bundled',
        activationState: 'enabled',
        readiness: {
          canEnable: true,
          items: [
            {
              id: 'outputs',
              label: 'Output browsing',
              status: 'warning',
              blocking: false,
            },
          ],
        },
      },
      { color: true }
    );

    expect(blocked).toContain(
      '\u001B[1;31m✗ NOT USABLE NOW · SETUP REQUIRED\u001B[0m'
    );
    expect(warning).toContain('\u001B[1;32m✓ USABLE NOW\u001B[0m');
    expect(warning).toContain('\u001B[1;33m! 1 WARNING\u001B[0m');
  });

  it('honors NO_COLOR for status output', () => {
    const pipeline = {
      pipelineId: 'simulate-reads',
      installed: true,
      packageState: 'bundled',
      setupState: 'ready',
      activationState: 'enabled',
    };
    const color = pipelineListColorEnabled({
      isTTY: true,
      env: { TERM: 'xterm-256color' },
    });
    const noColor = pipelineListColorEnabled({
      isTTY: true,
      env: { TERM: 'xterm-256color', NO_COLOR: '1' },
    });

    expect(
      formatManagedPipelineStatus(pipeline, { color })
    ).toContain('\u001B[');
    expect(
      formatManagedPipelineStatus(pipeline, { color: noColor })
    ).not.toContain('\u001B[');
  });
});

describe('managed pipeline installation output', () => {
  it('removes stale setup guidance after runtime setup makes the pipeline ready', () => {
    expect(
      reconcileManagedInstallMessage(
        'Pipeline simulate-reads is already installed successfully; setup is still required',
        false
      )
    ).toBe('Pipeline simulate-reads is already installed successfully');
  });

  it('keeps setup guidance when another readiness requirement remains', () => {
    const message =
      'Pipeline mag installed successfully; setup is still required';
    expect(reconcileManagedInstallMessage(message, true)).toBe(message);
  });
});

describe('guided setup output', () => {
  it('turns the pipeline catalog into an actionable installation handoff', () => {
    const guidance = formatManagedPipelineListGuidance();

    expect(guidance).toContain('Start here');
    expect(guidance).toContain(
      'seqdesk pipelines install <pipeline-id>'
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
        expect.stringContaining(
          'seqdesk storage configure /absolute/path/to/sequencing-data'
        ),
        expect.stringContaining(
          'seqdesk pipelines setup mag --runtime'
        ),
      ])
    );
    expect(guidance).not.toContain('seqdesk pipelines setup mag');
  });
});
