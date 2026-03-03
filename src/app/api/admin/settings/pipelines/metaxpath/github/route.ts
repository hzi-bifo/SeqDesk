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
  isValidGitRef,
  METAXPATH_DESCRIPTOR_RELATIVE_PATH,
  METAXPATH_PIPELINE_ID,
  METAXPATH_REPO_HTTPS,
  METAXPATH_REPOSITORY,
  REQUIRED_DESCRIPTOR_FILES,
  shouldCopyWorkflowEntry,
  validateMetaxPathDescriptorDir,
} from "@/lib/pipelines/metaxpath-import";

const execFileAsync = promisify(execFile);

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

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
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
    }
  );
}

async function getGitCommit(cloneDir: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cloneDir, "rev-parse", "HEAD"]);
  return stdout.trim();
}

async function installSnapshotFromClone(cloneDir: string, ref: string, commit: string) {
  const pipelinesDir = path.join(process.cwd(), "pipelines");
  const targetDir = path.join(pipelinesDir, METAXPATH_PIPELINE_ID);
  const targetExists = await pathExists(targetDir);
  const stageDir = path.join(pipelinesDir, `${METAXPATH_PIPELINE_ID}.__tmp-${Date.now()}`);

  await fs.mkdir(pipelinesDir, { recursive: true });
  await fs.mkdir(stageDir, { recursive: true });

  try {
    const descriptorDir = path.join(cloneDir, METAXPATH_DESCRIPTOR_RELATIVE_PATH);

    for (const fileName of REQUIRED_DESCRIPTOR_FILES) {
      await fs.copyFile(
        path.join(descriptorDir, fileName),
        path.join(stageDir, fileName)
      );
    }

    const workflowDir = path.join(stageDir, "workflow");
    await fs.mkdir(workflowDir, { recursive: true });
    const rootEntries = await fs.readdir(cloneDir, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (!shouldCopyWorkflowEntry(entry.name)) continue;
      const sourcePath = path.join(cloneDir, entry.name);
      const destinationPath = path.join(workflowDir, entry.name);
      await fs.cp(sourcePath, destinationPath, { recursive: true });
    }

    const syncedAt = new Date().toISOString();
    const sourceMetadata = {
      repo: METAXPATH_REPOSITORY,
      ref,
      commit,
      syncedAt,
    };
    await fs.writeFile(
      path.join(stageDir, ".source.json"),
      `${JSON.stringify(sourceMetadata, null, 2)}\n`,
      "utf8"
    );

    let backupDir: string | null = null;
    try {
      if (targetExists) {
        backupDir = path.join(
          pipelinesDir,
          `${METAXPATH_PIPELINE_ID}.__backup-${Date.now()}`
        );
        await fs.rename(targetDir, backupDir);
      }

      await fs.rename(stageDir, targetDir);

      if (backupDir) {
        await fs.rm(backupDir, { recursive: true, force: true });
      }
    } catch (error) {
      const targetStillExists = await pathExists(targetDir);
      if (!targetStillExists && backupDir && (await pathExists(backupDir))) {
        await fs.rename(backupDir, targetDir);
      }
      throw error;
    } finally {
      if (await pathExists(stageDir)) {
        await fs.rm(stageDir, { recursive: true, force: true });
      }
    }

    const action = targetExists ? "sync" : "install";
    await db.pipelineConfig.upsert({
      where: { pipelineId: METAXPATH_PIPELINE_ID },
      create: {
        pipelineId: METAXPATH_PIPELINE_ID,
        enabled: false,
        config: null,
      },
      update: {},
    });

    clearPackageCache();
    clearRegistryCache();

    return {
      action,
      targetExists,
      syncedAt,
    };
  } catch (error) {
    if (await pathExists(stageDir)) {
      await fs.rm(stageDir, { recursive: true, force: true });
    }
    throw error;
  }
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
      ? body.ref.trim()
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
    return NextResponse.json(
      { error: "Failed to import MetaxPath from GitHub", details },
      { status: 500 }
    );
  } finally {
    if (askPassPath && (await pathExists(askPassPath))) {
      await fs.rm(askPassPath, { force: true });
    }
    if (await pathExists(tempRoot)) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  }
}
