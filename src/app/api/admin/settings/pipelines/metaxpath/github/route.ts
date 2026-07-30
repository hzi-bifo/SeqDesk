import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { promisify } from "util";
import { execFile } from "child_process";
import path from "path";
import os from "os";
import fs from "fs/promises";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { clearPackageCache } from "@/lib/pipelines/package-loader";
import { clearRegistryCache } from "@/lib/pipelines/registry";
import {
  classifyCloneFailure,
  DEFAULT_METAXPATH_REF,
  installGitHubPipelineSnapshot,
  isValidGitRef,
  METAXPATH_DESCRIPTOR_RELATIVE_PATH,
  METAXPATH_PIPELINE_ID,
  METAXPATH_REPO_HTTPS,
  METAXPATH_REPOSITORY,
  resolveMetaxPathRef,
  validateMetaxPathDescriptorDir,
} from "@/lib/pipelines/metaxpath-import";

const execFileAsync = promisify(execFile);
const GITHUB_CLONE_TIMEOUT_MS = 120_000;

export const runtime = "nodejs";

interface GitHubImportRequest {
  token?: unknown;
  ref?: unknown;
}

function getExecErrorDetails(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "stderr" in error &&
    typeof (error as { stderr?: unknown }).stderr === "string"
  ) {
    return ((error as { stderr: string }).stderr || "").trim();
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "stdout" in error &&
    typeof (error as { stdout?: unknown }).stdout === "string"
  ) {
    return ((error as { stdout: string }).stdout || "").trim();
  }
  return error instanceof Error ? error.message : "Unknown error";
}

async function createAskPassScript(baseDir: string): Promise<string> {
  const scriptPath = path.join(baseDir, "git-askpass.sh");
  const script = [
    "#!/bin/sh",
    'case "$1" in',
    '  *Username*) echo "x-access-token" ;;',
    '  *Password*) echo "${GITHUB_TOKEN}" ;;',
    '  *) echo "${GITHUB_TOKEN}" ;;',
    "esac",
    "",
  ].join("\n");
  await fs.writeFile(scriptPath, script, { mode: 0o700 });
  await fs.chmod(scriptPath, 0o700);
  return scriptPath;
}

async function cloneMetaxPathRepository(
  cloneDir: string,
  ref: string,
  token: string,
  askPassPath: string
): Promise<void> {
  await execFileAsync(
    "git",
    ["clone", "--depth", "1", "--branch", ref, METAXPATH_REPO_HTTPS, cloneDir],
    {
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: askPassPath,
        GITHUB_TOKEN: token,
      },
      maxBuffer: 10 * 1024 * 1024,
      timeout: GITHUB_CLONE_TIMEOUT_MS,
      killSignal: "SIGTERM",
    }
  );
}

async function getGitCommit(cloneDir: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cloneDir, "rev-parse", "HEAD"]);
  return stdout.trim();
}

async function installSnapshotFromClone(cloneDir: string, ref: string, commit: string) {
  // Establish the disabled configuration row first. If this fails, do not
  // activate new package files and then report the install as failed.
  await db.pipelineConfig.upsert({
    where: { pipelineId: METAXPATH_PIPELINE_ID },
    create: {
      pipelineId: METAXPATH_PIPELINE_ID,
      enabled: false,
      config: null,
    },
    update: {},
  });

  const result = await installGitHubPipelineSnapshot({
    pipelineId: METAXPATH_PIPELINE_ID,
    cloneDir,
    repo: METAXPATH_REPOSITORY,
    ref,
    commit,
    descriptorPath: METAXPATH_DESCRIPTOR_RELATIVE_PATH,
    includeWorkflow: true,
  });

  clearPackageCache();
  clearRegistryCache();

  return {
    action: result.action === "update" ? "sync" : "install",
    targetExists: result.action === "update",
    syncedAt: result.syncedAt,
  };
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: GitHubImportRequest;
  try {
    body = (await req.json()) as GitHubImportRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const refRaw =
    typeof body.ref === "string" && body.ref.trim().length > 0
      ? resolveMetaxPathRef(body.ref, METAXPATH_REPOSITORY)
      : DEFAULT_METAXPATH_REF;

  if (!token) {
    return NextResponse.json({ error: "GitHub token is required" }, { status: 400 });
  }

  if (!isValidGitRef(refRaw)) {
    return NextResponse.json(
      { error: "Invalid Git reference format" },
      { status: 400 }
    );
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-metaxpath-"));
  const cloneDir = path.join(tempRoot, "repo");
  let askPassPath: string | null = null;

  try {
    askPassPath = await createAskPassScript(tempRoot);
    try {
      await cloneMetaxPathRepository(cloneDir, refRaw, token, askPassPath);
    } catch (error) {
      const details = getExecErrorDetails(error);
      const classification = classifyCloneFailure(details);
      return NextResponse.json(
        { error: classification.error, details },
        { status: classification.status }
      );
    }

    const descriptorDir = path.join(cloneDir, METAXPATH_DESCRIPTOR_RELATIVE_PATH);
    const descriptorValidation = await validateMetaxPathDescriptorDir(descriptorDir);
    if (!descriptorValidation.valid) {
      return NextResponse.json(
        {
          error: "MetaxPath descriptor validation failed",
          details: descriptorValidation.errors,
          descriptorPath: METAXPATH_DESCRIPTOR_RELATIVE_PATH,
        },
        { status: 422 }
      );
    }

    const commit = await getGitCommit(cloneDir);
    const installResult = await installSnapshotFromClone(cloneDir, refRaw, commit);

    return NextResponse.json({
      success: true,
      pipelineId: METAXPATH_PIPELINE_ID,
      action: installResult.action,
      repo: METAXPATH_REPOSITORY,
      ref: refRaw,
      commit,
      syncedAt: installResult.syncedAt,
    });
  } catch (error) {
    const details = getExecErrorDetails(error);
    console.error("[MetaxPath GitHub Import] Failed:", details);
    const invalidPackage = details.startsWith("Invalid pipeline package");
    return NextResponse.json(
      {
        error: invalidPackage
          ? "MetaxPath package validation failed"
          : "Failed to import MetaxPath from GitHub",
        details,
      },
      { status: invalidPackage ? 422 : 500 }
    );
  } finally {
    try {
      await fs.rm(tempRoot, { recursive: true, force: true });
    } catch (error) {
      console.warn(
        `[MetaxPath GitHub Import] Could not clean up temporary checkout ${tempRoot}:`,
        error
      );
    }
  }
}
