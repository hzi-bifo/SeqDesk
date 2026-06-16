#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";
import {
  applyInstallProfile,
  ensureDatabaseEnv,
  readJsonFile,
} from "./lib/install-profile-apply-core.mjs";

function usage() {
  console.log(`Usage:
  node scripts/apply-install-profile.mjs --profile-config <file>

Options:
  --profile-config <file>  Resolved install profile JSON
  -h, --help              Show this help
`);
}

function parseArgs(argv) {
  const args = {
    profileConfig: process.env.SEQDESK_INSTALL_PROFILE_CONFIG || "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }
    if (arg === "--profile-config" || arg === "--profile_config") {
      args.profileConfig = argv[index + 1] || "";
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (!args.profileConfig) {
    throw new Error("--profile-config is required");
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { resolved, parsed } = readJsonFile(args.profileConfig);
  ensureDatabaseEnv();

  const prisma = new PrismaClient();
  try {
    const result = await applyInstallProfile(prisma, parsed);

    console.log(`Applied install profile ${parsed.id || "unknown"} from ${resolved}`);
    console.log(
      `Profile changes: orderForm=${result.appliedOrderForm ? "yes" : "no"}, pipelinesEnabled=${result.enabledPipelines}`
    );
    if (result.persistedProfile) {
      console.log("Persisted safe install profile metadata in the runtime config");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("ERROR: Failed to apply install profile:", error?.message || error);
  process.exit(1);
});
