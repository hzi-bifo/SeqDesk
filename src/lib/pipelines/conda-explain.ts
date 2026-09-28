/**
 * Why a step's conda environment could not be built. Nextflow runs `micromamba create --quiet`, so its log only says
 * "Failed to create Conda environment" with an empty message. When a run fails that way, the monitor asks the same
 * solver again as a dry run and keeps the lines that name the cause ("nothing provides …", "… does not exist") in
 * logs/conda-explain.txt, which the card shows first.
 */
import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { redactLog } from './plain-status';

const run = promisify(execFile);
export type CondaExec = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
const defaultExec: CondaExec = async (file, args) => {
  try { return await run(file, args, { timeout: 120_000, maxBuffer: 1 << 20 }); }
  catch (error) { const e = error as { stdout?: string; stderr?: string }; return { stdout: e.stdout ?? '', stderr: e.stderr ?? '' }; }
};

export const CONDA_EXPLAIN_FILE = path.join('logs', 'conda-explain.txt');

/** The failed `micromamba create …` (or conda) command from Nextflow's log: the tool, its channels and the specs. */
export function failedCondaCommand(text: string | null | undefined): { tool: string; channels: string[]; specs: string[] } | null {
  const m = /Failed to create Conda environment\s+command:\s+(\S*(?:micromamba|mamba|conda))\s+create\s+([^\n]+)/.exec(text ?? '');
  if (!m) return null;
  const words = m[2].trim().split(/\s+/);
  const channels: string[] = [], specs: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (w === '-c' || w === '--channel') { if (words[i + 1] && !channels.includes(words[i + 1])) channels.push(words[i + 1]); i += 1; }
    else if (w === '--prefix' || w === '-p' || w === '-n') i += 1;
    else if (!w.startsWith('-') && /^[A-Za-z0-9_.:=<>!*-]+$/.test(w)) specs.push(w);
  }
  return specs.length ? { tool: m[1].split('/').pop()!, channels, specs } : null;
}

/** The solver's lines that say why: at most three, redacted, without ANSI colours. */
export function explainLines(output: string): string[] {
  return redactLog(output).split(/\r?\n/).map((l) => l.replace(/\u001b\[[0-9;]*m/g, '').replace(/^[\s│├└─]+/, '').trim())
    .filter((l) => /nothing provides|does not exist|could not be installed|cannot be installed|conflict|PackagesNotFound|not available from current channels/i.test(l))
    .slice(0, 3);
}

/** Ask the solver once (dry run, nothing installed) and keep its reason next to the run's logs. */
export async function explainCondaFailure(runFolder: string, logText: string, exec: CondaExec = defaultExec): Promise<string[]> {
  const file = path.join(runFolder, CONDA_EXPLAIN_FILE);
  const kept = await fs.readFile(file, 'utf8').catch(() => null);
  if (kept != null) return kept.split('\n').filter(Boolean);
  const cmd = failedCondaCommand(logText);
  if (!cmd) return [];
  const tool = cmd.tool === 'micromamba' ? 'micromamba' : cmd.tool;
  const args = ['create', '--dry-run', '--yes', '--override-channels', ...cmd.channels.flatMap((c) => ['-c', c]), '-p', path.join(runFolder, '.conda-explain-env'), ...cmd.specs];
  const { stdout, stderr } = await exec(tool, args);
  const lines = explainLines(`${stdout}\n${stderr}`);
  await fs.mkdir(path.dirname(file), { recursive: true }).catch(() => undefined);
  await fs.writeFile(file, lines.join('\n')).catch(() => undefined);
  return lines;
}
