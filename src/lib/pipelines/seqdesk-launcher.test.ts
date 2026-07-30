import { spawnSync } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

const launcherPath = path.resolve(process.cwd(), 'npm/seqdesk/bin/seqdesk.js');
const tempDirs: string[] = [];
const pythonPtyAvailable =
  process.platform !== 'win32' &&
  spawnSync('python3', ['--version'], { stdio: 'ignore' }).status === 0;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function makeInstallWithPipelineCli(
  layout: 'flat' | 'current' = 'flat',
  rootDir?: string,
  supportsCommandFamily = true
): { dir: string; capturePath: string } {
  const dir = rootDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'seqdesk-launcher-'));
  if (!rootDir) {
    tempDirs.push(dir);
  }
  const appDir = layout === 'current' ? path.join(dir, 'current') : dir;
  const scriptsDir = path.join(appDir, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  const capturePath = path.join(dir, 'pipeline-argv.json');
  fs.writeFileSync(
    path.join(scriptsDir, 'pipeline-cli.js'),
    [
      '#!/usr/bin/env node',
      'const fs = require("fs");',
      ...(supportsCommandFamily ? ['// --command-family'] : []),
      `fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(2) }));`,
      'process.exit(0);',
      '',
    ].join('\n')
  );
  return { dir, capturePath };
}

function discoveryEnv(
  overrides: Partial<NodeJS.ProcessEnv> = {}
): NodeJS.ProcessEnv {
  const baseEnv: NodeJS.ProcessEnv = { ...process.env };
  delete baseEnv.SEQDESK_DIR;
  delete baseEnv.SEQDESK_DEFAULT_INSTALL_FILE;
  delete baseEnv.XDG_CONFIG_HOME;
  return { ...baseEnv, ...overrides };
}

// Password the stub worker reports back, standing in for what the real
// scripts/reset-password.mjs generates.
const STUB_PASSWORD = 'Xk7RtQm2sWpZ9vHb4Ncd';

function stubResetPasswordWorker(capturePath: string, payload: Record<string, unknown>): string {
  return [
    "import fs from 'node:fs';",
    `fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({`,
    '  argv: process.argv.slice(2),',
    '  databaseUrl: process.env.DATABASE_URL ?? null,',
    '  directUrl: process.env.DIRECT_URL ?? null,',
    '  cwd: process.cwd(),',
    '}));',
    `console.log(JSON.stringify(${JSON.stringify(payload)}));`,
    `process.exit(${payload.ok === true ? 0 : 1});`,
    '',
  ].join('\n');
}

function makeResetPasswordInstall(
  options: {
    prefix?: string;
    layout?: 'current' | 'flat';
    worker?: string | null;
    runtime?: Record<string, unknown> | null;
    payload?: Record<string, unknown>;
  } = {}
): { dir: string; workerPath: string; capturePath: string; socketUrl: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), options.prefix || 'seqdesk-reset-password-'));
  tempDirs.push(dir);
  const appDir = options.layout === 'flat' ? dir : path.join(dir, 'current');
  const capturePath = path.join(dir, 'worker-capture.json');
  const workerPath = path.join(appDir, 'scripts', 'reset-password.mjs');

  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'seqdesk', version: '1.1.100' })
  );

  const socketDir = path.join(dir, 'postgres-socket');
  const socketUrl =
    'postgresql://seqdesk:secret@localhost:5432/seqdesk' +
    `?schema=public&host=${socketDir}`;
  const runtime =
    options.runtime === undefined
      ? { databaseUrl: socketUrl, nextAuthSecret: 'test-secret' }
      : options.runtime;
  if (runtime) {
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ runtime }));
  }

  if (options.worker !== null) {
    fs.mkdirSync(path.dirname(workerPath), { recursive: true });
    fs.writeFileSync(
      workerPath,
      options.worker ??
        stubResetPasswordWorker(capturePath, {
          ok: true,
          email: 'reviewer@example.org',
          role: 'ADMIN',
          firstName: 'Ada',
          lastName: 'Lovelace',
          generated: true,
          password: STUB_PASSWORD,
          ...options.payload,
        })
    );
  } else {
    // Keep the release layout so only the worker itself is missing, which is
    // what an install made before the command shipped looks like.
    fs.mkdirSync(appDir, { recursive: true });
  }

  return { dir, workerPath, capturePath, socketUrl };
}

function makeStorageInstall(
  options: {
    prefix?: string;
    layout?: 'current' | 'flat';
    worker?: string | null;
    runtime?: Record<string, unknown> | null;
    payload?: Record<string, unknown>;
    exitCode?: number;
  } = {}
): {
  dir: string;
  workerPath: string;
  capturePath: string;
  configPath: string;
  socketUrl: string;
} {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), options.prefix || 'seqdesk-storage-')
  );
  tempDirs.push(dir);
  const appDir = options.layout === 'flat' ? dir : path.join(dir, 'current');
  const capturePath = path.join(dir, 'storage-worker-capture.json');
  const configPath = path.join(dir, 'settings.json');
  const workerPath = path.join(
    appDir,
    'scripts',
    'configure-data-storage.mjs'
  );
  const socketDir = path.join(dir, 'postgres socket');
  const socketUrl =
    'postgresql://seqdesk:secret@localhost:5432/seqdesk' +
    `?schema=public&host=${encodeURIComponent(socketDir)}`;
  const runtime =
    options.runtime === undefined
      ? { databaseUrl: socketUrl }
      : options.runtime;

  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'seqdesk', version: '1.2.3' })
  );
  if (runtime) {
    fs.writeFileSync(configPath, JSON.stringify({ runtime }));
  }

  if (options.worker !== null) {
    fs.mkdirSync(path.dirname(workerPath), { recursive: true });
    const payload = options.payload ?? {
      ok: true,
      action: 'configure',
      dataBasePath: '/srv/seqdesk data',
      source: 'database',
      readable: true,
      writable: true,
      message: 'Data storage is ready.',
    };
    fs.writeFileSync(
      workerPath,
      options.worker ??
        [
          "import fs from 'node:fs';",
          `fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({`,
          '  argv: process.argv.slice(2),',
          '  databaseUrl: process.env.DATABASE_URL ?? null,',
          '  directUrl: process.env.DIRECT_URL ?? null,',
          '  cwd: process.cwd(),',
          '}));',
          `process.stdout.write(${JSON.stringify(
            `${JSON.stringify(payload)}\n`
          )});`,
          `process.exit(${options.exitCode ?? (payload.ok === false ? 1 : 0)});`,
          '',
        ].join('\n')
    );
  }

  return { dir, workerPath, capturePath, configPath, socketUrl };
}

function readCapture(capturePath: string): {
  argv: string[];
  databaseUrl: string | null;
  directUrl: string | null;
  cwd: string;
} {
  return JSON.parse(fs.readFileSync(capturePath, 'utf-8'));
}

function filesUnder(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? filesUnder(path.join(dir, entry.name))
        : [path.join(dir, entry.name)]
    );
}

type DoctorCheck = {
  name: string;
  status: string;
  detail: string;
  remediation?: string;
};

function makeDoctorInstall(
  prefix: string,
  runtime?: Record<string, unknown>
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.next', 'static'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'seqdesk', version: '1.2.3' })
  );
  fs.writeFileSync(path.join(dir, 'start.sh'), '#!/usr/bin/env bash\n');
  fs.chmodSync(path.join(dir, 'start.sh'), 0o700);
  if (runtime) {
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ runtime }));
  }
  return dir;
}

function runDoctorJson(
  dir: string,
  extraArgs: string[] = []
): { status: number | null; stdout: string; checks: DoctorCheck[] } {
  const result = spawnSync(
    process.execPath,
    [launcherPath, 'doctor', '--dir', dir, '--json', ...extraArgs],
    { encoding: 'utf-8' }
  );
  const report = JSON.parse(result.stdout) as { checks: DoctorCheck[] };
  return { status: result.status, stdout: result.stdout, checks: report.checks };
}

function listenLoopback(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Expected TCP server address'));
        return;
      }
      resolve({
        port: address.port,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

// Bind and immediately release a port so the doctor probe has a target that is
// reachable in principle but has nothing listening on it.
async function reserveFreePort(): Promise<number> {
  const server = await listenLoopback();
  await server.close();
  return server.port;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('seqdesk npm launcher pipeline dispatch', () => {
  it('prints canonical plural pipeline help without requiring an installed app', () => {
    const result = spawnSync(process.execPath, [launcherPath, 'pipelines', '--help'], {
      encoding: 'utf-8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('seqdesk pipelines install <pipelineId>');
    expect(result.stdout).toContain('seqdesk pipelines setup <pipelineId>');
    expect(result.stdout).toContain('seqdesk pipeline run <pipelineId>');
    expect(result.stdout).toContain('singular form, seqdesk pipeline ..., remains an alias');
  });

  it('keeps the singular pipeline command as an alias', () => {
    const { dir, capturePath } = makeInstallWithPipelineCli();
    const result = spawnSync(
      process.execPath,
      [launcherPath, 'pipeline', 'list', '--dir', dir, '--json'],
      { encoding: 'utf-8' }
    );

    expect(result.status).toBe(0);
    const captured = JSON.parse(fs.readFileSync(capturePath, 'utf-8'));
    expect(fs.realpathSync(captured.cwd)).toBe(fs.realpathSync(dir));
    expect(captured.argv).toEqual([
      'list',
      '--json',
      '--command-family',
      'pipeline',
      '--dir',
      dir,
    ]);
  });

  it('dispatches plural pipeline commands to a versioned install while keeping root cwd and --dir', () => {
    const { dir, capturePath } = makeInstallWithPipelineCli('current');
    const result = spawnSync(
      process.execPath,
      [
        launcherPath,
        'pipelines',
        'list',
        '--dir',
        dir,
        '--command-family',
        'pipeline',
        '--json',
      ],
      { encoding: 'utf-8' }
    );

    expect(result.status).toBe(0);
    const captured = JSON.parse(fs.readFileSync(capturePath, 'utf-8'));
    expect(fs.realpathSync(captured.cwd)).toBe(fs.realpathSync(dir));
    expect(captured.argv).toEqual([
      'list',
      '--json',
      '--command-family',
      'pipelines',
      '--dir',
      dir,
    ]);
  });

  it('resolves an installer-written default from a neutral working directory', () => {
    const { dir, capturePath } = makeInstallWithPipelineCli('current');
    const neutralDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seqdesk-neutral-cwd-'));
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seqdesk-launcher-home-'));
    tempDirs.push(neutralDir, homeDir);
    const configHome = path.join(homeDir, '.config');
    const pointerPath = path.join(configHome, 'seqdesk', 'default-install');
    fs.mkdirSync(path.dirname(pointerPath), { recursive: true });
    fs.writeFileSync(pointerPath, `${dir}\n`);

    const result = spawnSync(
      process.execPath,
      [launcherPath, 'pipelines', 'list', '--json'],
      {
        cwd: neutralDir,
        encoding: 'utf-8',
        env: discoveryEnv({ HOME: homeDir, XDG_CONFIG_HOME: configHome }),
      }
    );

    expect(result.status).toBe(0);
    const captured = JSON.parse(fs.readFileSync(capturePath, 'utf-8'));
    expect(fs.realpathSync(captured.cwd)).toBe(fs.realpathSync(dir));
    expect(captured.argv).toEqual([
      'list',
      '--json',
      '--command-family',
      'pipelines',
      '--dir',
      dir,
    ]);
  });

  it('does not send the hidden family marker to an older installed worker', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seqdesk-launcher-old-worker-'));
    tempDirs.push(rootDir);
    const { dir, capturePath } = makeInstallWithPipelineCli(
      'current',
      rootDir,
      false
    );
    const result = spawnSync(
      process.execPath,
      [launcherPath, 'pipeline', 'status', 'run-1', '--dir', dir, '--json'],
      { encoding: 'utf-8' }
    );

    expect(result.status).toBe(0);
    const captured = JSON.parse(fs.readFileSync(capturePath, 'utf-8'));
    expect(captured.argv).toEqual([
      'status',
      'run-1',
      '--json',
      '--dir',
      dir,
    ]);
  });

  it('keeps JSON stdout as one document while forwarding the plural family', () => {
    const { dir } = makeInstallWithPipelineCli('current');
    const workerPath = path.join(dir, 'current', 'scripts', 'pipeline-cli.js');
    fs.writeFileSync(
      workerPath,
      [
        '#!/usr/bin/env node',
        '// --command-family',
        'process.stdout.write(JSON.stringify({ success: true, argv: process.argv.slice(2) }) + "\\n");',
        '',
      ].join('\n')
    );

    const result = spawnSync(
      process.execPath,
      [launcherPath, 'pipelines', 'status', 'fixture', '--dir', dir, '--json'],
      { encoding: 'utf-8' }
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      success: true,
      argv: [
        'status',
        'fixture',
        '--json',
        '--command-family',
        'pipelines',
        '--dir',
        dir,
      ],
    });
  });

  it('prefers --dir over SEQDESK_DIR and the default pointer', () => {
    const explicit = makeInstallWithPipelineCli('current');
    const fromEnv = makeInstallWithPipelineCli('current');
    const fromPointer = makeInstallWithPipelineCli('current');
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seqdesk-launcher-home-'));
    tempDirs.push(homeDir);
    const pointerPath = path.join(homeDir, '.config', 'seqdesk', 'default-install');
    fs.mkdirSync(path.dirname(pointerPath), { recursive: true });
    fs.writeFileSync(pointerPath, `${fromPointer.dir}\n`);

    const result = spawnSync(
      process.execPath,
      [launcherPath, 'pipelines', 'list', '--dir', explicit.dir],
      {
        cwd: homeDir,
        encoding: 'utf-8',
        env: discoveryEnv({ HOME: homeDir, SEQDESK_DIR: fromEnv.dir }),
      }
    );

    expect(result.status).toBe(0);
    expect(fs.existsSync(explicit.capturePath)).toBe(true);
    expect(fs.existsSync(fromEnv.capturePath)).toBe(false);
    expect(fs.existsSync(fromPointer.capturePath)).toBe(false);
  });

  it('prefers SEQDESK_DIR over the default pointer', () => {
    const fromEnv = makeInstallWithPipelineCli('current');
    const fromPointer = makeInstallWithPipelineCli('current');
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seqdesk-launcher-home-'));
    tempDirs.push(homeDir);
    const pointerPath = path.join(homeDir, '.config', 'seqdesk', 'default-install');
    fs.mkdirSync(path.dirname(pointerPath), { recursive: true });
    fs.writeFileSync(pointerPath, `${fromPointer.dir}\n`);

    const result = spawnSync(
      process.execPath,
      [launcherPath, 'pipelines', 'list'],
      {
        cwd: homeDir,
        encoding: 'utf-8',
        env: discoveryEnv({ HOME: homeDir, SEQDESK_DIR: fromEnv.dir }),
      }
    );

    expect(result.status).toBe(0);
    expect(fs.existsSync(fromEnv.capturePath)).toBe(true);
    expect(fs.existsSync(fromPointer.capturePath)).toBe(false);
  });

  it('prefers the installer pointer over a recognizable working directory', () => {
    const fromPointer = makeInstallWithPipelineCli('current');
    const fromCwd = makeInstallWithPipelineCli('current');
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seqdesk-launcher-home-'));
    tempDirs.push(homeDir);
    const pointerPath = path.join(homeDir, '.config', 'seqdesk', 'default-install');
    fs.mkdirSync(path.dirname(pointerPath), { recursive: true });
    fs.writeFileSync(pointerPath, `${fromPointer.dir}\n`);

    const result = spawnSync(
      process.execPath,
      [launcherPath, 'pipelines', 'list'],
      {
        cwd: path.join(fromCwd.dir, 'current'),
        encoding: 'utf-8',
        env: discoveryEnv({ HOME: homeDir }),
      }
    );

    expect(result.status).toBe(0);
    expect(fs.existsSync(fromPointer.capturePath)).toBe(true);
    expect(fs.existsSync(fromCwd.capturePath)).toBe(false);
  });

  it('recognizes a versioned install from its current directory', () => {
    const recognized = makeInstallWithPipelineCli('current');
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seqdesk-launcher-home-'));
    tempDirs.push(homeDir);

    const result = spawnSync(
      process.execPath,
      [launcherPath, 'pipelines', 'list'],
      {
        cwd: path.join(recognized.dir, 'current'),
        encoding: 'utf-8',
        env: discoveryEnv({ HOME: homeDir }),
      }
    );

    expect(result.status).toBe(0);
    expect(fs.existsSync(recognized.capturePath)).toBe(true);
  });

  it('falls back to ~/seqdesk when no higher-priority install is discoverable', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seqdesk-launcher-home-'));
    const neutralDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seqdesk-neutral-cwd-'));
    tempDirs.push(homeDir, neutralDir);
    const fallback = makeInstallWithPipelineCli(
      'current',
      path.join(homeDir, 'seqdesk')
    );

    const result = spawnSync(
      process.execPath,
      [launcherPath, 'pipelines', 'list'],
      {
        cwd: neutralDir,
        encoding: 'utf-8',
        env: discoveryEnv({ HOME: homeDir }),
      }
    );

    expect(result.status).toBe(0);
    expect(fs.existsSync(fallback.capturePath)).toBe(true);
  });

  it('fails clearly when the installed pipeline script is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seqdesk-launcher-missing-'));
    tempDirs.push(dir);

    const result = spawnSync(
      process.execPath,
      [launcherPath, 'pipeline', 'list', '--dir', dir],
      { encoding: 'utf-8' }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Installed pipeline CLI not found');
  });

  it('returns one JSON document when the installed pipeline script is missing', () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'seqdesk-launcher-missing-json-')
    );
    tempDirs.push(dir);

    const result = spawnSync(
      process.execPath,
      [launcherPath, 'pipelines', 'list', '--dir', dir, '--json'],
      { encoding: 'utf-8' }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      success: false,
      error: expect.stringContaining('Installed pipeline CLI not found'),
    });
  });

  it('returns one JSON document for pipeline launcher argument errors', () => {
    const result = spawnSync(
      process.execPath,
      [launcherPath, 'pipelines', 'list', '--dir=', '--json'],
      { encoding: 'utf-8' }
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      success: false,
      error: '--dir requires a directory path',
    });
  });
});

describe('seqdesk npm launcher storage dispatch', () => {
  it('lists storage in top-level help and provides command and alias help', () => {
    const topLevel = spawnSync(process.execPath, [launcherPath, '--help'], {
      encoding: 'utf-8',
    });
    const group = spawnSync(process.execPath, [launcherPath, 'storage', '--help'], {
      encoding: 'utf-8',
    });
    const configure = spawnSync(
      process.execPath,
      [launcherPath, 'storage', 'configure', '--help'],
      { encoding: 'utf-8' }
    );
    const alias = spawnSync(
      process.execPath,
      [launcherPath, 'data-storage', 'status', '--help'],
      { encoding: 'utf-8' }
    );

    expect(topLevel.status).toBe(0);
    expect(topLevel.stdout).toContain(
      'seqdesk storage <configure|status> [options]'
    );
    for (const result of [group, configure, alias]) {
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        'seqdesk storage configure <absolute-path>'
      );
      expect(result.stdout).toContain('seqdesk storage status');
      expect(result.stdout).toContain('seqdesk data-storage');
    }
  });

  it('dispatches configure with spaces intact and the selected database environment', () => {
    const dataPath = '/srv/seqdesk data/incoming reads';
    const directUrl =
      'postgresql://seqdesk:secret@127.0.0.1:5433/seqdesk-direct';
    const fixture = makeStorageInstall({
      runtime: {
        databaseUrl:
          'postgresql://seqdesk:secret@127.0.0.1:5432/seqdesk',
        directUrl,
      },
      payload: {
        ok: true,
        action: 'configure',
        dataBasePath: dataPath,
        source: 'file',
        readable: true,
        writable: true,
        created: true,
      },
    });

    const result = spawnSync(
      process.execPath,
      [
        launcherPath,
        'storage',
        'configure',
        dataPath,
        '--dir',
        fixture.dir,
        '--create',
        '--yes',
      ],
      { encoding: 'utf-8' }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(dataPath);
    const captured = readCapture(fixture.capturePath);
    expect(captured.argv).toEqual([
      'configure',
      '--path',
      dataPath,
      '--config',
      fixture.configPath,
      '--create',
      '--json',
    ]);
    expect(captured.databaseUrl).toBe(
      'postgresql://seqdesk:secret@127.0.0.1:5432/seqdesk'
    );
    expect(captured.directUrl).toBe(directUrl);
    expect(fs.realpathSync(captured.cwd)).toBe(
      fs.realpathSync(path.join(fixture.dir, 'current'))
    );
  });

  it('resolves the default install for the data-storage status alias', () => {
    const dataPath = '/srv/seqdesk-data';
    const fixture = makeStorageInstall({
      payload: {
        ok: true,
        action: 'status',
        path: dataPath,
        source: 'database',
        inspection: {
          readable: true,
          writable: false,
          ready: true,
        },
        warnings: ['The directory is readable but not writable.'],
      },
    });
    const neutralDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'seqdesk-storage-neutral-')
    );
    const homeDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'seqdesk-storage-home-')
    );
    tempDirs.push(neutralDir, homeDir);
    const configHome = path.join(homeDir, '.config');
    const pointerPath = path.join(
      configHome,
      'seqdesk',
      'default-install'
    );
    fs.mkdirSync(path.dirname(pointerPath), { recursive: true });
    fs.writeFileSync(pointerPath, `${fixture.dir}\n`);

    const result = spawnSync(
      process.execPath,
      [launcherPath, 'data-storage', 'status', '--json'],
      {
        cwd: neutralDir,
        encoding: 'utf-8',
        env: discoveryEnv({ HOME: homeDir, XDG_CONFIG_HOME: configHome }),
      }
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: 'status',
      installDir: fixture.dir,
      configPath: fixture.configPath,
      path: dataPath,
      inspection: {
        readable: true,
        writable: false,
        ready: true,
      },
    });
    expect(readCapture(fixture.capturePath).argv).toEqual([
      'status',
      '--config',
      fixture.configPath,
      '--json',
    ]);

    const readable = spawnSync(
      process.execPath,
      [launcherPath, 'storage', 'status', '--dir', fixture.dir],
      { encoding: 'utf-8' }
    );
    expect(readable.status).toBe(0);
    expect(readable.stdout).toContain('Readable');
    expect(readable.stdout).toContain('Writable');
    expect(readable.stdout).toContain(
      'The directory is readable but not writable.'
    );
  });

  it('requires confirmation before configure and does not start the worker when declined', () => {
    const dataPath = '/srv/seqdesk-data';
    const fixture = makeStorageInstall();

    const declined = spawnSync(
      process.execPath,
      [
        launcherPath,
        'storage',
        'configure',
        dataPath,
        '--dir',
        fixture.dir,
      ],
      { encoding: 'utf-8', input: 'n\n' }
    );

    expect(declined.status).toBe(1);
    expect(declined.stdout).toContain(
      'Configure this data storage path? (y/N)'
    );
    expect(declined.stderr).toContain(
      'No data storage setting was changed'
    );
    expect(fs.existsSync(fixture.capturePath)).toBe(false);

    const accepted = spawnSync(
      process.execPath,
      [
        launcherPath,
        'storage',
        'configure',
        dataPath,
        '--dir',
        fixture.dir,
      ],
      { encoding: 'utf-8', input: 'yes\n' }
    );

    expect(accepted.status).toBe(0);
    expect(fs.existsSync(fixture.capturePath)).toBe(true);
  });

  it('rejects missing, relative, empty, and filesystem-root paths before dispatch', () => {
    const fixture = makeStorageInstall();
    const argumentSets = [
      ['storage', 'configure'],
      ['storage', 'configure', 'relative/data'],
      ['storage', 'configure', ''],
      ['storage', 'configure', path.parse(process.cwd()).root],
    ];

    for (const commandArgs of argumentSets) {
      const result = spawnSync(
        process.execPath,
        [
          launcherPath,
          ...commandArgs,
          '--dir',
          fixture.dir,
          '--yes',
        ],
        { encoding: 'utf-8' }
      );
      expect(result.status).toBe(2);
    }
    expect(fs.existsSync(fixture.capturePath)).toBe(false);
  });

  it('requires --yes for JSON configure and emits only the final worker JSON object', () => {
    const dataPath = '/srv/seqdesk-data';
    const fixture = makeStorageInstall({
      worker: [
        'console.log("worker diagnostic that must not leak to launcher stdout");',
        `console.log(JSON.stringify(${JSON.stringify({
          ok: true,
          action: 'configure',
          dataBasePath: dataPath,
          readable: true,
        })}));`,
        '',
      ].join('\n'),
    });

    const unconfirmed = spawnSync(
      process.execPath,
      [
        launcherPath,
        'storage',
        'configure',
        dataPath,
        '--dir',
        fixture.dir,
        '--json',
      ],
      { encoding: 'utf-8' }
    );
    expect(unconfirmed.status).toBe(2);
    expect(unconfirmed.stderr).toBe('');
    expect(JSON.parse(unconfirmed.stdout)).toEqual({
      ok: false,
      error: expect.stringContaining('--json requires --yes'),
    });

    const confirmed = spawnSync(
      process.execPath,
      [
        launcherPath,
        'storage',
        'configure',
        dataPath,
        '--dir',
        fixture.dir,
        '--yes',
        '--json',
      ],
      { encoding: 'utf-8' }
    );
    expect(confirmed.status).toBe(0);
    expect(confirmed.stderr).toBe('');
    expect(confirmed.stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(confirmed.stdout)).toMatchObject({
      ok: true,
      command: 'configure',
      installDir: fixture.dir,
      configPath: fixture.configPath,
      dataBasePath: dataPath,
      readable: true,
    });
  });

  it('reports a missing installed worker with an actionable update command', () => {
    const fixture = makeStorageInstall({ worker: null });

    const result = spawnSync(
      process.execPath,
      [
        launcherPath,
        'storage',
        'status',
        '--dir',
        fixture.dir,
        '--json',
      ],
      { encoding: 'utf-8' }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      command: 'status',
      installDir: fixture.dir,
      error: expect.stringContaining('no data-storage worker'),
      remediation: expect.stringContaining('Update this SeqDesk install'),
    });
  });

  it('returns a failing status with guidance for a configured path that is missing', () => {
    const dataPath = '/srv/missing-seqdesk-data';
    const fixture = makeStorageInstall({
      payload: {
        ok: true,
        action: 'status',
        source: 'file',
        path: dataPath,
        ready: false,
        inspection: {
          configured: true,
          requestedPath: dataPath,
          absolute: true,
          exists: false,
          directory: false,
          readable: false,
          searchable: false,
          writable: false,
          ready: false,
          error: 'The data storage directory does not exist.',
        },
        warnings: ['The data storage directory does not exist.'],
      },
    });

    const human = spawnSync(
      process.execPath,
      [launcherPath, 'storage', 'status', '--dir', fixture.dir],
      { encoding: 'utf-8' }
    );
    expect(human.status).toBe(1);
    expect(human.stdout).toContain('Ready');
    expect(human.stdout).toContain('does not exist');
    expect(human.stdout).toContain('--create');
    expect(human.stdout).not.toContain('Make the directory readable by');

    const json = spawnSync(
      process.execPath,
      [launcherPath, 'storage', 'status', '--dir', fixture.dir, '--json'],
      { encoding: 'utf-8' }
    );
    expect(json.status).toBe(1);
    expect(JSON.parse(json.stdout)).toMatchObject({
      ok: true,
      command: 'status',
      path: dataPath,
      ready: false,
    });
  });

  it('rejects incompatible worker success objects and preserves worker error codes', () => {
    const incompatible = makeStorageInstall({
      payload: {},
      exitCode: 0,
    });
    const incompatibleResult = spawnSync(
      process.execPath,
      [
        launcherPath,
        'storage',
        'configure',
        '/srv/seqdesk-data',
        '--dir',
        incompatible.dir,
        '--yes',
        '--json',
      ],
      { encoding: 'utf-8' }
    );
    expect(incompatibleResult.status).toBe(1);
    expect(JSON.parse(incompatibleResult.stdout)).toMatchObject({
      ok: false,
      error: expect.stringContaining('incompatible result'),
    });

    const workerFailure = makeStorageInstall({
      payload: {
        ok: false,
        action: 'configure',
        code: 'PATH_NOT_FOUND',
        error: 'The data storage directory does not exist.',
      },
    });
    const failureResult = spawnSync(
      process.execPath,
      [
        launcherPath,
        'storage',
        'configure',
        '/srv/seqdesk-data',
        '--dir',
        workerFailure.dir,
        '--yes',
        '--json',
      ],
      { encoding: 'utf-8' }
    );
    expect(failureResult.status).toBe(1);
    expect(JSON.parse(failureResult.stdout)).toMatchObject({
      ok: false,
      code: 'PATH_NOT_FOUND',
      error: 'The data storage directory does not exist.',
    });
  });
});

describe('seqdesk npm launcher installer dispatch', () => {
  it.runIf(pythonPtyAvailable)(
    'preserves an interactive terminal after installer logging redirects stdout',
    () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seqdesk-launcher-tty-'));
      tempDirs.push(dir);
      const capturePath = path.join(dir, 'tty-preserved');
      const installerLogPath = path.join(dir, 'installer.log');
      const installer = [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        `exec >${shellQuote(installerLogPath)} 2>&1`,
        'if [ ! -t 0 ] && [ ! -t 1 ]; then',
        '  echo "No interactive TTY detected"',
        '  exit 41',
        'fi',
        `printf 'tty preserved\\n' >${shellQuote(capturePath)}`,
        '',
      ].join('\n');
      const ptyRunnerPath = path.join(dir, 'pty-runner.py');
      fs.writeFileSync(
        ptyRunnerPath,
        [
          'import errno',
          'import os',
          'import pty',
          'import select',
          'import signal',
          'import sys',
          'import time',
          '',
          'pid, master_fd = pty.fork()',
          'if pid == 0:',
          '    os.execvpe(sys.argv[1], sys.argv[1:], os.environ)',
          '',
          'deadline = time.monotonic() + 20',
          'output = bytearray()',
          'timed_out = False',
          'status = None',
          'master_open = True',
          '',
          'try:',
          '    while status is None:',
          '        waited_pid, waited_status = os.waitpid(pid, os.WNOHANG)',
          '        if waited_pid == pid:',
          '            status = waited_status',
          '            break',
          '',
          '        remaining = deadline - time.monotonic()',
          '        if remaining <= 0:',
          '            timed_out = True',
          '            try:',
          '                os.killpg(pid, signal.SIGKILL)',
          '            except ProcessLookupError:',
          '                pass',
          '            _, status = os.waitpid(pid, 0)',
          '            break',
          '',
          '        if master_open:',
          '            readable, _, _ = select.select([master_fd], [], [], min(remaining, 0.1))',
          '        else:',
          '            time.sleep(min(remaining, 0.01))',
          '            readable = []',
          '        if master_fd in readable:',
          '            try:',
          '                chunk = os.read(master_fd, 65536)',
          '            except OSError as error:',
          '                if error.errno == errno.EIO:',
          '                    master_open = False',
          '                else:',
          '                    raise',
          '            else:',
          '                if chunk:',
          '                    output.extend(chunk)',
          '                else:',
          '                    master_open = False',
          'finally:',
          '    os.close(master_fd)',
          '',
          'sys.stdout.buffer.write(output)',
          'if timed_out:',
          '    print("PTY child timed out", file=sys.stderr)',
          '    raise SystemExit(124)',
          'raise SystemExit(os.waitstatus_to_exitcode(status))',
          '',
        ].join('\n')
      );

      const result = spawnSync(
        'python3',
        [
          ptyRunnerPath,
          process.execPath,
          launcherPath,
          '--interactive',
          '--without-pipelines',
          '--dir',
          path.join(dir, 'install'),
        ],
        {
          encoding: 'utf-8',
          env: {
            ...process.env,
            SEQDESK_INSTALL_URL: `data:text/plain,${encodeURIComponent(installer)}`,
          },
        },
      );

      expect(
        result.status,
        `PTY runner error: ${result.error?.message || 'none'}\nscript stdout:\n${result.stdout || ''}\nscript stderr:\n${result.stderr || ''}`
      ).toBe(0);
      expect(fs.readFileSync(capturePath, 'utf-8')).toBe('tty preserved\n');
      expect(fs.readFileSync(installerLogPath, 'utf-8')).not.toContain(
        'No interactive TTY detected'
      );
    },
    25_000
  );

  it('runs a temporary installer file with inherited stdin and cleans it up', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seqdesk-launcher-installer-'));
    tempDirs.push(dir);
    const capturePath = path.join(dir, 'installer-capture.json');
    const installer = [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'IFS= read -r answer',
      `node -e 'const fs=require("node:fs");fs.writeFileSync(process.argv[1],JSON.stringify({script:process.argv[2],answer:process.argv[3],args:process.argv.slice(4)}))' ${JSON.stringify(capturePath)} "$0" "$answer" "$@"`,
      '',
    ].join('\n');

    const result = spawnSync(
      process.execPath,
      [launcherPath, '--without-pipelines', '--dir', path.join(dir, 'install')],
      {
        encoding: 'utf-8',
        env: {
          ...process.env,
          SEQDESK_INSTALL_URL: `data:text/plain,${encodeURIComponent(installer)}`,
        },
        input: 'reviewer-input\n',
      }
    );

    expect(result.status).toBe(0);
    const captured = JSON.parse(fs.readFileSync(capturePath, 'utf-8')) as {
      script: string;
      answer: string;
      args: string[];
    };
    expect(captured.answer).toBe('reviewer-input');
    expect(captured.args).toEqual([
      '--without-pipelines',
      '--dir',
      path.join(dir, 'install'),
    ]);
    expect(captured.script).toContain('seqdesk-installer-');
    expect(fs.existsSync(captured.script)).toBe(false);
  });

  it('documents guided and unattended installation modes in CLI help', () => {
    const result = spawnSync(process.execPath, [launcherPath, '--help'], {
      encoding: 'utf-8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--interactive');
    expect(result.stdout).toContain('-y, --yes');
    expect(result.stdout).toContain('--without-pipelines');
  });
});

describe('seqdesk npm launcher reset-password', () => {
  it('lists reset-password in the top-level help', () => {
    const result = spawnSync(process.execPath, [launcherPath, '--help'], {
      encoding: 'utf-8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('seqdesk reset-password --email <address>');
  });

  it('treats a missing --email as a usage error and prints the usage', () => {
    const result = spawnSync(process.execPath, [launcherPath, 'reset-password'], {
      encoding: 'utf-8',
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Name the account whose password should be replaced');
    // The error names a command that can be retyped as-is, not a flag grammar.
    expect(result.stderr).toContain('seqdesk reset-password admin@example.com');
    expect(result.stderr).toContain('seqdesk reset-password <address>');
  });

  it('accepts the address positionally, so the command can be retyped from a screenshot', () => {
    const { dir, capturePath } = makeResetPasswordInstall();

    const result = spawnSync(
      process.execPath,
      [launcherPath, 'reset-password', 'reviewer@example.org', '--dir', dir, '--yes'],
      { encoding: 'utf-8' }
    );

    expect(result.status).toBe(0);
    expect(readCapture(capturePath).argv).toEqual([
      '--email',
      'reviewer@example.org',
      '--json',
    ]);
  });

  it('refuses an empty --dir= instead of silently targeting the current directory', () => {
    const result = spawnSync(
      process.execPath,
      [launcherPath, 'reset-password', 'reviewer@example.org', '--dir='],
      { encoding: 'utf-8' }
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--dir requires a directory path');
  });

  it('rejects --json without --yes so a script cannot skip the confirmation', () => {
    const { dir, capturePath } = makeResetPasswordInstall();

    const result = spawnSync(
      process.execPath,
      [launcherPath, 'reset-password', '--email', 'reviewer@example.org', '--dir', dir, '--json'],
      { encoding: 'utf-8' }
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--json requires --yes');
    expect(fs.existsSync(capturePath)).toBe(false);
  });

  it('names the version that introduced the worker when the release predates it', () => {
    const { dir, workerPath } = makeResetPasswordInstall({
      prefix: 'seqdesk-reset-password-old-',
      worker: null,
    });

    const result = spawnSync(
      process.execPath,
      [launcherPath, 'reset-password', '--email', 'reviewer@example.org', '--dir', dir, '--yes'],
      { encoding: 'utf-8' }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no password-reset worker');
    expect(result.stderr).toContain(workerPath);
    // The installed release version, then the version to update to.
    expect(result.stderr).toContain('1.1.100');
    expect(result.stderr).toContain('SeqDesk 1.1.125 or newer');
    expect(result.stderr).not.toContain('ENOENT');
  });

  it('requires a confirmation before changing anything when --yes is absent', () => {
    const { dir, capturePath } = makeResetPasswordInstall();

    const declined = spawnSync(
      process.execPath,
      [launcherPath, 'reset-password', '--email', 'reviewer@example.org', '--dir', dir],
      { encoding: 'utf-8', input: 'n\n' }
    );

    expect(declined.status).toBe(1);
    // The account and the database it would be changed in are named before the
    // question, so the operator can see what they are confirming.
    expect(declined.stdout).toContain('reviewer@example.org');
    expect(declined.stdout).toContain('(Unix socket)');
    expect(declined.stdout).toContain("Reset this account's password? (y/N)");
    expect(declined.stderr).toContain('No password was changed');
    expect(fs.existsSync(capturePath)).toBe(false);

    // An unanswered prompt (closed stdin, as in CI) must not be read as consent.
    const unanswered = spawnSync(
      process.execPath,
      [launcherPath, 'reset-password', '--email', 'reviewer@example.org', '--dir', dir],
      { encoding: 'utf-8' }
    );

    expect(unanswered.status).toBe(1);
    expect(unanswered.stderr).toContain('no confirmation was read from stdin');
    expect(unanswered.stderr).toContain('--yes');
    expect(fs.existsSync(capturePath)).toBe(false);

    const accepted = spawnSync(
      process.execPath,
      [launcherPath, 'reset-password', '--email', 'reviewer@example.org', '--dir', dir],
      { encoding: 'utf-8', input: 'y\n' }
    );

    expect(accepted.status).toBe(0);
    expect(fs.existsSync(capturePath)).toBe(true);
  });

  it('passes the socket-form database URL through to the installed worker', () => {
    const { dir, capturePath, socketUrl } = makeResetPasswordInstall();

    const result = spawnSync(
      process.execPath,
      [launcherPath, 'reset-password', '--email', 'reviewer@example.org', '--dir', dir, '--yes'],
      { encoding: 'utf-8' }
    );

    expect(result.status).toBe(0);
    const captured = readCapture(capturePath);
    // Verbatim: "?host=/path" is how Prisma is told to use a Unix socket, so
    // rewriting it would point the worker at a different server.
    expect(captured.databaseUrl).toBe(socketUrl);
    // No runtime.directUrl was configured, so databaseUrl is the fallback.
    expect(captured.directUrl).toBe(socketUrl);
    expect(captured.argv).toEqual(['--email', 'reviewer@example.org', '--json']);
    expect(fs.realpathSync(captured.cwd)).toBe(fs.realpathSync(path.join(dir, 'current')));
  });

  it('passes a configured directUrl and an explicit --password to the worker', () => {
    const directUrl = 'postgresql://seqdesk:secret@127.0.0.1:5433/seqdesk';
    const { dir, capturePath, socketUrl } = makeResetPasswordInstall({
      runtime: {
        databaseUrl:
          'postgresql://seqdesk:secret@127.0.0.1:5432/seqdesk',
        directUrl,
        nextAuthSecret: 'test-secret',
      },
      payload: { generated: false, password: 'chosen-by-operator' },
    });
    expect(socketUrl).toContain('host=');

    const result = spawnSync(
      process.execPath,
      [
        launcherPath,
        'reset-password',
        '--email',
        'reviewer@example.org',
        '--dir',
        dir,
        '--password',
        'chosen-by-operator',
        '--yes',
      ],
      { encoding: 'utf-8' }
    );

    expect(result.status).toBe(0);
    const captured = readCapture(capturePath);
    expect(captured.directUrl).toBe(directUrl);
    expect(captured.argv).toEqual([
      '--email',
      'reviewer@example.org',
      '--password',
      'chosen-by-operator',
      '--json',
    ]);
    expect(result.stdout).toContain('Set from the value you passed');
  });

  it('prints the new password once and leaves it in no file under the install', () => {
    const { dir, workerPath } = makeResetPasswordInstall();

    const result = spawnSync(
      process.execPath,
      [launcherPath, 'reset-password', '--email', 'reviewer@example.org', '--dir', dir, '--yes'],
      { encoding: 'utf-8' }
    );

    expect(result.status).toBe(0);
    expect(result.stdout.split(STUB_PASSWORD).length - 1).toBe(1);
    expect(result.stdout).toContain('Ada Lovelace');
    expect(result.stdout).toContain('ADMIN');
    expect(result.stdout).toContain('stored nowhere');

    // The stub worker's own source carries the password it reports, so it is the
    // one file that is expected to contain it.
    const leaked = filesUnder(dir).filter(
      (file) => file !== workerPath && fs.readFileSync(file, 'utf-8').includes(STUB_PASSWORD)
    );
    expect(leaked).toEqual([]);
  });

  it('turns worker failure codes into actionable messages', () => {
    const notFound = makeResetPasswordInstall({
      payload: { ok: false, error: 'No user with that email', code: 'not-found' },
    });
    const notFoundResult = spawnSync(
      process.execPath,
      [
        launcherPath,
        'reset-password',
        '--email',
        'nobody@example.org',
        '--dir',
        notFound.dir,
        '--yes',
      ],
      { encoding: 'utf-8' }
    );

    expect(notFoundResult.status).toBe(1);
    // The worker's own wording is passed through: it is the half that can say
    // "this database has admin@example.com, which differs only in capitalisation",
    // and a wrong capital is the mistake a locked-out operator actually makes.
    expect(notFoundResult.stderr).toContain('No user with that email');
    expect(notFoundResult.stderr).toContain('doctor --dir');

    const unreachable = makeResetPasswordInstall({
      payload: { ok: false, error: "Can't reach database server", code: 'db-unreachable' },
    });
    const unreachableResult = spawnSync(
      process.execPath,
      [
        launcherPath,
        'reset-password',
        '--email',
        'reviewer@example.org',
        '--dir',
        unreachable.dir,
        '--yes',
        '--json',
      ],
      { encoding: 'utf-8' }
    );

    expect(unreachableResult.status).toBe(1);
    const report = JSON.parse(unreachableResult.stdout) as {
      ok: boolean;
      error: string;
      remediation: string;
    };
    expect(report.ok).toBe(false);
    expect(report.error).toContain("Can't reach database server");
    expect(report.remediation).toContain('doctor --dir');
  });

  it('reports a worker that produced no result instead of a stack trace', () => {
    const { dir } = makeResetPasswordInstall({
      worker: [
        "console.error(\"Error: Cannot find package '@prisma/client'\");",
        'process.exit(1);',
        '',
      ].join('\n'),
    });

    const result = spawnSync(
      process.execPath,
      [launcherPath, 'reset-password', '--email', 'reviewer@example.org', '--dir', dir, '--yes'],
      { encoding: 'utf-8' }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('without reporting a result');
    expect(result.stderr).toContain('@prisma/client');
  });

  it('fails clearly when the install directory has no settings.json', () => {
    const { dir } = makeResetPasswordInstall({ runtime: null });

    const result = spawnSync(
      process.execPath,
      [launcherPath, 'reset-password', '--email', 'reviewer@example.org', '--dir', dir, '--yes'],
      { encoding: 'utf-8' }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('has no settings.json');
    expect(result.stderr).toContain('--reconfigure');
  });
});

describe('seqdesk npm launcher doctor release layout', () => {
  it('finds runtime dependencies and static assets under the current release', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seqdesk-doctor-current-'));
    tempDirs.push(dir);
    fs.mkdirSync(path.join(dir, 'current', 'node_modules'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'current', '.next', 'static'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'seqdesk', version: '1.2.3' })
    );
    fs.writeFileSync(path.join(dir, 'start.sh'), '#!/usr/bin/env bash\n');
    fs.chmodSync(path.join(dir, 'start.sh'), 0o700);

    const result = spawnSync(
      process.execPath,
      [launcherPath, 'doctor', '--dir', dir, '--json'],
      { encoding: 'utf-8' }
    );

    // settings.json is intentionally absent, so doctor still exits non-zero;
    // this fixture is scoped to immutable release-layout discovery.
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout) as {
      checks: Array<{ name: string; status: string; detail: string }>;
    };
    expect(report.checks).toEqual(
      expect.arrayContaining([
        {
          name: 'node_modules',
          status: 'pass',
          detail: 'present in current release',
        },
        {
          name: '.next/static',
          status: 'pass',
          detail: 'present in current release',
        },
      ])
    );
  });

  it('checks a configured PostgreSQL Unix socket instead of localhost TCP', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seqdesk-doctor-socket-'));
    tempDirs.push(dir);
    const socketDir = path.join(dir, 'postgres-socket');
    const socketUrl =
      `postgresql://seqdesk:secret@localhost:5432/seqdesk` +
      `?schema=public&host=${encodeURIComponent(socketDir)}`;
    const rawSocketUrl =
      `postgresql:///seqdesk` +
      `?schema=public&host=${socketDir}`;

    fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.next', 'static'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'seqdesk', version: '1.2.3' })
    );
    fs.writeFileSync(path.join(dir, 'start.sh'), '#!/usr/bin/env bash\n');
    fs.chmodSync(path.join(dir, 'start.sh'), 0o700);
    fs.writeFileSync(
      path.join(dir, 'settings.json'),
      JSON.stringify({
        runtime: {
          databaseUrl: socketUrl,
          directUrl: rawSocketUrl,
          nextAuthUrl: 'http://127.0.0.1:8000',
          nextAuthSecret: 'test-secret',
        },
      })
    );

    const result = spawnSync(
      process.execPath,
      [launcherPath, 'doctor', '--dir', dir, '--timeout-ms', '50', '--json'],
      { encoding: 'utf-8' }
    );

    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout) as {
      checks: Array<{ name: string; status: string; detail: string }>;
    };
    expect(report.checks).toEqual(
      expect.arrayContaining([
        {
          name: 'runtime.databaseUrl',
          status: 'pass',
          detail: `${socketDir}:5432/seqdesk (Unix socket)`,
        },
        expect.objectContaining({
          name: 'PostgreSQL socket',
          status: 'fail',
          detail: expect.stringContaining(
            path.join(socketDir, '.s.PGSQL.5432')
          ),
        }),
        {
          name: 'runtime.directUrl',
          status: 'pass',
          detail: `${socketDir}:5432/seqdesk (Unix socket)`,
        },
      ])
    );
    expect(report.checks.some((check) => check.name === 'PostgreSQL TCP')).toBe(false);
  });

  it('probes the host= query parameter instead of the URL host', async () => {
    const server = await listenLoopback();
    try {
      // libpq lets host= name the real server; the URL host is then ignored.
      // 192.0.2.1 is TEST-NET-1 and never answers, so contacting it instead
      // would time out rather than pass.
      const dir = makeDoctorInstall('seqdesk-doctor-hostparam-', {
        databaseUrl: `postgresql://seqdesk:secret@192.0.2.1:${server.port}/seqdesk?host=127.0.0.1`,
        nextAuthSecret: 'test-secret',
      });

      const { status, stdout, checks } = runDoctorJson(dir, ['--timeout-ms', '2000']);

      expect(status).toBe(0);
      expect(checks).toEqual(
        expect.arrayContaining([
          {
            name: 'runtime.databaseUrl',
            status: 'pass',
            detail: `127.0.0.1:${server.port}/seqdesk`,
          },
          {
            name: 'PostgreSQL TCP',
            status: 'pass',
            detail: `127.0.0.1:${server.port} reachable`,
          },
        ])
      );
      expect(stdout).not.toContain('192.0.2.1');
    } finally {
      await server.close();
    }
  }, 15_000);

  it('probes an IPv6 database host without the URL brackets', async () => {
    const port = await reserveFreePort();
    const dir = makeDoctorInstall('seqdesk-doctor-ipv6-', {
      databaseUrl: `postgresql://seqdesk:secret@[::1]:${port}/seqdesk`,
      nextAuthSecret: 'test-secret',
    });

    const { checks } = runDoctorJson(dir, ['--timeout-ms', '2000']);

    expect(checks).toEqual(
      expect.arrayContaining([
        {
          name: 'runtime.databaseUrl',
          status: 'pass',
          detail: `[::1]:${port}/seqdesk`,
        },
      ])
    );
    const tcpCheck = checks.find((check) => check.name === 'PostgreSQL TCP');
    expect(tcpCheck).toBeDefined();
    expect(tcpCheck?.detail).toContain(`[::1]:${port}`);
    // Keeping the brackets made Node treat "[::1]" as a DNS name, so the probe
    // failed with ENOTFOUND instead of actually reaching the loopback address.
    expect(tcpCheck?.detail).not.toContain('ENOTFOUND');
    expect(tcpCheck?.remediation).toContain('pg_isready -h ::1');
  }, 15_000);

  it('attaches a remediation hint to every failing check', () => {
    // An empty directory fails the package.json, settings.json, start.sh and
    // node_modules checks at once, which is what a reviewer sees after
    // pointing --dir at the wrong place.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seqdesk-doctor-remediation-'));
    tempDirs.push(dir);

    const { status, checks } = runDoctorJson(dir);

    expect(status).toBe(1);
    const failures = checks.filter((check) => check.status === 'fail');
    expect(failures.length).toBeGreaterThan(0);
    for (const failure of failures) {
      expect(failure.remediation, `no remediation for ${failure.name}`).toBeTruthy();
    }
    expect(
      checks.filter((check) => check.status === 'pass').map((check) => check.remediation)
    ).toEqual(checks.filter((check) => check.status === 'pass').map(() => undefined));

    const textResult = spawnSync(process.execPath, [launcherPath, 'doctor', '--dir', dir], {
      encoding: 'utf-8',
    });
    expect(textResult.status).toBe(1);
    expect(textResult.stdout).toContain('-> ');
  });
});
