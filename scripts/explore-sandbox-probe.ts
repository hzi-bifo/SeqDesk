/**
 * Red-team probe for one Explore run's sandbox. Starts a shell inside the
 * run's own sandbox (bubblewrap on Linux from control/mount-plan.json,
 * sandbox-exec on macOS from control/sandbox.sb) and checks that it can do
 * what an analysis needs and nothing more. Exits 1 when a probe that must be
 * blocked was allowed.
 *
 *   npm run explore:sandbox-probe -- <run folder> [--other <another run folder>] [--app <app dir>] [--tables <datasets root>]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderBwrapArgs, type MountPlan } from "../src/lib/explore/sandbox/mount-plan";

interface Probe {
  name: string;
  command: string;
  expect: "allowed" | "blocked";
}

function parseArgs(argv: string[]) {
  const options: { run?: string; other?: string; app?: string; tables?: string } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--other") options.other = argv[++index];
    else if (arg === "--app") options.app = argv[++index];
    else if (arg === "--tables") options.tables = argv[++index];
    else if (!options.run) options.run = arg;
  }
  return options;
}

function main(): number {
  const options = parseArgs(process.argv.slice(2));
  if (!options.run) {
    console.error("usage: explore-sandbox-probe <run folder> [--other <run folder>] [--app <dir>] [--tables <dir>]");
    return 2;
  }
  const run = path.resolve(options.run);
  const plan = JSON.parse(fs.readFileSync(path.join(run, "control", "mount-plan.json"), "utf8")) as MountPlan;
  const app = options.app ? path.resolve(options.app) : process.cwd();
  const runsRoot = path.dirname(run);
  const other = options.other ? path.resolve(options.other) : fs.readdirSync(runsRoot).map((entry) => path.join(runsRoot, entry)).find((entry) => entry !== run && fs.existsSync(path.join(entry, "inputs.json")));
  const home = os.homedir();
  const truth = process.platform === "darwin" ? "/usr/bin/true" : "/bin/true";

  const probes: Probe[] = [
    { name: "read own inputs", command: `cat '${run}/inputs.json'`, expect: "allowed" },
    { name: "write own outputs", command: `echo x > '${run}/outputs/.probe' && rm '${run}/outputs/.probe'`, expect: "allowed" },
    { name: "write own tmp", command: `echo x > '${run}/tmp/.probe' && rm '${run}/tmp/.probe'`, expect: "allowed" },
    { name: "read the inner script", command: `cat '${run}/control/analysis.sh'`, expect: "allowed" },
    { name: "read the run log", command: `cat '${run}/logs/pipeline.out'`, expect: "allowed" },
    { name: "run the environment's interpreter", command: `'${plan.binds.find((bind) => bind.purpose === "environment")?.dst}/bin/python' -c 'print(1)' || '${plan.binds.find((bind) => bind.purpose === "environment")?.dst}/bin/Rscript' -e '1'`, expect: "allowed" },
    { name: "spawn processes", command: `for i in 1 2 3; do ${truth}; done`, expect: "allowed" },
    { name: "read the plan files", command: `cat '${run}/control/mount-plan.json'`, expect: "blocked" },
    { name: "rewrite the isolation record", command: `echo x > '${run}/control/isolation.json'`, expect: "blocked" },
    { name: "append to the run log by path", command: `echo fake >> '${run}/logs/pipeline.out'`, expect: "blocked" },
    { name: "write the shared /tmp", command: `echo x > /tmp/.seqdesk-probe-$$ && rm /tmp/.seqdesk-probe-$$`, expect: "blocked" },
    { name: "read a file in the home directory", command: `f=$(ls -a '${home}' | while read -r n; do [ -f "${home}/$n" ] && echo "$n" && break; done); test -n "$f" && cat "${home}/$f" > /dev/null`, expect: "blocked" },
    // The ancestors of the run folder stay listable (getcwd walks them), so the
    // home listing is hidden only when runs live outside the home directory.
    ...(run.startsWith(`${home}/`) ? [] : [{ name: "list the home directory", command: `ls -a '${home}' | grep -v '^\\.\\?$' | head -1 | grep .`, expect: "blocked" as const }]),
    { name: "read the application's .env", command: `cat '${app}/.env' || cat '${app}/package.json'`, expect: "blocked" },
    { name: "reach localhost", command: `curl -s -m 3 http://127.0.0.1:3000/ || python3 -c "import socket;socket.create_connection(('127.0.0.1',5432),2)"`, expect: "blocked" },
    { name: "reach the internet", command: `curl -s -m 5 https://example.com/`, expect: "blocked" },
  ];
  if (other) probes.push({ name: "read another run", command: `cat '${other}/inputs.json'`, expect: "blocked" });
  if (options.tables) probes.push({ name: "list the tables storage", command: `ls '${options.tables}'`, expect: "blocked" });
  if (process.platform === "darwin") {
    probes.push({ name: "read a home file through the firmlink path", command: `f=$(ls -a '${home}' | while read -r n; do [ -f "${home}/$n" ] && echo "$n" && break; done); test -n "$f" && cat "/System/Volumes/Data${home}/$f" > /dev/null`, expect: "blocked" });
    probes.push({ name: "read a home file through Finder (Apple Events)", command: `osascript -e 'tell application "Finder" to get name of every item of (POSIX file "${home}" as alias)' | grep .`, expect: "blocked" });
    probes.push({ name: "hard-link a home file into the run", command: `ln '${home}/.gitconfig' '${run}/tmp/.hl' && cat '${run}/tmp/.hl'`, expect: "blocked" });
  } else {
    probes.push({ name: "see other processes", command: `test "$(ps -e | wc -l)" -gt 8`, expect: "blocked" });
  }

  const inside = (command: string) => {
    const env = { PATH: "/usr/bin:/bin", HOME: path.join(run, "home"), TMPDIR: path.join(run, "tmp") } as unknown as NodeJS.ProcessEnv;
    if (process.platform === "darwin") {
      return spawnSync("/usr/bin/sandbox-exec", ["-f", path.join(run, "control", "sandbox.sb"), "/bin/bash", "-c", command], { env, encoding: "utf8", timeout: 30_000 });
    }
    return spawnSync("bwrap", [...renderBwrapArgs(plan), "--", "/bin/bash", "-c", command], { env, encoding: "utf8", timeout: 30_000 });
  };

  let failures = 0;
  console.log(`Probing ${run}\n  plan ${plan.platform}, network ${plan.network}\n`);
  for (const probe of probes) {
    const result = inside(probe.command);
    const allowed = result.status === 0;
    const verdict = allowed ? "ALLOWED" : "blocked";
    const ok = (probe.expect === "allowed") === allowed;
    if (!ok) failures += 1;
    console.log(`${ok ? "ok  " : "FAIL"} ${probe.name.padEnd(40)} ${verdict}${ok ? "" : ` (expected ${probe.expect})`}`);
    if (!ok && result.stderr) console.log(`     ${result.stderr.trim().split("\n").slice(-1)[0]}`);
  }
  console.log(failures === 0 ? "\nAll probes behaved as expected." : `\n${failures} probe(s) did not behave as expected.`);
  return failures === 0 ? 0 : 1;
}

process.exit(main());
