#!/usr/bin/env node
/**
 * derive-update-tarball.mjs
 *
 * Tier-2 update-E2E helper. Given the "from" release tarball that the normal
 * build job produces (seqdesk-<Vfrom>.tar.gz), derive a genuinely distinct,
 * installable "to" tarball WITHOUT a second `next build`:
 *   1. extract the from tarball (top-level dir: seqdesk-<Vfrom>/)
 *   2. compute Vto = patch-bump(Vfrom) and assert Vto !== Vfrom
 *   3. rewrite the inner package.json .version to Vto — this is the ONLY runtime
 *      version source (getCurrentVersion/getInstalledVersion read
 *      process.cwd()/package.json at boot), and the updater's
 *      verifyInstalledVersion asserts the staged package.json.version equals the
 *      manifest's latest.version, so a re-stamp yields a real, installable release.
 *   4. inject ONE additive, non-destructive migration
 *      (CREATE TABLE IF NOT EXISTS only) with a timestamp that sorts last, so
 *      `migrate deploy` from the activated Vto release is genuinely non-empty
 *      while never decreasing any row count (the installer's data-loss guard
 *      only trips on a strict DECREASE of orders/samples/studies/users).
 *   5. rename the top-level dir to seqdesk-<Vto>/ so `tar --strip-components=1`
 *      stays valid, re-tar, and emit Vto + the real sha256 of the new tarball.
 *
 * Usage:
 *   node scripts/ci/derive-update-tarball.mjs \
 *     --from-tarball <path/to/seqdesk-Vfrom.tar.gz> \
 *     --work-dir <scratch dir> \
 *     --out-dir <dir for the new tarball> \
 *     [--github-env <path>]   # if set, append VTO/UPDATE_TARBALL/UPDATE_CHECKSUM
 *
 * Prints a JSON summary { fromVersion, toVersion, tarball, checksum } to stdout.
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SAFE_RELEASE_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,127}$/;
// Destructive DDL that must never appear in the generated migration. The
// updater's data-loss guard only catches row-count decreases, so this static
// guard is the belt-and-suspenders against an additive migration ever turning
// destructive.
const DESTRUCTIVE_SQL_PATTERN = /\b(DROP|TRUNCATE)\b|\bALTER\b[\s\S]*\bDROP\b/i;

function fail(message) {
  console.error(`derive-update-tarball: ${message}`);
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

function bumpPatch(version) {
  const parts = String(version).split(".");
  if (parts.length < 2) {
    fail(`cannot derive a distinct version from "${version}" (expected dotted semver)`);
  }
  const lastIndex = parts.length - 1;
  // Tolerate a trailing pre-release/build suffix on the final segment by
  // incrementing only its leading integer run.
  const match = String(parts[lastIndex]).match(/^(\d+)/);
  if (!match) {
    fail(`final version segment "${parts[lastIndex]}" is not numeric; cannot bump`);
  }
  const bumped = String(Number(match[1]) + 1);
  parts[lastIndex] = bumped;
  return parts.join(".");
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function tar(args) {
  execFileSync("tar", args, { stdio: ["ignore", "ignore", "inherit"] });
}

const args = parseArgs(process.argv.slice(2));
const fromTarball = args["from-tarball"];
const workDir = args["work-dir"];
const outDir = args["out-dir"];
const githubEnv = args["github-env"];

if (!fromTarball || !workDir || !outDir) {
  fail("required: --from-tarball, --work-dir, --out-dir");
}
if (!fs.existsSync(fromTarball)) fail(`from tarball not found: ${fromTarball}`);

fs.rmSync(workDir, { recursive: true, force: true });
fs.mkdirSync(workDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

// 1. Extract the from tarball. It has a single top-level seqdesk-<Vfrom>/ dir.
tar(["-xzf", fromTarball, "-C", workDir]);
const topEntries = fs
  .readdirSync(workDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);
if (topEntries.length !== 1) {
  fail(`expected exactly one top-level dir in the tarball, found: ${topEntries.join(", ") || "none"}`);
}
const fromDirName = topEntries[0];
const fromDir = path.join(workDir, fromDirName);

// 2. Read Vfrom from the inner package.json and compute Vto.
const pkgPath = path.join(fromDir, "package.json");
if (!fs.existsSync(pkgPath)) fail(`package.json missing inside ${fromDirName}`);
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const fromVersion = String(pkg.version || "").trim();
if (!fromVersion) fail("inner package.json has no version");
const toVersion = bumpPatch(fromVersion);
if (toVersion === fromVersion) fail(`derived version equals source version (${fromVersion})`);
if (!SAFE_RELEASE_VERSION_PATTERN.test(toVersion)) {
  fail(`derived version "${toVersion}" fails SAFE_RELEASE_VERSION_PATTERN`);
}

// 3. Re-stamp the inner package.json version (the sole runtime version source).
pkg.version = toVersion;
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

// 4. Inject one additive, non-destructive migration that sorts last.
const migrationsDir = path.join(fromDir, "prisma", "migrations");
if (!fs.existsSync(migrationsDir)) {
  fail("prisma/migrations is missing from the tarball; migrate deploy would have nothing to apply");
}
const additiveDir = path.join(migrationsDir, "99999999999999_ci_e2e_additive");
fs.mkdirSync(additiveDir, { recursive: true });
const migrationSql = `-- CI-only additive probe migration injected by derive-update-tarball.mjs.
-- Additive and idempotent: it never drops or rewrites existing data, so the
-- updater's row-count data-loss guard stays green while proving migrate deploy
-- applies a real, pending schema change from the "to" release.
CREATE TABLE IF NOT EXISTS "_ci_e2e_probe" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "_ci_e2e_probe_pkey" PRIMARY KEY ("id")
);
`;
if (DESTRUCTIVE_SQL_PATTERN.test(migrationSql)) {
  fail("generated migration contains destructive DDL; refusing to build the update tarball");
}
fs.writeFileSync(path.join(additiveDir, "migration.sql"), migrationSql);

// 5. Rename the top-level dir to seqdesk-<Vto>/ and re-tar.
const toDirName = `seqdesk-${toVersion}`;
const toDir = path.join(workDir, toDirName);
if (toDirName !== fromDirName) {
  fs.renameSync(fromDir, toDir);
}
const outTarball = path.join(outDir, `seqdesk-${toVersion}.tar.gz`);
fs.rmSync(outTarball, { force: true });
tar(["-czf", outTarball, "-C", workDir, toDirName]);

const checksum = `sha256:${sha256File(outTarball)}`;
const summary = { fromVersion, toVersion, tarball: outTarball, checksum };

if (githubEnv) {
  fs.appendFileSync(
    githubEnv,
    `VFROM=${fromVersion}\nVTO=${toVersion}\nUPDATE_TARBALL=${outTarball}\nUPDATE_CHECKSUM=${checksum}\n`
  );
}

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
