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
  const metricsBySample = new Map();

  const parseNullableInt = (value) => {
    if (typeof value !== "string" || value.trim().length === 0) return null;
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isNaN(parsed) ? null : parsed;
  };

  const parseNullableFloat = (value) => {
    if (typeof value !== "string" || value.trim().length === 0) return null;
    const parsed = Number.parseFloat(value.trim());
    return Number.isNaN(parsed) ? null : parsed;
  };

  // Parse the summary TSV for writeback metrics
  const summaryPath = path.join(payload.outputDir, "summary", "reads-qc-summary.tsv");
  try {
    await fs.access(summaryPath);
    const content = await fs.readFile(summaryPath, "utf8");
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length > 0) {
      const headers = lines[0].split("\t");
      for (const line of lines.slice(1)) {
        const values = line.split("\t");
        const row = Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
        const sampleCode = (row.sample_id || "").trim();
        const readEnd = (row.read_end || "").trim();
        if (!sampleCode) continue;

        if (!metricsBySample.has(sampleCode)) {
          metricsBySample.set(sampleCode, {});
        }
        const entry = metricsBySample.get(sampleCode);

        if (readEnd === "R1") {
          entry.readCount1 = parseNullableInt(row.num_reads);
          entry.avgQuality1 = parseNullableFloat(row.avg_quality);
        } else if (readEnd === "R2") {
          entry.readCount2 = parseNullableInt(row.num_reads);
          entry.avgQuality2 = parseNullableFloat(row.avg_quality);
        }
      }
    }

    files.push({
      type: "artifact",
      name: "reads-qc-summary.tsv",
      path: summaryPath,
      fromStep: "collect_stats",
      outputId: "summary_tsv",
    });
  } catch {
    errors.push("Reads QC summary file was not produced");
  }

  // Discover per-sample TSV files
  const perSampleDir = path.join(payload.outputDir, "per_sample");
  try {
    const entries = await fs.readdir(perSampleDir);
    for (const entry of entries) {
      const match = entry.match(/^(.+?)\.tsv$/);
      if (!match) continue;

      const sampleCode = match[1];
      const sample = sampleByCode.get(sampleCode);

      if (!sample) {
        errors.push(`No matching sample for reads-qc output ${entry}`);
        continue;
      }

      const filePath = path.join(perSampleDir, entry);

      files.push({
        type: "artifact",
        name: entry,
        path: filePath,
        sampleId: sample.id,
        sampleName: sample.sampleId,
        fromStep: "seqkit_stats",
        outputId: "sample_stats",
      });
    }
  } catch (error) {
    errors.push(
      `Failed to read per-sample outputs: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }

  // Emit writeback entries for each sample that has metrics
  for (const [sampleCode, metrics] of metricsBySample) {
    const sample = sampleByCode.get(sampleCode);
    if (!sample) continue;

    const perSamplePath = path.join(perSampleDir, `${sampleCode}.tsv`);
    files.push({
      type: "artifact",
      name: `${sampleCode}_reads_writeback`,
      path: perSamplePath,
      sampleId: sample.id,
      sampleName: sample.sampleId,
      fromStep: "seqkit_stats",
      outputId: "sample_reads_writeback",
      metadata: {
        readCount1: metrics.readCount1 ?? null,
        readCount2: metrics.readCount2 ?? null,
        avgQuality1: metrics.avgQuality1 ?? null,
        avgQuality2: metrics.avgQuality2 ?? null,
      },
    });
  }

  // Discover HTML report
  const reportPath = path.join(payload.outputDir, "report", "reads-qc-report.html");
  try {
    await fs.access(reportPath);
    files.push({
      type: "artifact",
      name: "reads-qc-report.html",
      path: reportPath,
      fromStep: "generate_report",
      outputId: "summary_report",
    });
  } catch {
    errors.push("HTML summary report was not produced");
  }

  const summary = {
    assembliesFound: 0,
    binsFound: 0,
    artifactsFound: files.length,
    reportsFound: files.filter((f) => f.outputId === "summary_report").length,
  };

  process.stdout.write(JSON.stringify({ files, errors, summary }));
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
