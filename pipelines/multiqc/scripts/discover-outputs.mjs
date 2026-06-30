import fs from "node:fs/promises";
import path from "node:path";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function pathExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function readDirFiles(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(dirPath, entry.name));
  } catch {
    return [];
  }
}

async function main() {
  const raw = await readStdin();
  const payload = JSON.parse(raw || "{}");
  const outputDir = payload.outputDir;

  const files = [];
  const errors = [];

  // Aggregate MultiQC HTML report (study-level, previewable).
  const reportPath = path.join(outputDir, "multiqc", "study-multiqc.html");
  if (await pathExists(reportPath)) {
    files.push({
      type: "report",
      name: "study-multiqc.html",
      path: reportPath,
      fromStep: "multiqc",
      outputId: "multiqc_report",
    });
  } else {
    errors.push("MultiQC report (multiqc/study-multiqc.html) was not produced");
  }

  // MultiQC parsed data tables / metadata (run artifacts for download).
  const dataDir = path.join(outputDir, "multiqc", "multiqc_data");
  const dataFiles = await readDirFiles(dataDir);
  for (const filePath of dataFiles) {
    files.push({
      type: "artifact",
      name: path.basename(filePath),
      path: filePath,
      fromStep: "multiqc",
      outputId: "multiqc_data",
    });
  }

  const summary = {
    assembliesFound: 0,
    binsFound: 0,
    artifactsFound: files.filter((f) => f.outputId === "multiqc_data").length,
    reportsFound: files.filter((f) => f.outputId === "multiqc_report").length,
  };

  process.stdout.write(JSON.stringify({ files, errors, summary }));
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
