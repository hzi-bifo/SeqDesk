import { buildEnvironment, listEnvironments, registerExistingEnvironment } from "../src/lib/explore/environments";

/**
 * Build one Explore environment from the command line, for installs without
 * an admin session at hand: `npx tsx scripts/explore-build-env.ts seqdesk-explore-python`.
 */
async function main(): Promise<void> {
  const name = process.argv[2];
  if (!name) {
    console.error("usage: tsx scripts/explore-build-env.ts <environment-name> | --status | --register <name> <prefix>");
    process.exit(1);
  }
  if (name === "--register") {
    const [, , , environmentName, prefixPath] = process.argv;
    if (!environmentName || !prefixPath) {
      console.error("usage: tsx scripts/explore-build-env.ts --register <environment-name> <conda-prefix>");
      process.exit(1);
    }
    await registerExistingEnvironment(environmentName, prefixPath);
    console.log(`Registered ${environmentName} at ${prefixPath}`);
    process.exit(0);
  }
  if (name === "--status") {
    for (const environment of await listEnvironments()) {
      console.log(`${environment.name}: ${environment.status}${environment.prefixPath ? ` (${environment.prefixPath})` : ""}`);
    }
    process.exit(0);
  }
  const result = await buildEnvironment(name, { wait: true });
  console.log(result.message);
  const environments = await listEnvironments();
  for (const environment of environments) {
    console.log(`${environment.name}: ${environment.status}${environment.prefixPath ? ` (${environment.prefixPath})` : ""}`);
  }
  process.exit(result.started && (result.exitCode ?? 0) === 0 ? 0 : 2);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
