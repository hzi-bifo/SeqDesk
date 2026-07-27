#!/usr/bin/env node
// Reset one account's password directly in the SeqDesk database.
//
// This is the worker behind `seqdesk reset-password`. The npm launcher reads
// the installed settings.json, exports DATABASE_URL / DIRECT_URL from it and
// runs this script out of the installed release, where @prisma/client and
// bcryptjs are resolvable. It can also be run by hand:
//
//   DATABASE_URL="postgresql://..." \
//     node scripts/reset-password.mjs --email admin@example.com
//
// Usage:
//   node scripts/reset-password.mjs --email <address> [--password <value>] [--json]
//
// With --json the script writes exactly one line of JSON to stdout and nothing
// else, which is the contract the launcher parses:
//
//   {"ok":true,"email":..,"role":..,"firstName":..,"lastName":..,
//    "generated":true|false,"password":..}
//   {"ok":false,"error":"<human readable>",
//    "code":"not-found"|"db-unreachable"|"bad-usage"|"unknown"}
//
// Exit code is 0 on success and non-zero on every failure.
//
// This grants no privilege that the caller did not already have: anyone who can
// read the connection string can change the row anyway. What it must not do is
// leave the new password behind, so the password is never written to a file and
// never printed outside the single JSON line (or, in the readable mode, the one
// line that exists to show it to the operator who asked for it).

import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const USAGE = `Usage:
  node scripts/reset-password.mjs --email <address> [--password <value>] [--json]

Options:
  --email <address>    Account to reset. Matched exactly, as stored in the User table.
  --password <value>   Password to set. Omit to generate a strong one and print it.
  --json               Print one line of JSON instead of readable text.
  -h, --help           Show this help.
`;

// Failure classes the launcher distinguishes, with a distinct exit code each so
// a shell caller can branch without parsing anything.
const EXIT_CODES = {
  unknown: 1,
  "bad-usage": 2,
  "not-found": 3,
  "db-unreachable": 4,
};

// bcrypt cost. Must stay in step with what the app writes elsewhere
// (src/lib/auto-seed.ts, prisma/seed.mjs and src/app/api/register/route.ts all
// hash user passwords at 12), otherwise a reset password would be stored at a
// different cost than every other password in the same table.
const BCRYPT_COST = 12;

// The installer generates database passwords as raw hex (see
// generate_postgres_password in scripts/install-dist.sh): CSPRNG bytes, and an
// alphabet with nothing in it that needs quoting in a shell, a URL or a
// connection string. Keep that reasoning and widen the alphabet a little, since
// this password is typed into a login form rather than embedded in a URL:
// letters and digits only -- no punctuation to quote or escape -- minus the
// characters that are misread when a password is read off a terminal and
// retyped (0/O, 1/l/I).
const PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const PASSWORD_LENGTH = 20;

class ResetError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * A password from the kernel CSPRNG, drawn uniformly from PASSWORD_ALPHABET.
 *
 * Bytes that would bias the modulo are rejected and redrawn. There is
 * deliberately no fallback: if the CSPRNG is unavailable this throws rather
 * than quietly producing something guessable.
 */
function generatePassword(length = PASSWORD_LENGTH) {
  const alphabet = PASSWORD_ALPHABET;
  const size = alphabet.length;
  // Largest multiple of `size` that fits in a byte; anything at or above it
  // would make the low residues more likely than the high ones.
  const limit = 256 - (256 % size);

  const out = [];
  while (out.length < length) {
    let bytes;
    try {
      bytes = randomBytes(length * 2);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new ResetError(
        "unknown",
        `Cannot generate a password: the system random number generator is unavailable (${detail}). ` +
          "Re-run with --password and a value you chose yourself."
      );
    }
    for (const byte of bytes) {
      if (byte >= limit) continue;
      out.push(alphabet[byte % size]);
      if (out.length === length) break;
    }
  }

  const password = out.join("");
  if (password.length !== length) {
    throw new ResetError("unknown", "Cannot generate a password of the requested length.");
  }
  return password;
}

/**
 * Whether the caller asked for JSON, read straight off argv.
 *
 * main() needs this before parseArgs has run, because a usage error happens
 * during parsing and a caller that asked for JSON has to get JSON back for that
 * failure too.
 */
function wantsJson(argv) {
  return argv.some((arg) => arg === "--json" || arg.startsWith("--json="));
}

function parseArgs(argv) {
  const args = { email: "", password: undefined };

  const takeValue = (flag, inlineValue, next) => {
    if (inlineValue !== undefined) return inlineValue;
    if (next === undefined) {
      throw new ResetError("bad-usage", `${flag} requires a value.`);
    }
    return next;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const equals = arg.indexOf("=");
    const flag = arg.startsWith("--") && equals > -1 ? arg.slice(0, equals) : arg;
    const inline = arg.startsWith("--") && equals > -1 ? arg.slice(equals + 1) : undefined;

    switch (flag) {
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "--json":
        // Handled by wantsJson() before parsing starts.
        break;
      case "--email":
      case "-e":
        args.email = takeValue("--email", inline, argv[index + 1]);
        if (inline === undefined) index += 1;
        break;
      case "--password":
      case "-p":
        args.password = takeValue("--password", inline, argv[index + 1]);
        if (inline === undefined) index += 1;
        break;
      default:
        throw new ResetError(
          "bad-usage",
          arg.startsWith("-")
            ? `Unknown option: ${flag}`
            : `Unexpected argument: ${arg}. This command takes flags, not positional arguments.`
        );
    }
  }

  if (args.help) return args;

  args.email = args.email.trim();
  if (!args.email) {
    throw new ResetError("bad-usage", "--email is required.");
  }
  if (args.password !== undefined && args.password.trim() === "") {
    throw new ResetError("bad-usage", "--password was given an empty value.");
  }

  return args;
}

/**
 * Reduce a Prisma error to the one line that says what actually went wrong.
 *
 * Prisma prefixes its messages with an "Invalid `prisma.user.findUnique()`
 * invocation:" banner and, for some errors, a code frame. Reporting the first
 * line verbatim would put that banner in the JSON `error` field and hide the
 * reason ("Can't reach database server at ..."), so the decoration is dropped
 * and the first line of substance is kept.
 */
function summarizeMessage(message) {
  const meaningful = message
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^Invalid `[^`]*` invocation:?$/.test(line))
    .filter((line) => !/^(→|at\s|\d+\s)/.test(line));

  return meaningful[0] || message.trim();
}

/**
 * Map a thrown error onto one of the four contract codes.
 *
 * Prisma reports everything it could not do to the server itself with a P1xxx
 * code or a PrismaClientInitializationError; those are the "the database is not
 * answering the way this needs it to" class. Anything else keeps its own
 * message under `unknown` rather than being dressed up as a connection problem.
 */
function classifyError(error) {
  if (error instanceof ResetError) {
    return { code: error.code, message: error.message };
  }

  const code = typeof error?.code === "string" ? error.code : "";
  const name = typeof error?.name === "string" ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  const summary = summarizeMessage(message);

  if (code.startsWith("P1") || name === "PrismaClientInitializationError") {
    return { code: "db-unreachable", message: summary };
  }
  if (code === "P2021" || code === "P2022") {
    return {
      code: "unknown",
      message: `${summary} The database is reachable but does not carry the SeqDesk schema; apply the migrations first.`,
    };
  }

  return { code: "unknown", message: summary };
}

/**
 * Look for other rows whose address differs only in case, so an operator who
 * typed the wrong case is told the address that does exist instead of just
 * "not found". Never used to pick a row: the reset itself only ever matches the
 * address exactly, the same way the login does.
 */
async function suggestSimilarEmail(prisma, email) {
  try {
    const matches = await prisma.user.findMany({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { email: true },
      take: 3,
    });
    const others = matches.map((row) => row.email).filter((value) => value !== email);
    return others.length > 0 ? others : undefined;
  } catch {
    return undefined;
  }
}

async function resetPassword({ email, password }) {
  if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.trim()) {
    throw new ResetError(
      "db-unreachable",
      "DATABASE_URL is not set, so there is no database to reset the password in."
    );
  }

  const generated = password === undefined;
  const newPassword = generated ? generatePassword() : password;

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { email: true, role: true, firstName: true, lastName: true },
    });

    if (!user) {
      const similar = await suggestSimilarEmail(prisma, email);
      throw new ResetError(
        "not-found",
        similar
          ? `No account with the email ${email}. This database has ${similar.join(", ")}, which differs only in capitalisation.`
          : `No account with the email ${email} exists in this database.`
      );
    }

    const hashed = await hash(newPassword, BCRYPT_COST);
    await prisma.user.update({
      where: { email },
      data: { password: hashed },
    });

    return {
      ok: true,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      generated,
      password: newPassword,
    };
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

function printReadableSuccess(result) {
  const name = [result.firstName, result.lastName].filter(Boolean).join(" ").trim();
  const who = name ? `${name}, role ${result.role}` : `role ${result.role}`;
  console.log(`Password reset for ${result.email} (${who}).`);
  if (result.generated) {
    // The one place a generated password is shown: this mode exists so an
    // operator can read it. It is not written anywhere else.
    console.log(`New password: ${result.password}`);
    console.log(
      "Pass it to the account holder over a channel you trust, and have them change it after signing in."
    );
  } else {
    console.log("The account now uses the password you supplied on the command line.");
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const json = wantsJson(argv);
  try {
    const args = parseArgs(argv);

    if (args.help) {
      console.log(USAGE);
      return;
    }

    const result = await resetPassword(args);

    if (json) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      printReadableSuccess(result);
    }
  } catch (error) {
    const { code, message } = classifyError(error);
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: message, code })}\n`);
    } else {
      console.error(message);
      if (code === "bad-usage") {
        console.error("");
        console.error(USAGE);
      }
    }
    process.exitCode = EXIT_CODES[code] || EXIT_CODES.unknown;
  }
}

await main();
