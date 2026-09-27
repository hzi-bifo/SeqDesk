/**
 * Red-team probe for one Explore run's sandbox. Starts a shell inside the
 * run's own sandbox (bubblewrap on Linux from control/mount-plan.json,
 * sandbox-exec on macOS from control/sandbox.sb) and checks that it can do
 * what an analysis needs and nothing more. Exits 1 when a probe that must be
 * blocked was allowed. The probes live in src/lib/explore/sandbox/probe.ts;
 * the admin "Test the sandbox" button runs the same set on a throwaway run.
 *
 *   npm run explore:sandbox-probe -- <run folder> [--other <another run folder>] [--app <app dir>] [--tables <datasets root>]
 */
import fs from "node:fs";
import path from "node:path";
import type { MountPlan } from "../src/lib/explore/sandbox/mount-plan";
import { runSandboxProbes } from "../src/lib/explore/sandbox/probe";

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

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.run) {
    console.error("usage: explore-sandbox-probe <run folder> [--other <run folder>] [--app <dir>] [--tables <dir>]");
    return 2;
  }
  const run = path.resolve(options.run);
  const plan = JSON.parse(fs.readFileSync(path.join(run, "control", "mount-plan.json"), "utf8")) as MountPlan;
  const runsRoot = path.dirname(run);
  const other = options.other ? path.resolve(options.other) : fs.readdirSync(runsRoot).map((entry) => path.join(runsRoot, entry)).find((entry) => entry !== run && fs.existsSync(path.join(entry, "inputs.json")));
  console.log(`Probing ${run}\n  plan ${plan.platform}, network ${plan.network}\n`);
  const results = await runSandboxProbes({ run, plan, app: options.app ? path.resolve(options.app) : process.cwd(), other, tables: options.tables ? path.resolve(options.tables) : null });
  let failures = 0;
  for (const result of results) {
    if (!result.ok) failures += 1;
    console.log(`${result.ok ? "ok  " : "FAIL"} ${result.name.padEnd(40)} ${result.outcome === "allowed" ? "ALLOWED" : "blocked"}${result.ok ? "" : ` (expected ${result.expect})`}`);
    if (result.detail) console.log(`     ${result.detail}`);
  }
  console.log(failures === 0 ? "\nAll probes behaved as expected." : `\n${failures} probe(s) did not behave as expected.`);
  return failures === 0 ? 0 : 1;
}

main().then((code) => process.exit(code), (error) => { console.error(error); process.exit(2); });
