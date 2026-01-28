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

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== 'FACILITY_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const envName = process.env.CONDA_DEFAULT_ENV || inferEnvFromPrefix(process.env.CONDA_PREFIX);
    let condaBase = inferBaseFromPrefix(process.env.CONDA_PREFIX);

    if (!condaBase && await commandExists('conda')) {
      try {
        const { stdout } = await execAsync('conda info --base', { timeout: 8000 });
        condaBase = stdout.trim() || null;
      } catch {
        // ignore
      }
    }

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
