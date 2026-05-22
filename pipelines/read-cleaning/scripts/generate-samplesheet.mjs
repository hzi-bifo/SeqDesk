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

function normalizeDataClass(value) {
  return value === "raw" || value === "unknown" || value === "cleaned"
    ? value
    : "cleaned";
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function absoluteReadPath(dataBasePath, filePath) {
  if (!filePath) return "";
  return path.isAbsolute(filePath) ? filePath : path.join(dataBasePath, filePath);
}

function readTypeFromConfig(value) {
  return value === "short" || value === "long" ? value : "auto";
}

function readTypeFromOrder(order) {
  const haystack = [
    order?.platform,
    order?.customFields,
  ]
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLowerCase();

  if (
    haystack.includes("nanopore") ||
    haystack.includes("oxford") ||
    haystack.includes("ont") ||
    haystack.includes("pacbio") ||
    haystack.includes("revio") ||
    haystack.includes("sequel") ||
    haystack.includes("promethion") ||
    haystack.includes("gridion") ||
    haystack.includes("minion")
  ) {
    return "long";
  }

  return "short";
}

function selectInputRead(sample) {
  const activeReads = (sample.reads || []).filter((read) => read.isActive !== false);
  const protectedReads = activeReads.filter((read) => {
    const dataClass = normalizeDataClass(read.dataClass);
    return dataClass === "raw" || dataClass === "unknown";
  });

  return (
    protectedReads.find((read) => read.file1 && read.file2) ||
    protectedReads.find((read) => read.file1) ||
    null
  );
}

function buildRows(payload) {
  const errors = [];
  const rows = [];
  const configuredReadType = readTypeFromConfig(payload.config?.readType);

  for (const sample of payload.samples || []) {
    const read = selectInputRead(sample);
    if (!read?.file1) {
      errors.push(`Sample ${sample.sampleId}: active raw or unknown read files are required`);
      continue;
    }

    const readType =
      configuredReadType === "auto"
        ? read.file2
          ? "short"
          : readTypeFromOrder(sample.order)
        : configuredReadType;

    const file1 = absoluteReadPath(payload.dataBasePath, read.file1);
    const file2 = absoluteReadPath(payload.dataBasePath, read.file2);

    rows.push([
      sample.sampleId,
      readType === "short" ? file1 : "",
      readType === "short" ? file2 : "",
      readType === "long" ? file1 : "",
    ]);
  }

  return { rows, errors };
}

try {
  const payload = JSON.parse(await readStdin());
  const header = ["sample", "short_reads_fastq_1", "short_reads_fastq_2", "long_reads_fastq_1"];
  const { rows, errors } = buildRows(payload);
  const content = [header, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");

  process.stdout.write(
    JSON.stringify({
      content,
      sampleCount: rows.length,
      errors,
    })
  );
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : "Unknown error");
  process.exit(1);
}
