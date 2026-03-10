#!/usr/bin/env node

import fs from "fs";
import net from "net";
import path from "path";
import { spawn, spawnSync } from "child_process";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;
const DEFAULT_DB_HOST = "127.0.0.1";
const DEFAULT_DB_PORT = 5432;
const DEFAULT_DB_NAME = "seqdesk";
const DEFAULT_DB_USER = "seqdesk";
const DEFAULT_DB_PASSWORD = "seqdesk";
const DEFAULT_NEXTAUTH_SECRET = "seqdesk-local-dev-secret";
const BREW_FORMULAE = ["postgresql@16", "postgresql@15", "postgresql@14", "postgresql"];

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const repoDir = process.cwd();
const existingDev = findRunningSeqDeskDev(repoDir);
const existingDevRuntime = existingDev ? inspectRunningSeqDeskRuntime(existingDev.parentPid) : null;
const shouldForceRestart =
  !args.setupOnly && isRunningServerIncompatible(existingDevRuntime);

if (existingDev) {
  log(
    args.restart || shouldForceRestart
      ? `Found running SeqDesk dev server at ${existingDev.url}. It will be restarted after setup.`
      : `Found running SeqDesk dev server at ${existingDev.url}. Setup will reuse it.`
  );
  if (shouldForceRestart && existingDevRuntime?.reason) {
    log(`Current server is not a normal local app instance: ${existingDevRuntime.reason}`);
  }
}

const host = args.host || DEFAULT_HOST;
const port = await resolvePort({
  explicitPort: args.port,
  host,
  existingDev,
  restart: args.restart || shouldForceRestart,
});
const nextAuthUrl = `http://${host}:${port}`;
const databaseUrl = resolveDatabaseUrl(process.env.DATABASE_URL);
const directUrl = resolveDirectUrl(process.env.DIRECT_URL, databaseUrl);
const nextAuthSecret = process.env.NEXTAUTH_SECRET || DEFAULT_NEXTAUTH_SECRET;
const dbInfo = parseDatabaseUrl(databaseUrl);

if (!dbInfo) {
  fail(
    "DATABASE_URL must be a PostgreSQL connection string. Set DATABASE_URL explicitly if you need a non-default local database."
  );
}

const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  DIRECT_URL: directUrl,
  NEXTAUTH_URL: nextAuthUrl,
  NEXTAUTH_SECRET: nextAuthSecret,
  SEQDESK_ENABLE_PUBLIC_DEMO: "false",
  NEXT_PUBLIC_SEQDESK_ENABLE_PUBLIC_DEMO: "false",
  PORT: String(port),
};

if (isLocalDatabase(dbInfo)) {
  ensureLocalPostgresReady(dbInfo);
  ensureLocalDatabase(dbInfo);
} else {
  log(`Using PostgreSQL at ${dbInfo.host}:${dbInfo.port}/${dbInfo.database}.`);
}

runCommand("npm", ["run", "db:migrate:deploy"], { env });
runCommand("npm", ["run", "db:seed"], { env });

if (args.setupOnly) {
  log(`Setup complete. Start the app with: npm run dev:mac -- --port ${port}`);
  log(`Login URL: ${nextAuthUrl}/login`);
  process.exit(0);
}

if (existingDev && !(args.restart || shouldForceRestart)) {
  log(`Setup complete. SeqDesk is already running at ${existingDev.url}/login.`);
  log("Restart it with `npm run dev:mac -- --restart` if you need fresh runtime env.");
  process.exit(0);
}

if (existingDev && (args.restart || shouldForceRestart)) {
  stopRunningSeqDeskDev(existingDev, repoDir);
}

log(`Starting SeqDesk at ${nextAuthUrl}/login`);
log("Default users: admin@example.com / admin, user@example.com / user");
startDevServer({ env, host, port });

function parseArgs(argv) {
  const parsed = {
    help: false,
    host: "",
    port: null,
    restart: false,
    setupOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--restart") {
      parsed.restart = true;
      continue;
    }

    if (arg === "--setup-only") {
      parsed.setupOnly = true;
      continue;
    }

    if (arg === "--host") {
      const value = argv[index + 1];
      if (!value) {
        fail("Missing value for --host");
      }
      parsed.host = value;
      index += 1;
      continue;
    }

    if (arg === "--port") {
      const value = argv[index + 1];
      if (!value) {
        fail("Missing value for --port");
      }
      parsed.port = parsePort(value, "--port");
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: npm run dev:mac -- [options]",
      "",
      "Bootstraps a local Homebrew PostgreSQL-backed SeqDesk dev session on macOS.",
      "",
      "Options:",
      "  --port <number>   Start Next.js on a specific port",
      "  --host <host>     Bind Next.js to a specific host (default: 127.0.0.1)",
      "  --restart         Restart an already-running SeqDesk dev server in this repo",
      "  --setup-only      Run PostgreSQL, migration, and seed steps without starting Next.js",
      "  --help            Show this help text",
      "",
    ].join("\n")
  );
}

function parsePort(value, label) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    fail(`${label} must be a valid TCP port`);
  }
  return parsed;
}

async function resolvePort({ explicitPort, host, existingDev, restart }) {
  if (existingDev) {
    if (!restart) {
      return existingDev.port;
    }

    if (explicitPort) {
      if (explicitPort !== existingDev.port) {
        const available = await isPortAvailable(host, explicitPort);
        if (!available) {
          fail(`Port ${explicitPort} is already in use. Pass a different --port value.`);
        }
      }
      return explicitPort;
    }

    return existingDev.port;
  }

  if (explicitPort) {
    const available = await isPortAvailable(host, explicitPort);
    if (!available) {
      fail(`Port ${explicitPort} is already in use. Pass a different --port value.`);
    }
    return explicitPort;
  }

  for (let candidate = DEFAULT_PORT; candidate <= DEFAULT_PORT + 30; candidate += 1) {
    if (await isPortAvailable(host, candidate)) {
      if (candidate !== DEFAULT_PORT) {
        log(`Port ${DEFAULT_PORT} is busy. Using ${candidate} instead.`);
      }
      return candidate;
    }
  }

  fail(`Could not find a free port between ${DEFAULT_PORT} and ${DEFAULT_PORT + 30}.`);
}

function resolveDatabaseUrl(explicitValue) {
  const trimmed = trimString(explicitValue);
  if (!trimmed) {
    return buildDefaultDatabaseUrl();
  }

  if (!isPostgresUrl(trimmed)) {
    fail("DATABASE_URL must be PostgreSQL when using npm run dev:mac.");
  }

  return trimmed;
}

function resolveDirectUrl(explicitValue, databaseUrl) {
  const trimmed = trimString(explicitValue);
  if (!trimmed) {
    return databaseUrl;
  }

  if (!isPostgresUrl(trimmed)) {
    fail("DIRECT_URL must be PostgreSQL when using npm run dev:mac.");
  }

  return trimmed;
}

function buildDefaultDatabaseUrl() {
  return `postgresql://${DEFAULT_DB_USER}:${DEFAULT_DB_PASSWORD}@${DEFAULT_DB_HOST}:${DEFAULT_DB_PORT}/${DEFAULT_DB_NAME}?schema=public`;
}

function isPostgresUrl(value) {
  return value.startsWith("postgresql://") || value.startsWith("postgres://");
}

function trimString(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function parseDatabaseUrl(value) {
  try {
    const url = new URL(value);
    const database = url.pathname.replace(/^\/+/, "");

    return {
      database,
      host: url.hostname || DEFAULT_DB_HOST,
      password: decodeURIComponent(url.password || ""),
      port: Number.parseInt(url.port || String(DEFAULT_DB_PORT), 10),
      user: decodeURIComponent(url.username || ""),
    };
  } catch {
    return null;
  }
}

function isLocalDatabase(dbInfo) {
  return ["127.0.0.1", "localhost", "::1"].includes(dbInfo.host);
}

function ensureLocalPostgresReady(dbInfo) {
  if (pgIsReady(dbInfo)) {
    log(`PostgreSQL is ready on ${dbInfo.host}:${dbInfo.port}.`);
    return;
  }

  if (process.platform !== "darwin" || !commandExists("brew")) {
    fail(
      `PostgreSQL is not accepting connections on ${dbInfo.host}:${dbInfo.port}. Start it first, then rerun npm run dev:mac.`
    );
  }

  const formula = findInstalledBrewFormula();
  if (!formula) {
    fail(
      "Could not find an installed Homebrew PostgreSQL formula. Install one with `brew install postgresql@14` (or newer) first."
    );
  }

  log(`Starting PostgreSQL via Homebrew (${formula})...`);
  runCommand("brew", ["services", "start", formula], { stdio: "inherit" });

  if (!waitForPgReady(dbInfo, 15_000)) {
    fail(`PostgreSQL still is not ready on ${dbInfo.host}:${dbInfo.port} after starting ${formula}.`);
  }
}

function pgIsReady(dbInfo) {
  if (!commandExists("pg_isready")) {
    return false;
  }

  const result = spawnSync(
    "pg_isready",
    ["-h", dbInfo.host, "-p", String(dbInfo.port)],
    { stdio: "ignore" }
  );

  return result.status === 0;
}

function waitForPgReady(dbInfo, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (pgIsReady(dbInfo)) {
      log(`PostgreSQL is ready on ${dbInfo.host}:${dbInfo.port}.`);
      return true;
    }
    sleep(500);
  }

  return false;
}

function findInstalledBrewFormula() {
  for (const formula of BREW_FORMULAE) {
    const result = spawnSync("brew", ["list", "--versions", formula], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    if (result.status === 0 && trimString(result.stdout)) {
      return formula;
    }
  }

  return null;
}

function ensureLocalDatabase(dbInfo) {
  if (!commandExists("psql")) {
    fail("psql is required for npm run dev:mac. Install PostgreSQL client tools first.");
  }

  if (!dbInfo.user) {
    fail("DATABASE_URL must include a username when using npm run dev:mac.");
  }

  if (!dbInfo.password) {
    fail("DATABASE_URL must include a password when using npm run dev:mac.");
  }

  if (!dbInfo.database) {
    fail("DATABASE_URL must include a database name when using npm run dev:mac.");
  }

  const userExists = queryScalar(
    `SELECT 1 FROM pg_roles WHERE rolname = ${sqlString(dbInfo.user)};`
  );
  if (!userExists) {
    log(`Creating PostgreSQL role ${dbInfo.user}.`);
    runPsql(`CREATE ROLE ${sqlIdentifier(dbInfo.user)} LOGIN PASSWORD ${sqlString(dbInfo.password)};`);
  }

  const databaseExists = queryScalar(
    `SELECT 1 FROM pg_database WHERE datname = ${sqlString(dbInfo.database)};`
  );
  if (!databaseExists) {
    log(`Creating PostgreSQL database ${dbInfo.database}.`);
    runPsql(
      `CREATE DATABASE ${sqlIdentifier(dbInfo.database)} OWNER ${sqlIdentifier(dbInfo.user)};`
    );
  }
}

function queryScalar(sql) {
  const result = spawnSync("psql", ["postgres", "-Atqc", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    fail(trimString(result.stderr) || "psql query failed.");
  }

  return trimString(result.stdout);
}

function runPsql(sql) {
  runCommand("psql", ["postgres", "-c", sql], { stdio: "inherit" });
}

function sqlIdentifier(value) {
  return `"${String(value).replace(/"/g, "\"\"")}"`;
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function findRunningSeqDeskDev(repoDir) {
  const lockFile = path.join(repoDir, ".next", "dev", "lock");
  if (!fs.existsSync(lockFile) || !commandExists("lsof")) {
    return null;
  }

  const lsofResult = spawnSync("lsof", ["-t", lockFile], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (lsofResult.status !== 0) {
    return null;
  }

  const serverPid = Number.parseInt(firstNonEmptyLine(lsofResult.stdout), 10);
  if (!Number.isInteger(serverPid)) {
    return null;
  }

  const parentPidResult = spawnSync("ps", ["-o", "ppid=", "-p", String(serverPid)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (parentPidResult.status !== 0) {
    return null;
  }

  const parentPid = Number.parseInt(trimString(parentPidResult.stdout), 10);
  if (!Number.isInteger(parentPid)) {
    return null;
  }

  const commandResult = spawnSync("ps", ["-o", "command=", "-p", String(parentPid)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (commandResult.status !== 0) {
    return null;
  }

  const command = trimString(commandResult.stdout);
  const hostMatch = command.match(/--hostname(?:=|\s+)(\S+)/);
  const portMatch = command.match(/--port(?:=|\s+)(\d+)/);
  const host = hostMatch?.[1] || DEFAULT_HOST;
  const port = portMatch ? Number.parseInt(portMatch[1], 10) : DEFAULT_PORT;

  return {
    host,
    parentPid,
    port,
    serverPid,
    url: `http://${host}:${port}`,
  };
}

function inspectRunningSeqDeskRuntime(parentPid) {
  const result = spawnSync("ps", ["eww", "-p", String(parentPid), "-o", "command="], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) {
    return null;
  }

  const output = trimString(result.stdout);
  if (!output) {
    return null;
  }

  const demoFlag = extractEnvValue(output, "SEQDESK_ENABLE_PUBLIC_DEMO");
  const publicDemoFlag = extractEnvValue(
    output,
    "NEXT_PUBLIC_SEQDESK_ENABLE_PUBLIC_DEMO"
  );
  const databaseUrl = extractEnvValue(output, "DATABASE_URL");

  if (demoFlag === "true" || publicDemoFlag === "true") {
    return {
      compatible: false,
      reason: "public demo mode is enabled",
    };
  }

  if (databaseUrl && !isPostgresUrl(databaseUrl)) {
    return {
      compatible: false,
      reason: `DATABASE_URL points at ${databaseUrl}`,
    };
  }

  return {
    compatible: true,
    reason: "",
  };
}

function isRunningServerIncompatible(runtime) {
  return Boolean(runtime && runtime.compatible === false);
}

function extractEnvValue(output, key) {
  const match = output.match(new RegExp(`(?:^|\\s)${key}=([^\\s]+)`));
  return match?.[1] || "";
}

function stopRunningSeqDeskDev(existingDev, repoDir) {
  log(`Stopping existing SeqDesk dev server on port ${existingDev.port}.`);

  try {
    process.kill(existingDev.parentPid, "SIGTERM");
  } catch (error) {
    fail(`Could not stop running SeqDesk dev server: ${error.message}`);
  }

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!findRunningSeqDeskDev(repoDir)) {
      return;
    }
    sleep(250);
  }

  fail("Timed out waiting for the existing SeqDesk dev server to stop.");
}

function firstNonEmptyLine(value) {
  return String(value)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean) || "";
}

function commandExists(command) {
  const result = spawnSync("which", [command], { stdio: "ignore" });
  return result.status === 0;
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    env: options.env || process.env,
    stdio: options.stdio || "inherit",
  });

  if (result.error) {
    fail(result.error.message);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function startDevServer({ env, host, port }) {
  const child = spawn("npm", ["run", "dev", "--", "--hostname", host, "--port", String(port)], {
    env,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
}

function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Busy wait is acceptable here because the launcher is short-lived and synchronous.
  }
}

function isPortAvailable(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.unref();
    server.on("error", () => resolve(false));
    server.listen({ host, port }, () => {
      server.close(() => resolve(true));
    });
  });
}

function log(message) {
  process.stdout.write(`[dev:mac] ${message}\n`);
}

function fail(message) {
  process.stderr.write(`[dev:mac] ${message}\n`);
  process.exit(1);
}
