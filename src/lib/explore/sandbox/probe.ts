/**
 * Isolation probes: shell commands started inside a run's sandbox that check
 * it can do what an analysis needs and nothing more. Used by the
 * `explore:sandbox-probe` script (against a real run folder) and by the admin
 * "Test the sandbox" button (against a throwaway probe run).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderBwrapArgs, type MountPlan } from "./mount-plan";

export interface SandboxProbe {
  name: string;
  command: string;
  expect: "allowed" | "blocked";
}

export interface SandboxProbeResult extends SandboxProbe {
  outcome: "allowed" | "blocked";
  ok: boolean;
  detail?: string;
}

export interface SandboxProbeOptions {
  run: string;
  plan: MountPlan;
  /** The application directory (its .env must stay unreadable). */
  app: string;
  /** Another run folder, which must stay unreadable. */
  other?: string | null;
  /** The datasets root, which must stay unlistable. */
  tables?: string | null;
  /** Skip the interpreter probe when the run has no built environment. */
  skipInterpreter?: boolean;
}

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** The probes for one run folder and plan. Pure apart from reading the home directory's name. */
export function sandboxProbes(options: SandboxProbeOptions): SandboxProbe[] {
  const { run, plan, app } = options;
  const home = os.homedir();
  const truth = plan.platform === "darwin" ? "/usr/bin/true" : "/bin/true";
  const envDst = plan.binds.find((bind) => bind.purpose === "environment")?.dst;
  // With network "host" the sandbox deliberately allows the network; the probes follow the setting.
  const network: SandboxProbe["expect"] = plan.network === "host" ? "allowed" : "blocked";
  const probes: SandboxProbe[] = [
    { name: "read own inputs", command: `cat ${quote(`${run}/inputs.json`)}`, expect: "allowed" },
    { name: "write own outputs", command: `echo x > ${quote(`${run}/outputs/.probe`)} && rm ${quote(`${run}/outputs/.probe`)}`, expect: "allowed" },
    { name: "write own tmp", command: `echo x > ${quote(`${run}/tmp/.probe`)} && rm ${quote(`${run}/tmp/.probe`)}`, expect: "allowed" },
    { name: "read the inner script", command: `cat ${quote(`${run}/control/analysis.sh`)}`, expect: "allowed" },
    { name: "read the run log", command: `cat ${quote(`${run}/logs/pipeline.out`)}`, expect: "allowed" },
    ...(options.skipInterpreter || !envDst ? [] : [{ name: "run the environment's interpreter", command: `${quote(`${envDst}/bin/python`)} -c 'print(1)' || ${quote(`${envDst}/bin/Rscript`)} -e '1'`, expect: "allowed" as const }]),
    { name: "spawn processes", command: `for i in 1 2 3; do ${truth}; done`, expect: "allowed" },
    { name: "read the plan files", command: `cat ${quote(`${run}/control/mount-plan.json`)}`, expect: "blocked" },
    { name: "rewrite the isolation record", command: `echo x > ${quote(`${run}/control/isolation.json`)}`, expect: "blocked" },
    { name: "append to the run log by path", command: `echo fake >> ${quote(`${run}/logs/pipeline.out`)}`, expect: "blocked" },
    { name: "write the shared /tmp", command: `echo x > /tmp/.seqdesk-probe-$$ && rm /tmp/.seqdesk-probe-$$`, expect: "blocked" },
    { name: "read a file in the home directory", command: `f=$(ls -a ${quote(home)} | while read -r n; do [ -f ${quote(home)}/"$n" ] && echo "$n" && break; done); test -n "$f" && cat ${quote(home)}/"$f" > /dev/null`, expect: "blocked" },
    // The ancestors of the run folder stay listable (getcwd walks them), so the
    // home listing is hidden only when runs live outside the home directory.
    ...(run.startsWith(`${home}/`) ? [] : [{ name: "list the home directory", command: `ls -a ${quote(home)} | grep -v '^\\.\\?$' | head -1 | grep .`, expect: "blocked" as const }]),
    { name: "read the application's .env", command: `cat ${quote(`${app}/.env`)} || cat ${quote(`${app}/package.json`)}`, expect: "blocked" },
    { name: "reach localhost", command: `curl -s -m 3 http://127.0.0.1:3000/ || python3 -c "import socket;socket.create_connection(('127.0.0.1',5432),2)"`, expect: network },
    { name: "reach the internet", command: `curl -s -m 5 -o /dev/null https://example.com/`, expect: network },
  ];
  // "reach localhost" can fail on an open network when nothing listens; only check it when it must be blocked.
  if (network === "allowed") probes.splice(probes.findIndex((probe) => probe.name === "reach localhost"), 1);
  if (options.other) probes.push({ name: "read another run", command: `cat ${quote(`${options.other}/inputs.json`)}`, expect: "blocked" });
  if (options.tables) probes.push({ name: "list the tables storage", command: `ls ${quote(options.tables)}`, expect: "blocked" });
  if (plan.platform === "darwin") {
    probes.push({ name: "read a home file through the firmlink path", command: `f=$(ls -a ${quote(home)} | while read -r n; do [ -f ${quote(home)}/"$n" ] && echo "$n" && break; done); test -n "$f" && cat "/System/Volumes/Data${home}/$f" > /dev/null`, expect: "blocked" });
    probes.push({ name: "hard-link a home file into the run", command: `ln ${quote(`${home}/.gitconfig`)} ${quote(`${run}/tmp/.hl`)} && cat ${quote(`${run}/tmp/.hl`)}`, expect: "blocked" });
  } else {
    probes.push({ name: "see other processes", command: `test "$(ps -e | wc -l)" -gt 8`, expect: "blocked" });
  }
  return probes;
}

function runInside(run: string, plan: MountPlan, command: string, bwrap: string): Promise<{ status: number | null; stderr: string }> {
  const env = { PATH: "/usr/bin:/bin", HOME: path.join(run, "home"), TMPDIR: path.join(run, "tmp") } as unknown as NodeJS.ProcessEnv;
  const file: string = plan.platform === "darwin" ? "/usr/bin/sandbox-exec" : bwrap;
  const args: string[] = plan.platform === "darwin"
    ? ["-f", path.join(run, "control", "sandbox.sb"), "/bin/bash", "-c", command]
    : [...renderBwrapArgs(plan), "--", "/bin/bash", "-c", command];
  return new Promise((resolve) => {
    const child = spawn(file, args, { env, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { if (stderr.length < 4000) stderr += String(chunk); });
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.on("error", (error: Error) => { clearTimeout(timer); resolve({ status: null, stderr: error.message }); });
    child.on("close", (status: number | null) => { clearTimeout(timer); resolve({ status, stderr }); });
  });
}

/** Run every probe inside the sandbox and compare with what is expected. */
export async function runSandboxProbes(options: SandboxProbeOptions & { bwrap?: string }): Promise<SandboxProbeResult[]> {
  const results: SandboxProbeResult[] = [];
  for (const probe of sandboxProbes(options)) {
    const result = await runInside(options.run, options.plan, probe.command, options.bwrap ?? "bwrap");
    const outcome = result.status === 0 ? "allowed" : "blocked";
    const ok = outcome === probe.expect;
    const detail = !ok && result.stderr.trim() ? result.stderr.trim().split("\n").slice(-1)[0] : undefined;
    results.push({ ...probe, outcome, ok, ...(detail ? { detail } : {}) });
  }
  return results;
}

/** Lay out a throwaway run folder shaped like a real one (inputs, outputs, tmp, home, logs, control). */
export function createProbeRunFolder(folder: string): void {
  for (const sub of ["outputs", "tmp", "home", "logs", "control", "inputs"]) fs.mkdirSync(path.join(folder, sub), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(folder, "inputs.json"), "{}\n");
  fs.writeFileSync(path.join(folder, "logs", "pipeline.out"), "sandbox probe\n");
  fs.writeFileSync(path.join(folder, "control", "analysis.sh"), "#!/bin/bash\ntrue\n", { mode: 0o755 });
}
