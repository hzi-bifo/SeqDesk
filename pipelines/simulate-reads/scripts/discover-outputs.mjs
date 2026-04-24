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

  const manifestsDir = path.join(payload.outputDir, "manifests");
  try {
    const entries = await fs.readdir(manifestsDir);
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;

      const manifestPath = path.join(manifestsDir, entry);
      const parsed = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      const sampleCode = parsed.sampleId || path.basename(entry, ".json");
      const sample = sampleByCode.get(sampleCode);

      if (!sample) {
        errors.push(`No matching sample for simulated reads output ${entry}`);
        continue;
      }

      const relativeDir = path.join("simulated", `order_${parsed.orderId}`);
      const file1Name = parsed.file1Name;
      const file2Name = parsed.file2Name || null;

      if (!file1Name) {
        errors.push(`Simulation manifest ${entry} does not define file1Name`);
        continue;
      }

      files.push({
        type: "artifact",
        name: entry,
        path: manifestPath,
        sampleId: sample.id,
        sampleName: sample.sampleId,
        fromStep: "simulate_reads",
        outputId: "sample_simulated_reads",
        metadata: {
          file1: path.join(relativeDir, file1Name),
          file2: file2Name ? path.join(relativeDir, file2Name) : null,
          sourceFile1: path.join(payload.outputDir, "reads", file1Name),
          sourceFile2: file2Name ? path.join(payload.outputDir, "reads", file2Name) : null,
          readCount1: parsed.readCount1 ?? null,
          readCount2: parsed.readCount2 ?? null,
          readLength: parsed.readLength ?? null,
          replaceExisting: parsed.replaceExisting !== false,
          simulationModeRequested: parsed.simulationModeRequested ?? null,
          simulationModeUsed: parsed.simulationModeUsed ?? null,
          qualityProfile: parsed.qualityProfile ?? null,
          insertMean: parsed.insertMean ?? null,
          insertStdDev: parsed.insertStdDev ?? null,
          seed: parsed.seed ?? null,
          templateLabel: parsed.templateLabel ?? null,
          templateDir: parsed.templateDir ?? null,
        },
      });
    }
  } catch (error) {
    errors.push(
      `Failed to read simulation manifests: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }

  const summaryPath = path.join(payload.outputDir, "summary", "simulation-summary.tsv");
  try {
    await fs.access(summaryPath);
    files.push({
      type: "artifact",
      name: "simulation-summary.tsv",
      path: summaryPath,
      fromStep: "simulate_reads",
      outputId: "summary",
    });
  } catch {
    errors.push("Simulation summary file was not produced");
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
