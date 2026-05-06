#!/usr/bin/env node

import fs from "node:fs";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const result = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      fail(`Unexpected argument: ${arg}`);
    }

    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`Missing value for --${key}`);
    }
    result[key] = value;
    index += 1;
  }

  return result;
}

function toOptionalPort(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = Math.trunc(value);
    if (normalized > 0 && normalized <= 65535) {
      return normalized;
    }
    return undefined;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      const normalized = Math.trunc(parsed);
      if (normalized > 0 && normalized <= 65535) {
        return normalized;
      }
    }
  }

  return undefined;
}

function toOptionalBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return undefined;
}

function resolveConfiguredPort(config) {
  const appPort = toOptionalPort(config?.app?.port);
  if (appPort !== undefined) {
    return appPort;
  }

  const nextAuthUrl = config?.runtime?.nextAuthUrl;
  if (typeof nextAuthUrl === "string" && nextAuthUrl.trim()) {
    try {
      const parsed = new URL(nextAuthUrl);
      return toOptionalPort(parsed.port);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

const args = parseArgs(process.argv.slice(2));
const filePath = args.file;
const expectedPort = toOptionalPort(args["expected-port"]);
const expectedPipelinesEnabled = toOptionalBoolean(args["expected-pipelines-enabled"]) ?? false;

if (!filePath) {
  fail("Missing required --file");
}
if (expectedPort === undefined) {
  fail("Missing or invalid --expected-port");
}

let config;
try {
  config = JSON.parse(fs.readFileSync(filePath, "utf8"));
} catch (error) {
  fail(
    error instanceof Error
      ? `Failed to parse config file ${filePath}: ${error.message}`
      : `Failed to parse config file ${filePath}`
  );
}

if (config?.pipelines?.enabled !== expectedPipelinesEnabled) {
  fail(`Expected pipelines.enabled to be ${String(expectedPipelinesEnabled)}`);
}

const configuredPort = resolveConfiguredPort(config);
if (configuredPort !== expectedPort) {
  fail(`Expected configured port ${expectedPort}, got ${String(configuredPort)}`);
}

process.stdout.write(
  JSON.stringify(
    {
      file: filePath,
      port: configuredPort,
      pipelinesEnabled: config?.pipelines?.enabled,
    },
    null,
    2
  )
);
