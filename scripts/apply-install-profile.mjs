#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";
import {
  applyFeatureModules,
  applyInstallProfile,
  ensureDatabaseEnv,
  readJsonFile,
} from "./lib/install-profile-apply-core.mjs";

function usage() {
  console.log(`Usage:
  node scripts/apply-install-profile.mjs --profile-config <file>
  node scripts/apply-install-profile.mjs --feature-modules-from-env

Options:
  --profile-config <file>       Resolved install profile JSON
  --feature-modules-from-env    Apply SEQDESK_FEATURE_MODULES_JSON only
  -h, --help                   Show this help
`);
}

function parseArgs(argv) {
  const args = {
    profileConfig: "",
    featureModulesFromEnv: false,
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
    if (arg === "--feature-modules-from-env") {
      args.featureModulesFromEnv = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (!args.profileConfig && !args.featureModulesFromEnv) {
    args.profileConfig = process.env.SEQDESK_INSTALL_PROFILE_CONFIG || "";
  }
  if (args.profileConfig && args.featureModulesFromEnv) {
    throw new Error(
      "Choose either --profile-config or --feature-modules-from-env, not both."
    );
  }
  if (!args.profileConfig && !args.featureModulesFromEnv) {
    throw new Error(
      "--profile-config or --feature-modules-from-env is required"
    );
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configuredModules = args.featureModulesFromEnv
    ? process.env.SEQDESK_FEATURE_MODULES_JSON
    : undefined;
  if (args.featureModulesFromEnv && !configuredModules) {
    throw new Error(
      "SEQDESK_FEATURE_MODULES_JSON is required with --feature-modules-from-env"
    );
  }

  let parsedModules;
  if (configuredModules) {
    try {
      parsedModules = JSON.parse(configuredModules);
    } catch {
      throw new Error("SEQDESK_FEATURE_MODULES_JSON must contain valid JSON");
    }
  }
  const profileSource = args.featureModulesFromEnv
    ? undefined
    : readJsonFile(args.profileConfig);

  ensureDatabaseEnv();

  const prisma = new PrismaClient();
  try {
    if (args.featureModulesFromEnv) {
      const result = await applyFeatureModules(prisma, parsedModules);
      console.log(
        `Stored and verified ${result.appliedCount} requested feature-module switch(es); the global feature-module switch was preserved`
      );
      return;
    }

    const { resolved, parsed } = profileSource;
    const result = await applyInstallProfile(prisma, parsed);

    console.log(`Applied install profile ${parsed.id || "unknown"} from ${resolved}`);
    console.log(
      `Profile changes: orderForm=${result.appliedOrderForm ? "yes" : "no"}, pipelinesEnabled=${result.enabledPipelines}`
    );
    if (result.persistedProfile) {
      console.log("Persisted safe install profile metadata in the runtime config");
    }
    if (
      parsed.modules &&
      typeof parsed.modules === "object" &&
      !Array.isArray(parsed.modules) &&
      Object.keys(parsed.modules).length > 0
    ) {
      console.log(
        "Stored requested feature-module toggles; any existing global feature-module disable remains authoritative"
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("ERROR: Failed to apply installer settings:", error?.message || error);
  process.exit(1);
});
