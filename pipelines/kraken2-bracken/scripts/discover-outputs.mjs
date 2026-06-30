import fs from "fs/promises";
import path from "path";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

const TOP_N = 5;

function parseNullableInt(value) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseNullableFloat(value) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = Number.parseFloat(value.trim());
  return Number.isNaN(parsed) ? null : parsed;
}

// Parse a per-sample Bracken TSV (columns: sample_id, name, taxonomy_id,
// taxonomy_lvl, kraken_assigned_reads, added_reads, new_est_reads,
// fraction_total_reads) and return the top-N taxa by fraction.
async function parseBrackenTop(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.length > 0);
  if (lines.length <= 1) return [];

  const rows = lines.slice(1).map((line) => {
    const c = line.split("\t");
    return {
      name: (c[1] || "").trim(),
      taxonomyId: parseNullableInt(c[2]),
      newEstReads: parseNullableInt(c[6]),
      fraction: parseNullableFloat(c[7]),
    };
  });

  rows.sort((a, b) => (b.fraction ?? 0) - (a.fraction ?? 0));
  return rows.slice(0, TOP_N);
}

async function main() {
  const raw = await readStdin();
  const payload = JSON.parse(raw || "{}");
  const samples = Array.isArray(payload.samples) ? payload.samples : [];
  const sampleByCode = new Map(samples.map((sample) => [sample.sampleId, sample]));
  const files = [];
  const errors = [];

  const dirEntries = async (dir) => {
    try {
      return await fs.readdir(dir);
    } catch {
      return [];
    }
  };

  // Per-sample Kraken2 reports
  const kraken2Dir = path.join(payload.outputDir, "kraken2");
  for (const entry of await dirEntries(kraken2Dir)) {
    const match = entry.match(/^(.+?)\.kraken2\.report\.txt$/);
    if (!match) continue;
    const sample = sampleByCode.get(match[1]);
    if (!sample) {
      errors.push(`No matching sample for Kraken2 report ${entry}`);
      continue;
    }
    files.push({
      type: "report",
      name: entry,
      path: path.join(kraken2Dir, entry),
      sampleId: sample.id,
      sampleName: sample.sampleId,
      fromStep: "kraken2",
      outputId: "kraken2_report",
    });
  }

  // Per-sample Bracken abundance tables (+ top-N taxa metadata)
  const brackenDir = path.join(payload.outputDir, "bracken");
  for (const entry of await dirEntries(brackenDir)) {
    const match = entry.match(/^(.+?)\.bracken\.tsv$/);
    if (!match) continue;
    const sample = sampleByCode.get(match[1]);
    if (!sample) {
      errors.push(`No matching sample for Bracken table ${entry}`);
      continue;
    }
    const filePath = path.join(brackenDir, entry);
    let topTaxa = [];
    try {
      topTaxa = await parseBrackenTop(filePath);
    } catch (error) {
      errors.push(
        `Failed to parse Bracken table ${entry}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
    const top = topTaxa[0];
    files.push({
      type: "artifact",
      name: entry,
      path: filePath,
      sampleId: sample.id,
      sampleName: sample.sampleId,
      fromStep: "bracken",
      outputId: "bracken_abundance",
      metadata: {
        topTaxon: top?.name ?? null,
        topTaxonomyId: top?.taxonomyId ?? null,
        topFraction: top?.fraction ?? null,
        topReads: top?.newEstReads ?? null,
        topTaxa,
      },
    });
  }

  // Per-sample Krona HTML
  const kronaDir = path.join(payload.outputDir, "krona");
  for (const entry of await dirEntries(kronaDir)) {
    const match = entry.match(/^(.+?)\.krona\.html$/);
    if (!match) continue;
    const sample = sampleByCode.get(match[1]);
    if (!sample) {
      errors.push(`No matching sample for Krona chart ${entry}`);
      continue;
    }
    files.push({
      type: "report",
      name: entry,
      path: path.join(kronaDir, entry),
      sampleId: sample.id,
      sampleName: sample.sampleId,
      fromStep: "krona",
      outputId: "krona_html",
    });
  }

  // Run-level summary TSV
  const summaryPath = path.join(payload.outputDir, "summary", "kraken2-bracken-summary.tsv");
  try {
    await fs.access(summaryPath);
    files.push({
      type: "artifact",
      name: "kraken2-bracken-summary.tsv",
      path: summaryPath,
      fromStep: "summary",
      outputId: "summary_tsv",
    });
  } catch {
    errors.push("Run summary table was not produced");
  }

  const summary = {
    assembliesFound: 0,
    binsFound: 0,
    artifactsFound: files.filter((f) => f.type === "artifact").length,
    reportsFound: files.filter((f) => f.type === "report").length,
  };

  process.stdout.write(JSON.stringify({ files, errors, summary }));
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
