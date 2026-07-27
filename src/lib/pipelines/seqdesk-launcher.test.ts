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

function makeInstallWithPipelineCli(): { dir: string; capturePath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seqdesk-launcher-'));
  tempDirs.push(dir);
  const scriptsDir = path.join(dir, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  const capturePath = path.join(dir, 'pipeline-argv.json');
  fs.writeFileSync(
    path.join(scriptsDir, 'pipeline-cli.js'),
    [
      '#!/usr/bin/env node',
      'const fs = require("fs");',
      `fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(2) }));`,
      'process.exit(0);',
      '',
    ].join('\n')
  );
  return { dir, capturePath };
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
  it('prints pipeline help without requiring an installed app', () => {
    const result = spawnSync(process.execPath, [launcherPath, 'pipeline', '--help'], {
      encoding: 'utf-8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('seqdesk pipeline run <pipelineId>');
  });

  it('dispatches pipeline commands to the installed script under --dir', () => {
    const { dir, capturePath } = makeInstallWithPipelineCli();
    const result = spawnSync(
      process.execPath,
      [launcherPath, 'pipeline', 'list', '--dir', dir, '--json'],
      { encoding: 'utf-8' }
    );

    expect(result.status).toBe(0);
    const captured = JSON.parse(fs.readFileSync(capturePath, 'utf-8'));
    expect(fs.realpathSync(captured.cwd)).toBe(fs.realpathSync(dir));
    expect(captured.argv).toEqual(['list', '--dir', dir, '--json']);
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
