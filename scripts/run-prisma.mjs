#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const CONFIG_FILE_NAMES = [
  "seqdesk.config.json",
  ".seqdeskrc",
  ".seqdeskrc.json",
];

function trimToString(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function findConfigPath(baseDir) {
  for (const name of CONFIG_FILE_NAMES) {
    const candidate = path.join(baseDir, name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function loadRuntimeConfig(baseDir) {
  const configPath = findConfigPath(baseDir);
  if (!configPath) {
    return {};
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const runtime =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed.runtime
        : undefined;

    if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) {
      return {};
    }

    return {
      databaseUrl: trimToString(runtime.databaseUrl),
      directUrl: trimToString(runtime.directUrl),
    };
  } catch {
    return {};
  }
}

function isSqliteDatabaseUrl(value) {
  return typeof value === "string" && value.startsWith("file:");
}

function isPostgresDatabaseUrl(value) {
  return (
    typeof value === "string" &&
    (value.startsWith("postgresql://") || value.startsWith("postgres://"))
  );
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function clipOutput(value, maxChars = 20_000) {
  if (!value) return "";
  const text = Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, 4_000)}\n... output truncated ...\n${text.slice(-maxChars + 4_000)}`;
}

const runtime = loadRuntimeConfig(process.cwd());
const envDatabaseUrl = trimToString(process.env.DATABASE_URL);
const envDirectUrl = trimToString(process.env.DIRECT_URL);

if (!envDatabaseUrl && runtime.databaseUrl) {
  process.env.DATABASE_URL = runtime.databaseUrl;
}

if (!envDirectUrl) {
  process.env.DIRECT_URL = envDatabaseUrl || runtime.directUrl || process.env.DATABASE_URL;
}

if (!process.env.DATABASE_URL) {
  fail(
    "DATABASE_URL is not configured. SeqDesk now requires a PostgreSQL connection string."
  );
}

if (isSqliteDatabaseUrl(process.env.DATABASE_URL)) {
  fail(
    "SQLite is no longer supported. Configure PostgreSQL via DATABASE_URL. Use DIRECT_URL when migrations must bypass a pooled runtime URL."
  );
}

if (!isPostgresDatabaseUrl(process.env.DATABASE_URL)) {
  fail(
    "Unsupported DATABASE_URL. SeqDesk now only supports PostgreSQL connection strings."
  );
}

if (!process.env.DIRECT_URL) {
  fail(
    "DIRECT_URL could not be resolved. Set DIRECT_URL explicitly or configure runtime.directUrl in seqdesk.config.json."
  );
}

if (isSqliteDatabaseUrl(process.env.DIRECT_URL)) {
  fail(
    "SQLite is no longer supported for DIRECT_URL. Use a PostgreSQL connection string."
  );
}

if (!isPostgresDatabaseUrl(process.env.DIRECT_URL)) {
  fail(
    "Unsupported DIRECT_URL. SeqDesk now only supports PostgreSQL connection strings."
  );
}

const prismaBin =
  process.platform === "win32"
    ? path.join(process.cwd(), "node_modules", ".bin", "prisma.cmd")
    : path.join(process.cwd(), "node_modules", ".bin", "prisma");

const command = fs.existsSync(prismaBin) ? prismaBin : "npx";
const args =
  process.argv.length > 2
    ? fs.existsSync(prismaBin)
      ? process.argv.slice(2)
      : ["prisma", ...process.argv.slice(2)]
    : fs.existsSync(prismaBin)
      ? []
      : ["prisma"];

const prismaArgs = fs.existsSync(prismaBin) ? args : args.slice(1);
const isMigrateDeploy =
  prismaArgs.length === 2 && prismaArgs[0] === "migrate" && prismaArgs[1] === "deploy";
const quietMigrateDeploy =
  isMigrateDeploy && process.env.SEQDESK_PRISMA_VERBOSE !== "1";

const result = spawnSync(command, args, {
  stdio: quietMigrateDeploy ? ["ignore", "pipe", "pipe"] : "inherit",
  env: process.env,
  encoding: quietMigrateDeploy ? "utf8" : undefined,
  maxBuffer: 128 * 1024 * 1024,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (typeof result.status === "number") {
  if (quietMigrateDeploy) {
    if (result.status === 0) {
      console.log("Prisma migrate deploy completed.");
    } else {
      const stdout = clipOutput(result.stdout);
      const stderr = clipOutput(result.stderr);
      if (stdout) {
        console.error(`Prisma stdout:\n${stdout}`);
      }
      if (stderr) {
        console.error(`Prisma stderr:\n${stderr}`);
      }
    }
  }
  process.exit(result.status);
}

process.exit(1);
