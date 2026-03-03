#!/usr/bin/env node

"use strict";

const { spawn } = require("node:child_process");
const { version } = require("../package.json");

const INSTALL_URL = process.env.SEQDESK_INSTALL_URL || "https://seqdesk.com/install.sh";
const args = process.argv.slice(2);

if (process.platform === "win32") {
  console.error("[seqdesk] Windows is not supported directly. Use WSL and run `seqdesk` there.");
  process.exit(1);
}

const env = { ...process.env };
if (!env.SEQDESK_VERSION) {
  env.SEQDESK_VERSION = version;
}

const curl = spawn("curl", ["-fsSL", INSTALL_URL], {
  env,
  stdio: ["ignore", "pipe", "inherit"],
});

const bash = spawn("bash", ["-s", "--", ...args], {
  env,
  stdio: ["pipe", "inherit", "inherit"],
});

let downloadFailed = false;

curl.on("error", (error) => {
  downloadFailed = true;
  console.error(`[seqdesk] Failed to start curl: ${error.message}`);
  bash.kill("SIGTERM");
});

bash.on("error", (error) => {
  console.error(`[seqdesk] Failed to start bash: ${error.message}`);
  curl.kill("SIGTERM");
  process.exit(1);
});

curl.stdout.pipe(bash.stdin);

curl.on("close", (code, signal) => {
  if (signal) {
    downloadFailed = true;
    console.error(`[seqdesk] Installer download interrupted (${signal}).`);
    bash.kill("SIGTERM");
    return;
  }

  if (code !== 0) {
    downloadFailed = true;
    console.error(`[seqdesk] Could not download installer from ${INSTALL_URL}.`);
    bash.kill("SIGTERM");
  }
});

bash.on("close", (code, signal) => {
  if (signal) {
    process.exit(1);
  }

  if (downloadFailed) {
    process.exit(1);
  }

  process.exit(code ?? 1);
});
