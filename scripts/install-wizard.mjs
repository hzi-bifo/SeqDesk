#!/usr/bin/env node

import fs from "fs";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

const colors = {
  reset: "\u001b[0m",
  cyan: "\u001b[36m",
  blue: "\u001b[34m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  bold: "\u001b[1m",
};

const isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);
const yesMode = isTruthy(process.env.SEQDESK_YES);
const outPath = process.env.SEQDESK_WIZARD_OUT;

if (!outPath) {
  console.error("SEQDESK_WIZARD_OUT is required");
  process.exit(1);
}

const pipelinesEnabled = isTruthy(process.env.SEQDESK_WIZARD_PIPELINES_ENABLED);
const defaultDataPath = process.env.SEQDESK_WIZARD_DEFAULT_DATA_PATH || "./data";
const defaultRunDir = process.env.SEQDESK_WIZARD_DEFAULT_RUN_DIR || "./pipeline_runs";

const defaults = {
  dataPath: process.env.SEQDESK_DATA_PATH || defaultDataPath,
  runDir: process.env.SEQDESK_RUN_DIR || defaultRunDir,
  nextAuthUrl: process.env.SEQDESK_NEXTAUTH_URL || "",
  databaseUrl: process.env.SEQDESK_DATABASE_URL || "",
};

if (yesMode) {
  writeOutput(defaults, pipelinesEnabled);
  process.exit(0);
}

if (!isTTY) {
  console.error("Interactive wizard requires a TTY. Set SEQDESK_YES=1 for non-interactive installs.");
  process.exit(1);
}

const rl = readline.createInterface({ input, output });

try {
  clearScreen();
  printHeader("SeqDesk Setup Wizard");
  printLine("Let's configure your installation. Press Enter to accept defaults.");
  printLine("");

  const dataPath = await ask("Sequencing data base path", defaults.dataPath);
  let runDir = defaults.runDir;
  if (pipelinesEnabled) {
    runDir = await ask("Pipeline run directory", defaults.runDir);
  }
  const nextAuthUrl = await askOptional("NEXTAUTH_URL (optional)", defaults.nextAuthUrl);
  const databaseUrl = await askOptional("DATABASE_URL (optional)", defaults.databaseUrl);

  const summary = {
    dataPath,
    runDir: pipelinesEnabled ? runDir : "(pipelines disabled)",
    nextAuthUrl: nextAuthUrl || "(not set)",
    databaseUrl: databaseUrl || "(not set)",
  };

  printLine("");
  printHeader("Review");
  printLine(`Data path: ${summary.dataPath}`);
  printLine(`Run dir:   ${summary.runDir}`);
  printLine(`NEXTAUTH_URL: ${summary.nextAuthUrl}`);
  printLine(`DATABASE_URL: ${summary.databaseUrl}`);
  printLine("");

  const confirmed = await confirm("Continue with these settings?", true);
  if (!confirmed) {
    printLine("Installation cancelled.");
    process.exit(2);
  }

  writeOutput({
    dataPath,
    runDir,
    nextAuthUrl,
    databaseUrl,
  }, pipelinesEnabled);
} finally {
  rl.close();
}

function ask(label, defaultValue) {
  return prompt(`${label} [${defaultValue}]: `, defaultValue);
}

function askOptional(label, defaultValue) {
  const placeholder = defaultValue || "";
  return prompt(`${label}${placeholder ? ` [${placeholder}]` : ""}: `, defaultValue);
}

async function prompt(question, defaultValue) {
  const answer = await rl.question(colors.cyan + question + colors.reset);
  if (!answer.trim()) {
    return defaultValue || "";
  }
  return answer.trim();
}

async function confirm(question, defaultYes) {
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = await rl.question(colors.cyan + `${question} ${suffix} ` + colors.reset);
  const normalized = answer.trim().toLowerCase();
  if (!normalized) return defaultYes;
  return normalized === "y" || normalized === "yes";
}

function writeOutput(values, pipelinesEnabled) {
  const lines = [];
  lines.push(`SEQDESK_DATA_PATH="${escapeShell(values.dataPath)}"`);
  if (pipelinesEnabled) {
    lines.push(`SEQDESK_RUN_DIR="${escapeShell(values.runDir || defaultRunDir)}"`);
  } else {
    lines.push("SEQDESK_RUN_DIR=\"\"");
  }
  lines.push(`SEQDESK_NEXTAUTH_URL="${escapeShell(values.nextAuthUrl || "")}"`);
  lines.push(`SEQDESK_DATABASE_URL="${escapeShell(values.databaseUrl || "")}"`);
  fs.writeFileSync(outPath, lines.join("\n") + "\n");
}

function escapeShell(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\"/g, "\\\"")
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`");
}

function isTruthy(value) {
  if (!value) return false;
  return ["1", "true", "yes", "y"].includes(String(value).toLowerCase());
}

function clearScreen() {
  process.stdout.write("\u001b[2J\u001b[H");
}

function printHeader(title) {
  const line = "=".repeat(Math.max(20, title.length + 6));
  printLine(colors.blue + line + colors.reset);
  printLine(colors.blue + `${title}` + colors.reset);
  printLine(colors.blue + line + colors.reset);
}

function printLine(text) {
  output.write(text + "\n");
}
