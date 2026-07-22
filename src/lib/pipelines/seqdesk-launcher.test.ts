import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

const launcherPath = path.resolve(process.cwd(), 'npm/seqdesk/bin/seqdesk.js');
const tempDirs: string[] = [];

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
});
