import fs from "fs/promises";
import path from "path";

export interface StoreFileEntry {
  path: string;
  content: string;
  encoding?: string;
}

export function resolveStorePath(baseDir: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Invalid absolute path from store: ${relativePath}`);
  }
  const baseResolved = path.resolve(baseDir);
  const resolved = path.resolve(baseResolved, relativePath);
  if (!resolved.startsWith(`${baseResolved}${path.sep}`)) {
    throw new Error(`Invalid path traversal from store: ${relativePath}`);
  }
  return resolved;
}

function readManifestIdFromFileMap(
  payloadFiles: Record<string, unknown>
): string | undefined {
  const manifestRaw = payloadFiles["manifest.json"];
  if (typeof manifestRaw !== "string") return undefined;
  try {
    const parsed = JSON.parse(manifestRaw) as { package?: { id?: string } };
    return parsed.package?.id;
  } catch {
    return undefined;
  }
}

export function assertPackageId(
  payload: Record<string, unknown>,
  pipelineId: string
): void {
  const manifest = payload.manifest as { package?: { id?: string } } | undefined;
  const metaPackage = payload.package as { id?: string } | undefined;
  const filePayloadId =
    payload.files && typeof payload.files === "object" && !Array.isArray(payload.files)
      ? readManifestIdFromFileMap(payload.files as Record<string, unknown>)
      : undefined;
  const payloadId =
    manifest?.package?.id ||
    metaPackage?.id ||
    filePayloadId ||
    (typeof payload.id === "string" ? payload.id : undefined);
  if (payloadId && payloadId !== pipelineId) {
    throw new Error(`Package ID mismatch. Expected ${pipelineId} but got ${payloadId}.`);
  }
}

export async function writePackageFiles(
  pipelineDir: string,
  payload: Record<string, unknown>,
  pipelineId: string
): Promise<void> {
  assertPackageId(payload, pipelineId);

  if (Array.isArray(payload.files)) {
    for (const file of payload.files as StoreFileEntry[]) {
      if (!file?.path || typeof file.path !== "string") {
        throw new Error("Invalid file entry from store.");
      }
      const filePath = resolveStorePath(pipelineDir, file.path);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const buffer =
        file.encoding === "base64"
          ? Buffer.from(file.content, "base64")
          : Buffer.from(file.content, "utf8");
      await fs.writeFile(filePath, buffer);
    }
    return;
  }

  if (payload.files && typeof payload.files === "object") {
    for (const [filePathRaw, content] of Object.entries(
      payload.files as Record<string, string>
    )) {
      if (typeof content !== "string") {
        throw new Error(`Invalid file content for ${filePathRaw}`);
      }
      const filePath = resolveStorePath(pipelineDir, filePathRaw);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf8");
    }
    return;
  }

  if (payload.manifest && payload.definition && payload.registry) {
    await fs.writeFile(
      resolveStorePath(pipelineDir, "manifest.json"),
      `${JSON.stringify(payload.manifest, null, 2)}\n`
    );
    await fs.writeFile(
      resolveStorePath(pipelineDir, "definition.json"),
      `${JSON.stringify(payload.definition, null, 2)}\n`
    );
    await fs.writeFile(
      resolveStorePath(pipelineDir, "registry.json"),
      `${JSON.stringify(payload.registry, null, 2)}\n`
    );
    if (payload.samplesheet) {
      await fs.writeFile(
        resolveStorePath(pipelineDir, "samplesheet.yaml"),
        String(payload.samplesheet)
      );
    }
    if (payload.parsers && typeof payload.parsers === "object") {
      for (const [parserPath, parserContent] of Object.entries(
        payload.parsers as Record<string, string>
      )) {
        const filePath = resolveStorePath(pipelineDir, parserPath);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, parserContent, "utf8");
      }
    }
    return;
  }

  throw new Error("Unsupported package payload format from store.");
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function installPackageDirectory(
  pipelinesDir: string,
  pipelineId: string,
  writer: (tempDir: string) => Promise<void>
): Promise<"install" | "update"> {
  const pipelineDir = path.join(pipelinesDir, pipelineId);
  const exists = await pathExists(pipelineDir);
  const tempDir = path.join(pipelinesDir, `${pipelineId}.__tmp-${Date.now()}`);
  const backupDir = path.join(pipelinesDir, `${pipelineId}.__backup-${Date.now()}`);

  await fs.mkdir(pipelinesDir, { recursive: true });
  await fs.mkdir(tempDir, { recursive: true });

  try {
    await writer(tempDir);
    if (exists) {
      await fs.rename(pipelineDir, backupDir);
    }
    try {
      await fs.rename(tempDir, pipelineDir);
      if (exists) {
        await fs.rm(backupDir, { recursive: true, force: true });
      }
    } catch (error) {
      if (exists && (await pathExists(backupDir)) && !(await pathExists(pipelineDir))) {
        await fs.rename(backupDir, pipelineDir);
      }
      throw error;
    }
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }

  return exists ? "update" : "install";
}
