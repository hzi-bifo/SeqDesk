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

const runtime = loadRuntimeConfig(process.cwd());

if (!process.env.DATABASE_URL && runtime.databaseUrl) {
  process.env.DATABASE_URL = runtime.databaseUrl;
}

if (!process.env.DIRECT_URL) {
  process.env.DIRECT_URL = runtime.directUrl || process.env.DATABASE_URL;
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

const result = spawnSync(command, args, {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);
