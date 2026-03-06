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
  const script = await downloadInstaller();
  const exitCode = await runInstaller(script);
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(`[seqdesk] ${error.message}`);
  process.exit(1);
});
