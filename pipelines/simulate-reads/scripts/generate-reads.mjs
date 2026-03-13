import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { gzipSync } from "zlib";

const BASES = ["A", "C", "G", "T"];
const GC_PROFILES = [0.42, 0.49, 0.56, 0.63, 0.38, 0.45, 0.52, 0.59];

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    return fallback;
  }
  return process.argv[index + 1];
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

function buildShortQuality(length, rng) {
  const chars = new Array(length);
  for (let index = 0; index < length; index += 1) {
    let meanQ;
    if (index < 5) meanQ = 26 + index * 2;
    else if (index > length - 10) meanQ = Math.max(16, 35 - (index - (length - 10)) * 2);
    else meanQ = 36;
    const q = Math.max(2, Math.min(41, Math.round(meanQ + (rng() - 0.5) * 8)));
    chars[index] = String.fromCharCode(33 + q);
  }
  return chars.join("");
}

function buildLongQuality(length, rng) {
  const chars = new Array(length);
  for (let index = 0; index < length; index += 1) {
    const meanQ = 14 - Math.min(6, Math.floor(index / 600));
    const q = Math.max(3, Math.min(22, Math.round(meanQ + (rng() - 0.5) * 6)));
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

function buildShortReads(sampleId, readCount, readLength, pairedEnd) {
  const seed = hashString(sampleId) + readCount * 131 + readLength * 17;
  const rng = createRng(seed);
  const references = buildReferenceSet(seed, rng);
  const read1Lines = [];
  const read2Lines = [];

  for (let index = 0; index < readCount; index += 1) {
    const reference = rng() < 0.68 ? references[0] : references[1];
    const minInsert = readLength * 2 + 20;
    const maxInsert = Math.max(minInsert + 80, Math.min(readLength * 6, reference.length - 1));
    const insertSize = randomInt(minInsert, maxInsert, rng);
    const maxStart = reference.length - insertSize;
    const start = randomInt(0, maxStart, rng);
    const fragment = reference.slice(start, start + insertSize);
    const header = `@SIM:SEQDESK:${sampleId}:${index + 1}`;

    const read1Seq = mutateSequence(fragment.slice(0, readLength), rng, 0.0015);
    read1Lines.push(
      `${header} 1:N:0:${sampleId}`,
      read1Seq,
      "+",
      buildShortQuality(readLength, rng)
    );

    if (pairedEnd) {
      const read2Seq = mutateSequence(
        reverseComplement(fragment.slice(insertSize - readLength, insertSize)),
        rng,
        0.0015
      );
      read2Lines.push(
        `${header} 2:N:0:${sampleId}`,
        read2Seq,
        "+",
        buildShortQuality(readLength, rng)
      );
    }
  }

  return {
    read1: Buffer.from(`${read1Lines.join("\n")}\n`, "utf8"),
    read2: pairedEnd ? Buffer.from(`${read2Lines.join("\n")}\n`, "utf8") : null,
  };
}

function buildLongReads(sampleId, readCount, targetReadLength) {
  const readLength = Math.max(500, targetReadLength);
  const seed = hashString(sampleId) + readCount * 211 + readLength * 29;
  const rng = createRng(seed);
  const references = buildReferenceSet(seed, rng);
  const lines = [];

  for (let index = 0; index < readCount; index += 1) {
    const reference = rng() < 0.55 ? references[0] : references[1];
    const currentLength = Math.max(
      400,
      Math.min(reference.length - 1, Math.round(readLength * (0.7 + rng() * 0.6)))
    );
    const maxStart = Math.max(0, reference.length - currentLength);
    const start = randomInt(0, maxStart, rng);
    const sequence = mutateSequence(
      reference.slice(start, start + currentLength),
      rng,
      0.035
    );
    lines.push(
      `@SIM:SEQDESK:${sampleId}:LONG:${index + 1}`,
      sequence,
      "+",
      buildLongQuality(sequence.length, rng)
    );
  }

  return {
    read1: Buffer.from(`${lines.join("\n")}\n`, "utf8"),
    read2: null,
  };
}

async function main() {
  const sampleId = getArg("--sample-id");
  const orderId = getArg("--order-id");
  const readsDir = getArg("--reads-dir", "reads");
  const manifestPath = getArg("--manifest-path");
  const summaryPath = getArg("--summary-path");
  const mode = normalizeMode(getArg("--mode", "shortReadPaired"));
  const replaceExisting = getArg("--replace-existing", "true") !== "false";

  if (!sampleId || !orderId || !manifestPath || !summaryPath) {
    throw new Error("Missing required arguments");
  }

  const readCount =
    mode === "longRead"
      ? clampInt(getArg("--read-count"), 250, 5, 5000)
      : clampInt(getArg("--read-count"), 1000, 2, 50000);
  const readLength =
    mode === "longRead"
      ? clampInt(getArg("--read-length"), 2500, 500, 30000)
      : clampInt(getArg("--read-length"), 150, 25, 300);

  const generated =
    mode === "longRead"
      ? buildLongReads(sampleId, readCount, readLength)
      : buildShortReads(sampleId, readCount, readLength, mode === "shortReadPaired");

  await fs.mkdir(readsDir, { recursive: true });
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.mkdir(path.dirname(summaryPath), { recursive: true });

  const file1Name = `${sampleId}_R1.fastq.gz`;
  const file1Path = path.join(readsDir, file1Name);
  const file1Buffer = gzipSync(generated.read1);
  await fs.writeFile(file1Path, file1Buffer);

  let file2Name = null;
  let file2Path = null;
  let file2Buffer = null;

  if (generated.read2) {
    file2Name = `${sampleId}_R2.fastq.gz`;
    file2Path = path.join(readsDir, file2Name);
    file2Buffer = gzipSync(generated.read2);
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
    replaceExisting,
    file1Name,
    file2Name,
    checksum1,
    checksum2,
    readCount1: readCount,
    readCount2: file2Buffer ? readCount : null,
    readLength,
  };

  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await fs.writeFile(
    summaryPath,
    [
      "sample_id\tmode\tfile1\tfile2\tchecksum1\tchecksum2",
      `${sampleId}\t${mode}\t${file1Name}\t${file2Name ?? ""}\t${checksum1}\t${checksum2 ?? ""}`,
    ].join("\n"),
    "utf8"
  );
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
