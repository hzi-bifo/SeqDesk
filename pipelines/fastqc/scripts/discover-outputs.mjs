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
  const summaryMetricsBySample = new Map();

  const parseNullableInt = (value) => {
    if (typeof value !== "string" || value.trim().length === 0) {
      return null;
    }
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isNaN(parsed) ? null : parsed;
  };

  const parseNullableFloat = (value) => {
    if (typeof value !== "string" || value.trim().length === 0) {
      return null;
    }
    const parsed = Number.parseFloat(value.trim());
    return Number.isNaN(parsed) ? null : parsed;
  };

  const summaryPath = path.join(payload.outputDir, "summary", "fastqc-summary.tsv");
  try {
    await fs.access(summaryPath);

    const summaryContent = await fs.readFile(summaryPath, "utf8");
    const lines = summaryContent
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length > 0) {
      const headers = lines[0].split("\t");
      for (const line of lines.slice(1)) {
        const values = line.split("\t");
        const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
        const sampleCode = typeof row.sample_id === "string" ? row.sample_id.trim() : "";

        if (!sampleCode) {
          continue;
        }

        summaryMetricsBySample.set(sampleCode, {
          readCount1: parseNullableInt(row.r1_read_count),
          readCount2: parseNullableInt(row.r2_read_count),
          avgQuality1: parseNullableFloat(row.r1_avg_quality),
          avgQuality2: parseNullableFloat(row.r2_avg_quality),
        });
      }
    }

    files.push({
      type: "artifact",
      name: "fastqc-summary.tsv",
      path: summaryPath,
      fromStep: "fastqc",
      outputId: "summary",
    });
  } catch {
    errors.push("FastQC summary file was not produced");
  }

  const reportsDir = path.join(payload.outputDir, "fastqc_reports");
  try {
    const entries = await fs.readdir(reportsDir);
    for (const entry of entries) {
      // Match files like {sampleId}_R1_fastqc.html or {sampleId}_R2_fastqc.zip
      const htmlMatch = entry.match(/^(.+?)_(R[12])_fastqc\.html$/);
      const zipMatch = entry.match(/^(.+?)_(R[12])_fastqc\.zip$/);
      const match = htmlMatch || zipMatch;
      if (!match) continue;

      const sampleCode = match[1];
      const readEnd = match[2];
      const sample = sampleByCode.get(sampleCode);

      if (!sample) {
        errors.push(`No matching sample for FastQC output ${entry}`);
        continue;
      }

      const filePath = path.join(reportsDir, entry);
      const isHtml = !!htmlMatch;

      files.push({
        type: "artifact",
        name: entry,
        path: filePath,
        sampleId: sample.id,
        sampleName: sample.sampleId,
        fromStep: "fastqc",
        outputId: isHtml ? "sample_qc_reports" : "sample_qc_data",
        metadata: {
          readEnd,
          format: isHtml ? "html" : "zip",
        },
      });
    }
  } catch (error) {
    errors.push(
      `Failed to read FastQC outputs: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }

  // Emit metadata-only entries to write fastqcReport1/fastqcReport2 to Read model
  const htmlBySample = new Map();
  for (const f of files) {
    if (f.outputId !== "sample_qc_reports" || !f.sampleId) continue;
    const readEnd = f.metadata?.readEnd;
    if (!readEnd) continue;
    if (!htmlBySample.has(f.sampleId)) {
      htmlBySample.set(f.sampleId, { id: f.sampleId, name: f.sampleName });
    }
    const entry = htmlBySample.get(f.sampleId);
    if (readEnd === "R1") entry.report1 = f.path;
    if (readEnd === "R2") entry.report2 = f.path;
  }
  for (const [sampleId, entry] of htmlBySample) {
    files.push({
      type: "artifact",
      name: `${entry.name}_fastqc_reads`,
      path: entry.report1 || entry.report2,
      sampleId,
      sampleName: entry.name,
      fromStep: "fastqc",
      outputId: "sample_fastqc_reads",
      metadata: {
        fastqcReport1: entry.report1 || null,
        fastqcReport2: entry.report2 || null,
        readCount1: summaryMetricsBySample.get(entry.name)?.readCount1 ?? null,
        readCount2: summaryMetricsBySample.get(entry.name)?.readCount2 ?? null,
        avgQuality1: summaryMetricsBySample.get(entry.name)?.avgQuality1 ?? null,
        avgQuality2: summaryMetricsBySample.get(entry.name)?.avgQuality2 ?? null,
      },
    });
  }

  const reportsFound = files.filter((f) => f.outputId === "sample_qc_reports").length;

  const summary = {
    assembliesFound: 0,
    binsFound: 0,
    artifactsFound: files.length,
    reportsFound,
  };

  process.stdout.write(JSON.stringify({ files, errors, summary }));
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
