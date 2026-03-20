import fs from "fs/promises";
import path from "path";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const raw = await readStdin();
  const payload = JSON.parse(raw || "{}");
  const samples = Array.isArray(payload.samples) ? payload.samples : [];
  const sampleByCode = new Map(samples.map((sample) => [sample.sampleId, sample]));
  const files = [];
  const errors = [];

  const checksumDir = path.join(payload.outputDir, "checksums");
  try {
    const entries = await fs.readdir(checksumDir);
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const filePath = path.join(checksumDir, entry);
      const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
      const sampleCode = parsed.sampleId || path.basename(entry, ".json");
      const sample = sampleByCode.get(sampleCode);

      if (!sample) {
        errors.push(`No matching sample for checksum output ${entry}`);
        continue;
      }

      const ck1 = (parsed.checksum1 || "").trim();
      const ck2 = (parsed.checksum2 || "").trim();

      if (!ck1) {
        errors.push(`Sample ${sampleCode}: checksum1 is empty (FASTQ file may not exist)`);
        continue;
      }

      files.push({
        type: "artifact",
        name: entry,
        path: filePath,
        sampleId: sample.id,
        sampleName: sample.sampleId,
        fromStep: "checksum",
        outputId: "sample_checksums",
        metadata: {
          checksum1: ck1,
          checksum2: ck2 || null,
        },
      });
    }
  } catch (error) {
    errors.push(
      `Failed to read checksum outputs: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }

  const summaryPath = path.join(payload.outputDir, "summary", "checksum-summary.tsv");
  try {
    await fs.access(summaryPath);
    files.push({
      type: "artifact",
      name: "checksum-summary.tsv",
      path: summaryPath,
      fromStep: "checksum",
      outputId: "summary",
    });
  } catch {
    errors.push("Checksum summary file was not produced");
  }

  const summary = {
    assembliesFound: 0,
    binsFound: 0,
    artifactsFound: files.length,
    reportsFound: 0,
  };

  process.stdout.write(JSON.stringify({ files, errors, summary }));
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
