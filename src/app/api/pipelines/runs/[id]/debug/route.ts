import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getExecutionSettings } from "@/lib/pipelines/execution-settings";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { isDemoSession } from "@/lib/demo/server";

const execFileAsync = promisify(execFile);

const MAX_COMMAND_OUTPUT = 16_000;
const MAX_FILE_OUTPUT = 16_000;
const MAX_TAIL_BYTES = 256 * 1024;
const MAX_TAIL_LINES = 150;

type CommandResult = {
  command: string;
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
};

type DebugFileInfo = {
  path: string;
  exists: boolean;
  size?: number;
  updatedAt?: string;
  tail?: string | null;
};

type DebugBundle = {
  generatedAt: string;
  run: {
    id: string;
    runNumber: string;
    pipelineId: string;
    status: string;
    statusSource: string | null;
    currentStep: string | null;
    progress: number | null;
    queueJobId: string | null;
    queueStatus: string | null;
    queueReason: string | null;
    createdAt: Date;
    queuedAt: Date | null;
    startedAt: Date | null;
    completedAt: Date | null;
    lastEventAt: Date | null;
    runFolder: string | null;
    outputPath: string | null;
    errorPath: string | null;
    outputTail: string | null;
    errorTail: string | null;
    config: Record<string, unknown> | null;
  };
  target: {
    type: "study" | "order";
    id: string;
    title: string;
    orderNumber?: string | null;
    selectedSamples: Array<{
      id: string;
      sampleId: string;
      readCount: number;
      reads: Array<{
        id: string;
        file1: string | null;
        file2: string | null;
        checksum1: string | null;
        checksum2: string | null;
      }>;
    }>;
    selectedSampleCount: number;
  } | null;
  study: {
    id: string;
    title: string;
    selectedSamples: Array<{
      id: string;
      sampleId: string;
      readCount: number;
      reads: Array<{
        id: string;
        file1: string | null;
        file2: string | null;
        checksum1: string | null;
        checksum2: string | null;
      }>;
    }>;
    selectedSampleCount: number;
  } | null;
  executionSettings: {
    useSlurm: boolean;
    slurmQueue: string;
    slurmCores: number;
    slurmMemory: string;
    slurmTimeLimit: number;
    slurmOptions: string;
    runtimeMode: "conda";
    condaPath: string;
    condaEnv: string;
    nextflowProfile: string;
    pipelineRunDir: string;
    weblogUrl: string;
    weblogSecretConfigured: boolean;
    condaScriptPath: string | null;
    condaScriptExists: boolean | null;
  };
  hostDiagnostics: {
    commandChecks: CommandResult[];
    condaChecks: CommandResult[];
    queueChecks: CommandResult[];
  };
  files: DebugFileInfo[];
  collectionCommand: string;
  notes: string[];
};

function clip(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const hidden = value.length - maxChars;
  return `${value.slice(0, maxChars)}\n...[truncated ${hidden} chars]`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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

async function readTailLines(filePath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
    const bytes = Math.min(MAX_TAIL_BYTES, stat.size);
    const buffer = await readTail(filePath, bytes);
    const lines = buffer
      .toString("utf-8")
      .split(/\r?\n/)
      .slice(-MAX_TAIL_LINES)
      .join("\n");
    return clip(lines, MAX_FILE_OUTPUT);
  } catch {
    return null;
  }
}

async function inspectFile(filePath: string): Promise<DebugFileInfo> {
  try {
    const stat = await fs.stat(filePath);
    const isTextLike = /\.(out|err|log|txt|sh|csv|yaml|yml|json|config|dot)$/i.test(
      filePath
    );
    return {
      path: filePath,
      exists: true,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
      tail: isTextLike ? await readTailLines(filePath) : null,
    };
  } catch {
    return {
      path: filePath,
      exists: false,
    };
  }
}

async function runShell(command: string, timeoutMs = 8_000): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-lc", command], {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    });
    return {
      command,
      ok: true,
      stdout: clip((stdout || "").trim(), MAX_COMMAND_OUTPUT),
      stderr: clip((stderr || "").trim(), MAX_COMMAND_OUTPUT),
    };
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string; code?: number | string };
    return {
      command,
      ok: false,
      stdout: clip((err.stdout || "").trim(), MAX_COMMAND_OUTPUT),
      stderr: clip((err.stderr || "").trim(), MAX_COMMAND_OUTPUT),
      error: err.message,
    };
  }
}

function valueOrDash(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function section(title: string): string {
  return `\n=== ${title} ===\n`;
}

function formatCommandResult(result: CommandResult): string {
  return [
    `Command: ${result.command}`,
    `OK: ${result.ok ? "yes" : "no"}`,
    result.error ? `Error: ${result.error}` : null,
    result.stdout ? `STDOUT:\n${result.stdout}` : "STDOUT: (empty)",
    result.stderr ? `STDERR:\n${result.stderr}` : "STDERR: (empty)",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildBundleText(bundle: DebugBundle): string {
  const lines: string[] = [];

  lines.push("SeqDesk Debug Bundle");
  lines.push(`GeneratedAt: ${bundle.generatedAt}`);

  lines.push(section("Run"));
  lines.push(`RunID: ${bundle.run.id}`);
  lines.push(`RunNumber: ${bundle.run.runNumber}`);
  lines.push(`Pipeline: ${bundle.run.pipelineId}`);
  lines.push(`Status: ${bundle.run.status}`);
  lines.push(`StatusSource: ${valueOrDash(bundle.run.statusSource)}`);
  lines.push(`CurrentStep: ${valueOrDash(bundle.run.currentStep)}`);
  lines.push(`Progress: ${valueOrDash(bundle.run.progress)}`);
  lines.push(`QueueJobID: ${valueOrDash(bundle.run.queueJobId)}`);
  lines.push(`QueueStatus: ${valueOrDash(bundle.run.queueStatus)}`);
  lines.push(`QueueReason: ${valueOrDash(bundle.run.queueReason)}`);
  lines.push(`CreatedAt: ${valueOrDash(bundle.run.createdAt)}`);
  lines.push(`QueuedAt: ${valueOrDash(bundle.run.queuedAt)}`);
  lines.push(`StartedAt: ${valueOrDash(bundle.run.startedAt)}`);
  lines.push(`CompletedAt: ${valueOrDash(bundle.run.completedAt)}`);
  lines.push(`LastEventAt: ${valueOrDash(bundle.run.lastEventAt)}`);
  lines.push(`RunFolder: ${valueOrDash(bundle.run.runFolder)}`);
  lines.push(`OutputPath: ${valueOrDash(bundle.run.outputPath)}`);
  lines.push(`ErrorPath: ${valueOrDash(bundle.run.errorPath)}`);

  lines.push(section("TargetAndSamples"));
  if (!bundle.target) {
    lines.push("Target: -");
  } else {
    lines.push(`TargetType: ${bundle.target.type}`);
    lines.push(`TargetID: ${bundle.target.id}`);
    lines.push(`TargetTitle: ${bundle.target.title}`);
    if (bundle.target.orderNumber) {
      lines.push(`OrderNumber: ${bundle.target.orderNumber}`);
    }
    lines.push(`SelectedSampleCount: ${bundle.target.selectedSampleCount}`);
    for (const sample of bundle.target.selectedSamples) {
      lines.push(`Sample: ${sample.sampleId} (${sample.id}) reads=${sample.readCount}`);
      for (const read of sample.reads) {
        lines.push(`  ReadID: ${read.id}`);
        lines.push(`    file1: ${valueOrDash(read.file1)}`);
        lines.push(`    file2: ${valueOrDash(read.file2)}`);
        lines.push(`    checksum1: ${valueOrDash(read.checksum1)}`);
        lines.push(`    checksum2: ${valueOrDash(read.checksum2)}`);
      }
    }
  }

  lines.push(section("ExecutionSettings"));
  lines.push(`UseSlurm: ${bundle.executionSettings.useSlurm}`);
  lines.push(`SlurmQueue: ${bundle.executionSettings.slurmQueue}`);
  lines.push(`SlurmCores: ${bundle.executionSettings.slurmCores}`);
  lines.push(`SlurmMemory: ${bundle.executionSettings.slurmMemory}`);
  lines.push(`SlurmTimeLimit: ${bundle.executionSettings.slurmTimeLimit}`);
  lines.push(`SlurmOptions: ${valueOrDash(bundle.executionSettings.slurmOptions)}`);
  lines.push(`RuntimeMode: ${bundle.executionSettings.runtimeMode}`);
  lines.push(`CondaPath: ${valueOrDash(bundle.executionSettings.condaPath)}`);
  lines.push(`CondaEnv: ${valueOrDash(bundle.executionSettings.condaEnv)}`);
  lines.push(`NextflowProfile: ${valueOrDash(bundle.executionSettings.nextflowProfile)}`);
  lines.push(`PipelineRunDir: ${valueOrDash(bundle.executionSettings.pipelineRunDir)}`);
  lines.push(`WeblogURL: ${valueOrDash(bundle.executionSettings.weblogUrl)}`);
  lines.push(
    `WeblogSecretConfigured: ${bundle.executionSettings.weblogSecretConfigured}`
  );
  lines.push(
    `CondaScriptPath: ${valueOrDash(bundle.executionSettings.condaScriptPath)}`
  );
  lines.push(
    `CondaScriptExists: ${valueOrDash(bundle.executionSettings.condaScriptExists)}`
  );

  lines.push(section("HostDiagnostics"));
  for (const result of bundle.hostDiagnostics.commandChecks) {
    lines.push(formatCommandResult(result));
    lines.push("");
  }

  lines.push(section("CondaDiagnostics"));
  for (const result of bundle.hostDiagnostics.condaChecks) {
    lines.push(formatCommandResult(result));
    lines.push("");
  }

  lines.push(section("QueueDiagnostics"));
  if (bundle.hostDiagnostics.queueChecks.length === 0) {
    lines.push("No queue diagnostics available.");
  } else {
    for (const result of bundle.hostDiagnostics.queueChecks) {
      lines.push(formatCommandResult(result));
      lines.push("");
    }
  }

  lines.push(section("Files"));
  for (const file of bundle.files) {
    lines.push(`Path: ${file.path}`);
    lines.push(`Exists: ${file.exists ? "yes" : "no"}`);
    lines.push(`Size: ${valueOrDash(file.size)}`);
    lines.push(`UpdatedAt: ${valueOrDash(file.updatedAt)}`);
    if (file.tail) {
      lines.push("Tail:");
      lines.push(file.tail);
    }
    lines.push("");
  }

  lines.push(section("CollectionCommand"));
  lines.push(bundle.collectionCommand);

  lines.push(section("Notes"));
  for (const note of bundle.notes) {
    lines.push(`- ${note}`);
  }

  lines.push(section("RunConfigJSON"));
  lines.push(JSON.stringify(bundle.run.config || {}, null, 2));

  lines.push(section("OutputTail"));
  lines.push(bundle.run.outputTail || "(empty)");

  lines.push(section("ErrorTail"));
  lines.push(bundle.run.errorTail || "(empty)");

  return lines.join("\n").trim() + "\n";
}

function buildCollectionCommand(input: {
  runId: string;
  runFolder: string | null;
  queueJobId: string | null;
  condaPath: string;
  condaEnv: string;
}): string {
  const scriptLines = [
    "set -o pipefail",
    `RUN_ID=${shellQuote(input.runId)}`,
    `RUN_FOLDER=${shellQuote(input.runFolder || "")}`,
    `QUEUE_JOB_ID=${shellQuote(input.queueJobId || "")}`,
    `CONDA_BASE=${shellQuote(input.condaPath || "")}`,
    `CONDA_ENV=${shellQuote(input.condaEnv || "seqdesk-pipelines")}`,
    'OUT="$HOME/seqdesk-sessioninfo-${RUN_ID}-$(date +%Y%m%d-%H%M%S).txt"',
    "{",
    'echo "=== SeqDesk Session Info ==="',
    'echo "Generated: $(date -Iseconds)"',
    'echo "Hostname: $(hostname 2>/dev/null || echo unknown)"',
    'echo "User: $(whoami 2>/dev/null || echo unknown)"',
    'echo "Kernel: $(uname -a 2>/dev/null || echo unknown)"',
    'echo ""',
    'for cmd in conda nextflow sbatch squeue sacct; do',
    '  if command -v "$cmd" >/dev/null 2>&1; then',
    '    echo "$cmd: $(command -v "$cmd")"',
    "  else",
    '    echo "$cmd: missing"',
    "  fi",
    "done",
    'echo ""',
    'if command -v sbatch >/dev/null 2>&1; then sbatch --version || true; fi',
    'if command -v squeue >/dev/null 2>&1; then squeue --version || true; fi',
    'if command -v sacct >/dev/null 2>&1; then sacct --version || true; fi',
    'echo ""',
    'if [ -n "$CONDA_BASE" ]; then',
    '  echo "Conda base: $CONDA_BASE"',
    '  if [ -f "$CONDA_BASE/etc/profile.d/conda.sh" ]; then',
    '    echo "conda.sh: present"',
    "  else",
    '    echo "conda.sh: missing"',
    "  fi",
    "fi",
    'if command -v conda >/dev/null 2>&1; then',
    "  conda --version || true",
    "  conda env list || true",
    '  if [ -n "$CONDA_ENV" ]; then',
    '    conda run -n "$CONDA_ENV" nextflow -version || true',
    '    conda run -n "$CONDA_ENV" java -version || true',
    "  fi",
    "fi",
    'if [ -n "$QUEUE_JOB_ID" ]; then',
    '  echo ""',
    '  echo "Queue job: $QUEUE_JOB_ID"',
    '  if command -v squeue >/dev/null 2>&1; then',
    '    squeue -j "$QUEUE_JOB_ID" -h -o "%i|%T|%R|%M|%N" || true',
    "  fi",
    '  if command -v sacct >/dev/null 2>&1; then',
    '    sacct -j "$QUEUE_JOB_ID" --format=JobID,State,ExitCode,Elapsed,NodeList%30 --noheader -P || true',
    "  fi",
    "fi",
    'if [ -n "$RUN_FOLDER" ] && [ -d "$RUN_FOLDER" ]; then',
    '  echo ""',
    '  echo "Run folder: $RUN_FOLDER"',
    '  ls -lah "$RUN_FOLDER" || true',
    '  ls -lah "$RUN_FOLDER/logs" || true',
    '  for file in "$RUN_FOLDER/run.sh" "$RUN_FOLDER/samplesheet.csv" "$RUN_FOLDER/nextflow.config" "$RUN_FOLDER/logs/pipeline.out" "$RUN_FOLDER/logs/pipeline.err"; do',
    '    if [ -f "$file" ]; then',
    '      echo ""',
    '      echo "----- $file (tail -n 200) -----"',
    '      tail -n 200 "$file" || true',
    "    fi",
    "  done",
    '  if [ -n "$QUEUE_JOB_ID" ]; then',
    '    for file in "$RUN_FOLDER/logs/slurm-${QUEUE_JOB_ID}.out" "$RUN_FOLDER/logs/slurm-${QUEUE_JOB_ID}.err"; do',
    '      if [ -f "$file" ]; then',
    '        echo ""',
    '        echo "----- $file (tail -n 200) -----"',
    '        tail -n 200 "$file" || true',
    "      fi",
    "    done",
    "  fi",
    "fi",
    '} > "$OUT" 2>&1',
    'echo "$OUT"',
  ];

  return `bash -lc ${shellQuote(scriptLines.join("\n"))}`;
}

// GET - Build a debug bundle (run/session info) for support
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (isDemoSession(session)) {
      return NextResponse.json(
        { error: "Run diagnostics are disabled in the public demo." },
        { status: 403 }
      );
    }

    const { id } = await params;

    const run = await db.pipelineRun.findUnique({
      where: { id },
      include: {
        order: {
          select: {
            id: true,
            name: true,
            orderNumber: true,
            userId: true,
            samples: {
              select: {
                id: true,
                sampleId: true,
                reads: {
                  select: {
                    id: true,
                    file1: true,
                    file2: true,
                    checksum1: true,
                    checksum2: true,
                  },
                },
              },
            },
          },
        },
        study: {
          select: {
            id: true,
            title: true,
            userId: true,
            samples: {
              select: {
                id: true,
                sampleId: true,
                reads: {
                  select: {
                    id: true,
                    file1: true,
                    file2: true,
                    checksum1: true,
                    checksum2: true,
                  },
                },
              },
            },
          },
        },
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    if (
      session.user.role !== "FACILITY_ADMIN" &&
      run.study?.userId !== session.user.id &&
      run.order?.userId !== session.user.id
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const executionSettings = await getExecutionSettings();
    const selectedSampleIds = parseJson<string[]>(run.inputSampleIds);
    const selectedSampleSet =
      Array.isArray(selectedSampleIds) && selectedSampleIds.length > 0
        ? new Set(selectedSampleIds)
        : null;

    const targetSamples =
      run.targetType === "order" ? run.order?.samples || [] : run.study?.samples || [];

    const selectedSamples = targetSamples
      .filter((sample) => !selectedSampleSet || selectedSampleSet.has(sample.id))
      .map((sample) => ({
        id: sample.id,
        sampleId: sample.sampleId,
        readCount: sample.reads.length,
        reads: sample.reads.map((read) => ({
          id: read.id,
          file1: read.file1,
          file2: read.file2,
          checksum1: read.checksum1,
          checksum2: read.checksum2,
        })),
      }));

    const runFolder = run.runFolder;
    const queueJobId = run.queueJobId;
    const queueIsNumeric = Boolean(queueJobId && /^\d+$/.test(queueJobId));

    const candidateFiles = new Set<string>();
    if (runFolder) {
      candidateFiles.add(path.join(runFolder, "run.sh"));
      candidateFiles.add(path.join(runFolder, "samplesheet.csv"));
      candidateFiles.add(path.join(runFolder, "nextflow.config"));
      candidateFiles.add(path.join(runFolder, "trace.txt"));
      candidateFiles.add(path.join(runFolder, "logs", "pipeline.out"));
      candidateFiles.add(path.join(runFolder, "logs", "pipeline.err"));
      if (queueIsNumeric && queueJobId) {
        candidateFiles.add(path.join(runFolder, "logs", `slurm-${queueJobId}.out`));
        candidateFiles.add(path.join(runFolder, "logs", `slurm-${queueJobId}.err`));
      }
    }

    const files = await Promise.all(
      Array.from(candidateFiles).map((filePath) => inspectFile(filePath))
    );

    const commandChecks = await Promise.all([
      runShell("hostname"),
      runShell("uname -a"),
      runShell("whoami"),
      runShell("date -Iseconds"),
      runShell(
        "for cmd in conda nextflow sbatch squeue sacct; do if command -v \"$cmd\" >/dev/null 2>&1; then echo \"$cmd=$(command -v \"$cmd\")\"; else echo \"$cmd=missing\"; fi; done"
      ),
      runShell("if command -v sbatch >/dev/null 2>&1; then sbatch --version; else echo sbatch missing; fi"),
      runShell("if command -v squeue >/dev/null 2>&1; then squeue --version; else echo squeue missing; fi"),
      runShell("if command -v sacct >/dev/null 2>&1; then sacct --version; else echo sacct missing; fi"),
    ]);

    const condaChecks = await Promise.all([
      runShell("if command -v conda >/dev/null 2>&1; then conda --version; else echo conda missing; fi", 12_000),
      runShell("if command -v conda >/dev/null 2>&1; then conda env list; else echo conda missing; fi", 20_000),
      runShell(
        `if command -v conda >/dev/null 2>&1; then conda run -n ${shellQuote(
          executionSettings.condaEnv || "seqdesk-pipelines"
        )} nextflow -version; else echo conda missing; fi`,
        20_000
      ),
      runShell(
        `if command -v conda >/dev/null 2>&1; then conda run -n ${shellQuote(
          executionSettings.condaEnv || "seqdesk-pipelines"
        )} java -version; else echo conda missing; fi`,
        20_000
      ),
    ]);

    const queueChecks: CommandResult[] = [];
    if (queueIsNumeric && queueJobId) {
      queueChecks.push(
        await runShell(`squeue -j ${shellQuote(queueJobId)} -h -o '%i|%T|%R|%M|%N'`, 8_000),
        await runShell(
          `sacct -j ${shellQuote(
            queueJobId
          )} --format=JobID,State,ExitCode,Elapsed,NodeList%30 --noheader -P`,
          12_000
        )
      );
    }

    const condaScriptPath = executionSettings.condaPath
      ? path.join(executionSettings.condaPath, "etc", "profile.d", "conda.sh")
      : null;

    const bundle: DebugBundle = {
      generatedAt: new Date().toISOString(),
      run: {
        id: run.id,
        runNumber: run.runNumber,
        pipelineId: run.pipelineId,
        status: run.status,
        statusSource: run.statusSource,
        currentStep: run.currentStep,
        progress: run.progress,
        queueJobId: run.queueJobId,
        queueStatus: run.queueStatus,
        queueReason: run.queueReason,
        createdAt: run.createdAt,
        queuedAt: run.queuedAt,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        lastEventAt: run.lastEventAt,
        runFolder: run.runFolder,
        outputPath: run.outputPath,
        errorPath: run.errorPath,
        outputTail: run.outputTail,
        errorTail: run.errorTail,
        config: parseJson<Record<string, unknown>>(run.config),
      },
      target:
        run.targetType === "order" && run.order
          ? {
              type: "order",
              id: run.order.id,
              title: run.order.name ?? run.order.orderNumber,
              orderNumber: run.order.orderNumber,
              selectedSamples,
              selectedSampleCount: selectedSamples.length,
            }
          : run.study
            ? {
                type: "study",
                id: run.study.id,
                title: run.study.title,
                selectedSamples,
                selectedSampleCount: selectedSamples.length,
              }
            : null,
      study: run.study
        ? {
            id: run.study.id,
            title: run.study.title,
            selectedSamples,
            selectedSampleCount: selectedSamples.length,
          }
        : null,
      executionSettings: {
        useSlurm: executionSettings.useSlurm,
        slurmQueue: executionSettings.slurmQueue,
        slurmCores: executionSettings.slurmCores,
        slurmMemory: executionSettings.slurmMemory,
        slurmTimeLimit: executionSettings.slurmTimeLimit,
        slurmOptions: executionSettings.slurmOptions,
        runtimeMode: executionSettings.runtimeMode,
        condaPath: executionSettings.condaPath,
        condaEnv: executionSettings.condaEnv,
        nextflowProfile: executionSettings.nextflowProfile,
        pipelineRunDir: executionSettings.pipelineRunDir,
        weblogUrl: executionSettings.weblogUrl || "",
        weblogSecretConfigured: Boolean(executionSettings.weblogSecret),
        condaScriptPath,
        condaScriptExists: condaScriptPath ? await fileExists(condaScriptPath) : null,
      },
      hostDiagnostics: {
        commandChecks,
        condaChecks,
        queueChecks,
      },
      files,
      collectionCommand: buildCollectionCommand({
        runId: run.id,
        runFolder: run.runFolder,
        queueJobId: run.queueJobId,
        condaPath: executionSettings.condaPath,
        condaEnv: executionSettings.condaEnv,
      }),
      notes: [
        "Run this collection command on the same host where SeqDesk launches pipelines.",
        "Attach the generated text file and this JSON when reporting pipeline issues.",
      ],
    };

    const format = new URL(request.url).searchParams.get("format");
    if (format === "text") {
      return new NextResponse(buildBundleText(bundle), {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }

    return NextResponse.json(bundle);
  } catch (error) {
    console.error("[Run Debug API] Error:", error);
    return NextResponse.json(
      { error: "Failed to build debug bundle" },
      { status: 500 }
    );
  }
}
