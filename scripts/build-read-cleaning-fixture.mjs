#!/usr/bin/env node
// Build a small RAW ONT FASTQ bundle for the read-cleaning E2E.
//
// Each sample mixes REAL human reads (human mitochondrion NC_012920.1 — a host
// contaminant kraken2's `minusb` DB flags) with REAL microbial reads (an E. coli
// K-12 region NC_000913.3 — not in `minusb`, so retained). read-cleaning
// (nf-core/detaxizer + kraken2) should REMOVE the human reads and KEEP the
// microbial ones, giving a deterministic contamination-removal assertion:
// cleaned output ≈ the microbial reads only.
//
// Output: a tar.gz in the hosted `downloadedFastqBundle` format
//   manifest.json
//   reads/<sampleId>.fastq.gz
// plus its sha256. Host the tar.gz, then add a fixture entry to the install
// profile (like the gemma-nanopore example) pointing at {url, sha256}. The
// manifest marks every sample `dataClass: "raw"` so read-cleaning is eligible
// (order-pipeline-readiness requires raw/unknown reads).
//
// Usage: node scripts/build-read-cleaning-fixture.mjs [--out <dir>]

import https from "node:https";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const FIXTURE_ID = "read-cleaning-spiked-ont-3sample";
const ORDER_NUMBER = "DEV-RC-SPIKE-001";
const STUDY_ALIAS = "read-cleaning-spike";
const SAMPLES = 3;
const HUMAN_READS_PER_SAMPLE = 30; // contaminant — expected REMOVED
const MICROBE_READS_PER_SAMPLE = 30; // retained
const READ_MIN = 600;
const READ_MAX = 2000;
const ERROR_RATE = 0.02; // ~2% substitution; keeps plenty of exact 35-mers for kraken2
const SEED = 20260610;

const REFS = {
  human: { id: "NC_012920.1" }, // human mitochondrion, ~16.5 kb (contaminant)
  microbe: { id: "NC_000913.3", start: 1, stop: 40000 }, // E. coli K-12 region (retained)
};

// deterministic PRNG so the simulated reads are reproducible (mulberry32)
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const randint = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

function fetchFasta({ id, start, stop }) {
  const params = new URLSearchParams({ db: "nucleotide", id, rettype: "fasta", retmode: "text" });
  if (start) params.set("seq_start", String(start));
  if (stop) params.set("seq_stop", String(stop));
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?${params.toString()}`;
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`fetch ${id}: HTTP ${res.statusCode}`));
          return;
        }
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          const seq = data
            .split("\n")
            .filter((l) => !l.startsWith(">"))
            .join("")
            .replace(/[^ACGTacgt]/g, "")
            .toUpperCase();
          if (seq.length < READ_MAX) reject(new Error(`fetch ${id}: too short (${seq.length} bp)`));
          else resolve(seq);
        });
      })
      .on("error", reject);
  });
}

const BASES = ["A", "C", "G", "T"];
function mutate(seq) {
  let out = "";
  for (const b of seq) out += rand() < ERROR_RATE ? BASES[randint(0, 3)] : b;
  return out;
}
function qualString(len) {
  // ONT-ish quality, Phred ~8-18 (Phred+33)
  let q = "";
  for (let i = 0; i < len; i++) q += String.fromCharCode(33 + randint(8, 18));
  return q;
}
function simulateReads(seq, n, origin) {
  const reads = [];
  for (let i = 0; i < n; i++) {
    const L = randint(READ_MIN, READ_MAX);
    const start = randint(0, Math.max(0, seq.length - L));
    const sub = mutate(seq.slice(start, start + L));
    reads.push({ origin, idx: i, seq: sub, q: qualString(sub.length) });
  }
  return reads;
}

async function main() {
  const outIdx = process.argv.indexOf("--out");
  const outDir = outIdx >= 0 ? process.argv[outIdx + 1] : fs.mkdtempSync(path.join(os.tmpdir(), "rc-fixture-"));
  fs.mkdirSync(outDir, { recursive: true });
  const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-bundle-"));
  fs.mkdirSync(path.join(bundleDir, "reads"), { recursive: true });

  console.error("Fetching references from NCBI E-utilities...");
  const human = await fetchFasta(REFS.human);
  const microbe = await fetchFasta(REFS.microbe);
  console.error(`  human mt: ${human.length} bp | E. coli region: ${microbe.length} bp`);

  const samples = [];
  for (let s = 1; s <= SAMPLES; s++) {
    const sampleId = `RC-SPIKE-${String(s).padStart(2, "0")}`;
    const reads = [
      ...simulateReads(human, HUMAN_READS_PER_SAMPLE, "human"),
      ...simulateReads(microbe, MICROBE_READS_PER_SAMPLE, "microbe"),
    ];
    // shuffle so origins are interleaved
    for (let i = reads.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [reads[i], reads[j]] = [reads[j], reads[i]];
    }
    const fastq =
      reads
        .map((r, n) => `@${sampleId}_read${n} origin=${r.origin}\n${r.seq}\n+\n${r.q}`)
        .join("\n") + "\n";
    const rel = `reads/${sampleId}.fastq.gz`;
    fs.writeFileSync(path.join(bundleDir, rel), zlib.gzipSync(Buffer.from(fastq)));
    samples.push({
      sampleId,
      sampleAlias: sampleId,
      sampleTitle: `Read-cleaning spike ${sampleId}`,
      scientificName: "metagenome",
      taxId: "256318",
      materialBodySite: "control",
      dataClass: "raw",
      dataClassSource: "profile_fixture_manifest",
      classificationNote:
        "Synthetic raw ONT reads: human mt (host contaminant, expected removed) + E. coli (retained). For the read-cleaning E2E.",
      file1: rel,
      customFields: {
        expected_human_reads: HUMAN_READS_PER_SAMPLE,
        expected_microbe_reads: MICROBE_READS_PER_SAMPLE,
      },
    });
  }

  const manifest = {
    dataset: {
      id: FIXTURE_ID,
      label: "Read-cleaning spiked ONT (synthetic)",
      description:
        "Raw ONT reads spiked with human mitochondrial contamination + E. coli, for the read-cleaning contamination-removal E2E.",
    },
    order: {
      orderNumber: ORDER_NUMBER,
      name: "Read-cleaning spike (synthetic raw ONT)",
      status: "SUBMITTED",
    },
    study: {
      alias: STUDY_ALIAS,
      title: "Read-cleaning spike test",
      principalInvestigator: "CI",
      abstract: "Synthetic spiked dataset for read-cleaning host-contamination removal.",
    },
    samples,
  };
  fs.writeFileSync(path.join(bundleDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  const tarPath = path.join(outDir, `${FIXTURE_ID}.tar.gz`);
  execFileSync("tar", ["-czf", tarPath, "-C", bundleDir, "."]);
  const buf = fs.readFileSync(tarPath);
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");

  console.log(
    JSON.stringify(
      {
        ok: true,
        tarPath,
        sha256,
        bytes: buf.length,
        fixtureId: FIXTURE_ID,
        orderNumber: ORDER_NUMBER,
        studyAlias: STUDY_ALIAS,
        samples: samples.length,
        readsPerSample: { human: HUMAN_READS_PER_SAMPLE, microbe: MICROBE_READS_PER_SAMPLE },
        expectedAfterCleaning: `≈${MICROBE_READS_PER_SAMPLE} microbial reads per sample retained, ≈${HUMAN_READS_PER_SAMPLE} human reads removed`,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
