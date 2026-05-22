import fs from "node:fs/promises";
import path from "node:path";

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
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

function parseMaybeNumber(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

async function parseSummaryRows(summaryPath) {
  if (!(await pathExists(summaryPath))) return new Map();

  try {
    const content = await fs.readFile(summaryPath, "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return new Map();
    const header = lines[0].split("\t");
    const sampleIndex = header.findIndex((key) => key === "sample" || key === "sample_id");
    if (sampleIndex < 0) return new Map();

    const rows = new Map();
    for (const line of lines.slice(1)) {
      const cells = line.split("\t");
      const sample = cells[sampleIndex];
      if (!sample) continue;
      const metadata = {};
      header.forEach((key, index) => {
        if (key) metadata[key] = parseMaybeNumber(cells[index]);
      });
      rows.set(sample, metadata);
    }
    return rows;
  } catch {
    return new Map();
  }
}

function sampleSummary(summaryRows, sampleName, readLayout) {
  return (
    summaryRows.get(sampleName) ||
    (readLayout === "long" ? summaryRows.get(`${sampleName}_longReads`) : undefined) ||
    {}
  );
}

async function discoverCandidates(payload, summaryRows) {
  const files = [];
  const errors = [];
  const filteredDir = path.join(payload.outputDir, "filter", "filtered");

  for (const sample of payload.samples || []) {
    const sampleName = sample.sampleId;
    const pairedR1 = path.join(filteredDir, `${sampleName}_R1_filtered.fastq.gz`);
    const pairedR2 = path.join(filteredDir, `${sampleName}_R2_filtered.fastq.gz`);
    const single = path.join(filteredDir, `${sampleName}_filtered.fastq.gz`);
    const longRead = path.join(filteredDir, `${sampleName}_longReads_filtered.fastq.gz`);

    if (await pathExists(pairedR1)) {
      files.push({
        type: "artifact",
        name: `${sampleName} cleaned reads`,
        path: pairedR1,
        sampleId: sample.id,
        sampleName,
        fromStep: "filter",
        outputId: "cleaned_read_candidates",
        metadata: {
          dataClass: "cleaned",
          readLayout: "paired",
          sourceFile1: pairedR1,
          sourceFile2: (await pathExists(pairedR2)) ? pairedR2 : null,
          ...sampleSummary(summaryRows, sampleName, "paired"),
        },
      });
      continue;
    }

    if (await pathExists(longRead)) {
      files.push({
        type: "artifact",
        name: `${sampleName} cleaned long reads`,
        path: longRead,
        sampleId: sample.id,
        sampleName,
        fromStep: "filter",
        outputId: "cleaned_read_candidates",
        metadata: {
          dataClass: "cleaned",
          readLayout: "long",
          sourceFile1: longRead,
          sourceFile2: null,
          ...sampleSummary(summaryRows, sampleName, "long"),
        },
      });
      continue;
    }

    if (await pathExists(single)) {
      files.push({
        type: "artifact",
        name: `${sampleName} cleaned reads`,
        path: single,
        sampleId: sample.id,
        sampleName,
        fromStep: "filter",
        outputId: "cleaned_read_candidates",
        metadata: {
          dataClass: "cleaned",
          readLayout: "single",
          sourceFile1: single,
          sourceFile2: null,
          ...sampleSummary(summaryRows, sampleName, "single"),
        },
      });
      continue;
    }
  }

  return { files, errors };
}

async function discoverRemovedReads(payload) {
  const removedDir = path.join(payload.outputDir, "filter", "removed");
  const files = [];
  const entries = await readDirFiles(removedDir);

  for (const filePath of entries) {
    const basename = path.basename(filePath);
    if (!basename.endsWith("_removed.fastq.gz")) continue;
    const sample = (payload.samples || []).find((item) => basename.startsWith(item.sampleId));
    files.push({
      type: "artifact",
      name: basename,
      path: filePath,
      ...(sample ? { sampleId: sample.id, sampleName: sample.sampleId } : {}),
      fromStep: "filter",
      outputId: "removed_reads",
    });
  }

  return files;
}

try {
  const payload = JSON.parse(await readStdin());
  const files = [];
  const errors = [];
  const summaryPath = path.join(payload.outputDir, "summary", "summary.tsv");
  const summaryRows = await parseSummaryRows(summaryPath);

  const candidates = await discoverCandidates(payload, summaryRows);
  files.push(...candidates.files);
  errors.push(...candidates.errors);
  files.push(...(await discoverRemovedReads(payload)));

  if (await pathExists(summaryPath)) {
    files.push({
      type: "artifact",
      name: "summary.tsv",
      path: summaryPath,
      fromStep: "summary",
      outputId: "summary",
    });
  }

  const multiqcPath = path.join(payload.outputDir, "multiqc", "multiqc_report.html");
  if (await pathExists(multiqcPath)) {
    files.push({
      type: "report",
      name: "MultiQC report",
      path: multiqcPath,
      fromStep: "multiqc",
      outputId: "multiqc_report",
    });
  }

  const pipelineInfoFiles = await readDirFiles(path.join(payload.outputDir, "pipeline_info"));
  for (const filePath of pipelineInfoFiles) {
    files.push({
      type: "artifact",
      name: path.basename(filePath),
      path: filePath,
      fromStep: "pipeline_info",
      outputId: "pipeline_info",
    });
  }

  process.stdout.write(
    JSON.stringify({
      files,
      errors,
      summary: {
        assembliesFound: 0,
        binsFound: 0,
        artifactsFound: files.filter((file) => file.type !== "report").length,
        reportsFound: files.filter((file) => file.type === "report").length,
      },
    })
  );
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : "Unknown error");
  process.exit(1);
}
