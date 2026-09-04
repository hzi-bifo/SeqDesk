import path from "path";
import { buildSeqDeskSlurmJobName } from "@/lib/pipelines/run-directory";
import type { ExecutionSettings } from "@/lib/pipelines/execution-settings";

/**
 * Shell wrappers for Explore analysis runs. They follow the pipeline wrapper
 * conventions so the same monitoring works: logs in `logs/pipeline.out` and
 * `logs/pipeline.err`, and the canonical exit marker
 * `Pipeline completed with exit code: N` written by an EXIT trap.
 */
export const EXPLORE_LOG_OUT = "logs/pipeline.out";
export const EXPLORE_LOG_ERR = "logs/pipeline.err";

export interface RunScriptOptions {
  runId: string;
  runFolder: string;
  language: "python" | "r";
  entrypoint: string;
  environmentPrefix: string;
  condaPath?: string | null;
  helperLibDir: string;
  slurm?: Pick<ExecutionSettings, "slurmQueue" | "slurmCores" | "slurmMemory" | "slurmTimeLimit" | "slurmOptions">;
}

export function shellQuote(value: string): string {
  if (value === "") return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function assertSafeRunFolder(runFolder: string): void {
  if (!path.isAbsolute(runFolder) || /[\r\n'"`$\\]/.test(runFolder)) {
    throw new Error("Run folder path contains unsupported characters");
  }
}

function sanitizeQueue(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : fallback;
}

function sanitizeMemory(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && /^\d+[KMGT]?B?$/.test(trimmed) ? trimmed : fallback;
}

function sanitizeCores(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function sanitizeHours(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function sanitizeOptions(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) return "";
  const tokens = trimmed.split(/\s+/).filter((token) => !/^(-J|--job-name)(=|$)/.test(token));
  return tokens.map(shellQuote).join(" ");
}

/** Body shared by the local and the SLURM wrapper: activate the env, run the script. */
function buildBody(options: RunScriptOptions): string {
  const interpreter = options.language === "r" ? "Rscript" : "python";
  const condaLines: string[] = [];
  if (options.condaPath?.trim()) {
    condaLines.push(`CONDA_BASE=${shellQuote(options.condaPath.trim())}`);
    condaLines.push('if [ -f "$CONDA_BASE/etc/profile.d/conda.sh" ]; then');
    condaLines.push('  # shellcheck disable=SC1091');
    condaLines.push('  source "$CONDA_BASE/etc/profile.d/conda.sh"');
    condaLines.push("fi");
  }
  return [
    `RUN_DIR=${shellQuote(options.runFolder)}`,
    `ENV_PREFIX=${shellQuote(options.environmentPrefix)}`,
    `HELPER_LIB=${shellQuote(options.helperLibDir)}`,
    'STDOUT_LOG="$RUN_DIR/logs/pipeline.out"',
    'STDERR_LOG="$RUN_DIR/logs/pipeline.err"',
    'mkdir -p "$RUN_DIR/logs" "$RUN_DIR/outputs"',
    "",
    "# Always record the real exit code for the monitor, even under set -e.",
    `trap 'EXIT_CODE=$?; echo "Pipeline completed with exit code: $EXIT_CODE at $(date)" >> "$STDOUT_LOG"; exit $EXIT_CODE' EXIT`,
    "",
    'echo "Starting Explore analysis at $(date)" > "$STDOUT_LOG"',
    ': > "$STDERR_LOG"',
    'cd "$RUN_DIR"',
    ...condaLines,
    "",
    "# The environment is a conda prefix: prefer its binaries directly so the",
    "# wrapper works without conda on PATH (SLURM nodes only share the filesystem).",
    'export PATH="$ENV_PREFIX/bin:$PATH"',
    `export PYTHONPATH="$HELPER_LIB/python\${PYTHONPATH:+:$PYTHONPATH}"`,
    `export R_LIBS_USER="$HELPER_LIB/r\${R_LIBS_USER:+:$R_LIBS_USER}"`,
    'export SEQDESK_EXPLORE_RUN_DIR="$RUN_DIR"',
    "export MPLBACKEND=Agg",
    "export PYTHONUNBUFFERED=1",
    "# No secrets reach the analysis process.",
    "unset DATABASE_URL DIRECT_URL ANTHROPIC_API_KEY NEXTAUTH_SECRET",
    "",
    `if ! command -v ${interpreter} >/dev/null 2>&1; then`,
    `  echo "ERROR: ${interpreter} not found in $ENV_PREFIX/bin" >> "$STDERR_LOG"`,
    "  exit 1",
    "fi",
    `echo "Using ${interpreter}: $(command -v ${interpreter})" >> "$STDOUT_LOG"`,
    `${interpreter} ${shellQuote(options.entrypoint)} --run-dir "$RUN_DIR" >> "$STDOUT_LOG" 2>> "$STDERR_LOG"`,
  ].join("\n");
}

export function generateLocalRunScript(options: RunScriptOptions): string {
  assertSafeRunFolder(options.runFolder);
  return `#!/bin/bash
set -euo pipefail

${buildBody(options)}
`;
}

export function generateSlurmRunScript(options: RunScriptOptions): string {
  assertSafeRunFolder(options.runFolder);
  const slurm = options.slurm;
  const queue = sanitizeQueue(slurm?.slurmQueue, "cpu");
  const cores = sanitizeCores(slurm?.slurmCores, 2);
  const memory = sanitizeMemory(slurm?.slurmMemory, "16GB");
  const hours = sanitizeHours(slurm?.slurmTimeLimit, 4);
  const extra = sanitizeOptions(slurm?.slurmOptions);
  const jobName = buildSeqDeskSlurmJobName(options.runId);
  return `#!/bin/bash
#SBATCH --job-name=${jobName}
#SBATCH -p ${queue}
#SBATCH -c ${cores}
#SBATCH --mem='${memory}'
#SBATCH -t ${hours}:0:0
#SBATCH --chdir=${shellQuote(options.runFolder)}
#SBATCH --output="/tmp/seqdesk-explore-%j.out"
#SBATCH --error="/tmp/seqdesk-explore-%j.err"
${extra ? `#SBATCH ${extra}` : ""}

set -euo pipefail

# SLURM opens its own --output/--error as the daemon user, which fails on a
# root-squashed NFS run dir; they point at node-local /tmp and are copied back.
copy_slurm_logs() {
  if [ -n "\${SLURM_JOB_ID:-}" ]; then
    cp -f "/tmp/seqdesk-explore-\${SLURM_JOB_ID}.out" "${options.runFolder}/logs/slurm.out" 2>/dev/null || true
    cp -f "/tmp/seqdesk-explore-\${SLURM_JOB_ID}.err" "${options.runFolder}/logs/slurm.err" 2>/dev/null || true
  fi
}
for _ in $(seq 1 15); do
  if mkdir -p "${options.runFolder}/logs" 2>/dev/null && : > "${options.runFolder}/logs/.nfs-probe" 2>/dev/null; then
    rm -f "${options.runFolder}/logs/.nfs-probe" 2>/dev/null || true
    break
  fi
  sleep 2
done

${buildBody(options).replace(
    "trap 'EXIT_CODE=$?; echo \"Pipeline completed with exit code: $EXIT_CODE at $(date)\" >> \"$STDOUT_LOG\"; exit $EXIT_CODE' EXIT",
    "trap 'EXIT_CODE=$?; echo \"Pipeline completed with exit code: $EXIT_CODE at $(date)\" >> \"$STDOUT_LOG\"; copy_slurm_logs; exit $EXIT_CODE' EXIT"
  )}
`;
}
