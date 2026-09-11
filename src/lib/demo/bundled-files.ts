import fs from "fs/promises";
import path from "path";

const DEMO_PIPELINE_DIR = path.join(process.cwd(), "public", "demo", "pipeline");

/**
 * The bundled copy of a seeded demo artifact, matched by basename, or null.
 * Seeded runs point at folders that never exist on disk (the public demo has
 * no pipeline runtime), so anything that wants to read such an artifact, the
 * preview as well as the Explore table builders, reads the bundled file.
 */
export async function bundledDemoPipelineFile(artifactPath: string): Promise<string | null> {
  const base = path.basename(artifactPath);
  if (!base || base.startsWith(".")) return null;
  const candidate = path.join(DEMO_PIPELINE_DIR, base);
  try {
    const stat = await fs.stat(candidate);
    return stat.isFile() ? candidate : null;
  } catch {
    return null;
  }
}

/** Whether an artifact's metadata marks it as seeded for the demo. */
export function isSeededDemoArtifact(metadata: string | null | undefined): boolean {
  if (!metadata) return false;
  try {
    const parsed = JSON.parse(metadata) as { seeded?: unknown };
    return parsed?.seeded === true;
  } catch {
    return false;
  }
}
