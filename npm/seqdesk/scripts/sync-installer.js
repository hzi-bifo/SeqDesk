"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const defaultRepositoryRoot = path.resolve(__dirname, "..", "..", "..");
const defaultSourcePath = path.join(
  defaultRepositoryRoot,
  "scripts",
  "install-dist.sh",
);
const defaultTargetPath = path.resolve(
  __dirname,
  "..",
  "installer",
  "install.sh",
);

function digest(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function readRequiredFile(filePath, label) {
  try {
    return fs.readFileSync(filePath);
  } catch (error) {
    throw new Error(
      `[sync-installer] Could not read ${label} at ${filePath}: ${error.message}`,
    );
  }
}

function synchronizeInstaller({
  sourcePath = defaultSourcePath,
  targetPath = defaultTargetPath,
  check = false,
  log = console.log,
} = {}) {
  const source = readRequiredFile(sourcePath, "the canonical installer");
  const firstLine = source.toString("utf8", 0, 64).split("\n", 1)[0];
  if (firstLine !== "#!/bin/bash" && firstLine !== "#!/usr/bin/env bash") {
    throw new Error(
      `[sync-installer] Refusing to bundle ${sourcePath}: expected a Bash installer.`,
    );
  }

  let target = null;
  try {
    target = fs.readFileSync(targetPath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new Error(
        `[sync-installer] Could not read the bundled installer at ${targetPath}: ${error.message}`,
      );
    }
  }

  const contentMatches = target !== null && source.equals(target);
  const targetIsExecutable =
    target !== null && (fs.statSync(targetPath).mode & 0o111) !== 0;
  const sourceDigest = digest(source);

  if (check) {
    if (!contentMatches || !targetIsExecutable) {
      throw new Error(
        "[sync-installer] The bundled npm installer is missing or stale. " +
          "Run `npm run sync-installer` from npm/seqdesk and include the generated file.",
      );
    }
    log(
      `[sync-installer] Bundled installer matches scripts/install-dist.sh (${sourceDigest.slice(0, 12)}).`,
    );
    return { updated: false, sha256: sourceDigest };
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (!contentMatches) {
    const temporaryPath = `${targetPath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, source, { mode: 0o755 });
      fs.renameSync(temporaryPath, targetPath);
    } finally {
      fs.rmSync(temporaryPath, { force: true });
    }
  }
  fs.chmodSync(targetPath, 0o755);

  log(
    contentMatches && targetIsExecutable
      ? `[sync-installer] Bundled installer is already current (${sourceDigest.slice(0, 12)}).`
      : `[sync-installer] Updated npm/seqdesk/installer/install.sh (${sourceDigest.slice(0, 12)}).`,
  );
  return {
    updated: !contentMatches || !targetIsExecutable,
    sha256: sourceDigest,
  };
}

if (require.main === module) {
  try {
    const arguments_ = process.argv.slice(2);
    if (arguments_.some((argument) => argument !== "--check")) {
      throw new Error(
        `[sync-installer] Unknown option: ${arguments_.find((argument) => argument !== "--check")}`,
      );
    }
    synchronizeInstaller({ check: arguments_.includes("--check") });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

module.exports = { synchronizeInstaller };
