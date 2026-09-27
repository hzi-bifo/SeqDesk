/**
 * Per-run resource caps (CPU, memory, processes) for local runs, applied
 * without root. The wrapper decides at run time, on the machine that runs
 * the step, which mechanism it can use:
 *
 * 1. Linux with a user systemd and cgroup v2 delegation: the run goes into a
 *    transient scope (`systemd-run --user --scope -p MemoryMax= -p TasksMax=
 *    -p CPUQuota=`). The kernel enforces the caps for the whole process
 *    tree, bubblewrap's user namespace included. CPUQuota needs the cpu
 *    controller delegated; many distributions delegate only memory and pids.
 * 2. Linux without it: `prlimit` rlimits (address space per process, and a
 *    process count for the user).
 * 3. Elsewhere (macOS): `ulimit` in a shell in front of the sandbox, for what
 *    the platform accepts (macOS ignores an address-space limit).
 *
 * SLURM runs keep the scheduler's own limits. The wrapper logs a
 * `Limits: …` line and writes control/limits.json; after a failure it
 * turns a limit hit into a plain sentence in the error log.
 */
import type { RunResourceLimits } from "./settings";

export type LimitMechanism = "systemd" | "prlimit" | "ulimit" | "slurm" | "none";

export interface RunLimitsRecord extends RunResourceLimits {
  /** The mechanism the wrapper used, and which caps it really enforced. */
  mechanism: LimitMechanism;
  enforced: Array<"memory" | "cpu" | "pids">;
  /** Why a cap could not be applied (e.g. the cpu controller is not delegated). */
  notes?: string[];
}

export function formatMemory(memoryGb: number): string {
  return `${memoryGb} GB`;
}

/** The unit name must be unique and systemd-safe. Pure. */
export function limitUnitName(runId: string): string {
  return `seqdesk-run-${runId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "run"}`;
}

/**
 * The systemd-run argv for the given caps and delegated controllers. Pure;
 * the wrapper renders the same decisions in shell.
 */
export function systemdRunArgs(limits: RunResourceLimits, controllers: string[], unit: string): { args: string[]; enforced: RunLimitsRecord["enforced"]; notes: string[] } {
  const args = ["systemd-run", "--user", "--scope", "--quiet", `--unit=${unit}`];
  const enforced: RunLimitsRecord["enforced"] = [];
  const notes: string[] = [];
  if (limits.memoryGb > 0) {
    if (controllers.includes("memory")) {
      args.push("-p", `MemoryMax=${limits.memoryGb}G`, "-p", "MemorySwapMax=0");
      enforced.push("memory");
    } else notes.push("memory: the memory controller is not delegated to the user");
  }
  if (limits.cores > 0) {
    if (controllers.includes("cpu")) {
      args.push("-p", `CPUQuota=${limits.cores * 100}%`);
      enforced.push("cpu");
    } else notes.push("cpu: the cpu controller is not delegated to the user");
  }
  if (limits.pids > 0) {
    if (controllers.includes("pids")) {
      args.push("-p", `TasksMax=${limits.pids}`);
      enforced.push("pids");
    } else notes.push("pids: the pids controller is not delegated to the user");
  }
  args.push("--");
  return { args, enforced, notes };
}

/** The prlimit fallback: address space per process and a process count on top of what the user already runs. Pure. */
export function prlimitArgs(limits: RunResourceLimits, userProcesses: number): { args: string[]; enforced: RunLimitsRecord["enforced"] } {
  const args = ["prlimit"];
  const enforced: RunLimitsRecord["enforced"] = [];
  if (limits.memoryGb > 0) {
    args.push(`--as=${limits.memoryGb * 1024 * 1024 * 1024}`);
    enforced.push("memory");
  }
  if (limits.pids > 0) {
    args.push(`--nproc=${userProcesses + limits.pids}`);
    enforced.push("pids");
  }
  args.push("--");
  return { args, enforced };
}

/**
 * Wrapper lines that pick the mechanism and fill the RLIM array (a command
 * prefix). Expects RUN_DIR, STDOUT_LOG and STDERR_LOG; defines
 * `seqdesk_explain_limits STATUS`, which writes a sentence when a cap
 * stopped the step. Works under bash 3.2 (macOS) with `set -u`.
 */
export function resourceLimitLines(limits: RunResourceLimits | null | undefined, runId: string): string[] {
  const caps = limits ?? { cores: 0, memoryGb: 0, pids: 0 };
  const memGb = Math.max(0, Math.floor(caps.memoryGb));
  const cores = Math.max(0, Math.floor(caps.cores));
  const pids = Math.max(0, Math.floor(caps.pids));
  const unit = limitUnitName(runId);
  const memLabel = formatMemory(memGb);
  return [
    "# Resource caps for local runs (SLURM enforces its own).",
    `LIMIT_CORES=${cores}; LIMIT_MEM_GB=${memGb}; LIMIT_PIDS=${pids}`,
    'RLIM=(); LIMITS_USED="none"; LIMITS_ENFORCED=""; LIMITS_NOTES=""; LIMIT_UNIT=""',
    'if [ -n "${SLURM_JOB_ID:-}" ]; then',
    '  LIMITS_USED="slurm"',
    'elif [ "$LIMIT_CORES$LIMIT_MEM_GB$LIMIT_PIDS" = "000" ]; then',
    '  LIMITS_USED="none"',
    'elif [ "$(uname -s)" = "Linux" ]; then',
    '  SEQDESK_UID="$(id -u)"',
    '  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$SEQDESK_UID}"',
    '  CG_CTRL="$(cat "/sys/fs/cgroup/user.slice/user-$SEQDESK_UID.slice/user@$SEQDESK_UID.service/cgroup.subtree_control" 2>/dev/null || true)"',
    '  if [ -n "$CG_CTRL" ] && command -v systemd-run >/dev/null 2>&1 && systemd-run --user --scope --quiet --collect -p TasksMax=16 true >/dev/null 2>&1; then',
    `    LIMIT_UNIT="${unit}-$$"`,
    '    RLIM=(systemd-run --user --scope --quiet "--unit=$LIMIT_UNIT")',
    '    LIMITS_USED="systemd"',
    '    case " $CG_CTRL " in *" memory "*) if [ "$LIMIT_MEM_GB" -gt 0 ]; then RLIM+=(-p "MemoryMax=${LIMIT_MEM_GB}G" -p MemorySwapMax=0); LIMITS_ENFORCED="$LIMITS_ENFORCED memory"; fi ;; *) [ "$LIMIT_MEM_GB" -gt 0 ] && LIMITS_NOTES="$LIMITS_NOTES|memory: the memory controller is not delegated to the user" ;; esac',
    '    case " $CG_CTRL " in *" cpu "*) if [ "$LIMIT_CORES" -gt 0 ]; then RLIM+=(-p "CPUQuota=$((LIMIT_CORES * 100))%"); LIMITS_ENFORCED="$LIMITS_ENFORCED cpu"; fi ;; *) [ "$LIMIT_CORES" -gt 0 ] && LIMITS_NOTES="$LIMITS_NOTES|cpu: the cpu controller is not delegated to the user" ;; esac',
    '    case " $CG_CTRL " in *" pids "*) if [ "$LIMIT_PIDS" -gt 0 ]; then RLIM+=(-p "TasksMax=$LIMIT_PIDS"); LIMITS_ENFORCED="$LIMITS_ENFORCED pids"; fi ;; *) [ "$LIMIT_PIDS" -gt 0 ] && LIMITS_NOTES="$LIMITS_NOTES|pids: the pids controller is not delegated to the user" ;; esac',
    '    RLIM+=(--)',
    '  elif command -v prlimit >/dev/null 2>&1; then',
    '    RLIM=(prlimit)',
    '    LIMITS_USED="prlimit"',
    '    if [ "$LIMIT_MEM_GB" -gt 0 ]; then RLIM+=("--as=$((LIMIT_MEM_GB * 1024 * 1024 * 1024))"); LIMITS_ENFORCED="$LIMITS_ENFORCED memory"; fi',
    '    # RLIMIT_NPROC counts every process of the user: the cap sits on top of what already runs.',
    '    if [ "$LIMIT_PIDS" -gt 0 ]; then RLIM+=("--nproc=$(( $(ps -L -u "$SEQDESK_UID" -o lwp= 2>/dev/null | wc -l) + LIMIT_PIDS ))"); LIMITS_ENFORCED="$LIMITS_ENFORCED pids"; fi',
    '    [ "$LIMIT_CORES" -gt 0 ] && LIMITS_NOTES="$LIMITS_NOTES|cpu: no user cgroup delegation, cores are not capped"',
    '    RLIM+=(--)',
    '  fi',
    'fi',
    'if [ "$LIMITS_USED" = "none" ] && [ -z "${SLURM_JOB_ID:-}" ] && [ "$LIMIT_CORES$LIMIT_MEM_GB$LIMIT_PIDS" != "000" ]; then',
    '  # ulimit in a shell in front of the sandbox, for what the platform accepts.',
    '  ULIM=""',
    '  if [ "$LIMIT_MEM_GB" -gt 0 ] && ( ulimit -S -v $((LIMIT_MEM_GB * 1024 * 1024)) ) 2>/dev/null; then ULIM="ulimit -S -v $((LIMIT_MEM_GB * 1024 * 1024)); "; LIMITS_ENFORCED="$LIMITS_ENFORCED memory"; elif [ "$LIMIT_MEM_GB" -gt 0 ]; then LIMITS_NOTES="$LIMITS_NOTES|memory: this platform does not limit address space"; fi',
    '  if [ "$LIMIT_PIDS" -gt 0 ]; then',
    '    NPROC_CAP=$(( $(ps -u "$(id -u)" -o pid= 2>/dev/null | wc -l) + LIMIT_PIDS ))',
    '    if ( ulimit -S -u "$NPROC_CAP" ) 2>/dev/null; then ULIM="${ULIM}ulimit -S -u $NPROC_CAP; "; LIMITS_ENFORCED="$LIMITS_ENFORCED pids"; fi',
    '  fi',
    '  [ "$LIMIT_CORES" -gt 0 ] && LIMITS_NOTES="$LIMITS_NOTES|cpu: cores are not capped on this platform"',
    '  if [ -n "$ULIM" ]; then RLIM=(/bin/bash -c "${ULIM}exec \\"\\$@\\"" seqdesk-limits); LIMITS_USED="ulimit"; fi',
    'fi',
    'LIMITS_ENFORCED="${LIMITS_ENFORCED# }"',
    `echo "Limits: $LIMITS_USED (cores ${cores}, memory ${memLabel}, processes ${pids}; enforced: \${LIMITS_ENFORCED:-nothing})" >> "$STDOUT_LOG"`,
    '{',
    '  printf \'{"mechanism":"%s","cores":%s,"memoryGb":%s,"pids":%s,"enforced":[\' "$LIMITS_USED" "$LIMIT_CORES" "$LIMIT_MEM_GB" "$LIMIT_PIDS"',
    '  SEP=""; for CAP in $LIMITS_ENFORCED; do printf \'%s"%s"\' "$SEP" "$CAP"; SEP=","; done',
    '  printf \'],"notes":[\'',
    '  SEP=""; OLD_IFS="$IFS"; IFS="|"; for NOTE in $LIMITS_NOTES; do [ -n "$NOTE" ] && printf \'%s"%s"\' "$SEP" "$NOTE" && SEP=","; done; IFS="$OLD_IFS"',
    "  printf ']}\\n'",
    '} > "$RUN_DIR/control/limits.json" 2>/dev/null || true',
    "seqdesk_explain_limits() {",
    '  local status="$1" hit="" result=""',
    '  if [ -n "$LIMIT_UNIT" ]; then',
    '    result="$(systemctl --user show -p Result --value "$LIMIT_UNIT.scope" 2>/dev/null || true)"',
    '    systemctl --user reset-failed "$LIMIT_UNIT.scope" >/dev/null 2>&1 || true',
    "  fi",
    '  [ "$status" -eq 0 ] && return 0',
    '  case " $LIMITS_ENFORCED " in *" memory "*)',
    '    if [ "$result" = "oom-kill" ] || { [ "$LIMITS_USED" = "systemd" ] && [ "$status" -eq 137 ]; } || grep -qE "MemoryError|[Cc]annot allocate (memory|vector)|std::bad_alloc|memory exhausted|Out of memory" "$STDERR_LOG" 2>/dev/null; then hit="memory"; fi ;;',
    "  esac",
    '  if [ -z "$hit" ]; then case " $LIMITS_ENFORCED " in *" pids "*)',
    `    if grep -qE "fork: (retry: )?Resource temporarily unavailable|Cannot fork|can't start new thread|Resource temporarily unavailable" "$STDERR_LOG" 2>/dev/null; then hit="pids"; fi ;;`,
    "  esac; fi",
    `  if [ "$hit" = "memory" ]; then echo "ERROR: memory limit (${memLabel}) reached: the step used more memory than a run may and was stopped. A facility admin can raise the limit under Analysis environments." >> "$STDERR_LOG"; fi`,
    `  if [ "$hit" = "pids" ]; then echo "ERROR: process limit (${pids}) reached: the step started more processes or threads than a run may. A facility admin can raise the limit under Analysis environments." >> "$STDERR_LOG"; fi`,
    "  return 0",
    "}",
  ];
}

/** What the wrapper reported: the `Limits: …` line of the run log. */
export function limitsFromLog(log: string | null | undefined): { mechanism: LimitMechanism; detail: string } | null {
  if (!log) return null;
  const match = log.match(/^Limits: (systemd|prlimit|ulimit|slurm|none)(?: \((.*)\))?$/m);
  return match ? { mechanism: match[1] as LimitMechanism, detail: match[2] ?? "" } : null;
}
