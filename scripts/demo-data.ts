#!/usr/bin/env node

import { db } from "@/lib/db";
import {
  DemoDataCommandError,
  executeDemoDataCommand,
  type DemoDataAction,
  type DemoDataCommandResult,
} from "@/lib/seed/demo-data-command";

const USAGE = `Usage:
  node scripts/demo-data.js <install|status|remove> --config <settings.json> [--user-email <address>] [--json]
`;

class DemoDataUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoDataUsageError";
  }
}

interface ParsedArgs {
  action: DemoDataAction;
  configPath: string;
  userEmail?: string;
  json: boolean;
  help: boolean;
}

function takeValue(
  argv: string[],
  index: number,
  flag: string,
  inlineValue?: string
): { value: string; nextIndex: number } {
  const value = inlineValue ?? argv[index + 1];
  if (!value || (inlineValue === undefined && value.startsWith("-"))) {
    throw new DemoDataUsageError(`${flag} requires a value.`);
  }
  return {
    value,
    nextIndex: inlineValue === undefined ? index + 1 : index,
  };
}

export function parseDemoDataWorkerArgs(argv: string[]): ParsedArgs {
  const actionToken = argv[0];
  if (actionToken === "--help" || actionToken === "-h") {
    return {
      action: "status",
      configPath: "",
      json: false,
      help: true,
    };
  }
  if (!["install", "status", "remove"].includes(actionToken)) {
    throw new DemoDataUsageError(
      "The first argument must be install, status, or remove."
    );
  }

  const parsed: ParsedArgs = {
    action: actionToken as DemoDataAction,
    configPath: "",
    json: false,
    help: false,
  };

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    const equalsIndex = token.indexOf("=");
    const flag =
      token.startsWith("--") && equalsIndex >= 0
        ? token.slice(0, equalsIndex)
        : token;
    const inlineValue =
      token.startsWith("--") && equalsIndex >= 0
        ? token.slice(equalsIndex + 1)
        : undefined;

    if (flag === "--help" || flag === "-h") {
      parsed.help = true;
      continue;
    }
    if (flag === "--json") {
      parsed.json = true;
      continue;
    }
    if (flag === "--config") {
      const taken = takeValue(argv, index, flag, inlineValue);
      parsed.configPath = taken.value;
      index = taken.nextIndex;
      continue;
    }
    if (flag === "--user-email" || flag === "--owner-email") {
      const taken = takeValue(argv, index, flag, inlineValue);
      parsed.userEmail = taken.value;
      index = taken.nextIndex;
      continue;
    }
    throw new DemoDataUsageError(`Unknown option: ${token}`);
  }

  if (!parsed.help && !parsed.configPath.trim()) {
    throw new DemoDataUsageError("--config is required.");
  }
  return parsed;
}

function printReadableResult(result: DemoDataCommandResult): void {
  console.log(`SeqDesk demo data ${result.action}`);
  console.log(`Owner: ${result.owner.displayName} <${result.owner.email}>`);
  console.log(`Data path: ${result.dataBasePath ?? "not configured"}`);
  if (result.action === "install") {
    if (result.alreadyInstalled) {
      console.log(`Already installed (${result.ordersCount} orders).`);
    } else {
      console.log(
        `Installed ${result.ordersCreated ?? 0} orders, ` +
          `${result.samplesCreated ?? 0} samples, ` +
          `${result.readsCreated ?? 0} read records, and ` +
          `${result.filesCreated ?? 0} FASTQ files.`
      );
    }
    return;
  }
  if (result.action === "remove") {
    if (result.alreadyAbsent) {
      console.log("No demo dataset was installed for this owner.");
    } else if (result.filesRemoved) {
      console.log(
        `Removed ${result.ordersDeleted ?? 0} orders and the generated FASTQ folder.`
      );
    } else {
      console.log(
        `Removed ${result.ordersDeleted ?? 0} orders. The generated FASTQ folder could not be removed and remains retryable.`
      );
    }
    if ((result.ticketLinksCleared ?? 0) > 0) {
      console.log(
        `Cleared ${result.ticketLinksCleared} fixture link${
          result.ticketLinksCleared === 1 ? "" : "s"
        } from preserved support tickets.`
      );
    }
    return;
  }
  if (result.cleanupPending) {
    console.log(
      result.filesPresent
        ? "Database rows are absent, but generated FASTQ files still need cleanup."
        : "A previous removal is still pending at the original storage path; retry remove."
    );
    return;
  }
  console.log(
    result.seeded
      ? `Installed (${result.ordersCount} orders).`
      : "Not installed."
  );
}

function classifyError(error: unknown): {
  code: string;
  error: string;
} {
  if (error instanceof DemoDataUsageError) {
    return { code: "BAD_USAGE", error: error.message };
  }
  if (error instanceof DemoDataCommandError) {
    return { code: error.code, error: error.message };
  }
  const candidate =
    error && typeof error === "object"
      ? (error as { code?: unknown; name?: unknown; message?: unknown })
      : null;
  const prismaCode =
    typeof candidate?.code === "string" ? candidate.code : "";
  const name = typeof candidate?.name === "string" ? candidate.name : "";
  if (/^P1\d{3}$/.test(prismaCode) || name.includes("PrismaClientInitialization")) {
    return {
      code: "DATABASE_UNREACHABLE",
      error: "The SeqDesk database could not be reached.",
    };
  }
  return {
    code: "UNKNOWN",
    error:
      typeof candidate?.message === "string" && candidate.message.trim()
        ? candidate.message.trim()
        : "The demo-data operation failed.",
  };
}

export async function runDemoDataWorker(argv: string[]): Promise<number> {
  const wantsJson = argv.some(
    (arg) => arg === "--json" || arg.startsWith("--json=")
  );
  try {
    const options = parseDemoDataWorkerArgs(argv);
    if (options.help) {
      console.log(USAGE.trim());
      return 0;
    }
    const result = await executeDemoDataCommand({
      action: options.action,
      configPath: options.configPath,
      userEmail: options.userEmail,
    });
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      printReadableResult(result);
    }
    return 0;
  } catch (error) {
    const failure = classifyError(error);
    if (wantsJson) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, ...failure })}\n`
      );
    } else {
      console.error(`[seqdesk] ${failure.error}`);
      if (failure.code === "BAD_USAGE") {
        console.error("");
        console.error(USAGE.trim());
      }
    }
    return failure.code === "BAD_USAGE" ? 2 : 1;
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

runDemoDataWorker(process.argv.slice(2)).then((exitCode) => {
  // Let Node flush piped JSON output before exiting. A forced process.exit()
  // can truncate the worker payload when stdout is back-pressured.
  process.exitCode = exitCode;
});
