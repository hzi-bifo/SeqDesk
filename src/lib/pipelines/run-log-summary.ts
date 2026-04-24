import fs from "fs/promises";

const MAX_TAIL_BYTES = 256 * 1024;
const MAX_TAIL_LINES = 150;
const MAX_TAIL_CHARS = 8000;

function clip(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return value.slice(value.length - maxChars);
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function normalizeLine(line: string): string {
  return stripAnsi(line)
    .replace(/\u0000/g, "")
    .trim();
}

async function readTail(filePath: string, size: number): Promise<Buffer> {
  const handle = await fs.open(filePath, "r");
  try {
    const stat = await handle.stat();
    const start = Math.max(0, stat.size - size);
    const length = stat.size - start;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    return buffer;
  } finally {
    await handle.close();
  }
}

export async function readLogTailLines(filePath: string | null | undefined): Promise<string | null> {
  if (!filePath) return null;

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;

    const buffer = await readTail(filePath, Math.min(MAX_TAIL_BYTES, stat.size));
    const lines = buffer
      .toString("utf8")
      .split(/\r?\n/)
      .slice(-MAX_TAIL_LINES)
      .join("\n");

    return clip(lines, MAX_TAIL_CHARS);
  } catch {
    return null;
  }
}

function extractCommandError(lines: string[]): string | null {
  const commandErrorIndex = lines.findIndex((line) => line === "Command error:");
  if (commandErrorIndex < 0) return null;

  for (const line of lines.slice(commandErrorIndex + 1)) {
    if (!line || /^at\s+/i.test(line)) continue;
    if (
      /^Work dir:/i.test(line) ||
      /^Tip:/i.test(line) ||
      /^Command (executed|exit status|output|error):/i.test(line)
    ) {
      break;
    }
    return line.replace(/^Error:\s*/i, "").trim();
  }

  return null;
}

export function summarizeFailureTail(input: {
  outputTail: string | null;
  errorTail: string | null;
  exitCode: number | null;
}): string {
  const fallback = `Pipeline exited with code ${input.exitCode ?? "unknown"}`;
  const lines = [input.outputTail, input.errorTail]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => value.split(/\r?\n/))
    .map(normalizeLine)
    .filter(Boolean);

  if (lines.length === 0) return fallback;

  const commandError = extractCommandError(lines);
  if (commandError) return commandError;

  for (const line of lines) {
    if (
      /no template fastq pairs found/i.test(line) ||
      /template simulation /i.test(line) ||
      /missing input files/i.test(line)
    ) {
      return line.replace(/^Error:\s*/i, "").trim();
    }
  }

  for (const line of lines) {
    if (
      /(error|failed|exception|denied|invalid|unsupported|cannot|requires|missing|not found)/i.test(line) &&
      !/^ERROR ~ /i.test(line) &&
      !/^Process .* terminated with an error exit status/i.test(line)
    ) {
      return line.replace(/^Error:\s*/i, "").trim();
    }
  }

  return fallback;
}

export async function summarizePipelineFailure(input: {
  outputPath: string | null;
  errorPath: string | null;
  exitCode: number | null;
}): Promise<{ outputTail: string | null; errorTail: string }> {
  const [outputTail, errorTail] = await Promise.all([
    readLogTailLines(input.outputPath),
    readLogTailLines(input.errorPath),
  ]);

  return {
    outputTail,
    errorTail: summarizeFailureTail({
      outputTail,
      errorTail,
      exitCode: input.exitCode,
    }),
  };
}
