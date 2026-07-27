#!/usr/bin/env node

"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { version } = require("../package.json");

const INSTALL_URL = process.env.SEQDESK_INSTALL_URL || "https://seqdesk.org/install.sh";
const DEFAULT_PROFILE_REGISTRY_URL = "https://seqdesk.org/api/install-profiles";
// Troubleshooting targets shared with the installer, which prints the same
// pages next to its own failures. Keep them identical so a reviewer who hits
// the problem during install and again in doctor lands on one page.
const DOCS_INSTALLATION_URL = "https://seqdesk.org/docs/installation";
const DOCS_COMMON_PROBLEMS_URL = "https://seqdesk.org/docs/installation/common-problems";
const DOCS_POSTGRES_URL =
  "https://seqdesk.org/docs/installation/quickstart#postgresql-cannot-be-reached-or-migrations-fail";
const args = process.argv.slice(2);

if (process.platform === "win32") {
  console.error("[seqdesk] Windows is not supported directly. Use WSL and run `seqdesk` there.");
  process.exit(1);
}

const env = { ...process.env };
if (!env.SEQDESK_VERSION) {
  env.SEQDESK_VERSION = version;
}

const DOCTOR_USAGE = `Usage:
  seqdesk doctor [--dir /path/to/seqdesk] [--url http://127.0.0.1:8000]

Options:
  --dir, -d          Installed SeqDesk directory. Defaults to the current directory.
  --url, -u          Running SeqDesk URL for HTTP checks.
  --timeout-ms       Timeout for PostgreSQL and HTTP checks. Defaults to 5000.
  --json             Print machine-readable JSON.
  --help, -h         Show this help.
`;

const RESET_PASSWORD_USAGE = `Usage:
  seqdesk reset-password <address> [--dir /path/to/seqdesk] [--password <value>] [--yes] [--json]

Example:
  cd ~/seqdesk && seqdesk reset-password admin@example.com

Options:
  <address>          Account to reset. May also be given as --email <address>.
  --email, -e        Account to reset, by email address. Required.
  --dir, -d          Installed SeqDesk directory. Defaults to the current directory.
  --password         Password to set. Omit to generate a strong one.
  --yes, -y          Skip the confirmation prompt. Required with --json.
  --json             Print machine-readable JSON.
  --help, -h         Show this help.

Resets one account. The new password is printed once and is stored nowhere:
SeqDesk keeps only its bcrypt hash, and this command writes it to no file.
`;

// scripts/reset-password.mjs ships inside the release, so an install made before
// that release has no worker to run. Name the version that introduced it instead
// of failing with a bare ENOENT.
const RESET_PASSWORD_MIN_APP_VERSION = "1.1.125";

const ASSETS_USAGE = `Usage:
  seqdesk assets apply [--dir /path/to/seqdesk] (--profile <id> --profile-code <code> | --profile-config <file>)

Options:
  --dir, -d                    Installed SeqDesk directory. Defaults to the current directory.
  --profile <id>               Hosted install profile id, for example dev.
  --profile-code, --key <code> Hosted profile access code.
  --profile-config <file>      Already-resolved install profile JSON.
  --profile-registry-url <url> Hosted profile registry URL. Defaults to https://seqdesk.org/api/install-profiles.
  --json                       Print machine-readable JSON from the installed asset script.
  --help, -h                   Show this help.
`;

const PIPELINE_USAGE = `Usage:
  seqdesk pipeline list --dir /path/to/seqdesk [--catalog study|order|all] [--enabled] [--json]
  seqdesk pipeline run <pipelineId> --dir /path/to/seqdesk (--study <id>|--order <id>) [--samples id,id] [--config-file file|--config-json json] [--execution default|local|slurm] [--watch] [--json] [--user-email email]
  seqdesk pipeline status <runId> --dir /path/to/seqdesk [--watch] [--json]
  seqdesk pipeline sync <runId> --dir /path/to/seqdesk [--json]
  seqdesk pipeline logs <runId> --dir /path/to/seqdesk [--type output|error] [--tail 200] [--json]
  seqdesk pipeline outputs <runId> --dir /path/to/seqdesk [--json]
  seqdesk pipeline debug <runId> --dir /path/to/seqdesk [--format text|json] [--out file]
  seqdesk pipeline cancel <runId> --dir /path/to/seqdesk [--json]

Local shell access to the installed directory is treated as operator access.
`;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function firstNumber(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

// Remediation text contains ready-to-paste shell commands, so paths with
// spaces or shell metacharacters have to be quoted the way the installer's
// shell_quote does it.
function shellQuote(value) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function parseDoctorArgs(argv) {
  const options = {
    dir: process.cwd(),
    url: "",
    json: false,
    timeoutMs: 5000,
    help: false,
  };

  let positionalDir = "";

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }

    if (token === "--json") {
      options.json = true;
      continue;
    }

    if (token === "--dir" || token === "-d") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`${token} requires a directory path`);
      }
      options.dir = value;
      index += 1;
      continue;
    }

    if (token.startsWith("--dir=")) {
      const dirValue = token.slice("--dir=".length);
      // An empty value resolves to the current working directory, which is
      // almost never the install that was meant and may be a different database
      // entirely. Refuse it, the way --password= already does.
      if (!dirValue) {
        throw new Error("--dir requires a directory path");
      }
      options.dir = dirValue;
      continue;
    }

    if (token === "--url" || token === "-u") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`${token} requires a URL`);
      }
      options.url = value;
      index += 1;
      continue;
    }

    if (token.startsWith("--url=")) {
      options.url = token.slice("--url=".length);
      continue;
    }

    if (token === "--timeout-ms") {
      const value = Number(argv[index + 1]);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("--timeout-ms requires a positive number");
      }
      options.timeoutMs = value;
      index += 1;
      continue;
    }

    if (token.startsWith("--timeout-ms=")) {
      const value = Number(token.slice("--timeout-ms=".length));
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("--timeout-ms requires a positive number");
      }
      options.timeoutMs = value;
      continue;
    }

    if (token.startsWith("-")) {
      throw new Error(`Unknown doctor option: ${token}`);
    }

    if (positionalDir) {
      throw new Error(`Unexpected doctor argument: ${token}`);
    }
    positionalDir = token;
  }

  if (positionalDir) {
    options.dir = positionalDir;
  }

  options.dir = path.resolve(options.dir);
  return options;
}

function parseResetPasswordArgs(argv) {
  const options = {
    dir: process.cwd(),
    email: "",
    password: "",
    yes: false,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }

    if (token === "--json") {
      options.json = true;
      continue;
    }

    if (token === "--yes" || token === "-y") {
      options.yes = true;
      continue;
    }

    if (token === "--dir" || token === "-d") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`${token} requires a directory path`);
      }
      options.dir = value;
      index += 1;
      continue;
    }

    if (token.startsWith("--dir=")) {
      const dirValue = token.slice("--dir=".length);
      // An empty value resolves to the current working directory, which is
      // almost never the install that was meant and may be a different database
      // entirely. Refuse it, the way --password= already does.
      if (!dirValue) {
        throw new Error("--dir requires a directory path");
      }
      options.dir = dirValue;
      continue;
    }

    if (token === "--email" || token === "-e") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`${token} requires an email address`);
      }
      options.email = value;
      index += 1;
      continue;
    }

    if (token.startsWith("--email=")) {
      options.email = token.slice("--email=".length);
      continue;
    }

    if (token === "--password") {
      const value = argv[index + 1];
      // A password may legitimately begin with "-". Consuming the next option as
      // the password would silently set the account to something like "--yes",
      // so require the inline form for those instead of guessing.
      if (value === undefined || value.startsWith("-")) {
        throw new Error(
          "--password requires a value; write --password=<value> for a password that starts with '-'"
        );
      }
      options.password = value;
      index += 1;
      continue;
    }

    if (token.startsWith("--password=")) {
      const value = token.slice("--password=".length);
      // An empty value is a mistake, not a request for an empty password: it
      // would otherwise fall through and silently generate one instead.
      if (!value) {
        throw new Error("--password requires a value; omit --password entirely to generate one");
      }
      options.password = value;
      continue;
    }

    if (token.startsWith("-")) {
      throw new Error(`Unknown reset-password option: ${token}`);
    }

    // Accept the address positionally. Someone running this is locked out of
    // their own installation; `seqdesk reset-password admin@example.com` is the
    // command they can retype from a screenshot without consulting --help.
    if (!options.email) {
      options.email = token;
      continue;
    }

    throw new Error(
      `Unexpected reset-password argument: ${token} (the account ${options.email} was already given)`
    );
  }

  options.dir = path.resolve(options.dir);
  options.email = options.email.trim();

  if (options.help) {
    return options;
  }

  if (!options.email) {
    throw new Error(
      "Name the account whose password should be replaced, for example: seqdesk reset-password admin@example.com"
    );
  }

  // The prompt has no answer in JSON mode, and silently skipping it would let a
  // script change a password without ever asking.
  if (options.json && !options.yes) {
    throw new Error("--json requires --yes, because the confirmation prompt cannot be answered in JSON mode");
  }

  return options;
}

function profileCodeEnvName(profileId) {
  return `${profileId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_SETUP_CODE`;
}

function safeProfileFileName(profileId) {
  const normalized = profileId.replace(/[^a-z0-9_-]/gi, "-").replace(/^-+|-+$/g, "");
  return `${normalized || "profile"}-install-profile.json`;
}

function parseAssetsArgs(argv) {
  const options = {
    dir: process.cwd(),
    profile: "",
    profileCode: "",
    profileConfig: "",
    profileRegistryUrl: process.env.SEQDESK_PROFILE_REGISTRY_URL || DEFAULT_PROFILE_REGISTRY_URL,
    json: false,
    help: false,
  };

  const subcommand = argv[0];
  if (subcommand === "--help" || subcommand === "-h") {
    options.help = true;
    return options;
  }
  if (subcommand !== "apply") {
    throw new Error(subcommand ? `Unknown assets command: ${subcommand}` : "Missing assets command: apply");
  }

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }

    if (token === "--json") {
      options.json = true;
      continue;
    }

    if (token === "--dir" || token === "-d") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`${token} requires a directory path`);
      }
      options.dir = value;
      index += 1;
      continue;
    }

    if (token.startsWith("--dir=")) {
      const dirValue = token.slice("--dir=".length);
      // An empty value resolves to the current working directory, which is
      // almost never the install that was meant and may be a different database
      // entirely. Refuse it, the way --password= already does.
      if (!dirValue) {
        throw new Error("--dir requires a directory path");
      }
      options.dir = dirValue;
      continue;
    }

    if (token === "--profile") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--profile requires an id");
      }
      options.profile = value;
      index += 1;
      continue;
    }

    if (token.startsWith("--profile=")) {
      options.profile = token.slice("--profile=".length);
      continue;
    }

    if (token === "--profile-code" || token === "--key") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`${token} requires a code`);
      }
      options.profileCode = value;
      index += 1;
      continue;
    }

    if (token.startsWith("--profile-code=")) {
      options.profileCode = token.slice("--profile-code=".length);
      continue;
    }

    if (token.startsWith("--key=")) {
      options.profileCode = token.slice("--key=".length);
      continue;
    }

    if (token === "--profile-config") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--profile-config requires a file path");
      }
      options.profileConfig = value;
      index += 1;
      continue;
    }

    if (token.startsWith("--profile-config=")) {
      options.profileConfig = token.slice("--profile-config=".length);
      continue;
    }

    if (token === "--profile-registry-url") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--profile-registry-url requires a URL");
      }
      options.profileRegistryUrl = value;
      index += 1;
      continue;
    }

    if (token.startsWith("--profile-registry-url=")) {
      options.profileRegistryUrl = token.slice("--profile-registry-url=".length);
      continue;
    }

    throw new Error(`Unknown assets option: ${token}`);
  }

  options.dir = path.resolve(options.dir);
  options.profile = options.profile.trim();
  options.profileCode = options.profileCode.trim();
  options.profileConfig = options.profileConfig ? path.resolve(options.profileConfig) : "";
  options.profileRegistryUrl = options.profileRegistryUrl.trim() || DEFAULT_PROFILE_REGISTRY_URL;
  return options;
}

function parsePipelineLauncherArgs(argv) {
  const options = {
    dir: process.cwd(),
    help: false,
  };

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
    options.help = true;
    return options;
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }

    if (token === "--dir" || token === "-d") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`${token} requires a directory path`);
      }
      options.dir = value;
      index += 1;
      continue;
    }

    if (token.startsWith("--dir=")) {
      const dirValue = token.slice("--dir=".length);
      // An empty value resolves to the current working directory, which is
      // almost never the install that was meant and may be a different database
      // entirely. Refuse it, the way --password= already does.
      if (!dirValue) {
        throw new Error("--dir requires a directory path");
      }
      options.dir = dirValue;
      continue;
    }
  }

  options.dir = path.resolve(options.dir);
  return options;
}

// `remediation` is optional and only added to the emitted check when a caller
// supplies one, so the JSON report keeps its existing shape for passing checks
// and for any consumer that compares whole check objects.
function addCheck(checks, status, name, detail = "", remediation = "") {
  const check = { status, name, detail };
  if (remediation) {
    check.remediation = remediation;
  }
  checks.push(check);
}

function readJsonFile(file) {
  const raw = fs.readFileSync(file, "utf8");
  return JSON.parse(raw);
}

function checkExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function fileExists(file) {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

function dirExists(file) {
  try {
    return fs.statSync(file).isDirectory();
  } catch {
    return false;
  }
}

// Distribution installs keep immutable app files under current/ while the root
// holds shared config, data, and the start wrapper. Legacy/source installs still
// place the app files directly in the requested directory.
function resolveAppDir(installDir) {
  const currentDir = path.join(installDir, "current");
  return dirExists(currentDir) ? currentDir : installDir;
}

// A13: the installer writes settings.json on fresh installs (seqdesk.config.json
// only on legacy upgrades). Resolve to whichever exists so the runtime config
// that is actually in use is the one that gets read.
function resolveConfigPath(installDir) {
  return (
    ["settings.json", "seqdesk.config.json"]
      .map((name) => path.join(installDir, name))
      .find(fileExists) || path.join(installDir, "settings.json")
  );
}

function summarizePostgresUrl(value) {
  const parsed = new URL(value);
  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, "")) || "(no database)";
  const port = parsed.port || "5432";
  const socketDir = postgresSocketDirectory(parsed);
  if (socketDir) {
    return `${socketDir}:${port}/${database} (Unix socket)`;
  }
  return `${postgresTcpHost(parsed)}:${port}/${database}`;
}

function postgresSocketDirectory(parsed) {
  const configuredHost = (parsed.searchParams.get("host") || "").trim();
  return path.isAbsolute(configuredHost) ? path.normalize(configuredHost) : "";
}

// libpq lets a `host=` query parameter override the host component of the URI.
// An absolute value selects a Unix socket directory (postgresSocketDirectory);
// anything else is the real TCP host, and the URI host is then ignored. Without
// this, postgresql://user:pw@ignored/db?host=db.example.org would be probed as
// "ignored" and could report a pass for a server that was never contacted.
function postgresTcpHost(parsed) {
  const configuredHost = (parsed.searchParams.get("host") || "").trim();
  if (configuredHost && !path.isAbsolute(configuredHost)) {
    return configuredHost;
  }
  return parsed.hostname;
}

// URL.hostname keeps the square brackets around an IPv6 literal ("[::1]"), and
// net.createConnection then treats them as part of a DNS name and fails with
// ENOTFOUND. The shell installer strips them the same way before probing a
// database host (scripts/install.sh, db_probe_host).
function stripIpv6Brackets(host) {
  if (host.length > 1 && host.startsWith("[") && host.endsWith("]")) {
    return host.slice(1, -1);
  }
  return host;
}

function validatePostgresUrl(value) {
  if (!value) {
    return { ok: false, detail: "missing" };
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    return { ok: false, detail: `invalid URL: ${error.message}` };
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    return { ok: false, detail: `expected postgresql:// URL, got ${parsed.protocol || "unknown"}` };
  }

  const socketDir = postgresSocketDirectory(parsed);
  const host = postgresTcpHost(parsed);
  if (!host && !socketDir) {
    return { ok: false, detail: "missing host" };
  }

  if (!parsed.pathname || parsed.pathname === "/") {
    return { ok: false, detail: "missing database name" };
  }

  return {
    ok: true,
    detail: summarizePostgresUrl(value),
    parsed,
    socketDir,
    host,
  };
}

function connectTcp(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: stripIpv6Brackets(host), port });
    let settled = false;

    function finish(error) {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }

    socket.setTimeout(timeoutMs, () => {
      finish(new Error(`timed out after ${timeoutMs}ms`));
    });
    socket.once("connect", () => finish());
    socket.once("error", (error) => finish(error));
  });
}

function connectUnixSocket(socketDir, port, timeoutMs) {
  const socketPath = path.join(socketDir, `.s.PGSQL.${port}`);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: socketPath });
    let settled = false;

    function finish(error) {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }

    socket.setTimeout(timeoutMs, () => {
      finish(new Error(`timed out after ${timeoutMs}ms`));
    });
    socket.once("connect", () => finish());
    socket.once("error", (error) => finish(error));
  });
}

function inferAppUrl(config, explicitUrl) {
  if (explicitUrl) {
    return { url: explicitUrl, source: "option" };
  }

  const runtime = isPlainObject(config?.runtime) ? config.runtime : {};
  const app = isPlainObject(config?.app) ? config.app : {};
  const configuredUrl = firstString(runtime.nextAuthUrl, config?.nextAuthUrl, app.nextAuthUrl);
  if (configuredUrl) {
    return { url: configuredUrl, source: "config" };
  }

  const port = firstNumber(app.port, config?.port);
  if (port) {
    return { url: `http://127.0.0.1:${port}`, source: "config port" };
  }

  return { url: "", source: "" };
}

function normalizeBaseUrl(value) {
  if (!value) return "";
  try {
    const parsed = new URL(value);
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": `seqdesk/${version} doctor`,
      },
    });
    const text = await response.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`HTTP ${response.status}, non-JSON response`);
      }
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}${json?.error ? `: ${json.error}` : ""}`);
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeTelemetry(config) {
  const telemetry = isPlainObject(config?.telemetry) ? config.telemetry : {};
  const enabled = telemetry.enabled === true;
  const endpoint = firstString(telemetry.endpoint);
  const intervalHours = firstNumber(telemetry.intervalHours);
  if (!enabled) {
    return "disabled";
  }
  return [
    "enabled",
    endpoint ? `endpoint=${endpoint}` : "",
    intervalHours ? `intervalHours=${intervalHours}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

const useColor = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
const style = {
  bold: useColor ? "\u001b[1m" : "",
  red: useColor ? "\u001b[0;31m" : "",
  yellow: useColor ? "\u001b[1;33m" : "",
  reset: useColor ? "\u001b[0m" : "",
};

function printHeader(label) {
  console.log("");
  console.log(`${style.bold}${label}${style.reset}`);
}

function printKv(label, value) {
  console.log(`  ${label.padEnd(24, " ")} ${value}`);
}

function printCheck(check) {
  const detail = check.detail || "ok";
  if (check.status === "pass") {
    printKv(check.name, detail);
    return;
  }

  const label = check.status === "warn" ? "warning" : "error";
  const color = check.status === "warn" ? style.yellow : style.red;
  const detailSuffix = check.detail ? ` - ${check.detail}` : "";
  console.log(`  ${color}${label}${style.reset} ${check.name}${detailSuffix}`);
  if (check.remediation) {
    // Print the next step directly under the failure it belongs to. A separate
    // summary block would force the reader to match failures to advice by name.
    console.log(`    -> ${check.remediation}`);
  }
}

function printDoctorResult(result) {
  console.log(`${style.bold}SeqDesk doctor${style.reset}`);
  printKv("Version", version);
  printKv("Directory", result.installDir);
  if (result.appUrl) {
    printKv("URL", result.appUrl);
  }

  printHeader("Checks");
  for (const check of result.checks) {
    printCheck(check);
  }

  printHeader("Summary");
  printKv("Passed", result.summary.pass);
  printKv("Warnings", result.summary.warn);
  printKv("Errors", result.summary.fail);
}

async function runDoctor(argv) {
  let options;
  try {
    options = parseDoctorArgs(argv);
  } catch (error) {
    console.error(`[seqdesk] ${error.message}`);
    console.error("");
    console.error(DOCTOR_USAGE.trim());
    return 2;
  }

  if (options.help) {
    console.log(DOCTOR_USAGE.trim());
    return 0;
  }

  const installDir = options.dir;
  const checks = [];
  const result = {
    version,
    installDir,
    appUrl: "",
    checks,
    summary: { pass: 0, warn: 0, fail: 0 },
  };

  if (!dirExists(installDir)) {
    addCheck(
      checks,
      "fail",
      "Install directory",
      "directory does not exist",
      `Pass --dir with the directory the installer reported, or install first: curl -fsSL ${INSTALL_URL} | bash`
    );
    for (const check of checks) result.summary[check.status] += 1;
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printDoctorResult(result);
    }
    return 1;
  }
  addCheck(checks, "pass", "Install directory", installDir);

  const appDir = resolveAppDir(installDir);

  const packagePath = path.join(installDir, "package.json");
  let packageJson = null;
  if (!fileExists(packagePath)) {
    addCheck(
      checks,
      "fail",
      "package.json",
      "missing",
      `${installDir} is not a SeqDesk installation. Point --dir at the directory the installer reported.`
    );
  } else {
    try {
      packageJson = readJsonFile(packagePath);
      const name = firstString(packageJson.name) || "unknown";
      const appVersion = firstString(packageJson.version) || "unknown";
      addCheck(checks, "pass", "package.json", `${name}@${appVersion}`);
    } catch (error) {
      addCheck(
        checks,
        "fail",
        "package.json",
        `invalid JSON: ${error.message}`,
        `Reinstall over this directory to restore the release files. See ${DOCS_COMMON_PROBLEMS_URL}`
      );
    }
  }

  // Read whichever runtime config the install actually uses, so doctor's
  // runtime.* / TCP / HTTP checks run against the real values.
  const configPath = resolveConfigPath(installDir);
  const configName = path.basename(configPath);
  let config = null;
  // Ready-to-paste repair commands, in the same form the installer prints when
  // it tells an operator how to reconfigure or re-seed an existing install.
  const reconfigureHint = `npx -y seqdesk@latest -y --reconfigure --dir ${shellQuote(installDir)}`;
  const reseedHint = `npx -y seqdesk@latest -y --reconfigure --reseed-db --dir ${shellQuote(installDir)}`;
  if (!fileExists(configPath)) {
    addCheck(
      checks,
      "fail",
      configName,
      "missing",
      `The runtime config was never written or was deleted. Recreate it with: ${reconfigureHint}`
    );
  } else {
    try {
      config = readJsonFile(configPath);
      addCheck(checks, "pass", configName, "parseable");
    } catch (error) {
      addCheck(
        checks,
        "fail",
        configName,
        `invalid JSON: ${error.message}`,
        `Fix the JSON syntax in ${configPath}, or rewrite it with: ${reconfigureHint}`
      );
    }
  }

  const startPath = path.join(installDir, "start.sh");
  if (!fileExists(startPath)) {
    addCheck(
      checks,
      "fail",
      "start.sh",
      "missing",
      `The start wrapper is missing, so SeqDesk cannot be started. Recreate it with: ${reconfigureHint}`
    );
  } else if (!checkExecutable(startPath)) {
    addCheck(checks, "fail", "start.sh", "not executable", `chmod +x ${shellQuote(startPath)}`);
  } else {
    addCheck(checks, "pass", "start.sh", "executable");
  }

  if (dirExists(path.join(appDir, "node_modules"))) {
    addCheck(
      checks,
      "pass",
      "node_modules",
      appDir === installDir ? "present" : "present in current release"
    );
  } else {
    addCheck(
      checks,
      "fail",
      "node_modules",
      "missing",
      `Production dependencies are absent, so the app cannot start. Reinstall the release: curl -fsSL ${INSTALL_URL} | bash`
    );
  }

  if (dirExists(path.join(appDir, ".next", "static"))) {
    addCheck(
      checks,
      "pass",
      ".next/static",
      appDir === installDir ? "present" : "present in current release"
    );
  } else if (dirExists(path.join(appDir, ".next"))) {
    addCheck(checks, "warn", ".next/static", ".next exists but static assets are missing");
  } else {
    addCheck(checks, "warn", ".next/static", "missing; production release assets may be incomplete");
  }

  if (config) {
    const runtime = isPlainObject(config.runtime) ? config.runtime : {};
    const databaseUrl = firstString(runtime.databaseUrl, config.databaseUrl);
    const directUrl = firstString(runtime.directUrl, runtime.databaseDirectUrl, config.directUrl);
    const nextAuthUrl = firstString(runtime.nextAuthUrl, config.nextAuthUrl);
    const nextAuthSecret = firstString(runtime.nextAuthSecret, config.nextAuthSecret);

    const databaseValidation = validatePostgresUrl(databaseUrl);
    if (databaseValidation.ok) {
      addCheck(checks, "pass", "runtime.databaseUrl", databaseValidation.detail);
      const port = Number(databaseValidation.parsed.port || "5432");
      if (databaseValidation.socketDir) {
        try {
          await connectUnixSocket(databaseValidation.socketDir, port, options.timeoutMs);
          addCheck(
            checks,
            "pass",
            "PostgreSQL socket",
            `${databaseValidation.socketDir}:${port} reachable`
          );
        } catch (error) {
          const socketPath = path.join(
            databaseValidation.socketDir,
            `.s.PGSQL.${port}`
          );
          addCheck(
            checks,
            "fail",
            "PostgreSQL socket",
            `${databaseValidation.socketDir}:${port} unreachable (${socketPath}): ${error.message}`,
            `Start the server that owns this socket directory (an installer-managed cluster is started by ${shellQuote(startPath)}), or correct the host= parameter of runtime.databaseUrl. See ${DOCS_POSTGRES_URL}`
          );
        }
      } else {
        const host = databaseValidation.host;
        try {
          await connectTcp(host, port, options.timeoutMs);
          addCheck(checks, "pass", "PostgreSQL TCP", `${host}:${port} reachable`);
        } catch (error) {
          addCheck(
            checks,
            "fail",
            "PostgreSQL TCP",
            `${host}:${port} unreachable: ${error.message}`,
            `Confirm PostgreSQL is running and reachable: pg_isready -h ${shellQuote(stripIpv6Brackets(host))} -p ${port}. See ${DOCS_POSTGRES_URL}`
          );
        }
      }
    } else {
      addCheck(
        checks,
        "fail",
        "runtime.databaseUrl",
        databaseValidation.detail,
        `Set runtime.databaseUrl in ${configName} to postgresql://user:password@host:5432/dbname (append ?host=/path/to/socket/dir for a Unix socket), or rewrite it with: ${reconfigureHint}`
      );
    }

    if (directUrl) {
      const directValidation = validatePostgresUrl(directUrl);
      addCheck(
        checks,
        directValidation.ok ? "pass" : "fail",
        "runtime.directUrl",
        directValidation.detail,
        directValidation.ok
          ? ""
          : `Set runtime.directUrl in ${configName} to the same database in postgresql:// form, or remove it to fall back to runtime.databaseUrl.`
      );
    } else {
      addCheck(checks, "warn", "runtime.directUrl", "missing; databaseUrl will be used as fallback");
    }

    if (nextAuthUrl) {
      addCheck(checks, "pass", "runtime.nextAuthUrl", nextAuthUrl);
    } else {
      addCheck(checks, "warn", "runtime.nextAuthUrl", "missing; app URL must be provided another way");
    }

    if (nextAuthSecret) {
      addCheck(checks, "pass", "runtime.nextAuthSecret", "set");
    } else {
      addCheck(
        checks,
        "fail",
        "runtime.nextAuthSecret",
        "missing",
        `Sessions cannot be signed without it. Add runtime.nextAuthSecret to ${configName} (generate one with: openssl rand -base64 32) and restart SeqDesk.`
      );
    }

    addCheck(checks, config.telemetry?.enabled === true ? "pass" : "warn", "telemetry", summarizeTelemetry(config));

    const inferred = inferAppUrl(config, options.url);
    const appUrl = normalizeBaseUrl(inferred.url);
    result.appUrl = appUrl;

    if (inferred.url && !appUrl) {
      addCheck(
        checks,
        inferred.source === "option" ? "fail" : "warn",
        "App URL",
        `invalid URL: ${inferred.url}`,
        inferred.source === "option"
          ? "Pass a full URL including the scheme, for example: --url http://127.0.0.1:8000"
          : `Set runtime.nextAuthUrl in ${configName} to a full URL including the scheme, for example http://127.0.0.1:8000`
      );
      addCheck(checks, "warn", "HTTP checks", "skipped because app URL is invalid");
    } else if (!appUrl) {
      addCheck(checks, "warn", "HTTP checks", "skipped; pass --url or configure runtime.nextAuthUrl/app.port");
    } else {
      const unreachableStatus = inferred.source === "option" ? "fail" : "warn";
      const unreachableRemediation = `Start SeqDesk with ${shellQuote(startPath)} (or check "pm2 status" if it runs under pm2) and confirm the URL is ${appUrl}. See ${DOCS_COMMON_PROBLEMS_URL}`;
      try {
        const providers = await fetchJson(`${appUrl}/api/auth/providers`, options.timeoutMs);
        if (providers && isPlainObject(providers.credentials)) {
          addCheck(checks, "pass", "HTTP /api/auth/providers", "credentials auth available");
        } else {
          addCheck(
            checks,
            "fail",
            "HTTP /api/auth/providers",
            "credentials auth missing",
            `SeqDesk answered but exposes no credentials login. Check runtime.nextAuthUrl and runtime.nextAuthSecret in ${configName}, restart SeqDesk, then re-run doctor.`
          );
        }
      } catch (error) {
        addCheck(
          checks,
          unreachableStatus,
          "HTTP /api/auth/providers",
          error.message,
          unreachableRemediation
        );
      }

      try {
        const setupStatus = await fetchJson(`${appUrl}/api/setup/status`, options.timeoutMs);
        if (setupStatus?.configured === true) {
          addCheck(checks, "pass", "HTTP /api/setup/status", "database configured");
        } else if (setupStatus?.exists === true) {
          addCheck(
            checks,
            "warn",
            "HTTP /api/setup/status",
            setupStatus.error || "database exists but is not seeded",
            `Seed the bootstrap accounts with: ${reseedHint}`
          );
        } else {
          addCheck(
            checks,
            "fail",
            "HTTP /api/setup/status",
            setupStatus?.error || "database not configured",
            `The app cannot use its database. Verify the PostgreSQL check above, then apply migrations and seed with: ${reseedHint}`
          );
        }
      } catch (error) {
        addCheck(
          checks,
          unreachableStatus,
          "HTTP /api/setup/status",
          error.message,
          unreachableRemediation
        );
      }
    }
  }

  for (const check of checks) {
    result.summary[check.status] += 1;
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printDoctorResult(result);
  }

  return result.summary.fail > 0 ? 1 : 0;
}

// Same shape as doctor's failing checks: what went wrong, then the next step on
// its own indented line.
function printResetPasswordError(message, remediation) {
  console.error(`[seqdesk] ${message}`);
  if (remediation) {
    console.error(`  -> ${remediation}`);
  }
}

function promptLine(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: Boolean(process.stdin.isTTY),
    });

    let answered = false;
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolve(answer);
    });
    // stdin can be closed or empty (a pipe, a CI step, `< /dev/null`). Report
    // that as "nobody answered" rather than as a declined confirmation, because
    // the two need different advice.
    rl.on("close", () => {
      if (!answered) {
        resolve(null);
      }
    });
  });
}

function runInstalledResetPasswordWorker({ appDir, workerPath, email, password, databaseUrl, directUrl }) {
  return new Promise((resolve, reject) => {
    const childArgs = [workerPath, "--email", email];
    if (password) {
      childArgs.push("--password", password);
    }
    childArgs.push("--json");

    // stdout is captured rather than inherited: it carries the one JSON line of
    // the contract, including the new password, and it must be printed by this
    // process exactly once and in the agreed format.
    const child = spawn(process.execPath, childArgs, {
      cwd: appDir,
      env: { ...env, DATABASE_URL: databaseUrl, DIRECT_URL: directUrl },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      reject(new Error(`Failed to start the installed password-reset worker: ${error.message}`));
    });

    child.on("close", (code, signal) => {
      if (signal) {
        reject(new Error(`The installed password-reset worker exited with signal ${signal}`));
        return;
      }
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function parseWorkerPayload(stdout) {
  const line = stdout
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .pop();
  if (!line) {
    return null;
  }
  try {
    const parsed = JSON.parse(line);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function summarizeWorkerStderr(stderr) {
  const lines = stderr
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return "";
  }
  return lines.slice(-3).join(" | ");
}

function describeWorkerFailure(payload, context) {
  const detail = firstString(payload.error) || "no reason reported";
  switch (firstString(payload.code)) {
    case "not-found":
      return {
        // The worker looks for a case-insensitive near-match and says so, which
        // is the single most useful thing to print here: a wrong capital is the
        // mistake a locked-out operator actually makes. Pass its wording through.
        message: detail !== "no reason reported"
          ? detail
          : `No SeqDesk account has the email ${context.email} in ${context.database}.`,
        remediation: `The address is matched exactly as stored. Check the spelling, or confirm --dir points at the install that owns this database: ${context.doctorHint}`,
      };
    case "db-unreachable":
      return {
        message: `PostgreSQL at ${context.database} did not answer: ${detail}`,
        remediation: `Start the database and re-check the connection: ${context.doctorHint}. See ${DOCS_POSTGRES_URL}`,
      };
    case "bad-usage":
      return {
        message: `The installed password-reset worker rejected the request: ${detail}`,
        remediation: `seqdesk ${version} and the release in ${context.installDir} disagree about the reset-password interface. Update the install: ${context.updateHint}`,
      };
    default:
      return {
        message: `The password was not changed: ${detail}`,
        remediation: `Check the install first: ${context.doctorHint}. If it passes, see ${DOCS_COMMON_PROBLEMS_URL}`,
      };
  }
}

function printResetPasswordPlan({ email, installDir, database }) {
  console.log(`${style.bold}SeqDesk reset-password${style.reset}`);
  printKv("Account", email);
  printKv("Directory", installDir);
  printKv("Database", database);
  console.log("");
  console.log(`This replaces the password of ${email} in that database. Nothing else changes.`);
}

function printResetPasswordResult(result) {
  console.log(`${style.bold}SeqDesk reset-password${style.reset}`);
  printKv("Account", result.email);
  const name = [result.firstName, result.lastName].filter(Boolean).join(" ").trim();
  if (name) {
    printKv("Name", name);
  }
  if (result.role) {
    printKv("Role", result.role);
  }
  printKv("Directory", result.installDir);
  printKv("Database", result.database);

  printHeader("New password");
  console.log(`  ${result.password}`);
  console.log("");
  console.log(
    result.generated
      ? "  Generated for this reset and printed here once."
      : "  Set from the value you passed, and printed here once."
  );
  console.log(
    "  It is stored nowhere: SeqDesk keeps only its bcrypt hash, and this command"
  );
  console.log("  writes it to no file. Copy it now, then change it after signing in.");
}

async function runResetPassword(argv) {
  let options;
  try {
    options = parseResetPasswordArgs(argv);
  } catch (error) {
    console.error(`[seqdesk] ${error.message}`);
    console.error("");
    console.error(RESET_PASSWORD_USAGE.trim());
    return 2;
  }

  if (options.help) {
    console.log(RESET_PASSWORD_USAGE.trim());
    return 0;
  }

  const installDir = options.dir;
  const doctorHint = `npx -y seqdesk@latest doctor --dir ${shellQuote(installDir)}`;
  const reconfigureHint = `npx -y seqdesk@latest -y --reconfigure --dir ${shellQuote(installDir)}`;
  const updateHint = `curl -fsSL ${INSTALL_URL} | bash -s -- --dir ${shellQuote(installDir)}`;

  const fail = (message, remediation) => {
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            ok: false,
            installDir,
            email: options.email,
            error: message,
            ...(remediation ? { remediation } : {}),
          },
          null,
          2
        )
      );
    } else {
      printResetPasswordError(message, remediation);
    }
    return 1;
  };

  if (!dirExists(installDir)) {
    return fail(
      `Install directory does not exist: ${installDir}`,
      `Pass --dir with the directory the installer reported, or install first: curl -fsSL ${INSTALL_URL} | bash`
    );
  }

  const configPath = resolveConfigPath(installDir);
  const configName = path.basename(configPath);
  if (!fileExists(configPath)) {
    return fail(
      `${installDir} has no ${configName}, so the database to change is unknown.`,
      `Point --dir at the directory the installer reported, or recreate the runtime config with: ${reconfigureHint}`
    );
  }

  let config;
  try {
    config = readJsonFile(configPath);
  } catch (error) {
    return fail(
      `${configPath} is not valid JSON: ${error.message}`,
      `Fix the JSON syntax in ${configPath}, or rewrite it with: ${reconfigureHint}`
    );
  }

  const runtime = isPlainObject(config?.runtime) ? config.runtime : {};
  const databaseUrl = firstString(runtime.databaseUrl, config?.databaseUrl);
  const configuredDirectUrl = firstString(
    runtime.directUrl,
    runtime.databaseDirectUrl,
    config?.directUrl
  );

  const databaseValidation = validatePostgresUrl(databaseUrl);
  if (!databaseValidation.ok) {
    return fail(
      `runtime.databaseUrl in ${configName} is ${databaseValidation.detail}.`,
      `Set runtime.databaseUrl in ${configName} to postgresql://user:password@host:5432/dbname (append ?host=/path/to/socket/dir for a Unix socket), or rewrite it with: ${reconfigureHint}`
    );
  }

  if (configuredDirectUrl) {
    const directValidation = validatePostgresUrl(configuredDirectUrl);
    if (!directValidation.ok) {
      return fail(
        `runtime.directUrl in ${configName} is ${directValidation.detail}.`,
        `Set runtime.directUrl in ${configName} to the same database in postgresql:// form, or remove it to fall back to runtime.databaseUrl.`
      );
    }
  }

  // The connection strings go to the worker verbatim, socket form and all: a
  // "?host=/path" parameter is how libpq and Prisma are told to use a Unix
  // socket, and rewriting it here would point the worker at a different server
  // than the one doctor reports on.
  const directUrl = configuredDirectUrl || databaseUrl;
  const database = databaseValidation.detail;

  const appDir = resolveAppDir(installDir);
  const workerPath = path.join(appDir, "scripts", "reset-password.mjs");
  if (!fileExists(workerPath)) {
    let installedVersion = "";
    try {
      installedVersion = firstString(readJsonFile(path.join(installDir, "package.json")).version);
    } catch {
      // No readable package.json: report the missing worker without a version.
    }
    return fail(
      `The installed release has no password-reset worker at ${workerPath}${installedVersion ? ` (installed release: ${installedVersion})` : ""}.`,
      `reset-password needs SeqDesk ${RESET_PASSWORD_MIN_APP_VERSION} or newer in the install directory. Update it with: ${updateHint}`
    );
  }

  if (!options.yes) {
    printResetPasswordPlan({ email: options.email, installDir, database });
    const answer = await promptLine("Reset this account's password? (y/N) ");
    if (answer === null) {
      printResetPasswordError(
        "Cancelled: no confirmation was read from stdin, so nothing was changed.",
        "Answer the prompt on a terminal, or pass --yes to confirm up front (that is what CI needs)."
      );
      return 1;
    }
    if (!/^(y|yes)$/i.test(answer.trim())) {
      console.error("[seqdesk] Cancelled. No password was changed.");
      return 1;
    }
    console.log("");
  }

  let worker;
  try {
    worker = await runInstalledResetPasswordWorker({
      appDir,
      workerPath,
      email: options.email,
      password: options.password,
      databaseUrl,
      directUrl,
    });
  } catch (error) {
    return fail(error.message, `Check the install first: ${doctorHint}`);
  }

  const payload = parseWorkerPayload(worker.stdout);
  if (!payload) {
    const stderrSummary = summarizeWorkerStderr(worker.stderr);
    return fail(
      `The installed password-reset worker exited with code ${worker.code} without reporting a result${stderrSummary ? `: ${stderrSummary}` : "."}`,
      `Run it directly to see the full output: DATABASE_URL=... ${shellQuote(process.execPath)} ${shellQuote(workerPath)} --email ${shellQuote(options.email)}. See ${DOCS_COMMON_PROBLEMS_URL}`
    );
  }

  if (payload.ok !== true || worker.code !== 0) {
    const described = describeWorkerFailure(payload, {
      email: options.email,
      database,
      installDir,
      doctorHint,
      updateHint,
    });
    return fail(described.message, described.remediation);
  }

  const result = {
    ok: true,
    installDir,
    database,
    email: firstString(payload.email) || options.email,
    role: firstString(payload.role),
    firstName: firstString(payload.firstName),
    lastName: firstString(payload.lastName),
    generated: payload.generated === true,
    password: typeof payload.password === "string" ? payload.password : "",
  };

  if (!result.password) {
    return fail(
      "The installed password-reset worker reported success but returned no password.",
      `Check the account by signing in, and check the install: ${doctorHint}`
    );
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printResetPasswordResult(result);
  }

  return 0;
}

function resolveProfileCode(profileId, explicitCode) {
  return firstString(
    explicitCode,
    process.env[profileCodeEnvName(profileId)],
    process.env.SEQDESK_PROFILE_CODE,
    process.env.SEQDESK_KEY
  );
}

function validateAssetInstallDir(installDir) {
  if (!dirExists(installDir)) {
    throw new Error(`Install directory does not exist: ${installDir}`);
  }
  if (!fileExists(path.join(installDir, "package.json"))) {
    throw new Error(`Install directory is missing package.json: ${installDir}`);
  }
  const assetScript = path.join(installDir, "scripts", "apply-install-profile-assets.mjs");
  if (!fileExists(assetScript)) {
    throw new Error(`Install directory is missing scripts/apply-install-profile-assets.mjs: ${installDir}`);
  }
  return assetScript;
}

function makeTempProfileFile(profileId, payload) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "seqdesk-profile-assets-"));
  const profilePath = path.join(tempDir, safeProfileFileName(profileId));
  fs.writeFileSync(profilePath, JSON.stringify(payload, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  return {
    path: profilePath,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

async function resolveHostedProfile(options) {
  const profileCode = resolveProfileCode(options.profile, options.profileCode);
  if (!options.profile) {
    throw new Error("--profile is required when --profile-config is not used");
  }
  if (!profileCode) {
    throw new Error(
      `--profile-code is required for profile '${options.profile}' (or set SEQDESK_PROFILE_CODE, SEQDESK_KEY, or ${profileCodeEnvName(options.profile)})`
    );
  }

  let profileUrl;
  try {
    profileUrl = new URL(
      `${options.profileRegistryUrl.replace(/\/+$/, "")}/${encodeURIComponent(options.profile)}/resolve`
    );
  } catch (error) {
    throw new Error(`Invalid --profile-registry-url: ${error.message}`);
  }

  let response;
  try {
    response = await fetch(profileUrl, {
      redirect: "follow",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${profileCode}`,
        "user-agent": `seqdesk/${version} assets`,
      },
    });
  } catch (error) {
    throw new Error(`Could not resolve hosted install profile '${options.profile}': ${error.message}`);
  }

  const text = await response.text();
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const json = JSON.parse(text);
      if (json?.error) message += `: ${json.error}`;
    } catch {
      // Keep the HTTP-only message. The response may be HTML from an upstream proxy.
    }
    throw new Error(`Could not resolve hosted install profile '${options.profile}': ${message}`);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error(`Hosted install profile '${options.profile}' returned invalid JSON: ${error.message}`);
  }
  if (!isPlainObject(payload)) {
    throw new Error(`Hosted install profile '${options.profile}' did not return a JSON object`);
  }

  return makeTempProfileFile(options.profile, payload);
}

function runInstalledAssetScript({ installDir, scriptPath, profileConfig, json }) {
  return new Promise((resolve, reject) => {
    const childArgs = [scriptPath, "--profile-config", profileConfig];
    if (json) childArgs.push("--json");

    const child = spawn(process.execPath, childArgs, {
      cwd: installDir,
      env,
      stdio: "inherit",
    });

    child.on("error", (error) => {
      reject(new Error(`Failed to start installed asset script: ${error.message}`));
    });

    child.on("close", (code, signal) => {
      if (signal) {
        reject(new Error(`Installed asset script exited with signal ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

function runInstalledPipelineScript({ installDir, argv }) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(installDir, "scripts", "pipeline-cli.js");
    if (!fileExists(scriptPath)) {
      reject(
        new Error(
          `Installed pipeline CLI not found at ${scriptPath}. Update the SeqDesk install before using pipeline commands.`
        )
      );
      return;
    }

    const child = spawn(process.execPath, [scriptPath, ...argv], {
      cwd: installDir,
      env,
      stdio: "inherit",
    });

    child.on("error", (error) => {
      reject(new Error(`Failed to start installed pipeline CLI: ${error.message}`));
    });

    child.on("close", (code, signal) => {
      if (signal) {
        reject(new Error(`Installed pipeline CLI exited with signal ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

async function runAssets(argv) {
  let options;
  try {
    options = parseAssetsArgs(argv);
  } catch (error) {
    console.error(`[seqdesk] ${error.message}`);
    console.error("");
    console.error(ASSETS_USAGE.trim());
    return 2;
  }

  if (options.help) {
    console.log(ASSETS_USAGE.trim());
    return 0;
  }

  let tempProfile = null;
  try {
    const scriptPath = validateAssetInstallDir(options.dir);
    let profileConfig = options.profileConfig;
    if (profileConfig) {
      if (!fileExists(profileConfig)) {
        throw new Error(`Profile config file does not exist: ${profileConfig}`);
      }
    } else {
      if (!options.json) {
        console.error(`[seqdesk] Resolving hosted install profile '${options.profile}'`);
      }
      tempProfile = await resolveHostedProfile(options);
      profileConfig = tempProfile.path;
    }

    return await runInstalledAssetScript({
      installDir: options.dir,
      scriptPath,
      profileConfig,
      json: options.json,
    });
  } catch (error) {
    console.error(`[seqdesk] ${error.message}`);
    return 1;
  } finally {
    tempProfile?.cleanup();
  }
}

async function runPipeline(argv) {
  let options;
  try {
    options = parsePipelineLauncherArgs(argv);
  } catch (error) {
    console.error(`[seqdesk] ${error.message}`);
    console.error("");
    console.error(PIPELINE_USAGE.trim());
    return 2;
  }

  if (options.help) {
    console.log(PIPELINE_USAGE.trim());
    return 0;
  }

  try {
    return await runInstalledPipelineScript({
      installDir: options.dir,
      argv,
    });
  } catch (error) {
    console.error(`[seqdesk] ${error.message}`);
    return 1;
  }
}

async function downloadInstaller() {
  let response;
  try {
    response = await fetch(INSTALL_URL, {
      redirect: "follow",
      headers: {
        "user-agent": `seqdesk/${version}`,
      },
    });
  } catch (error) {
    throw new Error(`Could not download installer from ${INSTALL_URL}: ${error.message}`);
  }

  if (!response.ok) {
    throw new Error(`Could not download installer from ${INSTALL_URL}: HTTP ${response.status}`);
  }

  return response.text();
}

function runInstaller(script) {
  return new Promise((resolve, reject) => {
    let tempDir;
    let scriptPath;

    try {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "seqdesk-installer-"));
      scriptPath = path.join(tempDir, "install.sh");
      fs.writeFileSync(scriptPath, script, { mode: 0o700 });
    } catch (error) {
      reject(new Error(`Could not prepare the installer: ${error.message}`));
      return;
    }

    const cleanup = () => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Best effort: the operating system will eventually clear its temp dir.
      }
    };

    // Run a real file instead of piping the script to `bash -s`. Piping consumes
    // stdin and makes the installer's guided prompts believe no TTY is present.
    const bash = spawn("bash", [scriptPath, ...args], {
      env,
      stdio: "inherit",
    });

    let settled = false;

    function finishError(error) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }

    function finishSuccess(code) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(code ?? 1);
    }

    bash.on("error", (error) => {
      finishError(new Error(`Failed to start bash: ${error.message}`));
    });

    bash.on("close", (code, signal) => {
      if (signal) {
        finishError(new Error(`Installer exited with signal ${signal}`));
        return;
      }
      finishSuccess(code);
    });

  });
}

async function main() {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(`seqdesk ${version}`);
    console.log("");
    console.log("Usage:");
    console.log("  seqdesk [installer options]");
    console.log("  seqdesk doctor [options]");
    console.log("  seqdesk reset-password --email <address> [options]");
    console.log("  seqdesk assets apply [options]");
    console.log("  seqdesk pipeline <command> [options]");
    console.log("  seqdesk --version");
    console.log("");
    console.log("Common installer options:");
    console.log("  --interactive        Guided database and bootstrap-account setup");
    console.log("  -y, --yes            Non-interactive install using configured/default values");
    console.log("  --dir <path>         Explicit installation directory");
    console.log("  --with-pipelines     Install optional Conda/Nextflow pipeline support");
    console.log("  --without-pipelines  Install the core application only (default)");
    console.log("  --config <path>      Read unattended installation settings from JSON");
    console.log("");
    console.log("Local-only binding: SEQDESK_BIND_HOST=127.0.0.1 seqdesk --interactive");
    console.log(`Full guide: ${DOCS_INSTALLATION_URL}`);
    return;
  }

  if (args[0] === "--version" || args[0] === "-v") {
    console.log(version);
    return;
  }

  if (args[0] === "doctor") {
    const exitCode = await runDoctor(args.slice(1));
    process.exit(exitCode);
  }

  if (args[0] === "reset-password") {
    const exitCode = await runResetPassword(args.slice(1));
    process.exit(exitCode);
  }

  if (args[0] === "assets") {
    const exitCode = await runAssets(args.slice(1));
    process.exit(exitCode);
  }

  if (args[0] === "pipeline") {
    const exitCode = await runPipeline(args.slice(1));
    process.exit(exitCode);
  }

  const script = await downloadInstaller();
  const exitCode = await runInstaller(script);
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(`[seqdesk] ${error.message}`);
  process.exit(1);
});
