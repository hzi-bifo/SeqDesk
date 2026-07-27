#!/usr/bin/env node
/**
 * Assert that what the installer PRINTED about login credentials is true.
 *
 * The installer's closing "Login" block is the only place a generated password
 * is ever shown, and an operator has no way to check it other than by trying to
 * sign in. So the single property worth asserting is: a password the installer
 * printed must authenticate. Every existing installation check starts from an
 * empty database, where a freshly generated password is always written, always
 * seeded, and therefore always works -- which is exactly why a second install
 * over a database that already held the bootstrap accounts could print
 * credentials that were never applied, and no check noticed.
 *
 * The parser reads the same lines a human reads, in both forms the summary
 * uses:
 *
 *     Admin                admin@example.com
 *     Admin password       <generated>
 *
 *     Admin                admin@example.com / admin
 *
 * Anything the summary does NOT claim is not asserted: "configured profile
 * password" and "not created" name no password, so there is nothing to verify.
 *
 * Usage:
 *   node scripts/ci/assert-printed-credentials.mjs \
 *     --summary <installer-stdout.log> \
 *     --base-url http://127.0.0.1:8801 \
 *     [--label "first install"] \
 *     [--require-printed-password] \
 *     [--require-disclosure] \
 *     [--result-file <path>]
 *
 *   --require-printed-password  Fail unless the summary printed at least one
 *                               "<role> password" line with a value. Guards the
 *                               leg that is supposed to exercise generated
 *                               credentials against silently degrading into a
 *                               run that prints nothing and asserts nothing.
 *   --require-disclosure        When the summary prints no usable credential,
 *                               it must say plainly that the database already
 *                               holds accounts. Silence is not an honest
 *                               outcome either: the operator is left with an
 *                               install they cannot sign in to and no reason
 *                               why.
 *
 * Passwords are never written to the result file and never echoed, so the file
 * is safe to upload as a build artifact.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = process.env.GITHUB_WORKSPACE || path.resolve(HERE, "..", "..");
const AUTH_E2E = path.join(WORKSPACE, "scripts", "run-auth-e2e.mjs");

const ROLES = [
  {
    key: "admin",
    label: "Admin",
    expectedRole: "FACILITY_ADMIN",
    checkPath: "/api/admin/users",
  },
  {
    key: "researcher",
    label: "Researcher",
    expectedRole: "RESEARCHER",
    checkPath: null,
  },
];

function fail(message, details) {
  console.error("");
  console.error(`FAIL: ${message}`);
  if (details) {
    console.error(details);
  }
  process.exit(1);
}

function parseArgs(argv) {
  const flags = new Set([
    "require-printed-password",
    "require-disclosure",
  ]);
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      fail(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    if (flags.has(key)) {
      result[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`Missing value for --${key}`);
    }
    result[key] = value;
    index += 1;
  }
  return result;
}

// The summary is written to a terminal, so it carries colour codes; a run under
// `script`/a pty additionally carries carriage returns.
function readSummaryLines(file) {
  if (!fs.existsSync(file)) {
    fail(`Installer summary not found: ${file}`);
  }
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.replace(/\u001B\[[0-9;]*[A-Za-z]/g, "").replace(/\r/g, ""));
}

// print_kv pads the label to 20 columns, so a value is always separated from
// its label by at least two spaces. The last occurrence wins: the closing Login
// block is printed after the pre-install configuration summary, which uses
// different labels ("Admin account") but is not worth depending on.
function lastLabelledValue(lines, label) {
  const pattern = new RegExp(`^\\s+${label}\\s{2,}(\\S.*?)\\s*$`);
  let value = null;
  for (const line of lines) {
    const match = pattern.exec(line);
    if (match) {
      value = match[1];
    }
  }
  return value;
}

function hasEmptyCredentialLabel(lines) {
  return lines.some((line) => /^\s+[A-Za-z]+ password\s*$/.test(line));
}

function parseIdentity(value) {
  if (!value) {
    return { email: null, password: null, note: null };
  }
  if (/^not created$/i.test(value)) {
    return { email: null, password: null, note: "not created" };
  }
  const parts = value.split(" / ");
  const email = parts[0].trim();
  if (parts.length === 1) {
    return { email, password: null, note: null };
  }
  // Everything after " / " is either a literal password
  //   "admin@example.com / admin"
  //   "user@example.com / user (default; change after first login)"
  // or prose about one, naming no value that could be tried:
  //   "admin@example.com / configured profile password"
  //   "admin@example.com / existing password (unchanged)"
  // A trailing parenthetical is an aside in both forms, so it is dropped first.
  // What is left is a value only if it is a single token that does not talk
  // about a password -- the installer's own passwords are hex or one word, and
  // treating "existing password" as a login attempt would fail an install that
  // was telling the truth.
  const rest = parts.slice(1).join(" / ").replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (!rest) {
    return { email, password: null, note: null };
  }
  if (/\s/.test(rest) || /password/i.test(rest)) {
    return { email, password: null, note: rest };
  }
  return { email, password: rest, note: null };
}

function parseCredentials(lines) {
  const credentials = [];
  for (const role of ROLES) {
    const identity = parseIdentity(lastLabelledValue(lines, role.label));
    const printedPassword = lastLabelledValue(lines, `${role.label} password`);
    credentials.push({
      ...role,
      email: identity.email,
      password: printedPassword || identity.password,
      passwordPrintedOnOwnLine: Boolean(printedPassword),
      note: identity.note,
    });
  }
  return credentials;
}

// Wording-independent: a disclosure has to talk about accounts/credentials that
// already exist. Pinning an exact sentence would make this check a spelling
// test that breaks on the first reword.
function findDisclosure(lines) {
  for (const line of lines) {
    if (!/\b(already|existing|unchanged|pre-existing)\b/i.test(line)) {
      continue;
    }
    if (!/\b(account|accounts|user|users|credential|credentials|password|passwords|login)\b/i.test(line)) {
      continue;
    }
    return line.trim();
  }
  return null;
}

function verifyLogin(credential, baseUrl) {
  const args = [
    AUTH_E2E,
    "--base-url",
    baseUrl,
    "--email",
    credential.email,
    "--password",
    credential.password,
  ];
  if (credential.expectedRole) {
    args.push("--expected-role", credential.expectedRole);
  }
  if (credential.checkPath) {
    args.push("--check-path", credential.checkPath);
  }
  const run = spawnSync(process.execPath, args, { encoding: "utf8" });
  return {
    ok: run.status === 0,
    output: [run.stdout, run.stderr].filter(Boolean).join("\n").trim(),
  };
}

const args = parseArgs(process.argv.slice(2));
const summaryFile = args.summary;
const baseUrl = args["base-url"];
const label = args.label || "install";

if (!summaryFile) {
  fail("Missing required --summary");
}
if (!baseUrl) {
  fail("Missing required --base-url");
}
if (!fs.existsSync(AUTH_E2E)) {
  fail(`Auth driver not found: ${AUTH_E2E}`);
}

const lines = readSummaryLines(summaryFile);

if (hasEmptyCredentialLabel(lines)) {
  fail(
    `The ${label} summary printed a credential label with no value.`,
    "The operator was handed an account name and no way to sign in to it."
  );
}

const credentials = parseCredentials(lines);
const verifiable = credentials.filter((entry) => entry.email && entry.password);
const printedOnOwnLine = credentials.filter((entry) => entry.passwordPrintedOnOwnLine);

if (args["require-printed-password"] && printedOnOwnLine.length === 0) {
  fail(
    `The ${label} summary printed no "<role> password" line.`,
    [
      "This leg only means something if the installer generated and displayed a",
      "password, so a summary without one is treated as a broken test rather",
      "than a pass. Summary was:",
      "",
      lines.join("\n"),
    ].join("\n")
  );
}

const results = [];
for (const credential of verifiable) {
  process.stdout.write(
    `Verifying the ${credential.key} credential printed by the ${label} (${credential.email}) ...\n`
  );
  const outcome = verifyLogin(credential, baseUrl);
  results.push({
    role: credential.key,
    email: credential.email,
    printedOnOwnLine: credential.passwordPrintedOnOwnLine,
    verified: outcome.ok,
  });
  if (!outcome.ok) {
    fail(
      `A password printed by the ${label} does not work (${credential.email}).`,
      [
        "The installer displayed this credential to the operator as the way to",
        "sign in, and it does not authenticate. Whatever the installer prints",
        "has to be true: either print credentials that work, or print none and",
        "say why.",
        "",
        `  base URL: ${baseUrl}`,
        `  summary:  ${summaryFile}`,
        "",
        outcome.output || "(no output from the auth driver)",
      ].join("\n")
    );
  }
  process.stdout.write(`ok: the printed ${credential.key} credential authenticates\n`);
}

const disclosure = findDisclosure(lines);

if (verifiable.length === 0) {
  if (args["require-disclosure"]) {
    if (!disclosure) {
      fail(
        `The ${label} printed no usable credential and did not say why.`,
        [
          "Nothing in the summary tells the operator that the database already",
          "holds the bootstrap accounts, so the install looks successful and",
          "the operator has no credential to try and no reason to look further.",
          "",
          "Summary was:",
          "",
          lines.join("\n"),
        ].join("\n")
      );
    }
    process.stdout.write(`ok: the ${label} disclosed the pre-existing accounts: ${disclosure}\n`);
  } else {
    process.stdout.write(`note: the ${label} printed no verifiable credential\n`);
  }
} else if (disclosure) {
  process.stdout.write(`note: the ${label} also disclosed: ${disclosure}\n`);
}

if (args["result-file"]) {
  // Deliberately free of password values: this file is uploaded as a build
  // artifact.
  fs.writeFileSync(
    args["result-file"],
    `${JSON.stringify(
      {
        label,
        summary: summaryFile,
        baseUrl,
        credentialsPrinted: results,
        credentialsWithoutPassword: credentials
          .filter((entry) => !(entry.email && entry.password))
          .map((entry) => ({ role: entry.key, email: entry.email, note: entry.note })),
        disclosure,
      },
      null,
      2
    )}\n`
  );
}

process.stdout.write(`Printed-credential check passed for the ${label}.\n`);
