/**
 * Bring an analysis up to date with its template: the template's current code
 * becomes a new version of the analysis, keeping its inputs and parameters,
 * optionally followed by a run.
 *
 *   npx tsx scripts/explore-update-from-template.ts --analysis <analysisId> --user <userId> [--run] [--mode local|slurm]
 *
 * DATABASE_URL must point at the SeqDesk database.
 */
import { db } from "../src/lib/db";
import { createRevision } from "../src/lib/explore/analyses";
import { getKit } from "../src/lib/explore/kits/loader";
import { createAndStartRun } from "../src/lib/explore/runner";

function readArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      args[token.slice(2)] = "true";
    } else {
      args[token.slice(2)] = next;
      index += 1;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2));
  if (!args.analysis || !args.user) throw new Error("--analysis <analysisId> and --user <userId> are required");
  const analysis = await db.exploreAnalysis.findUnique({ where: { id: args.analysis }, select: { id: true, name: true, kitId: true } });
  if (!analysis) throw new Error(`No analysis with id ${args.analysis}`);
  if (!analysis.kitId) throw new Error(`${analysis.name} was not created from a template`);
  const kit = await getKit(analysis.kitId);
  if (!kit) throw new Error(`Template ${analysis.kitId} is not installed`);
  const revision = await createRevision({
    analysisId: analysis.id,
    code: kit.code,
    author: "user",
    authorUserId: args.user,
    message: `Updated from template ${kit.manifest.id}${kit.manifest.version ? ` ${kit.manifest.version}` : ""}`,
  });
  console.log(`${analysis.name}: version ${revision.number} from template ${kit.manifest.id}`);
  if (args.run) {
    const mode = args.mode === "local" || args.mode === "slurm" ? args.mode : "default";
    const run = await createAndStartRun({ analysisId: analysis.id, executionMode: mode, createdById: args.user });
    console.log(`started ${run.runNumber} (${run.status})`);
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await db.$disconnect();
    process.exit(1);
  });
