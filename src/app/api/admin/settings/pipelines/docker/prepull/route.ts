import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getExecutionSettings, type ExecutionSettings } from '../../execution/route';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { readTail } from '@/lib/pipelines/nextflow';

const execAsync = promisify(exec);

interface PrepullStatus {
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  pid?: number;
  exitCode?: number;
  runDir: string;
  outPath: string;
  errPath: string;
  command: string;
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execAsync(`command -v ${command}`, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function ensureDocker(): Promise<{ ok: boolean; message: string }> {
  try {
    await execAsync('docker --version', { timeout: 8000 });
  } catch {
    return { ok: false, message: 'Docker CLI not found on PATH.' };
  }

  try {
    await execAsync('docker info', { timeout: 8000 });
    return { ok: true, message: 'Docker daemon is running.' };
  } catch {
    return { ok: false, message: 'Docker daemon is not running.' };
  }
}

async function checkNextflow(settings: ExecutionSettings): Promise<{ ok: boolean; message: string }> {
  if (await commandExists('nextflow')) {
    return { ok: true, message: 'Nextflow found on PATH.' };
  }

  if (!settings.condaPath) {
    return {
      ok: false,
      message: 'Nextflow not found on PATH. Install Nextflow or configure a conda path.',
    };
  }

  const condaEnv = settings.condaEnv || 'seqdesk-pipelines';
  const condaSh = path.join(settings.condaPath, 'etc', 'profile.d', 'conda.sh');
  try {
    await fs.access(condaSh);
  } catch {
    return {
      ok: false,
      message: 'Conda activation script not found at the configured conda path.',
    };
  }

  try {
    await execAsync(
      `bash -lc 'source "${condaSh}" && conda activate ${condaEnv} && command -v nextflow'`,
      { timeout: 10000 }
    );
    return { ok: true, message: 'Nextflow found in conda environment.' };
  } catch {
    return {
      ok: false,
      message: `Nextflow not found on PATH or in conda env "${condaEnv}".`,
    };
  }
}

async function loadLatestStatus(rootDir: string): Promise<PrepullStatus | null> {
  const latestPath = path.join(rootDir, 'latest.json');
  try {
    const latestRaw = await fs.readFile(latestPath, 'utf8');
    const latest = JSON.parse(latestRaw) as { statusPath?: string };
    if (!latest.statusPath) return null;
    const statusRaw = await fs.readFile(latest.statusPath, 'utf8');
    return JSON.parse(statusRaw) as PrepullStatus;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'FACILITY_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const execSettings = await getExecutionSettings();
    const rootDir = path.join(execSettings.pipelineRunDir || process.cwd(), '_docker_prepull');
    const status = await loadLatestStatus(rootDir);

    if (!status) {
      return NextResponse.json({ status: null });
    }

    const outputTail = await readTail(status.outPath, 60);
    const errorTail = await readTail(status.errPath, 60);

    return NextResponse.json({
      status,
      outputTail,
      errorTail,
    });
  } catch (error) {
    console.error('[Docker Prepull] Error:', error);
    return NextResponse.json({ error: 'Failed to load prepull status' }, { status: 500 });
  }
}

export async function POST() {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'FACILITY_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const execSettings = await getExecutionSettings();

    const dockerCheck = await ensureDocker();
    if (!dockerCheck.ok) {
      return NextResponse.json({ error: dockerCheck.message }, { status: 400 });
    }

    const condaEnv = execSettings.condaEnv || 'seqdesk-pipelines';
    const nextflowCheck = await checkNextflow(execSettings);
    if (!nextflowCheck.ok) {
      return NextResponse.json({ error: nextflowCheck.message }, { status: 400 });
    }

    const rootDir = path.join(execSettings.pipelineRunDir || process.cwd(), '_docker_prepull');
    const runDir = path.join(rootDir, `prepull-${Date.now()}`);
    await fs.mkdir(path.join(runDir, 'logs'), { recursive: true });

    const outPath = path.join(runDir, 'logs', 'prepull.out');
    const errPath = path.join(runDir, 'logs', 'prepull.err');
    const statusPath = path.join(runDir, 'status.json');

    const runName = `DOCKER-PREPULL-${Date.now()}`;
    const workDir = path.join(runDir, 'work');
    const outDir = path.join(runDir, 'output');

    const nfCommand = [
      'nextflow',
      'run',
      'nf-core/mag',
      '-profile',
      'test,docker',
      '-stub',
      '--outdir',
      outDir,
      '-work-dir',
      workDir,
      '-name',
      runName,
    ].join(' ');

    const scriptLines: string[] = [
      '#!/bin/bash',
      'set -e',
      'export NXF_ANSI_LOG=false',
    ];

    if (execSettings.condaPath) {
      scriptLines.push(
        `export PATH="${execSettings.condaPath}/bin:$PATH"`,
        `source "${execSettings.condaPath}/etc/profile.d/conda.sh"`,
        `conda activate ${condaEnv}`
      );
    }

    scriptLines.push(`${nfCommand} >> "${outPath}" 2>> "${errPath}"`);
    scriptLines.push('echo "Pre-pull completed" >> "${outPath}"');

    const scriptPath = path.join(runDir, 'prepull.sh');
    await fs.writeFile(scriptPath, scriptLines.join('\n'));
    await fs.chmod(scriptPath, 0o755);

    const status: PrepullStatus = {
      status: 'running',
      startedAt: new Date().toISOString(),
      pid: undefined,
      runDir,
      outPath,
      errPath,
      command: nfCommand,
    };
    await fs.writeFile(statusPath, JSON.stringify(status, null, 2));

    await fs.writeFile(path.join(rootDir, 'latest.json'), JSON.stringify({ statusPath }, null, 2));

    const child = spawn('bash', [scriptPath], {
      cwd: runDir,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    status.pid = child.pid;
    await fs.writeFile(statusPath, JSON.stringify(status, null, 2));

    child.on('close', async (code) => {
      const finalStatus: PrepullStatus = {
        ...status,
        status: code === 0 ? 'completed' : 'failed',
        completedAt: new Date().toISOString(),
        exitCode: code ?? undefined,
      };
      try {
        await fs.writeFile(statusPath, JSON.stringify(finalStatus, null, 2));
      } catch (err) {
        console.error('[Docker Prepull] Failed to update status:', err);
      }
    });

    return NextResponse.json({
      success: true,
      status,
      message: 'Pre-pull started. This can take a few minutes.',
    });
  } catch (error) {
    console.error('[Docker Prepull] Error:', error);
    return NextResponse.json({ error: 'Failed to start pre-pull' }, { status: 500 });
  }
}
