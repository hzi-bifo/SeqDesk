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

// `migrate deploy` acquires a session-level Postgres advisory lock, which a
// transaction-mode pooler cannot hold — it hangs and fails with P1002. Derive
// an unpooled connection string so migrations bypass the pooler. Neon exposes
// its pooled endpoint as "<id>-pooler.<region>.<host>"; the direct endpoint is
// the same host without the "-pooler" label. Non-pooled URLs pass through
// unchanged.
function toUnpooledUrl(value) {
  if (typeof value !== "string" || value.length === 0) {
    return value;
  }

  try {
    const url = new URL(value);
    if (url.hostname.includes("-pooler.")) {
      url.hostname = url.hostname.replace("-pooler.", ".");
    }
    // `pgbouncer=true` only applies to the pooled connection.
    url.searchParams.delete("pgbouncer");
    return url.toString();
  } catch {
    return value;
  }
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
  // Prefer an explicitly configured direct URL, otherwise fall back to
  // DATABASE_URL.
  process.env.DIRECT_URL = runtime.directUrl || process.env.DATABASE_URL;
}

// Migrations must bypass any connection pooler regardless of how DIRECT_URL was
// supplied: a transaction-mode pooler can't hold the session-level advisory
// lock `migrate deploy` needs, so it hangs and fails with P1002 (Neon's
// `-pooler` endpoint / PgBouncer). Normalize to the unpooled host here.
if (process.env.DIRECT_URL) {
  process.env.DIRECT_URL = toUnpooledUrl(process.env.DIRECT_URL);
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

if (!fs.existsSync(prismaBin)) {
  fail(
    `Local Prisma CLI not found at ${prismaBin}. Run "npm ci --omit=dev --no-audit --no-fund" in the SeqDesk install directory before running Prisma commands.`
  );
}

const versionResult = spawnSync(prismaBin, ["--version"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env,
  encoding: "utf8",
  maxBuffer: 128 * 1024 * 1024,
});

if (versionResult.error) {
  fail(`Failed to run local Prisma CLI: ${versionResult.error.message}`);
}

if (versionResult.status !== 0) {
  const stdout = clipOutput(versionResult.stdout);
  const stderr = clipOutput(versionResult.stderr);
  fail(
    [
      "Failed to inspect local Prisma CLI version.",
      stdout ? `Prisma stdout:\n${stdout}` : "",
      stderr ? `Prisma stderr:\n${stderr}` : "",
    ]
      .filter(Boolean)
      .join("\n")
  );
}

const versionOutput = `${versionResult.stdout || ""}\n${versionResult.stderr || ""}`;
const versionMatch = versionOutput.match(/prisma\s+:\s+(\d+)\.(\d+)\.(\d+)/i)
  || versionOutput.match(/\b(\d+)\.(\d+)\.(\d+)\b/);
const prismaVersion = versionMatch
  ? `${versionMatch[1]}.${versionMatch[2]}.${versionMatch[3]}`
  : "unknown";
const prismaMajor = versionMatch ? Number(versionMatch[1]) : NaN;

if (prismaMajor !== 5) {
  fail(
    `Unsupported local Prisma CLI version ${prismaVersion}. SeqDesk currently requires Prisma CLI 5.x; run "npm ci --omit=dev --no-audit --no-fund" in the SeqDesk install directory and retry.`
  );
}

const command = prismaBin;
const args = process.argv.length > 2 ? process.argv.slice(2) : [];

const prismaArgs = args;
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
