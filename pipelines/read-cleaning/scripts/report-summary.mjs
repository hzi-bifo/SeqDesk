// Tool-specific normalization stays in this package, never in the report UI.
// Contract verified against nf-core/detaxizer 1.3.0 (3586921aa3a4c49271f1b2082309bdc33c819749),
// modules/local/{summary_classification,summary_blastn,summarizer}.nf.
const CLASSIFIERS = new Map([
  ["classified with kraken2", "Kraken2"],
  ["classified with bbduk", "BBDuk"],
  ["classified with kraken2 and bbduk", "Kraken2 + BBDuk"],
]);
const VALIDATION_COLUMNS = ["blastn_unique_ids", "blastn_lines", "filteredblastn_unique_ids", "filteredblastn_lines"];

function count(value, label, optional = false) {
  const text = value?.trim() ?? "";
  if (optional && (text === "" || text === "NA" || text === "NaN")) return null;
  const parsed = Number(text);
  if (!/^\d+(?:\.0+)?$/.test(text) || !Number.isSafeInteger(parsed)) {
    throw new Error(`${label} must be a non-negative integer count.`);
  }
  return parsed;
}

/** Normalize only the pinned upstream format; never guess identities or scientific measurements. */
export function normalizeReportSummary(text, samples) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) throw new Error("The screening summary has no sample rows.");
  const headers = lines[0].split("\t");
  if (!["", "sample", "sample_id"].includes(headers[0]) || new Set(headers).size !== headers.length) {
    throw new Error("The screening summary has an unsupported sample header or duplicate columns.");
  }
  const classification = headers.filter(header => CLASSIFIERS.has(header));
  if (classification.length !== 1 || headers.slice(1).some(header => !CLASSIFIERS.has(header) && !VALIDATION_COLUMNS.includes(header))) {
    throw new Error("The screening summary does not match the supported detaxizer classification columns.");
  }

  const identities = new Map();
  for (const sample of samples) {
    if (typeof sample.id !== "string" || typeof sample.sampleId !== "string" || !sample.id || !sample.sampleId) continue;
    // Upstream removes _R1 from its classification index and appends _longReads
    // for long reads. Keep every possible match so collisions are rejected.
    for (const name of new Set([sample.sampleId, `${sample.sampleId}_longReads`].map(name => name.replaceAll("_R1", "")))) {
      const ids = identities.get(name) ?? new Set();
      ids.add(sample.id);
      identities.set(name, ids);
    }
  }
  const seen = new Set();
  return lines.slice(1).map(line => {
    const cells = line.split("\t");
    if (cells.length !== headers.length) throw new Error("The screening summary has an incomplete row.");
    const matches = identities.get(cells[0]);
    if (matches?.size !== 1) throw new Error("A screening summary row has an unknown or ambiguous sample label.");
    const sampleId = [...matches][0];
    if (seen.has(sampleId)) throw new Error("The screening summary contains more than one row for a sample.");
    seen.add(sampleId);
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
    return {
      sample_record: sampleId,
      source_sample: cells[0],
      classifier: CLASSIFIERS.get(classification[0]),
      classified_read_ids: count(row[classification[0]], classification[0]),
      ...Object.fromEntries(VALIDATION_COLUMNS.map(column => [column, count(row[column], column, true)])),
    };
  });
}
