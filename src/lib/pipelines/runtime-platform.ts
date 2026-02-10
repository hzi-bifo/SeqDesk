import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

export interface RuntimePlatformInfo {
  os: string;
  arch: string;
  raw: string;
  source: 'conda' | 'node';
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execAsync(`command -v ${command}`, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function resolveCondaBin(condaPath?: string): Promise<string | null> {
  if (condaPath) {
    const possiblePaths = [
      path.join(condaPath, 'condabin', 'conda'),
      path.join(condaPath, 'bin', 'conda'),
    ];
    for (const p of possiblePaths) {
      try {
        await fs.access(p);
        return p;
      } catch {
        // Try next path
      }
    }
  }

  return (await commandExists('conda')) ? 'conda' : null;
}

function parseCondaSubdir(subdir: string): { os: string; arch: string } | null {
  const normalized = subdir.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith('osx-')) {
    return { os: 'darwin', arch: normalized.slice(4) || 'unknown' };
  }
  if (normalized.startsWith('linux-')) {
    return { os: 'linux', arch: normalized.slice(6) || 'unknown' };
  }
  if (normalized.startsWith('win-')) {
    return { os: 'win32', arch: normalized.slice(4) || 'unknown' };
  }

  const [os, arch] = normalized.split('-', 2);
  if (!os || !arch) {
    return null;
  }
  return { os, arch };
}

export async function detectRuntimePlatform(
  condaPath?: string
): Promise<RuntimePlatformInfo> {
  const condaBin = await resolveCondaBin(condaPath);
  if (condaBin) {
    try {
      const { stdout } = await execAsync(
        `${shellQuote(condaBin)} info --json`,
        { timeout: 10000 }
      );
      const parsed = JSON.parse(stdout) as { subdir?: unknown; platform?: unknown };
      const rawSubdir =
        typeof parsed.subdir === 'string'
          ? parsed.subdir
          : typeof parsed.platform === 'string'
          ? parsed.platform
          : '';
      const runtime = parseCondaSubdir(rawSubdir);
      if (runtime) {
        return {
          ...runtime,
          raw: rawSubdir,
          source: 'conda',
        };
      }
    } catch {
      // Fall back to node runtime info
    }
  }

  return {
    os: process.platform,
    arch: process.arch,
    raw: `${process.platform}-${process.arch}`,
    source: 'node',
  };
}

export function isMacOsArmRuntime(platform: RuntimePlatformInfo): boolean {
  const arch = platform.arch.toLowerCase();
  return platform.os === 'darwin' && (arch === 'arm64' || arch === 'aarch64');
}
