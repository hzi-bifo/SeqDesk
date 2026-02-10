import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

async function commandExists(command: string): Promise<boolean> {
  try {
    await execAsync(`command -v ${command}`, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function inferEnvFromPrefix(prefix?: string | null): string | null {
  if (!prefix) return null;
  const parts = prefix.split(path.sep).filter(Boolean);
  const envIndex = parts.lastIndexOf('envs');
  if (envIndex >= 0 && parts.length > envIndex + 1) {
    return parts[envIndex + 1];
  }
  return path.basename(prefix) || null;
}

function inferBaseFromPrefix(prefix?: string | null): string | null {
  if (!prefix) return null;
  const marker = `${path.sep}envs${path.sep}`;
  const idx = prefix.indexOf(marker);
  if (idx >= 0) {
    return prefix.slice(0, idx);
  }
  return prefix;
}

function normalizeEnvName(name?: string | null): string | null {
  const trimmed = name?.trim();
  return trimmed ? trimmed : null;
}

async function detectCondaEnvNames(): Promise<string[]> {
  if (!(await commandExists('conda'))) {
    return [];
  }

  try {
    const { stdout } = await execAsync('conda env list --json', { timeout: 8000 });
    const parsed = JSON.parse(stdout) as { envs?: unknown };
    if (!Array.isArray(parsed.envs)) {
      return [];
    }

    const names = parsed.envs
      .map((envPath) => (typeof envPath === 'string' ? inferEnvFromPrefix(envPath) : null))
      .map((name) => normalizeEnvName(name))
      .filter((name): name is string => Boolean(name));
    return [...new Set(names)];
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'FACILITY_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const processEnvName = normalizeEnvName(
      process.env.CONDA_DEFAULT_ENV || inferEnvFromPrefix(process.env.CONDA_PREFIX)
    );
    let condaBase = inferBaseFromPrefix(process.env.CONDA_PREFIX);
    const envNames = await detectCondaEnvNames();

    if (!condaBase && await commandExists('conda')) {
      try {
        const { stdout } = await execAsync('conda info --base', { timeout: 8000 });
        condaBase = stdout.trim() || null;
      } catch {
        // ignore
      }
    }

    // Prefer the SeqDesk pipeline env if it exists, even when the process runs in base.
    const envName =
      envNames.includes('seqdesk-pipelines')
        ? 'seqdesk-pipelines'
        : processEnvName;

    const detected = Boolean(envName || condaBase);

    return NextResponse.json({
      detected,
      condaEnv: envName || null,
      condaBase: condaBase || null,
    });
  } catch (error) {
    console.error('[Auto Detect] Error:', error);
    return NextResponse.json(
      { detected: false, message: 'Failed to auto-detect conda environment' },
      { status: 500 }
    );
  }
}
