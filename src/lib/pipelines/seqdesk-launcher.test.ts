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
