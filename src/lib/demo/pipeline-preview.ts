import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const DEMO_PUBLIC_DIR = path.join(process.cwd(), "public", "demo");
const DEMO_PIPELINE_DIR = path.join(DEMO_PUBLIC_DIR, "pipeline");

// Previewable extensions we are willing to serve from the bundled demo assets.
const DEMO_PREVIEW_CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".htm": "text/html",
  ".tsv": "text/tab-separated-values",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".json": "application/json",
};

async function serveBundled(
  file: string,
  contentType: string
): Promise<NextResponse | null> {
  try {
    const content = await fs.readFile(file);
    return new NextResponse(content, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(content.length),
        "Content-Security-Policy":
          "script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return null;
  }
}

/**
 * For demo sessions, serve real pipeline-output files bundled into the deployment
 * (under public/demo/), mapping a seeded run-folder path to a bundled asset by
 * basename. The public demo runs on Vercel serverless with no persistent
 * filesystem, so the seeded runs' paths never exist on disk — bundled assets are
 * the only way a demo user can view real pipeline artifacts.
 *
 * Resolution order:
 *  1. Per-sample FastQC reports (`<sample>_R1_fastqc.html` / `_R2_fastqc.html`)
 *     map to the two bundled per-direction reports (public/demo/fastqc_R{1,2}.html).
 *  2. Any artifact dropped under public/demo/pipeline/, matched by basename
 *     (e.g. multiqc_report.html, reads-qc-report.html, *-summary.tsv). To make a
 *     new artifact browsable in the demo: drop the real file under
 *     public/demo/pipeline/ and have the seed reference a path whose basename
 *     matches it — no code change needed.
 *
 * Returns null when nothing matches (the caller then returns 403).
 */
export async function serveDemoPipelineFile(
  filePath: string
): Promise<NextResponse | null> {
  const base = path.basename(filePath);
  if (!base || base === "." || base === "..") return null;

  const fastqc = base.match(/_(R[12])_fastqc\.html$/);
  if (fastqc) {
    // Prefer a real per-sample report bundled under public/demo/pipeline/ (e.g. the
    // mouse-gut DRR######_R1_fastqc.html reports). Studies whose per-sample reports
    // aren't bundled fall back to the shared per-direction report.
    if (/^[A-Za-z0-9._-]+$/.test(base)) {
      const perSample = await serveBundled(
        path.join(DEMO_PIPELINE_DIR, base),
        "text/html"
      );
      if (perSample) return perSample;
    }
    return serveBundled(
      path.join(DEMO_PUBLIC_DIR, `fastqc_${fastqc[1]}.html`),
      "text/html"
    );
  }

  // Only a safe, single-segment basename with a known previewable extension.
  if (!/^[A-Za-z0-9._-]+$/.test(base)) return null;
  const contentType = DEMO_PREVIEW_CONTENT_TYPES[path.extname(base).toLowerCase()];
  if (!contentType) return null;
  return serveBundled(path.join(DEMO_PIPELINE_DIR, base), contentType);
}
