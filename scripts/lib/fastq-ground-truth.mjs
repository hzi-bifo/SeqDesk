import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

import { formatHalfEvenBinary64 } from "./decimal-rounding.mjs";

const GZIP_MAGIC_BYTE_1 = 0x1f;
const GZIP_MAGIC_BYTE_2 = 0x8b;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const HEADER_PREFIX = 0x40;
const PLUS_PREFIX = 0x2b;
const MIN_PRINTABLE_ASCII = 0x20;
const MIN_PHRED_33_ASCII = 0x21;
const MIN_PHRED_64_ASCII = 0x40;
const MAX_PRINTABLE_ASCII = 0x7e;
const FASTQC_ENCODING_OFFSETS = new Map([
  ["Sanger / Illumina 1.9", 33],
  ["Illumina 1.3", 64],
  ["Illumina 1.5", 64],
]);

export class FastqValidationError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "FastqValidationError";
  }
}

async function isGzipFile(filePath) {
  const handle = await fsPromises.open(filePath, "r");
  try {
    const signature = Buffer.alloc(2);
    const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
    return (
      bytesRead === signature.length &&
      signature[0] === GZIP_MAGIC_BYTE_1 &&
      signature[1] === GZIP_MAGIC_BYTE_2
    );
  } finally {
    await handle.close();
  }
}

async function* readFastqChunks(filePath, gzipCompressed) {
  const source = fs.createReadStream(filePath);
  if (!gzipCompressed) {
    yield* source;
    return;
  }

  const gunzip = zlib.createGunzip();
  const forwardSourceError = (error) => gunzip.destroy(error);
  source.on("error", forwardSourceError);
  source.pipe(gunzip);

  try {
    yield* gunzip;
  } finally {
    source.off("error", forwardSourceError);
    source.unpipe(gunzip);
    source.destroy();
    gunzip.destroy();
  }
}

async function* readFastqLines(filePath, gzipCompressed) {
  let pending = Buffer.alloc(0);

  for await (const rawChunk of readFastqChunks(
    filePath,
    gzipCompressed
  )) {
    const chunk = Buffer.isBuffer(rawChunk)
      ? rawChunk
      : Buffer.from(rawChunk);
    const buffer =
      pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
    let lineStart = 0;
    let lineEnd = buffer.indexOf(LINE_FEED, lineStart);

    while (lineEnd !== -1) {
      let line = buffer.subarray(lineStart, lineEnd);
      if (
        line.length > 0 &&
        line[line.length - 1] === CARRIAGE_RETURN
      ) {
        line = line.subarray(0, line.length - 1);
      }
      yield line;
      lineStart = lineEnd + 1;
      lineEnd = buffer.indexOf(LINE_FEED, lineStart);
    }

    pending =
      lineStart === buffer.length
        ? Buffer.alloc(0)
        : Buffer.from(buffer.subarray(lineStart));
  }

  if (pending.length > 0) {
    if (pending[pending.length - 1] === CARRIAGE_RETURN) {
      pending = pending.subarray(0, pending.length - 1);
    }
    yield pending;
  }
}

function failRecord(filePath, recordNumber, message) {
  throw new FastqValidationError(
    `Invalid FASTQ ${filePath}, record ${recordNumber}: ${message}`
  );
}

function assertPrintableAscii(
  line,
  {
    filePath,
    recordNumber,
    label,
    minimum = MIN_PRINTABLE_ASCII,
  }
) {
  for (const byte of line) {
    if (byte < minimum || byte > MAX_PRINTABLE_ASCII) {
      failRecord(
        filePath,
        recordNumber,
        `${label} contains a non-Phred+33/non-printable ASCII byte (${byte})`
      );
    }
  }
}

function validateRecord(filePath, recordNumber, lines) {
  const [header, sequence, plus, quality] = lines;

  if (
    header.length < 2 ||
    header[0] !== HEADER_PREFIX ||
    header.subarray(1).toString("ascii").trim().length === 0
  ) {
    failRecord(
      filePath,
      recordNumber,
      'header must start with "@" and contain a read identifier'
    );
  }
  assertPrintableAscii(header, {
    filePath,
    recordNumber,
    label: "header",
  });

  if (sequence.length === 0) {
    failRecord(filePath, recordNumber, "sequence must not be empty");
  }
  assertPrintableAscii(sequence, {
    filePath,
    recordNumber,
    label: "sequence",
    minimum: MIN_PHRED_33_ASCII,
  });

  if (plus.length === 0 || plus[0] !== PLUS_PREFIX) {
    failRecord(filePath, recordNumber, 'separator must start with "+"');
  }
  assertPrintableAscii(plus, {
    filePath,
    recordNumber,
    label: "separator",
  });

  if (quality.length === 0) {
    failRecord(filePath, recordNumber, "quality must not be empty");
  }
  if (quality.length !== sequence.length) {
    failRecord(
      filePath,
      recordNumber,
      `sequence and quality lengths differ (${sequence.length} !== ${quality.length})`
    );
  }
  assertPrintableAscii(quality, {
    filePath,
    recordNumber,
    label: "quality",
    minimum: MIN_PHRED_33_ASCII,
  });

  let qualityScoreTotal = 0;
  let qualityScoreOffset64Total = 0;
  let fastqcOffset64Compatible = true;
  let errorProbabilityTotal = 0;
  let q20BaseCount = 0;
  let q30BaseCount = 0;
  for (const byte of quality) {
    const qualityScore = byte - MIN_PHRED_33_ASCII;
    qualityScoreTotal += qualityScore;
    if (byte < MIN_PHRED_64_ASCII) {
      fastqcOffset64Compatible = false;
    } else {
      qualityScoreOffset64Total += byte - MIN_PHRED_64_ASCII;
    }
    errorProbabilityTotal += 10 ** (-qualityScore / 10);
    if (qualityScore >= 20) q20BaseCount += 1;
    if (qualityScore >= 30) q30BaseCount += 1;
  }

  let gBaseCount = 0;
  let cBaseCount = 0;
  for (const byte of sequence) {
    if (byte === 0x47 || byte === 0x67) {
      // G / g
      gBaseCount += 1;
    } else if (byte === 0x43 || byte === 0x63) {
      // C / c
      cBaseCount += 1;
    }
  }

  return {
    readLength: sequence.length,
    qualityScoreTotal,
    qualityScoreOffset64Total,
    fastqcOffset64Compatible,
    errorProbabilityTotal,
    q20BaseCount,
    q30BaseCount,
    gBaseCount,
    cBaseCount,
  };
}

function addSafeInteger(current, increment, label, filePath) {
  const result = current + increment;
  if (!Number.isSafeInteger(result)) {
    throw new FastqValidationError(
      `FASTQ ${filePath} exceeds the safe integer range for ${label}`
    );
  }
  return result;
}

function lengthAtRank(sortedLengthCounts, rank) {
  let observed = 0;
  for (const [length, count] of sortedLengthCounts) {
    observed += count;
    if (observed >= rank) return length;
  }
  throw new Error(`Could not resolve FASTQ read-length rank ${rank}`);
}

function calculateMedianLength(lengthCounts, readCount) {
  const sortedLengthCounts = [...lengthCounts.entries()].sort(
    ([left], [right]) => left - right
  );
  const lowerRank = Math.floor((readCount + 1) / 2);
  const upperRank = Math.ceil((readCount + 1) / 2);
  return (
    (lengthAtRank(sortedLengthCounts, lowerRank) +
      lengthAtRank(sortedLengthCounts, upperRank)) /
    2
  );
}

function calculateN50(lengthCounts, totalBases) {
  const descendingLengthCounts = [...lengthCounts.entries()].sort(
    ([left], [right]) => right - left
  );
  const threshold = totalBases / 2;
  let cumulativeBases = 0;
  for (const [length, count] of descendingLengthCounts) {
    cumulativeBases += length * count;
    if (cumulativeBases >= threshold) return length;
  }
  throw new Error("Could not calculate FASTQ read N50");
}

// NanoMath 1.3+/1.4 computes N50 from an ascending numpy sort and uses the
// first length whose cumulative sum reaches half of all bases. This differs
// from the conventional descending implementation only at some exact
// half-way boundaries, so keep it as an explicitly named tool-semantic value.
function calculateNanomathN50(lengthCounts, totalBases) {
  const ascendingLengthCounts = [...lengthCounts.entries()].sort(
    ([left], [right]) => left - right
  );
  const threshold = totalBases / 2;
  let cumulativeBases = 0;
  for (const [length, count] of ascendingLengthCounts) {
    cumulativeBases += length * count;
    if (cumulativeBases >= threshold) return length;
  }
  throw new Error("Could not calculate NanoMath FASTQ read N50");
}

/**
 * Independently calculate exact FASTQ metrics without loading the complete
 * file into memory. Compression is detected from the gzip magic bytes, not
 * from the filename.
 *
 * @param {string} fastqPath path to a plain or gzip-compressed FASTQ file
 * @returns {Promise<{
 *   readCount: number,
 *   totalBases: number,
 *   minReadLength: number,
 *   maxReadLength: number,
 *   meanReadLength: number,
 *   medianReadLength: number,
 *   n50: number,
 *   meanBaseQuality: number,
 *   meanPerReadQuality: number,
 *   meanErrorProbabilityQuality: number,
 *   meanPerReadErrorProbabilityQuality: number,
 *   fastqcMeanSequenceQuality: number,
 *   fastqcMeanSequenceQualityByOffset: {
 *     33: number,
 *     64: number | null,
 *   },
 *   nanomathMeanReadQuality: number,
 *   q20Percent: number,
 *   q30Percent: number,
 *   gcBasePercent: number,
 *   meanPerReadGcPercent: number,
 *   seqkitMeanPerReadGcPercent: number,
 *   seqkitPerReadGcBinary64Total: number,
 *   seqkitPerReadGcHundredthsTotal: number,
 *   seqkitGcReadCount: number,
 *   nanomathN50: number,
 * }>}
 */
export async function computeFastqGroundTruth(fastqPath) {
  if (typeof fastqPath !== "string" || fastqPath.trim().length === 0) {
    throw new TypeError("FASTQ path must be a non-empty string");
  }

  const filePath = path.resolve(fastqPath);
  let gzipCompressed;
  try {
    gzipCompressed = await isGzipFile(filePath);
  } catch (error) {
    throw new FastqValidationError(
      `Could not open FASTQ ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }

  let readCount = 0;
  let totalBases = 0;
  let totalQualityScore = 0;
  let perReadMeanQualityTotal = 0;
  let totalErrorProbability = 0;
  let perReadErrorProbabilityQualityTotal = 0;
  let fastqcBinnedQualityOffset33Total = 0;
  let fastqcBinnedQualityOffset64Total = 0;
  let fastqcOffset64Compatible = true;
  let nanomathTruncatedReadErrorProbabilityTotal = 0;
  let q20BaseCount = 0;
  let q30BaseCount = 0;
  let gcBaseCount = 0;
  let perReadGcPercentTotal = 0;
  let seqkitPerReadGcBinary64Total = 0;
  let seqkitPerReadGcHundredthsTotal = 0;
  let seqkitGcReadCount = 0;
  let minReadLength = Number.POSITIVE_INFINITY;
  let maxReadLength = 0;
  const lengthCounts = new Map();
  let recordLines = [];

  try {
    for await (const line of readFastqLines(
      filePath,
      gzipCompressed
    )) {
      recordLines.push(line);
      if (recordLines.length < 4) continue;

      const recordNumber = readCount + 1;
      const {
        readLength,
        qualityScoreTotal,
        qualityScoreOffset64Total,
        fastqcOffset64Compatible: recordFastqcOffset64Compatible,
        errorProbabilityTotal,
        q20BaseCount: recordQ20BaseCount,
        q30BaseCount: recordQ30BaseCount,
        gBaseCount: recordGBaseCount,
        cBaseCount: recordCBaseCount,
      } = validateRecord(
        filePath,
        recordNumber,
        recordLines
      );
      readCount = addSafeInteger(readCount, 1, "read count", filePath);
      totalBases = addSafeInteger(
        totalBases,
        readLength,
        "total bases",
        filePath
      );
      totalQualityScore = addSafeInteger(
        totalQualityScore,
        qualityScoreTotal,
        "total quality score",
        filePath
      );
      perReadMeanQualityTotal += qualityScoreTotal / readLength;
      totalErrorProbability += errorProbabilityTotal;
      const perReadErrorProbabilityQuality =
        -10 * Math.log10(errorProbabilityTotal / readLength);
      perReadErrorProbabilityQualityTotal +=
        perReadErrorProbabilityQuality;
      // FastQC 0.12.1 bins every read by integer division of the summed
      // ASCII qualities. With Phred+33 input this is floor(mean Phred).
      fastqcBinnedQualityOffset33Total = addSafeInteger(
        fastqcBinnedQualityOffset33Total,
        Math.floor(qualityScoreTotal / readLength),
        "FastQC offset-33 binned quality total",
        filePath
      );
      if (recordFastqcOffset64Compatible) {
        fastqcBinnedQualityOffset64Total = addSafeInteger(
          fastqcBinnedQualityOffset64Total,
          Math.floor(qualityScoreOffset64Total / readLength),
          "FastQC offset-64 binned quality total",
          filePath
        );
      } else {
        fastqcOffset64Compatible = false;
      }
      // NanoGet stores the error-probability quality for each read in a
      // float32 numpy column. NanoMath then casts that float32 value to int
      // before applying ave_qual across reads. Model both conversions: a
      // direct truncation of the JavaScript double differs at float32
      // rounding boundaries.
      const nanogetFloat32ReadQuality = Math.fround(
        perReadErrorProbabilityQuality
      );
      nanomathTruncatedReadErrorProbabilityTotal +=
        10 ** (-Math.trunc(nanogetFloat32ReadQuality) / 10);
      q20BaseCount = addSafeInteger(
        q20BaseCount,
        recordQ20BaseCount,
        "Q20 base count",
        filePath
      );
      q30BaseCount = addSafeInteger(
        q30BaseCount,
        recordQ30BaseCount,
        "Q30 base count",
        filePath
      );
      gcBaseCount = addSafeInteger(
        gcBaseCount,
        recordGBaseCount + recordCBaseCount,
        "GC base count",
        filePath
      );
      perReadGcPercentTotal +=
        ((recordGBaseCount + recordCBaseCount) / readLength) * 100;
      // Pinned SeqKit 2.8.0 computes (G+C)/full read length, so ambiguous
      // bases remain in the denominator and an all-N read contributes 0.00.
      // fx2tab calls BaseContent("G") and BaseContent("C") separately before
      // adding the two binary64 ratios and multiplying by 100. Preserve that
      // operation order: combining the integer counts first can cross a
      // two-decimal Go fmt rounding boundary.
      const seqkitGcBinary64 =
        (recordGBaseCount / readLength +
          recordCBaseCount / readLength) *
        100;
      const seqkitGcText = formatHalfEvenBinary64(
        seqkitGcBinary64,
        2
      );
      const seqkitGcValue = Number(seqkitGcText);
      const seqkitGcHundredths = Number(seqkitGcText.replace(".", ""));
      seqkitPerReadGcBinary64Total += seqkitGcValue;
      seqkitPerReadGcHundredthsTotal = addSafeInteger(
        seqkitPerReadGcHundredthsTotal,
        seqkitGcHundredths,
        "SeqKit per-read GC hundredths total",
        filePath
      );
      seqkitGcReadCount = addSafeInteger(
        seqkitGcReadCount,
        1,
        "SeqKit GC read count",
        filePath
      );
      if (!Number.isFinite(perReadMeanQualityTotal)) {
        throw new FastqValidationError(
          `FASTQ ${filePath} exceeds the numeric range for per-read quality`
        );
      }
      if (
        !Number.isFinite(totalErrorProbability) ||
        !Number.isFinite(perReadErrorProbabilityQualityTotal) ||
        !Number.isFinite(nanomathTruncatedReadErrorProbabilityTotal) ||
        !Number.isFinite(perReadGcPercentTotal) ||
        !Number.isFinite(seqkitPerReadGcBinary64Total)
      ) {
        throw new FastqValidationError(
          `FASTQ ${filePath} exceeds the numeric range for derived metrics`
        );
      }
      minReadLength = Math.min(minReadLength, readLength);
      maxReadLength = Math.max(maxReadLength, readLength);
      lengthCounts.set(
        readLength,
        addSafeInteger(
          lengthCounts.get(readLength) ?? 0,
          1,
          `read-length ${readLength} count`,
          filePath
        )
      );
      recordLines = [];
    }
  } catch (error) {
    if (error instanceof FastqValidationError) throw error;
    throw new FastqValidationError(
      `Could not decode FASTQ ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }

  if (recordLines.length > 0) {
    throw new FastqValidationError(
      `Invalid FASTQ ${filePath}: truncated record ${readCount + 1} has ${
        recordLines.length
      } of 4 required lines`
    );
  }
  if (readCount === 0) {
    throw new FastqValidationError(
      `Invalid FASTQ ${filePath}: file contains no records`
    );
  }

  return {
    readCount,
    totalBases,
    minReadLength,
    maxReadLength,
    meanReadLength: totalBases / readCount,
    medianReadLength: calculateMedianLength(lengthCounts, readCount),
    n50: calculateN50(lengthCounts, totalBases),
    nanomathN50: calculateNanomathN50(lengthCounts, totalBases),
    meanBaseQuality: totalQualityScore / totalBases,
    meanPerReadQuality: perReadMeanQualityTotal / readCount,
    meanErrorProbabilityQuality:
      -10 * Math.log10(totalErrorProbability / totalBases),
    meanPerReadErrorProbabilityQuality:
      perReadErrorProbabilityQualityTotal / readCount,
    fastqcMeanSequenceQuality:
      fastqcBinnedQualityOffset33Total / readCount,
    fastqcMeanSequenceQualityByOffset: {
      33: fastqcBinnedQualityOffset33Total / readCount,
      64: fastqcOffset64Compatible
        ? fastqcBinnedQualityOffset64Total / readCount
        : null,
    },
    nanomathMeanReadQuality:
      -10 *
      Math.log10(
        nanomathTruncatedReadErrorProbabilityTotal / readCount
      ),
    q20Percent: (q20BaseCount / totalBases) * 100,
    q30Percent: (q30BaseCount / totalBases) * 100,
    gcBasePercent: (gcBaseCount / totalBases) * 100,
    meanPerReadGcPercent: perReadGcPercentTotal / readCount,
    seqkitMeanPerReadGcPercent:
      seqkitPerReadGcBinary64Total / seqkitGcReadCount,
    seqkitPerReadGcBinary64Total,
    seqkitPerReadGcHundredthsTotal,
    seqkitGcReadCount,
  };
}

function parseFastqcPositiveInteger(value, label) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(text)) {
    throw new FastqValidationError(
      `FastQC ${label} must be a positive integer`
    );
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new FastqValidationError(
      `FastQC ${label} must be a positive safe integer`
    );
  }
  return parsed;
}

function fastqcQualityOffsetForEncoding(encoding) {
  if (typeof encoding !== "string") {
    throw new FastqValidationError(
      "FastQC Encoding must be a non-empty string"
    );
  }
  const normalized = encoding.trim();
  const qualityOffset = FASTQC_ENCODING_OFFSETS.get(normalized);
  if (qualityOffset === undefined) {
    throw new FastqValidationError(
      `Unsupported FastQC Encoding ${JSON.stringify(normalized)}`
    );
  }
  return { encoding: normalized, qualityOffset };
}

/**
 * Select the raw FASTQ integer-binned mean corresponding to the exact
 * Encoding reported by FastQC. Offset-64 evidence is rejected when any raw
 * quality character lies below ASCII 64; unsupported labels fail closed.
 *
 * @param {{
 *   fastqcMeanSequenceQualityByOffset?: {
 *     33?: number | null,
 *     64?: number | null,
 *   },
 * }} groundTruth
 * @param {string} encoding
 * @returns {number}
 */
export function resolveFastqcMeanSequenceQualityForEncoding(
  groundTruth,
  encoding
) {
  const parsedEncoding = fastqcQualityOffsetForEncoding(encoding);
  const value =
    groundTruth?.fastqcMeanSequenceQualityByOffset?.[
      parsedEncoding.qualityOffset
    ];
  if (!Number.isFinite(value) || value < 0) {
    throw new FastqValidationError(
      `Raw FASTQ quality characters are outside the valid ASCII range for FastQC Encoding ${JSON.stringify(
        parsedEncoding.encoding
      )} (offset ${parsedEncoding.qualityOffset})`
    );
  }
  return value;
}

/**
 * Parse the independently extracted `fastqc_data.txt` member of a FastQC ZIP.
 * The parser is deliberately strict: exactly one Basic Statistics module and
 * one Per sequence quality scores module must be present, and their sequence
 * counts must agree.
 */
export function parseFastqcDataGroundTruth(text) {
  if (typeof text !== "string" || text.length === 0) {
    throw new FastqValidationError("FastQC data must be non-empty text");
  }

  const lines = text.split(/\r?\n/);
  let currentModule = null;
  let basicModuleCount = 0;
  let qualityModuleCount = 0;
  let filename = null;
  let totalSequences = null;
  let encoding = null;
  let qualityOffset = null;
  let qualityCount = 0;
  let weightedQualityTotal = 0;
  const qualityBins = new Set();

  for (const line of lines) {
    if (line.startsWith(">>")) {
      if (line === ">>END_MODULE") {
        currentModule = null;
        continue;
      }
      const moduleName = line.slice(2).split("\t", 1)[0];
      currentModule = moduleName;
      if (moduleName === "Basic Statistics") basicModuleCount += 1;
      if (moduleName === "Per sequence quality scores") qualityModuleCount += 1;
      continue;
    }

    if (currentModule === "Basic Statistics") {
      const separator = line.indexOf("\t");
      if (separator < 0) continue;
      const key = line.slice(0, separator);
      const value = line.slice(separator + 1);
      if (key === "Filename") {
        if (filename !== null) {
          throw new FastqValidationError(
            "FastQC Basic Statistics contains duplicate Filename values"
          );
        }
        filename = value.trim();
      } else if (key === "Total Sequences") {
        if (totalSequences !== null) {
          throw new FastqValidationError(
            "FastQC Basic Statistics contains duplicate Total Sequences values"
          );
        }
        totalSequences = parseFastqcPositiveInteger(
          value,
          "Total Sequences"
        );
      } else if (key === "Encoding") {
        if (encoding !== null) {
          throw new FastqValidationError(
            "FastQC Basic Statistics contains duplicate Encoding values"
          );
        }
        const parsedEncoding = fastqcQualityOffsetForEncoding(value);
        encoding = parsedEncoding.encoding;
        qualityOffset = parsedEncoding.qualityOffset;
      }
      continue;
    }

    if (
      currentModule === "Per sequence quality scores" &&
      line.length > 0 &&
      !line.startsWith("#")
    ) {
      const columns = line.split("\t");
      if (columns.length !== 2) {
        throw new FastqValidationError(
          "FastQC per-sequence quality row must have exactly two columns"
        );
      }
      const quality = Number(columns[0]);
      const count = Number(columns[1]);
      if (
        !Number.isSafeInteger(quality) ||
        quality < 0 ||
        quality > 93 ||
        !Number.isSafeInteger(count) ||
        count < 0
      ) {
        throw new FastqValidationError(
          "FastQC per-sequence quality row contains an invalid quality or count"
        );
      }
      if (qualityBins.has(quality)) {
        throw new FastqValidationError(
          `FastQC per-sequence quality module contains duplicate quality bin ${quality}`
        );
      }
      qualityBins.add(quality);
      qualityCount += count;
      weightedQualityTotal += quality * count;
      if (
        !Number.isSafeInteger(qualityCount) ||
        !Number.isSafeInteger(weightedQualityTotal)
      ) {
        throw new FastqValidationError(
          "FastQC per-sequence quality totals exceed the safe integer range"
        );
      }
    }
  }

  if (basicModuleCount !== 1) {
    throw new FastqValidationError(
      `FastQC data must contain exactly one Basic Statistics module (found ${basicModuleCount})`
    );
  }
  if (qualityModuleCount !== 1) {
    throw new FastqValidationError(
      `FastQC data must contain exactly one Per sequence quality scores module (found ${qualityModuleCount})`
    );
  }
  if (!filename) {
    throw new FastqValidationError(
      "FastQC Basic Statistics is missing Filename"
    );
  }
  if (totalSequences === null) {
    throw new FastqValidationError(
      "FastQC Basic Statistics is missing Total Sequences"
    );
  }
  if (encoding === null || qualityOffset === null) {
    throw new FastqValidationError(
      "FastQC Basic Statistics is missing Encoding"
    );
  }
  const maximumQuality = MAX_PRINTABLE_ASCII - qualityOffset;
  for (const quality of qualityBins) {
    if (quality > maximumQuality) {
      throw new FastqValidationError(
        `FastQC per-sequence quality bin ${quality} is outside the valid range for Encoding ${JSON.stringify(
          encoding
        )} (0-${maximumQuality})`
      );
    }
  }
  if (
    !Number.isSafeInteger(qualityCount) ||
    qualityCount <= 0 ||
    qualityCount !== totalSequences
  ) {
    throw new FastqValidationError(
      `FastQC per-sequence quality counts do not match Total Sequences (${qualityCount} !== ${totalSequences})`
    );
  }

  return {
    filename,
    totalSequences,
    encoding,
    qualityOffset,
    meanSequenceQualityNumerator: weightedQualityTotal,
    meanSequenceQualityDenominator: qualityCount,
    meanSequenceQuality: weightedQualityTotal / qualityCount,
  };
}
