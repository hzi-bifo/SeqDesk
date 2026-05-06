#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { applyProfileAssets, isRecord, toOptionalString } from "./lib/install-profile-assets.mjs";

function usage() {
  console.log(`Usage:
  node scripts/apply-install-profile-assets.mjs --profile-config <file>

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

function readJsonFile(filePath) {
  const resolved = path.resolve(filePath);
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error(`${resolved} must contain a JSON object`);
  }
  return { resolved, parsed };
}

function loadDatabaseConfigFromConfig() {
  try {
    const raw = fs.readFileSync("seqdesk.config.json", "utf8");
    const parsed = JSON.parse(raw);
    const runtime = isRecord(parsed?.runtime) ? parsed.runtime : {};
    return {
      databaseUrl: toOptionalString(runtime.databaseUrl),
      directUrl: toOptionalString(runtime.directUrl),
    };
  } catch {
    return {};
  }
}

function ensureDatabaseEnv() {
  if (process.env.DATABASE_URL) return;
  const loaded = loadDatabaseConfigFromConfig();
  if (loaded.databaseUrl) {
    process.env.DATABASE_URL = loaded.databaseUrl;
    process.env.DIRECT_URL = loaded.directUrl || loaded.databaseUrl;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { resolved, parsed } = readJsonFile(args.profileConfig);
  ensureDatabaseEnv();

  const prisma = new PrismaClient();
  try {
    const result = await applyProfileAssets({
      prisma,
      profile: parsed,
      rootDir: process.cwd(),
      logger: console,
    });
    console.log(`Applied install profile assets from ${resolved}`);
    console.log(
      `Profile assets: databases=${result.databases.downloaded || 0}, seedFixtures=${result.seedData.seeded || 0}`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("ERROR: Failed to apply install profile assets:", error?.message || error);
  process.exit(1);
});
