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

  // Parse the summary TSV for writeback metrics (read count + mean quality).
  const summaryPath = path.join(payload.outputDir, "summary", "nanoplot-summary.tsv");
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
        if (!sampleCode) continue;

        metricsBySample.set(sampleCode, {
          readCount1: parseNullableInt(row.num_reads),
          avgQuality1: parseNullableFloat(row.mean_quality),
          readN50: parseNullableInt(row.read_n50),
          meanLength: parseNullableFloat(row.mean_length),
        });
      }
    }

    files.push({
      type: "artifact",
      name: "nanoplot-summary.tsv",
      path: summaryPath,
      fromStep: "collect_stats",
      outputId: "summary_tsv",
    });
  } catch {
    errors.push("NanoPlot summary file was not produced");
  }

  // Discover per-sample NanoPlot outputs in nanoplot/.
  const nanoplotDir = path.join(payload.outputDir, "nanoplot");
  let reportCount = 0;
  try {
    const entries = await fs.readdir(nanoplotDir);

    for (const entry of entries) {
      const reportMatch = entry.match(/^(.+?)_NanoPlot-report\.html$/);
      if (reportMatch) {
        const sampleCode = reportMatch[1];
        const sample = sampleByCode.get(sampleCode);
        if (!sample) {
          errors.push(`No matching sample for NanoPlot report ${entry}`);
          continue;
        }
        files.push({
          type: "report",
          name: entry,
          path: path.join(nanoplotDir, entry),
          sampleId: sample.id,
          sampleName: sample.sampleId,
          fromStep: "nanoplot",
          outputId: "sample_report",
        });
        reportCount += 1;
        continue;
      }

      const statsMatch = entry.match(/^(.+?)_NanoStats\.txt$/);
      if (statsMatch) {
        const sampleCode = statsMatch[1];
        const sample = sampleByCode.get(sampleCode);
        if (!sample) {
          errors.push(`No matching sample for NanoStats ${entry}`);
          continue;
        }
        const statsPath = path.join(nanoplotDir, entry);

        files.push({
          type: "qc",
          name: entry,
          path: statsPath,
          sampleId: sample.id,
          sampleName: sample.sampleId,
          fromStep: "nanoplot",
          outputId: "sample_stats",
        });

        const metrics = metricsBySample.get(sampleCode);
        if (metrics) {
          files.push({
            type: "artifact",
            name: `${sampleCode}_reads_writeback`,
            path: statsPath,
            sampleId: sample.id,
            sampleName: sample.sampleId,
            fromStep: "nanoplot",
            outputId: "sample_reads_writeback",
            metadata: {
              readCount1: metrics.readCount1 ?? null,
              avgQuality1: metrics.avgQuality1 ?? null,
              readN50: metrics.readN50 ?? null,
              meanLength: metrics.meanLength ?? null,
            },
          });
        }
      }
    }
  } catch (error) {
    errors.push(
      `Failed to read NanoPlot outputs: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }

  const summary = {
    assembliesFound: 0,
    binsFound: 0,
    artifactsFound: files.length,
    reportsFound: reportCount,
  };

  process.stdout.write(JSON.stringify({ files, errors, summary }));
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
