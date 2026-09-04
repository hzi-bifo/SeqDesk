import { buildEnvironment, listEnvironments } from "../src/lib/explore/environments";

/**
 * Build one Explore environment from the command line, for installs without
 * an admin session at hand: `npx tsx scripts/explore-build-env.ts seqdesk-explore-python`.
 */
async function main(): Promise<void> {
  const name = process.argv[2];
  if (!name) {
    console.error("usage: tsx scripts/explore-build-env.ts <environment-name>");
    process.exit(1);
  }
  const result = await buildEnvironment(name);
  console.log(result.message);
  const environments = await listEnvironments();
  for (const environment of environments) {
    console.log(`${environment.name}: ${environment.status}${environment.prefixPath ? ` (${environment.prefixPath})` : ""}`);
  }
  process.exit(result.started ? 0 : 2);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
