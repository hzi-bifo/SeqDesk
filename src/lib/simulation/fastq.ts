const BASES = ["A", "C", "G", "T"] as const;
const GC_PROFILES = [0.42, 0.49, 0.56, 0.63, 0.38, 0.45, 0.52, 0.59];

type Base = (typeof BASES)[number];

interface SimulatedFastqOptions {
  sampleId: string;
  sampleIndex: number;
  readCount: number;
  readLength: number;
  pairedEnd?: boolean;
}

interface SimulatedFastqResult {
  read1: Buffer;
  read2: Buffer | null;
}

function createRng(seed: number) {
  let state = (seed >>> 0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function randomInt(min: number, max: number, rng: () => number): number {
  if (max <= min) return min;
  return min + Math.floor(rng() * (max - min + 1));
}

function pickBase(rng: () => number, gcContent: number): Base {
  const r = rng();
  if (r < gcContent / 2) return "G";
  if (r < gcContent) return "C";
  if (r < gcContent + (1 - gcContent) / 2) return "A";
  return "T";
}

function buildGenome(length: number, gcContent: number, rng: () => number): string {
  const chars = new Array<Base>(length);
  for (let i = 0; i < length; i += 1) {
    chars[i] = pickBase(rng, gcContent);
  }
  return chars.join("");
}

function reverseComplement(sequence: string): string {
  const chars = sequence.split("");
  chars.reverse();
  for (let i = 0; i < chars.length; i += 1) {
    switch (chars[i]) {
      case "A":
        chars[i] = "T";
        break;
      case "T":
        chars[i] = "A";
        break;
      case "C":
        chars[i] = "G";
        break;
      case "G":
        chars[i] = "C";
        break;
      default:
        chars[i] = "N";
    }
  }
  return chars.join("");
}

function mutateSequence(sequence: string, rng: () => number, errorRate: number): string {
  const chars = sequence.split("");
  for (let i = 0; i < chars.length; i += 1) {
    if (rng() >= errorRate) continue;
    const current = chars[i];
    let next = current;
    while (next === current) {
      next = BASES[Math.floor(rng() * BASES.length)];
    }
    chars[i] = next;
  }
  return chars.join("");
}

function buildQuality(length: number, rng: () => number): string {
  const chars: string[] = new Array(length);
  for (let i = 0; i < length; i += 1) {
    let meanQ: number;
    if (i < 5) meanQ = 26 + i * 2;
    else if (i > length - 10) meanQ = Math.max(16, 35 - (i - (length - 10)) * 2);
    else meanQ = 36;
    const q = Math.max(2, Math.min(41, Math.round(meanQ + (rng() - 0.5) * 8)));
    chars[i] = String.fromCharCode(33 + q);
  }
  return chars.join("");
}

function buildReferenceSet(sampleIndex: number, rng: () => number): string[] {
  const gcA = GC_PROFILES[sampleIndex % GC_PROFILES.length];
  const gcB = GC_PROFILES[(sampleIndex + 3) % GC_PROFILES.length];
  const lenA = 50_000 + (sampleIndex % 5) * 2_500;
  const lenB = 35_000 + (sampleIndex % 7) * 1_700;

  return [
    buildGenome(lenA, gcA, rng),
    buildGenome(lenB, gcB, rng),
  ];
}

export function buildSimulatedFastq(options: SimulatedFastqOptions): SimulatedFastqResult {
  const pairedEnd = options.pairedEnd !== false;
  const readCount = Math.max(1, Math.floor(options.readCount));
  const readLength = Math.max(25, Math.floor(options.readLength));
  const seed =
    (options.sampleIndex + 1) * 2654435761 +
    readCount * 131 +
    readLength * 17;
  const rng = createRng(seed);
  const references = buildReferenceSet(options.sampleIndex, rng);
  const read1Lines: string[] = [];
  const read2Lines: string[] = [];

  for (let i = 0; i < readCount; i += 1) {
    const reference = rng() < 0.68 ? references[0] : references[1];
    const minInsert = readLength * 2 + 20;
    const maxInsert = Math.max(
      minInsert + 80,
      Math.min(readLength * 6, reference.length - 1)
    );
    const insertSize = randomInt(minInsert, maxInsert, rng);
    const maxStart = reference.length - insertSize;
    const start = randomInt(0, maxStart, rng);
    const fragment = reference.slice(start, start + insertSize);

    const rawRead1 = fragment.slice(0, readLength);
    const read1Seq = mutateSequence(rawRead1, rng, 0.0015);
    const read1Qual = buildQuality(readLength, rng);

    const x = start + 1;
    const y = i + 1;
    const header = `@SIM:1:SEQDESK:1:1:${x}:${y}`;
    read1Lines.push(
      `${header} 1:N:0:${options.sampleId}`,
      read1Seq,
      "+",
      read1Qual
    );

    if (pairedEnd) {
      const rawRead2 = reverseComplement(
        fragment.slice(insertSize - readLength, insertSize)
      );
      const read2Seq = mutateSequence(rawRead2, rng, 0.0015);
      const read2Qual = buildQuality(readLength, rng);
      read2Lines.push(
        `${header} 2:N:0:${options.sampleId}`,
        read2Seq,
        "+",
        read2Qual
      );
    }
  }

  return {
    read1: Buffer.from(`${read1Lines.join("\n")}\n`, "utf-8"),
    read2: pairedEnd ? Buffer.from(`${read2Lines.join("\n")}\n`, "utf-8") : null,
  };
}
