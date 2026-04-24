import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { gunzipSync, gzipSync } from "zlib";

const BASES = ["A", "C", "G", "T"];
const GC_PROFILES = [0.42, 0.49, 0.56, 0.63, 0.38, 0.45, 0.52, 0.59];
const DEFAULT_TEMPLATE_SUBDIR = "_simulation_templates/mag";
const TEMPLATE_NUMBERED_REGEX = /^template_(\d+)_(1|2)\.(fastq|fq)\.gz$/i;
const TEMPLATE_GENERIC_REGEX = /^(.+?)(?:_R([12])|_([12]))\.(fastq|fq)\.gz$/i;
const SUMMARY_HEADERS = [
  "sample_id",
  "mode",
  "simulation_mode_requested",
  "simulation_mode_used",
  "quality_profile",
  "insert_mean",
  "insert_std_dev",
  "seed",
  "template_label",
  "template_dir",
  "file1",
  "file2",
  "checksum1",
  "checksum2",
  "read_count1",
  "read_count2",
  "read_length",
];

const QUALITY_PROFILES = {
  standard: {
    shortErrorRate: 0.0015,
    shortMidQ: 36,
    shortNoise: 8,
    longErrorRate: 0.035,
    longBaseQ: 14,
    longNoise: 6,
  },
  highAccuracy: {
    shortErrorRate: 0.0006,
    shortMidQ: 39,
    shortNoise: 5,
    longErrorRate: 0.016,
    longBaseQ: 18,
    longNoise: 4,
  },
  noisy: {
    shortErrorRate: 0.008,
    shortMidQ: 30,
    shortNoise: 10,
    longErrorRate: 0.06,
    longBaseQ: 11,
    longNoise: 7,
  },
};

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    return fallback;
  }
  return process.argv[index + 1];
}

function asTrimmedString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (Number.isNaN(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function normalizeMode(value) {
  if (
    value === "shortReadPaired" ||
    value === "shortReadSingle" ||
    value === "longRead"
  ) {
    return value;
  }
  return "shortReadPaired";
}

function normalizeSimulationMode(value) {
  if (value === "synthetic" || value === "template" || value === "auto") {
    return value;
  }
  return "auto";
}

function normalizeQualityProfile(value) {
  if (value === "highAccuracy" || value === "noisy" || value === "standard") {
    return value;
  }
  return "standard";
}

function createRng(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function hashString(value) {
  return value.split("").reduce((acc, char) => acc * 31 + char.charCodeAt(0), 17) >>> 0;
}

function randomInt(min, max, rng) {
  if (max <= min) return min;
  return min + Math.floor(rng() * (max - min + 1));
}

function sampleNormal(mean, stdDev, rng) {
  if (stdDev <= 0) return mean;
  const u1 = Math.max(rng(), 1e-12);
  const u2 = Math.max(rng(), 1e-12);
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z0 * stdDev;
}

function pickBase(rng, gcContent) {
  const r = rng();
  if (r < gcContent / 2) return "G";
  if (r < gcContent) return "C";
  if (r < gcContent + (1 - gcContent) / 2) return "A";
  return "T";
}

function buildGenome(length, gcContent, rng) {
  const chars = new Array(length);
  for (let index = 0; index < length; index += 1) {
    chars[index] = pickBase(rng, gcContent);
  }
  return chars.join("");
}

function reverseComplement(sequence) {
  return sequence
    .split("")
    .reverse()
    .map((base) => {
      switch (base) {
        case "A":
          return "T";
        case "T":
          return "A";
        case "C":
          return "G";
        case "G":
          return "C";
        default:
          return "N";
      }
    })
    .join("");
}

function mutateSequence(sequence, rng, errorRate) {
  const chars = sequence.split("");
  for (let index = 0; index < chars.length; index += 1) {
    if (rng() >= errorRate) continue;
    const current = chars[index];
    let next = current;
    while (next === current) {
      next = BASES[Math.floor(rng() * BASES.length)];
    }
    chars[index] = next;
  }
  return chars.join("");
}

function buildShortQuality(length, rng, profile) {
  const chars = new Array(length);
  for (let index = 0; index < length; index += 1) {
    let meanQ;
    if (index < 5) meanQ = Math.max(20, profile.shortMidQ - 10 + index * 2);
    else if (index > length - 10) {
      meanQ = Math.max(12, profile.shortMidQ - (index - (length - 10)) * 2);
    } else {
      meanQ = profile.shortMidQ;
    }
    const q = Math.max(
      2,
      Math.min(41, Math.round(meanQ + (rng() - 0.5) * profile.shortNoise)),
    );
    chars[index] = String.fromCharCode(33 + q);
  }
  return chars.join("");
}

function buildLongQuality(length, rng, profile) {
  const chars = new Array(length);
  for (let index = 0; index < length; index += 1) {
    const meanQ = profile.longBaseQ - Math.min(6, Math.floor(index / 600));
    const q = Math.max(
      3,
      Math.min(24, Math.round(meanQ + (rng() - 0.5) * profile.longNoise)),
    );
    chars[index] = String.fromCharCode(33 + q);
  }
  return chars.join("");
}

function buildReferenceSet(seed, rng) {
  const gcA = GC_PROFILES[seed % GC_PROFILES.length];
  const gcB = GC_PROFILES[(seed + 3) % GC_PROFILES.length];
  return [
    buildGenome(70000 + (seed % 5) * 3500, gcA, rng),
    buildGenome(45000 + (seed % 7) * 2800, gcB, rng),
  ];
}

function buildShortReads(options) {
  const {
    sampleId,
    readCount,
    readLength,
    pairedEnd,
    qualityProfile,
    insertMean,
    insertStdDev,
    seed,
  } = options;
  const profile = QUALITY_PROFILES[qualityProfile];
  const baseSeed =
    seed ??
    (hashString(sampleId) +
      readCount * 131 +
      readLength * 17 +
      insertMean * 7 +
      insertStdDev * 13);
  const rng = createRng(baseSeed);
  const references = buildReferenceSet(baseSeed, rng);
  const read1Lines = [];
  const read2Lines = [];

  for (let index = 0; index < readCount; index += 1) {
    const reference = rng() < 0.68 ? references[0] : references[1];
    const minInsert = Math.max(readLength * 2 + 20, 200);
    const maxInsert = Math.max(
      minInsert + 80,
      Math.min(Math.max(insertMean * 3, readLength * 6), reference.length - 1),
    );
    const insertSize = pairedEnd
      ? Math.max(
          minInsert,
          Math.min(
            maxInsert,
            Math.round(sampleNormal(insertMean, insertStdDev, rng)),
          ),
        )
      : readLength;
    const fragmentLength = pairedEnd ? insertSize : readLength;
    const maxStart = Math.max(0, reference.length - fragmentLength);
    const start = randomInt(0, maxStart, rng);
    const fragment = reference.slice(start, start + fragmentLength);
    const header = `@SIM:SEQDESK:${sampleId}:${index + 1}`;

    const read1Seq = mutateSequence(
      fragment.slice(0, readLength),
      rng,
      profile.shortErrorRate,
    );
    read1Lines.push(
      `${header} 1:N:0:${sampleId}`,
      read1Seq,
      "+",
      buildShortQuality(readLength, rng, profile),
    );

    if (pairedEnd) {
      const read2Seq = mutateSequence(
        reverseComplement(fragment.slice(insertSize - readLength, insertSize)),
        rng,
        profile.shortErrorRate,
      );
      read2Lines.push(
        `${header} 2:N:0:${sampleId}`,
        read2Seq,
        "+",
        buildShortQuality(readLength, rng, profile),
      );
    }
  }

  return {
    read1: Buffer.from(`${read1Lines.join("\n")}\n`, "utf8"),
    read2: pairedEnd ? Buffer.from(`${read2Lines.join("\n")}\n`, "utf8") : null,
    readCount1: readCount,
    readCount2: pairedEnd ? readCount : null,
    readLengthObserved: readLength,
  };
}

function buildLongReads(options) {
  const { sampleId, readCount, targetReadLength, qualityProfile, seed } = options;
  const readLength = Math.max(500, targetReadLength);
  const profile = QUALITY_PROFILES[qualityProfile];
  const baseSeed =
    seed ??
    (hashString(sampleId) + readCount * 211 + readLength * 29);
  const rng = createRng(baseSeed);
  const references = buildReferenceSet(baseSeed, rng);
  const lines = [];
  let totalLength = 0;

  for (let index = 0; index < readCount; index += 1) {
    const reference = rng() < 0.55 ? references[0] : references[1];
    const currentLength = Math.max(
      400,
      Math.min(reference.length - 1, Math.round(readLength * (0.7 + rng() * 0.6))),
    );
    totalLength += currentLength;
    const maxStart = Math.max(0, reference.length - currentLength);
    const start = randomInt(0, maxStart, rng);
    const sequence = mutateSequence(
      reference.slice(start, start + currentLength),
      rng,
      profile.longErrorRate,
    );
    lines.push(
      `@SIM:SEQDESK:${sampleId}:LONG:${index + 1}`,
      sequence,
      "+",
      buildLongQuality(sequence.length, rng, profile),
    );
  }

  return {
    read1: Buffer.from(`${lines.join("\n")}\n`, "utf8"),
    read2: null,
    readCount1: readCount,
    readCount2: null,
    readLengthObserved: Math.round(totalLength / Math.max(readCount, 1)),
  };
}

function resolveTemplateDir(templateDir, dataBasePath) {
  const configured = asTrimmedString(templateDir);
  const basePath = asTrimmedString(dataBasePath);

  if (configured) {
    if (path.isAbsolute(configured)) {
      return path.resolve(configured);
    }
    if (!basePath) {
      throw new Error(
        "Relative templateDir requires --data-base-path so it can be resolved.",
      );
    }
    return path.resolve(basePath, configured);
  }

  if (!basePath) {
    return null;
  }

  return path.resolve(basePath, DEFAULT_TEMPLATE_SUBDIR);
}

async function discoverTemplatePairs(templateDir) {
  let entries;
  try {
    entries = await fs.readdir(templateDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const numberedMap = new Map();

  for (const fileName of files) {
    const match = TEMPLATE_NUMBERED_REGEX.exec(fileName);
    if (!match) continue;
    const index = Number(match[1]);
    const mate = match[2];
    const absPath = path.join(templateDir, fileName);
    const existing = numberedMap.get(index) ?? { label: `template_${index}` };
    if (mate === "1") {
      existing.read1Path = absPath;
    } else {
      existing.read2Path = absPath;
    }
    numberedMap.set(index, existing);
  }

  const numberedPairs = Array.from(numberedMap.entries())
    .sort((a, b) => a[0] - b[0])
    .flatMap(([, pair]) =>
      pair.read1Path && pair.read2Path
        ? [{ read1Path: pair.read1Path, read2Path: pair.read2Path, label: pair.label }]
        : [],
    );

  if (numberedPairs.length > 0) {
    return numberedPairs;
  }

  const genericMap = new Map();
  for (const fileName of files) {
    const match = TEMPLATE_GENERIC_REGEX.exec(fileName);
    if (!match) continue;
    const key = match[1];
    const mate = match[2] ?? match[3];
    const absPath = path.join(templateDir, fileName);
    const existing = genericMap.get(key) ?? { label: key };
    if (mate === "1") {
      existing.read1Path = absPath;
    } else if (mate === "2") {
      existing.read2Path = absPath;
    }
    genericMap.set(key, existing);
  }

  return Array.from(genericMap.values())
    .sort((a, b) => a.label.localeCompare(b.label))
    .flatMap((pair) =>
      pair.read1Path && pair.read2Path
        ? [{ read1Path: pair.read1Path, read2Path: pair.read2Path, label: pair.label }]
        : [],
    );
}

function selectTemplatePair(templatePairs, sampleId, seed) {
  const selectorSeed = (seed ?? 0) + hashString(sampleId);
  return templatePairs[selectorSeed % templatePairs.length];
}

function analyzeFastqBuffer(buffer, filePath) {
  const raw = filePath.toLowerCase().endsWith(".gz")
    ? gunzipSync(buffer).toString("utf8")
    : buffer.toString("utf8");
  const trimmed = raw.trim();
  if (!trimmed) {
    return { readCount: 0, readLength: 0 };
  }

  const lines = trimmed.split(/\r?\n/);
  const readCount = Math.floor(lines.length / 4);
  let totalLength = 0;
  let observedRecords = 0;
  for (let index = 1; index < lines.length; index += 4) {
    if (typeof lines[index] !== "string") continue;
    totalLength += lines[index].length;
    observedRecords += 1;
  }

  return {
    readCount,
    readLength:
      observedRecords > 0 ? Math.round(totalLength / observedRecords) : 0,
  };
}

async function loadTemplateReads(options) {
  const { templatePair, mode, sampleId } = options;
  const pairedEnd = mode === "shortReadPaired";

  const read1Buffer = await fs.readFile(templatePair.read1Path);
  const read1Stats = analyzeFastqBuffer(read1Buffer, templatePair.read1Path);

  let read2Buffer = null;
  let read2Stats = null;
  if (pairedEnd) {
    read2Buffer = await fs.readFile(templatePair.read2Path);
    read2Stats = analyzeFastqBuffer(read2Buffer, templatePair.read2Path);
  }

  return {
    read1: read1Buffer,
    read2: read2Buffer,
    readCount1: read1Stats.readCount,
    readCount2: read2Stats?.readCount ?? null,
    readLengthObserved: read1Stats.readLength,
    templateLabel: templatePair.label,
    sourceSampleId: sampleId,
  };
}

async function resolveSimulationSource(options) {
  const { simulationMode, mode, templateDir, dataBasePath } = options;

  if (mode === "longRead") {
    if (simulationMode === "template") {
      throw new Error(
        "Template simulation is not supported for long-read mode. Choose synthetic or auto mode, or switch to a short-read mode.",
      );
    }

    return {
      modeUsed: "synthetic",
      templateDir: null,
      templatePair: null,
    };
  }

  if (simulationMode === "synthetic") {
    return {
      modeUsed: "synthetic",
      templateDir: null,
      templatePair: null,
    };
  }

  const resolvedTemplateDir = resolveTemplateDir(templateDir, dataBasePath);
  if (!resolvedTemplateDir) {
    if (simulationMode === "template") {
      throw new Error(
        "Template simulation requires a configured templateDir or data base path.",
      );
    }
    return {
      modeUsed: "synthetic",
      templateDir: null,
      templatePair: null,
    };
  }

  const templatePairs = await discoverTemplatePairs(resolvedTemplateDir);
  if (templatePairs.length === 0) {
    if (simulationMode === "template") {
      throw new Error(
        `No template FASTQ pairs found in "${resolvedTemplateDir}". Add files like "template_1_1.fastq.gz" and "template_1_2.fastq.gz".`,
      );
    }
    return {
      modeUsed: "synthetic",
      templateDir: resolvedTemplateDir,
      templatePair: null,
    };
  }

  return {
    modeUsed: "template",
    templateDir: resolvedTemplateDir,
    templatePair: templatePairs,
  };
}

function buildSummaryRow(manifest) {
  return [
    manifest.sampleId,
    manifest.mode,
    manifest.simulationModeRequested,
    manifest.simulationModeUsed,
    manifest.qualityProfile,
    String(manifest.insertMean),
    String(manifest.insertStdDev),
    manifest.seed == null ? "" : String(manifest.seed),
    manifest.templateLabel ?? "",
    manifest.templateDir ?? "",
    manifest.file1Name,
    manifest.file2Name ?? "",
    manifest.checksum1,
    manifest.checksum2 ?? "",
    String(manifest.readCount1),
    manifest.readCount2 == null ? "" : String(manifest.readCount2),
    String(manifest.readLength),
  ].join("\t");
}

async function main() {
  const sampleId = getArg("--sample-id");
  const orderId = getArg("--order-id");
  const readsDir = getArg("--reads-dir", "reads");
  const manifestPath = getArg("--manifest-path");
  const summaryPath = getArg("--summary-path");
  const simulationMode = normalizeSimulationMode(getArg("--simulation-mode", "auto"));
  const mode = normalizeMode(getArg("--mode", "shortReadPaired"));
  const replaceExisting = getArg("--replace-existing", "true") !== "false";
  const qualityProfile = normalizeQualityProfile(
    getArg("--quality-profile", "standard"),
  );
  const templateDir = getArg("--template-dir", "");
  const dataBasePath = getArg("--data-base-path", "");

  if (!sampleId || !orderId || !manifestPath || !summaryPath) {
    throw new Error("Missing required arguments");
  }

  const readCount =
    mode === "longRead"
      ? clampInt(getArg("--read-count"), 1000, 5, 5000)
      : clampInt(getArg("--read-count"), 1000, 2, 50000);
  const readLength =
    mode === "longRead"
      ? clampInt(getArg("--read-length"), 2500, 500, 30000)
      : clampInt(getArg("--read-length"), 150, 25, 300);
  const insertMean = clampInt(
    getArg("--insert-mean"),
    Math.max(350, readLength * 2 + 20),
    Math.max(readLength * 2 + 20, 200),
    5000,
  );
  const insertStdDev = clampInt(
    getArg("--insert-std-dev"),
    30,
    5,
    Math.max(5, Math.min(1000, insertMean - readLength)),
  );
  const seedArg = getArg("--seed");
  const seed =
    seedArg == null || String(seedArg).trim() === ""
      ? null
      : clampInt(seedArg, 0, 0, 2_147_483_647);

  const source = await resolveSimulationSource({
    simulationMode,
    mode,
    templateDir,
    dataBasePath,
  });

  let generated;
  let templateLabel = null;
  if (source.modeUsed === "template") {
    const templatePair = selectTemplatePair(
      source.templatePair,
      sampleId,
      seed,
    );
    templateLabel = templatePair.label;
    generated = await loadTemplateReads({
      templatePair,
      mode,
      sampleId,
    });
  } else if (mode === "longRead") {
    generated = buildLongReads({
      sampleId,
      readCount,
      targetReadLength: readLength,
      qualityProfile,
      seed,
    });
  } else {
    generated = buildShortReads({
      sampleId,
      readCount,
      readLength,
      pairedEnd: mode === "shortReadPaired",
      qualityProfile,
      insertMean,
      insertStdDev,
      seed,
    });
  }

  await fs.mkdir(readsDir, { recursive: true });
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.mkdir(path.dirname(summaryPath), { recursive: true });

  const file1Name = `${sampleId}_R1.fastq.gz`;
  const file1Path = path.join(readsDir, file1Name);
  const file1Buffer =
    source.modeUsed === "template" ? generated.read1 : gzipSync(generated.read1);
  await fs.writeFile(file1Path, file1Buffer);

  let file2Name = null;
  let file2Path = null;
  let file2Buffer = null;

  if (generated.read2) {
    file2Name = `${sampleId}_R2.fastq.gz`;
    file2Path = path.join(readsDir, file2Name);
    file2Buffer =
      source.modeUsed === "template" ? generated.read2 : gzipSync(generated.read2);
    await fs.writeFile(file2Path, file2Buffer);
  }

  const checksum1 = crypto.createHash("md5").update(file1Buffer).digest("hex");
  const checksum2 = file2Buffer
    ? crypto.createHash("md5").update(file2Buffer).digest("hex")
    : null;

  const manifest = {
    sampleId,
    orderId,
    mode,
    simulationModeRequested: simulationMode,
    simulationModeUsed: source.modeUsed,
    qualityProfile,
    insertMean,
    insertStdDev,
    seed,
    templateLabel,
    templateDir: source.templateDir,
    replaceExisting,
    file1Name,
    file2Name,
    checksum1,
    checksum2,
    readCount1: generated.readCount1,
    readCount2: generated.readCount2,
    readLength: generated.readLengthObserved,
  };

  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await fs.writeFile(
    summaryPath,
    `${SUMMARY_HEADERS.join("\t")}\n${buildSummaryRow(manifest)}\n`,
    "utf8",
  );
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
