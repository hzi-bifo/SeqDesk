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
const defaultPort = process.env.SEQDESK_WIZARD_DEFAULT_PORT || "3000";

const defaults = {
  dataPath: process.env.SEQDESK_DATA_PATH || "",
  runDir: process.env.SEQDESK_RUN_DIR || "",
  port: process.env.SEQDESK_PORT || defaultPort,
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

await runWizard();

async function runWizard() {
  try {
    const clack = await import("@clack/prompts");
    await runClackWizard(clack);
  } catch {
    await runReadlineWizard();
  }
}

async function runClackWizard(clack) {
  const { intro, outro, text, confirm, note, isCancel, cancel } = clack;

  intro("SeqDesk Setup Wizard");
  note(
    "Minimal setup mode: configure data and pipeline paths later in Admin settings.",
    "Configuration"
  );

  const portValue = await text({
    message: "App port",
    placeholder: defaults.port,
    defaultValue: defaults.port,
  });
  if (isCancel(portValue)) {
    cancel("Installation cancelled");
    process.exit(2);
  }
  const port = String(portValue || defaults.port);
  const nextAuthUrl = defaults.nextAuthUrl || `http://localhost:${port}`;
  const databaseUrl = defaults.databaseUrl || "";

  note(
    [
      `Port:      ${port || defaults.port}`,
      `NEXTAUTH_URL: ${nextAuthUrl}`,
      `Data path: ${defaults.dataPath || "configure later in Admin > Data Storage"}`,
      `Run dir:   ${
        pipelinesEnabled
          ? defaults.runDir || "configure later in Admin > Pipeline Runtime"
          : "(pipelines disabled)"
      }`,
      `DATABASE_URL: ${databaseUrl || "(default sqlite)"}`,
    ].join("\n"),
    "Review"
  );

  const confirmed = await confirm({
    message: "Continue with these settings?",
    initialValue: true,
  });
  if (isCancel(confirmed) || !confirmed) {
    cancel("Installation cancelled");
    process.exit(2);
  }

  writeOutput(
    {
      dataPath: String(defaults.dataPath || ""),
      runDir: String(defaults.runDir || ""),
      port: String(port || defaults.port),
      nextAuthUrl: String(nextAuthUrl),
      databaseUrl: String(databaseUrl),
    },
    pipelinesEnabled
  );

  outro("Configuration saved. Continuing installation.");
}

async function runReadlineWizard() {
  const rl = readline.createInterface({ input, output });
  try {
    clearScreen();
    printHeader("SeqDesk Setup Wizard");
    printLine(
      "Minimal setup mode. Configure data and pipeline paths later in Admin settings."
    );
    printLine("");

    const port = await ask(rl, "App port", defaults.port);
    const nextAuthUrl = defaults.nextAuthUrl || `http://localhost:${port}`;
    const databaseUrl = defaults.databaseUrl || "";

    const summary = {
      port,
      nextAuthUrl,
      dataPath: defaults.dataPath || "configure later in Admin > Data Storage",
      runDir: pipelinesEnabled
        ? defaults.runDir || "configure later in Admin > Pipeline Runtime"
        : "(pipelines disabled)",
      databaseUrl: databaseUrl || "(default sqlite)",
    };

    printLine("");
    printHeader("Review");
    printLine(`Port:      ${summary.port}`);
    printLine(`NEXTAUTH_URL: ${summary.nextAuthUrl}`);
    printLine(`Data path: ${summary.dataPath}`);
    printLine(`Run dir:   ${summary.runDir}`);
    printLine(`DATABASE_URL: ${summary.databaseUrl}`);
    printLine("");

    const confirmed = await confirmText(rl, "Continue with these settings?", true);
    if (!confirmed) {
      printLine("Installation cancelled.");
      process.exit(2);
    }

    writeOutput(
      {
        dataPath: defaults.dataPath,
        runDir: defaults.runDir,
        port,
        nextAuthUrl,
        databaseUrl,
      },
      pipelinesEnabled
    );
  } finally {
    rl.close();
  }
}

function ask(rl, label, defaultValue) {
  return prompt(rl, `${label} [${defaultValue}]: `, defaultValue);
}

async function prompt(rl, question, defaultValue) {
  const answer = await rl.question(colors.cyan + question + colors.reset);
  if (!answer.trim()) {
    return defaultValue || "";
  }
  return answer.trim();
}

async function confirmText(rl, question, defaultYes) {
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = await rl.question(colors.cyan + `${question} ${suffix} ` + colors.reset);
  const normalized = answer.trim().toLowerCase();
  if (!normalized) return defaultYes;
  return normalized === "y" || normalized === "yes";
}

function writeOutput(values, pipelinesEnabled) {
  const port = values.port || defaultPort;
  const nextAuthUrl = values.nextAuthUrl || `http://localhost:${port}`;
  const lines = [];
  lines.push(`SEQDESK_DATA_PATH="${escapeShell(values.dataPath)}"`);
  if (pipelinesEnabled) {
    lines.push(`SEQDESK_RUN_DIR="${escapeShell(values.runDir || "")}"`);
  } else {
    lines.push("SEQDESK_RUN_DIR=\"\"");
  }
  lines.push(`SEQDESK_PORT="${escapeShell(port)}"`);
  lines.push(`SEQDESK_NEXTAUTH_URL="${escapeShell(nextAuthUrl)}"`);
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
