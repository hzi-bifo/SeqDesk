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

/**
 * How the analysis process is confined. The mount plan decides what exists
 * inside; the wrapper only knows which tool to call with which arguments.
 * `mode` "required" refuses to run when the tool is missing on the host that
 * executes the script (the SLURM node may differ from the app host);
 * "auto" runs unconfined and says so in the log.
 */
export type RunSandbox =
  | { kind: "bubblewrap"; mode: "required" | "auto"; args: string[]; planHash: string }
  | { kind: "seatbelt"; mode: "required" | "auto"; profilePath: string; planHash: string }
  | { kind: "none"; mode: "required" | "auto" | "off"; reason: string };

export interface RunScriptOptions {
  runId: string;
  runFolder: string;
  language: "python" | "r";
  entrypoint: string;
  environmentPrefix: string;
  condaPath?: string | null;
  /** The helper library staged inside the run folder (lib/); nodes cannot see the app checkout. */
  helperLibDir: string;
  slurm?: Pick<ExecutionSettings, "slurmQueue" | "slurmCores" | "slurmMemory" | "slurmTimeLimit" | "slurmOptions">;
  sandbox?: RunSandbox | null;
  /** Wall-clock limit for local runs in hours; 0 or undefined means none. */
  timeLimitHours?: number;
}

/** The inner script runs the analysis; it is what the sandbox executes. */
export const INNER_SCRIPT = "control/analysis.sh";

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

/**
 * The inner script: activates the environment and runs the analysis. It is
 * started by the wrapper inside the sandbox with an allowlisted environment,
 * so it sets everything it needs itself.
 */
export function generateInnerScript(options: RunScriptOptions): string {
  assertSafeRunFolder(options.runFolder);
  const interpreter = options.language === "r" ? "Rscript" : "python";
  return [
    "#!/bin/bash",
    "set -euo pipefail",
    `RUN_DIR=${shellQuote(options.runFolder)}`,
    `ENV_PREFIX=${shellQuote(options.environmentPrefix)}`,
    `HELPER_LIB=${shellQuote(options.helperLibDir)}`,
    'cd "$RUN_DIR"',
    "# The environment is a conda prefix: its binaries are used directly, so no",
    "# conda installation is needed where the analysis runs.",
    'export PATH="$ENV_PREFIX/bin:${PATH:-/usr/bin:/bin}"',
    'export PYTHONPATH="$HELPER_LIB/python${PYTHONPATH:+:$PYTHONPATH}"',
    'export R_LIBS_USER="$HELPER_LIB/r${R_LIBS_USER:+:$R_LIBS_USER}"',
    'export SEQDESK_EXPLORE_RUN_DIR="$RUN_DIR"',
    'export HOME="$RUN_DIR/home"',
    'export TMPDIR="$RUN_DIR/tmp"',
    'mkdir -p "$HOME" "$TMPDIR"',
    "export MPLBACKEND=Agg",
    "export PYTHONUNBUFFERED=1",
    "export PYTHONDONTWRITEBYTECODE=1",
    `if ! command -v ${interpreter} >/dev/null 2>&1; then`,
    `  echo "ERROR: ${interpreter} not found in $ENV_PREFIX/bin" >&2`,
    "  exit 1",
    "fi",
    `echo "Using ${interpreter}: $(command -v ${interpreter})"`,
    `exec ${interpreter} ${shellQuote(options.entrypoint)} --run-dir "$RUN_DIR"`,
    "",
  ].join("\n");
}

function sandboxLines(options: RunScriptOptions): string[] {
  const sandbox = options.sandbox ?? { kind: "none", mode: "off", reason: "sandboxing is switched off" };
  const inner = `"$RUN_DIR/${INNER_SCRIPT}"`;
  // Nothing of the server's environment reaches the analysis: the inner
  // script rebuilds what it needs from these few variables.
  const cleanEnv = 'env -i PATH="/usr/bin:/bin" LANG="${LANG:-C.UTF-8}" LC_ALL="${LC_ALL:-C.UTF-8}"';
  const limit = options.timeLimitHours && options.timeLimitHours > 0 ? Math.floor(options.timeLimitHours) : 0;
  const lines: string[] = [];
  lines.push("# A time limit when the host has GNU timeout (SLURM enforces its own).");
  lines.push('LIMIT=""');
  if (limit > 0) {
    // The absolute path: the limit runs under the emptied PATH of the analysis.
    lines.push(`if [ -z "\${SLURM_JOB_ID:-}" ] && command -v timeout >/dev/null 2>&1; then LIMIT="$(command -v timeout) --signal=TERM --kill-after=60 ${limit}h"; fi`);
  }
  const plain = `${cleanEnv} $LIMIT /bin/bash ${inner} >> "$STDOUT_LOG" 2>> "$STDERR_LOG"`;
  if (sandbox.kind === "bubblewrap") {
    const args = sandbox.args.map(shellQuote).join(" \\\n    ");
    lines.push('BWRAP="$(command -v bwrap 2>/dev/null || true)"');
    lines.push('if [ -n "$BWRAP" ]; then');
    lines.push(`  echo "Sandbox: bubblewrap (plan ${sandbox.planHash})" >> "$STDOUT_LOG"`);
    lines.push(`  ${cleanEnv} $LIMIT "$BWRAP" \\\n    ${args} \\\n    -- /bin/bash ${inner} >> "$STDOUT_LOG" 2>> "$STDERR_LOG"`);
    if (sandbox.mode === "required") {
      lines.push("else");
      lines.push('  echo "Sandbox: refused (bubblewrap is required but not installed on $(hostname))" >> "$STDOUT_LOG"');
      lines.push('  echo "ERROR: bubblewrap (bwrap) is required for analysis runs but is not installed on $(hostname)." >> "$STDERR_LOG"');
      lines.push("  exit 127");
    } else {
      lines.push("else");
      lines.push('  echo "Sandbox: none (bubblewrap not installed on $(hostname))" >> "$STDOUT_LOG"');
      lines.push(`  ${plain}`);
    }
    lines.push("fi");
  } else if (sandbox.kind === "seatbelt") {
    lines.push("if command -v sandbox-exec >/dev/null 2>&1; then");
    lines.push(`  echo "Sandbox: seatbelt (plan ${sandbox.planHash})" >> "$STDOUT_LOG"`);
    lines.push(`  ${cleanEnv} $LIMIT sandbox-exec -f ${shellQuote(sandbox.profilePath)} /bin/bash ${inner} >> "$STDOUT_LOG" 2>> "$STDERR_LOG"`);
    if (sandbox.mode === "required") {
      lines.push("else");
      lines.push('  echo "Sandbox: refused (sandbox-exec is required but not available)" >> "$STDOUT_LOG"');
      lines.push('  echo "ERROR: sandbox-exec is required for analysis runs but is not available." >> "$STDERR_LOG"');
      lines.push("  exit 127");
    } else {
      lines.push("else");
      lines.push('  echo "Sandbox: none (sandbox-exec not available)" >> "$STDOUT_LOG"');
      lines.push(`  ${plain}`);
    }
    lines.push("fi");
  } else if (sandbox.mode === "required") {
    lines.push(`echo "Sandbox: refused (${sandbox.reason.replace(/["$`\\]/g, "")})" >> "$STDOUT_LOG"`);
    lines.push(`echo "ERROR: a sandbox is required for analysis runs: ${sandbox.reason.replace(/["$`\\]/g, "")}" >> "$STDERR_LOG"`);
    lines.push("exit 127");
  } else {
    lines.push(`echo "Sandbox: none (${sandbox.reason.replace(/["$`\\]/g, "")})" >> "$STDOUT_LOG"`);
    lines.push(plain);
  }
  return lines;
}

/** Body shared by the local and the SLURM wrapper: log, then run the inner script confined. */
function buildBody(options: RunScriptOptions): string {
  return [
    `RUN_DIR=${shellQuote(options.runFolder)}`,
    'STDOUT_LOG="$RUN_DIR/logs/pipeline.out"',
    'STDERR_LOG="$RUN_DIR/logs/pipeline.err"',
    'mkdir -p "$RUN_DIR/logs" "$RUN_DIR/outputs" "$RUN_DIR/home" "$RUN_DIR/tmp"',
    "",
    "# Always record the real exit code for the monitor, even under set -e.",
    `trap 'EXIT_CODE=$?; echo "Pipeline completed with exit code: $EXIT_CODE at $(date)" >> "$STDOUT_LOG"; exit $EXIT_CODE' EXIT`,
    "",
    'echo "Starting Explore analysis at $(date) on $(hostname)" > "$STDOUT_LOG"',
    ': > "$STDERR_LOG"',
    'cd "$RUN_DIR"',
    ...sandboxLines(options),
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
