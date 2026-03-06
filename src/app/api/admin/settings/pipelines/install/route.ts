import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import path from "path";
import { promisify } from "util";
import { execFile } from "child_process";
import fs from "fs/promises";
import os from "os";
import { clearPackageCache } from "@/lib/pipelines/package-loader";
import { clearRegistryCache } from "@/lib/pipelines/registry";
import {
  installPackageDirectory,
  writePackageFiles,
} from "@/lib/pipelines/package-install";
import {
  classifyCloneFailure,
  DEFAULT_METAXPATH_REF,
  installGitHubPipelineSnapshot,
  isValidGitRef,
} from "@/lib/pipelines/metaxpath-import";
import type { PipelineSourceDescriptor } from "@/lib/pipelines/store-sources";

const execFileAsync = promisify(execFile);

interface InstallRequestBody {
  pipelineId?: unknown;
  version?: unknown;
  replace?: unknown;
  source?: Partial<PipelineSourceDescriptor>;
  credentials?: {
    accessKey?: unknown;
    token?: unknown;
    sha256?: unknown;
  };
  privatePackageUrl?: unknown;
  privateAccessKey?: unknown;
  privateSha256?: unknown;
}

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

async function cloneGitHubRepository(
  repo: string,
  ref: string,
  token: string,
  cloneDir: string,
  askPassPath: string
): Promise<void> {
  await execFileAsync(
    "git",
    ["clone", "--depth", "1", "--branch", ref, `https://github.com/${repo}.git`, cloneDir],
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

async function fetchPackagePayload(
  url: string,
  accessKey?: string
): Promise<Record<string, unknown>> {
  const headers = new Headers();
  if (accessKey) {
    headers.set("authorization", `Bearer ${accessKey}`);
  }
  const response = await fetch(url, {
    cache: "no-store",
    headers,
  });
  if (!response.ok) {
    throw new Error(`Failed to download pipeline package (${response.status})`);
  }

  try {
    return (await response.json()) as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON payload.";
    throw new Error(`Pipeline source returned an invalid package payload: ${message}`);
  }
}

async function installFromPackagePayload(
  pipelineId: string,
  payload: Record<string, unknown>
): Promise<"install" | "update"> {
  const pipelinesDir = path.join(process.cwd(), "pipelines");
  return installPackageDirectory(pipelinesDir, pipelineId, async (tempDir) => {
    await writePackageFiles(tempDir, payload, pipelineId);
  });
}

async function installFromGitHub(
  pipelineId: string,
  source: Partial<PipelineSourceDescriptor>,
  credentials: InstallRequestBody["credentials"]
): Promise<{ action: "install" | "update"; version?: string; source: string }> {
  const repo = trimToUndefined(source.repository);
  const ref = trimToUndefined(source.refDefault) || DEFAULT_METAXPATH_REF;
  const token = trimToUndefined(credentials?.token);

  if (!repo || !token) {
    throw new Error("GitHub installs require repository and token.");
  }
  if (!isValidGitRef(ref)) {
    throw new Error("Invalid Git reference format.");
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-github-pipeline-"));
  const cloneDir = path.join(tempRoot, "repo");
  const askPassPath = await createAskPassScript(tempRoot);

  try {
    try {
      await cloneGitHubRepository(repo, ref, token, cloneDir, askPassPath);
    } catch (error) {
      const details = getExecErrorDetails(error);
      const classification = classifyCloneFailure(details);
      throw new Error(classification.error);
    }
    const result = await installGitHubPipelineSnapshot({
      pipelineId,
      cloneDir,
      repo,
      ref,
      descriptorPath: trimToUndefined(source.descriptorPath),
      includeWorkflow:
        typeof source.includeWorkflow === "boolean" ? source.includeWorkflow : undefined,
    });
    return {
      action: result.action,
      version: result.manifest?.package.version,
      source: `github:${repo}@${ref}`,
    };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const body = (await req.json()) as InstallRequestBody;
    const pipelineId = trimToUndefined(body.pipelineId);
    const version = trimToUndefined(body.version);
    const replace = body.replace === true;
    const source = body.source || {};
    const credentials = {
      accessKey:
        trimToUndefined(body.credentials?.accessKey) ||
        trimToUndefined(body.privateAccessKey),
      token: trimToUndefined(body.credentials?.token),
      sha256:
        trimToUndefined(body.credentials?.sha256) ||
        trimToUndefined(body.privateSha256),
    };

    if (!pipelineId) {
      return NextResponse.json({ error: "Pipeline ID required" }, { status: 400 });
    }

    let action: "install" | "update";
    let resolvedVersion = version;
    let resolvedSource = "unknown";

    if (source.kind === "github") {
      const result = await installFromGitHub(pipelineId, source, credentials);
      action = result.action;
      resolvedVersion = result.version || resolvedVersion;
      resolvedSource = result.source;
    } else if (source.kind === "privateRegistry") {
      const packageUrl =
        trimToUndefined(source.packageUrlDefault) ||
        trimToUndefined(source.downloadUrl) ||
        trimToUndefined(body.privatePackageUrl);
      if (!packageUrl || !credentials.accessKey) {
        return NextResponse.json(
          { error: "Private package installs require package URL and access key." },
          { status: 400 }
        );
      }
      const payload = await fetchPackagePayload(packageUrl, credentials.accessKey);
      action = await installFromPackagePayload(pipelineId, payload);
      resolvedSource = packageUrl;
    } else {
      const downloadUrl =
        trimToUndefined(source.downloadUrl) || trimToUndefined(body.privatePackageUrl);
      if (!downloadUrl) {
        return NextResponse.json(
          { error: "Registry installs require a download URL." },
          { status: 400 }
        );
      }
      const payload = await fetchPackagePayload(downloadUrl);
      action = await installFromPackagePayload(pipelineId, payload);
      resolvedSource = downloadUrl;
    }

    clearPackageCache();
    clearRegistryCache();

    return NextResponse.json({
      success: true,
      message: `Pipeline ${pipelineId} ${replace ? "updated" : action === "update" ? "updated" : "installed"} successfully`,
      pipelineId,
      version: resolvedVersion || "unknown",
      source: resolvedSource,
      action,
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to install pipeline", details },
      { status: 500 }
    );
  }
}
