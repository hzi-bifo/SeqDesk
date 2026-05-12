#!/usr/bin/env node

"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { version } = require("../package.json");

const INSTALL_URL = process.env.SEQDESK_INSTALL_URL || "https://seqdesk.com/install.sh";
const DEFAULT_PROFILE_REGISTRY_URL = "https://www.seqdesk.com/api/install-profiles";
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
  seqdesk doctor [--dir /path/to/seqdesk] [--url http://127.0.0.1:3000]

Options:
  --dir, -d          Installed SeqDesk directory. Defaults to the current directory.
  --url, -u          Running SeqDesk URL for HTTP checks.
  --timeout-ms       Timeout for PostgreSQL and HTTP checks. Defaults to 5000.
  --json             Print machine-readable JSON.
  --help, -h         Show this help.
`;

const ASSETS_USAGE = `Usage:
  seqdesk assets apply [--dir /path/to/seqdesk] (--profile <id> --profile-code <code> | --profile-config <file>)

Options:
  --dir, -d                    Installed SeqDesk directory. Defaults to the current directory.
  --profile <id>               Hosted install profile id, for example dev.
  --profile-code, --key <code> Hosted profile access code.
  --profile-config <file>      Already-resolved install profile JSON.
  --profile-registry-url <url> Hosted profile registry URL. Defaults to https://www.seqdesk.com/api/install-profiles.
  --json                       Print machine-readable JSON from the installed asset script.
  --help, -h                   Show this help.
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
      options.dir = token.slice("--dir=".length);
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
      options.dir = token.slice("--dir=".length);
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

function addCheck(checks, status, name, detail = "") {
  checks.push({ status, name, detail });
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

function summarizePostgresUrl(value) {
  const parsed = new URL(value);
  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, "")) || "(no database)";
  const port = parsed.port || "5432";
  return `${parsed.hostname}:${port}/${database}`;
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

  if (!parsed.hostname) {
    return { ok: false, detail: "missing host" };
  }

  if (!parsed.pathname || parsed.pathname === "/") {
    return { ok: false, detail: "missing database name" };
  }

  return { ok: true, detail: summarizePostgresUrl(value), parsed };
}

function connectTcp(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
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
    addCheck(checks, "fail", "Install directory", "directory does not exist");
    for (const check of checks) result.summary[check.status] += 1;
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printDoctorResult(result);
    }
    return 1;
  }
  addCheck(checks, "pass", "Install directory", installDir);

  const packagePath = path.join(installDir, "package.json");
  let packageJson = null;
  if (!fileExists(packagePath)) {
    addCheck(checks, "fail", "package.json", "missing");
  } else {
    try {
      packageJson = readJsonFile(packagePath);
      const name = firstString(packageJson.name) || "unknown";
      const appVersion = firstString(packageJson.version) || "unknown";
      addCheck(checks, "pass", "package.json", `${name}@${appVersion}`);
    } catch (error) {
      addCheck(checks, "fail", "package.json", `invalid JSON: ${error.message}`);
    }
  }

  const configPath = path.join(installDir, "seqdesk.config.json");
  let config = null;
  if (!fileExists(configPath)) {
    addCheck(checks, "fail", "seqdesk.config.json", "missing");
  } else {
    try {
      config = readJsonFile(configPath);
      addCheck(checks, "pass", "seqdesk.config.json", "parseable");
    } catch (error) {
      addCheck(checks, "fail", "seqdesk.config.json", `invalid JSON: ${error.message}`);
    }
  }

  const startPath = path.join(installDir, "start.sh");
  if (!fileExists(startPath)) {
    addCheck(checks, "fail", "start.sh", "missing");
  } else if (!checkExecutable(startPath)) {
    addCheck(checks, "fail", "start.sh", "not executable");
  } else {
    addCheck(checks, "pass", "start.sh", "executable");
  }

  if (dirExists(path.join(installDir, "node_modules"))) {
    addCheck(checks, "pass", "node_modules", "present");
  } else {
    addCheck(checks, "fail", "node_modules", "missing");
  }

  if (dirExists(path.join(installDir, ".next", "static"))) {
    addCheck(checks, "pass", ".next/static", "present");
  } else if (dirExists(path.join(installDir, ".next"))) {
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
      try {
        await connectTcp(databaseValidation.parsed.hostname, port, options.timeoutMs);
        addCheck(checks, "pass", "PostgreSQL TCP", `${databaseValidation.parsed.hostname}:${port} reachable`);
      } catch (error) {
        addCheck(checks, "fail", "PostgreSQL TCP", `${databaseValidation.parsed.hostname}:${port} unreachable: ${error.message}`);
      }
    } else {
      addCheck(checks, "fail", "runtime.databaseUrl", databaseValidation.detail);
    }

    if (directUrl) {
      const directValidation = validatePostgresUrl(directUrl);
      addCheck(
        checks,
        directValidation.ok ? "pass" : "fail",
        "runtime.directUrl",
        directValidation.detail
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
      addCheck(checks, "fail", "runtime.nextAuthSecret", "missing");
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
        `invalid URL: ${inferred.url}`
      );
      addCheck(checks, "warn", "HTTP checks", "skipped because app URL is invalid");
    } else if (!appUrl) {
      addCheck(checks, "warn", "HTTP checks", "skipped; pass --url or configure runtime.nextAuthUrl/app.port");
    } else {
      const unreachableStatus = inferred.source === "option" ? "fail" : "warn";
      try {
        const providers = await fetchJson(`${appUrl}/api/auth/providers`, options.timeoutMs);
        if (providers && isPlainObject(providers.credentials)) {
          addCheck(checks, "pass", "HTTP /api/auth/providers", "credentials auth available");
        } else {
          addCheck(checks, "fail", "HTTP /api/auth/providers", "credentials auth missing");
        }
      } catch (error) {
        addCheck(checks, unreachableStatus, "HTTP /api/auth/providers", error.message);
      }

      try {
        const setupStatus = await fetchJson(`${appUrl}/api/setup/status`, options.timeoutMs);
        if (setupStatus?.configured === true) {
          addCheck(checks, "pass", "HTTP /api/setup/status", "database configured");
        } else if (setupStatus?.exists === true) {
          addCheck(checks, "warn", "HTTP /api/setup/status", setupStatus.error || "database exists but is not seeded");
        } else {
          addCheck(checks, "fail", "HTTP /api/setup/status", setupStatus?.error || "database not configured");
        }
      } catch (error) {
        addCheck(checks, unreachableStatus, "HTTP /api/setup/status", error.message);
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
    const bash = spawn("bash", ["-s", "--", ...args], {
      env,
      stdio: ["pipe", "inherit", "inherit"],
    });

    let settled = false;

    function finishError(error) {
      if (settled) return;
      settled = true;
      reject(error);
    }

    function finishSuccess(code) {
      if (settled) return;
      settled = true;
      resolve(code ?? 1);
    }

    bash.on("error", (error) => {
      finishError(new Error(`Failed to start bash: ${error.message}`));
    });

    bash.stdin.on("error", (error) => {
      if (error && error.code === "EPIPE") {
        return;
      }
      finishError(new Error(`Failed to write installer to bash stdin: ${error.message}`));
    });

    bash.on("close", (code, signal) => {
      if (signal) {
        finishError(new Error(`Installer exited with signal ${signal}`));
        return;
      }
      finishSuccess(code);
    });

    bash.stdin.end(script);
  });
}

async function main() {
  if (args[0] === "doctor") {
    const exitCode = await runDoctor(args.slice(1));
    process.exit(exitCode);
  }

  if (args[0] === "assets") {
    const exitCode = await runAssets(args.slice(1));
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
