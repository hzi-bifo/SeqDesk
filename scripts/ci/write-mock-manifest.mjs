#!/usr/bin/env node
/**
 * write-mock-manifest.mjs
 *
 * Emit a release manifest in the exact shape both the installer
 * (install-dist.sh -> GET $SEQDESK_API/version) and the in-app updater
 * (checker.ts -> GET $SEQDESK_UPDATE_SERVER/api/version) parse:
 *
 *   { updateAvailable, latest: { version, channel, releaseDate, downloadUrl,
 *     checksum, releaseNotes, minNodeVersion, databaseRequirement }, currentVersion }
 *
 * databaseRequirement is set to "postgresql" so the updater's
 * getDatabaseCompatibilityError passes against the provisioned Postgres. The
 * checksum must be a real "sha256:<64hex>" so verifyChecksum exercises the
 * hash-compare branch (not the placeholder skip).
 *
 * Usage:
 *   node scripts/ci/write-mock-manifest.mjs \
 *     --version <v> --download-url <url> --checksum sha256:<hex> --out <path> \
 *     [--update-available true|false] [--release-date YYYY-MM-DD] [--min-node 18.0.0] \
 *     [--notes "..."]
 */

import fs from "node:fs";
import path from "node:path";

function fail(message) {
  console.error(`write-mock-manifest: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) fail(`unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) fail(`missing value for --${key}`);
    out[key] = value;
    i += 1;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const version = args.version;
const downloadUrl = args["download-url"];
const checksum = args.checksum;
const out = args.out;

if (!version || !downloadUrl || !checksum || !out) {
  fail("required: --version, --download-url, --checksum, --out");
}
if (!/^sha256:[a-f0-9]{64}$/i.test(checksum)) {
  fail(`checksum must be sha256:<64 hex>, got "${checksum}"`);
}

const manifest = {
  updateAvailable: args["update-available"] !== "false",
  currentVersion: null,
  latest: {
    version,
    channel: "stable",
    releaseDate: args["release-date"] || "2026-01-01",
    downloadUrl,
    checksum,
    releaseNotes: args.notes || "CI Tier-2 update-E2E release artifact",
    minNodeVersion: args["min-node"] || "18.0.0",
    databaseRequirement: "postgresql",
  },
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`wrote ${out} (version ${version}, updateAvailable ${manifest.updateAvailable})\n`);
