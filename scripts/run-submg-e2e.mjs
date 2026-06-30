#!/usr/bin/env node

/**
 * End-to-end proof that the **submg** pipeline actually submits to ENA and writes
 * the returned accessions back into SeqDesk — exercised against the ENA TEST
 * server (wwwdev.ebi.ac.uk) only.
 *
 * The submg pipeline is a custom (non-Nextflow) runner: SeqDesk generates SubMG
 * YAML manifests from study/sample/read/assembly data, runs `submg-cli submit`
 * inside a conda env, parses the SubMG/webin output and persists the ENA
 * accessions onto the Sample/Read/Assembly rows. Nothing else in CI proves this
 * path works against a real ENA endpoint.
 *
 * Flow (logged in as the seeded FACILITY_ADMIN, against a RUNNING app):
 *   1. ensure dummy data (orders, studies, samples with paired reads on disk)
 *   2. configure Webin TEST credentials (stored encrypted; enaTestMode -> wwwdev)
 *   3. pick a study whose samples have paired reads
 *   4. fixtures (direct Prisma — there is no upload API for these):
 *        - md5 checksum1/2 onto each target sample's active paired read
 *        - a small assembly FASTA on disk + an Assembly row per target sample
 *        - backfill taxId / scientificName / checklist metadata if the seed
 *          didn't provide them
 *   5. register the study on ENA TEST (POST /api/admin/submissions, isTest) so it
 *      gets a real PRJ* accession + a fresh testRegisteredAt (submg requires both)
 *   6. clear the sample/read/assembly ENA accessions in the DB so the submg
 *      writeback is OBSERVABLE (study registration also pre-registers samples)
 *   7. start the submg run (study-scoped, executionMode=local) on one sample
 *   8. poll to completion, then assert submg wrote a sample accession back
 *
 * By default the run submits SAMPLES ONLY (--submit-samples): ENA sample
 * registration is the light, reliable round-trip that proves the whole
 * config-gen -> submg-cli -> ENA -> receipt-parse -> DB-writeback loop. Read /
 * assembly submission (heavier webin-cli uploads) can be enabled with
 * --submit-reads / --submit-assembly and is asserted warn-only.
 *
 * Credentials are never hard-coded — pass them as flags or env (CI: secrets):
 *   node scripts/run-submg-e2e.mjs \
 *     --base-url http://127.0.0.1:8896 \
 *     --email admin@example.com --password admin \
 *     --webin-username "$ENA_USERNAME" --webin-password "$ENA_PWD"
 */

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import { PrismaClient } from "@prisma/client";

function fail(message, details) {
  const parts = [message];
  if (details) parts.push(details);
  throw new Error(parts.join("\n"));
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) fail(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    if (["submit-reads", "submit-assembly"].includes(key)) {
      result[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`Missing value for --${key}`);
    result[key] = value;
    index += 1;
  }
  return result;
}

function envFlag(value) {
  if (value === undefined) return false;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function toOptionalInt(value) {
  if (value === undefined || value === null) return undefined;
  const parsed = Number.parseInt(String(value).trim(), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function splitSetCookieHeader(headerValue) {
  if (!headerValue) return [];
  return headerValue.split(/,(?=\s*[^;,=\s]+=[^;,]+)/g);
}

class CookieJar {
  #cookies = new Map();
  update(response) {
    const setCookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : splitSetCookieHeader(response.headers.get("set-cookie"));
    for (const entry of setCookies) {
      const firstPart = entry.split(";")[0];
      const separatorIndex = firstPart.indexOf("=");
      if (separatorIndex <= 0) continue;
      this.#cookies.set(
        firstPart.slice(0, separatorIndex).trim(),
        firstPart.slice(separatorIndex + 1).trim(),
      );
    }
  }
  headerValue() {
    return Array.from(this.#cookies.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
  }
}

function summarizeBody(body) {
  if (!body) return "";
  const compact = body.replace(/\s+/g, " ").trim();
  return compact.length <= 800 ? compact : `${compact.slice(0, 797)}...`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createClient(baseUrl) {
  const jar = new CookieJar();
  async function request(pathname, init = {}) {
    const headers = new Headers(init.headers || {});
    const cookieHeader = jar.headerValue();
    if (cookieHeader) headers.set("cookie", cookieHeader);
    const response = await fetch(new URL(pathname, baseUrl), {
      ...init,
      headers,
      redirect: init.redirect || "manual",
    });
    jar.update(response);
    return response;
  }
  return { request };
}

async function parseJson(response, context) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch (error) {
    fail(
      `${context} returned invalid JSON`,
      error instanceof Error ? `${error.message}\n${summarizeBody(text)}` : summarizeBody(text),
    );
  }
}

async function requestJson(client, pathname, init, context) {
  const response = await client.request(pathname, init);
  if (!response.ok && ![302, 303].includes(response.status)) {
    fail(`${context} failed (${response.status})`, summarizeBody(await response.text()));
  }
  return parseJson(response, context);
}

async function loginAdmin(client, baseUrl, email, password) {
  const csrf = await requestJson(client, "/api/auth/csrf", {}, "CSRF token");
  if (!csrf?.csrfToken) fail("CSRF endpoint did not return a csrfToken");
  await client.request("/api/auth/callback/credentials?json=true", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json, text/plain, */*",
    },
    body: new URLSearchParams({
      csrfToken: csrf.csrfToken,
      email,
      password,
      callbackUrl: new URL("/analysis", baseUrl).toString(),
      json: "true",
    }).toString(),
  });
  const session = await requestJson(client, "/api/auth/session", {}, "Session");
  if (session?.user?.email !== email || session?.user?.role !== "FACILITY_ADMIN") {
    fail("Login did not produce the expected admin session", JSON.stringify(session, null, 2));
  }
  return session;
}

async function ensureDummyData(client) {
  const response = await client.request("/api/admin/seed/dummy-data", { method: "POST" });
  if (response.status === 409) return { existed: true };
  if (!response.ok) {
    fail("Failed to load dummy data", summarizeBody(await response.text()));
  }
  return { created: true };
}

function md5OfFile(filePath) {
  const hash = crypto.createHash("md5");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

// Resolve a Read.file* path (stored relative to the data base path) to a real
// file on disk, tolerating the .gz / .fastq <-> .fq variants the app accepts.
function resolveOnDisk(dataBasePath, file) {
  if (typeof file !== "string" || !file) return null;
  const candidates = [];
  if (path.isAbsolute(file)) candidates.push(file);
  if (dataBasePath) candidates.push(path.resolve(dataBasePath, file));
  candidates.push(path.resolve(file));
  const variants = [];
  for (const candidate of candidates) {
    variants.push(candidate);
    if (candidate.endsWith(".gz")) variants.push(candidate.slice(0, -3));
    else variants.push(`${candidate}.gz`);
  }
  return variants.find((candidate) => fs.existsSync(candidate)) || null;
}

// A realistic multi-contig metagenome assembly FASTA — what a mag (MEGAHIT) run
// would produce — so ENA's genome-assembly validation accepts it on an opt-in
// --submit-assembly run (a handful of 2.5–4.6 kb contigs of valid IUPAC bases,
// 70-col wrapped). Deterministic (seeded LCG, no Math.random) for reproducibility.
function buildAssemblyFasta() {
  const bases = "ACGT";
  let seed = 0x2545f491;
  const nextBase = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return bases[(seed >>> 8) % 4];
  };
  const contigs = [];
  for (let c = 1; c <= 6; c += 1) {
    const length = 2500 + c * 350;
    let seq = "";
    for (let i = 0; i < length; i += 1) seq += nextBase();
    const wrapped = seq.match(/.{1,70}/g).join("\n");
    contigs.push(`>contig_${c} length=${length}\n${wrapped}`);
  }
  return `${contigs.join("\n")}\n`;
}

const MEGAHIT_MIN_CONTIG_LEN = 1000; // mag-style; comfortably above ENA's 200 bp floor

// Produce a REAL mag-style assembly: run MEGAHIT (nf-core/mag's assembler) on the
// seeded paired reads, deterministically (--num-cpu-threads 1). Returns gzip bytes
// of final.contigs.fa when it yields >=1 contig >= MEGAHIT_MIN_CONTIG_LEN, else null
// (caller falls back to the synthetic FASTA so the warn-only leg never regresses).
// The megahit binary comes from the submg conda env via SEQDESK_SUBMG_E2E_MEGAHIT_BIN;
// when unset/missing (local/dev), this returns null and the synthetic FASTA is used.
function buildMegahitAssemblyGz(r1Abs, r2Abs) {
  const bin = process.env.SEQDESK_SUBMG_E2E_MEGAHIT_BIN || "megahit";
  if (spawnSync(bin, ["--version"], { stdio: "ignore" }).status !== 0) return null;
  // Threads + timeout are env-tunable: the default (1 thread / 5 min) suits the tiny
  // dummy reads, while a real shotgun sample needs more (e.g. 4 threads / 20 min) to
  // assemble contigs within the window.
  const threads = String(process.env.SEQDESK_SUBMG_E2E_MEGAHIT_THREADS || "1");
  const timeoutSec = Number(process.env.SEQDESK_SUBMG_E2E_MEGAHIT_TIMEOUT_SEC || "300");
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "submg-megahit-"));
  const runOut = path.join(outDir, "asm"); // MEGAHIT requires its -o dir NOT pre-exist
  const res = spawnSync(
    bin,
    [
      "-1", r1Abs,
      "-2", r2Abs,
      "--num-cpu-threads", threads,
      "--min-contig-len", String(MEGAHIT_MIN_CONTIG_LEN),
      "-o", runOut,
    ],
    { stdio: "inherit", timeout: timeoutSec * 1000 },
  );
  const contigs = path.join(runOut, "final.contigs.fa");
  if (res.status !== 0 || !fs.existsSync(contigs)) return null;
  // Guard ENA validation: require a real header + IUPAC sequence (>=1 contig).
  const text = fs.readFileSync(contigs, "utf8");
  if (!/^>.+\n[ACGTNacgtn]/m.test(text)) return null;
  return zlib.gzipSync(Buffer.from(text));
}

const ACCESSION_RE = /^(ERS|SAMEA|SAMN|ERR|ERX|ERZ|GCA)/i;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl =
    args["base-url"] || process.env.SEQDESK_SUBMG_E2E_BASE_URL || "http://127.0.0.1:3000";
  const email = args.email || process.env.SEQDESK_SUBMG_E2E_EMAIL || "admin@example.com";
  const password = args.password || process.env.SEQDESK_SUBMG_E2E_PASSWORD || "admin";
  const webinUsername = args["webin-username"] || process.env.ENA_USERNAME;
  const webinPassword = args["webin-password"] || process.env.ENA_PWD;
  const submitReads = Boolean(args["submit-reads"]) || envFlag(process.env.SEQDESK_SUBMG_E2E_SUBMIT_READS);
  const submitAssembly =
    Boolean(args["submit-assembly"]) || envFlag(process.env.SEQDESK_SUBMG_E2E_SUBMIT_ASSEMBLY);
  const timeoutSeconds =
    toOptionalInt(args.timeout || process.env.SEQDESK_SUBMG_E2E_TIMEOUT_SECONDS) || 900;

  if (!webinUsername || !webinPassword) {
    fail(
      "Missing Webin TEST credentials. Pass --webin-username/--webin-password or set ENA_USERNAME/ENA_PWD.",
    );
  }

  const client = createClient(baseUrl);
  const session = await loginAdmin(client, baseUrl, email, password);
  const adminUserId = session?.user?.id;
  console.log(`Logged in as ${email} (FACILITY_ADMIN).`);

  await ensureDummyData(client);
  console.log("Dummy data present.");

  // Configure Webin TEST credentials (encrypted; enaTestMode -> wwwdev only).
  await requestJson(
    client,
    "/api/admin/settings/ena",
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enaUsername: webinUsername,
        enaPassword: webinPassword,
        enaTestMode: true,
      }),
    },
    "Configure ENA credentials",
  );
  console.log(`Configured ENA TEST credentials (${webinUsername}).`);

  const seqSettings = await requestJson(
    client,
    "/api/admin/settings/sequencing-files",
    {},
    "Fetch sequencing-files settings",
  );
  const dataBasePath =
    typeof seqSettings?.dataBasePath === "string" ? seqSettings.dataBasePath : null;
  if (!dataBasePath) fail("Could not resolve dataBasePath from sequencing-files settings");
  console.log(`Data base path: ${dataBasePath}`);

  // Optionally provision a REAL example dataset (e.g. the human-gut shotgun study) into the
  // configured data dir, so submg submits REAL reads + a REAL MEGAHIT assembly to ENA TEST
  // instead of dummy data. Env-gated: default behaviour (dummy data) is unchanged.
  const exampleDataset = process.env.SEQDESK_SUBMG_E2E_EXAMPLE_DATASET || null;
  if (exampleDataset) {
    // The example-dataset extractor reads the RAW stored SiteSettings.dataBasePath (not the
    // env-resolved value the GET above returns), so persist it explicitly first — otherwise
    // the seed 500s with "Data base path is not configured" (the slurm-e2e does the same via
    // --set-data-base-path).
    const setPathRes = await client.request("/api/admin/settings/sequencing-files", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataBasePath }),
    });
    if (!setPathRes.ok) {
      fail(
        `Failed to persist dataBasePath before example-dataset seed (${setPathRes.status})`,
        summarizeBody(await setPathRes.text()),
      );
    }
    console.log(`Persisted dataBasePath=${dataBasePath} to SiteSettings.`);
    console.log(`Seeding REAL example dataset '${exampleDataset}' (downloads reads)...`);
    const seedRes = await client.request(
      `/api/admin/seed/example-datasets/${exampleDataset}`,
      { method: "POST" },
    );
    if (!seedRes.ok) {
      fail(
        `Failed to seed example dataset '${exampleDataset}' (${seedRes.status})`,
        summarizeBody(await seedRes.text()),
      );
    }
    console.log(`Seeded REAL example dataset '${exampleDataset}'.`);
  }
  // When set, pin the submg run to this study alias (e.g. the human-gut shotgun study)
  // instead of the heuristic pick.
  const targetStudyAlias = process.env.SEQDESK_SUBMG_E2E_STUDY_ALIAS || null;

  const prisma = new PrismaClient();
  try {
    // Pick a study whose samples have an active paired read on disk. Prefer one
    // not yet ENA-registered (a fresh CI DB has none registered).
    const candidateStudies = await prisma.study.findMany({
      where: {
        samples: {
          some: { reads: { some: { isActive: true, file1: { not: null }, file2: { not: null } } } },
        },
      },
      include: {
        samples: {
          include: {
            reads: { where: { isActive: true }, orderBy: [{ dataClass: "asc" }, { id: "asc" }] },
            assemblies: true,
          },
          orderBy: { sampleId: "asc" },
        },
      },
      orderBy: [{ studyAccessionId: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    });

    const study =
      (targetStudyAlias &&
        candidateStudies.find((s) => String(s.alias) === targetStudyAlias)) ||
      candidateStudies.find((s) => !s.studyAccessionId) ||
      candidateStudies[0];
    if (!study) fail("No study with paired-read samples was found after seeding dummy data");
    if (targetStudyAlias && String(study.alias) !== targetStudyAlias) {
      fail(
        `Target study alias '${targetStudyAlias}' not found among paired-read studies`,
        JSON.stringify({ aliases: candidateStudies.map((s) => s.alias) }),
      );
    }

    // One submittable sample keeps the ENA TEST load (and the run) minimal.
    const targetSample = study.samples.find((sample) =>
      sample.reads.some((read) => read.file1 && read.file2),
    );
    if (!targetSample) fail(`Study ${study.id} has no sample with a paired active read`);
    const pairedRead = targetSample.reads.find((read) => read.file1 && read.file2);

    console.log(
      `Target study "${study.title}" (${study.id}); sample ${targetSample.sampleId} (${targetSample.id}).`,
    );

    // ---- Fixtures: checksums, assembly, and required metadata (direct DB) ----
    // (a) md5 checksums on the active paired read (submg requires them present).
    const checksumUpdate = {};
    if (!pairedRead.checksum1) {
      const onDisk = resolveOnDisk(dataBasePath, pairedRead.file1);
      checksumUpdate.checksum1 = onDisk
        ? md5OfFile(onDisk)
        : crypto.createHash("md5").update(`${pairedRead.id}:1`).digest("hex");
    }
    if (!pairedRead.checksum2) {
      const onDisk = resolveOnDisk(dataBasePath, pairedRead.file2);
      checksumUpdate.checksum2 = onDisk
        ? md5OfFile(onDisk)
        : crypto.createHash("md5").update(`${pairedRead.id}:2`).digest("hex");
    }
    if (Object.keys(checksumUpdate).length > 0) {
      await prisma.read.update({ where: { id: pairedRead.id }, data: checksumUpdate });
      console.log(`Set checksums on read ${pairedRead.id}: ${Object.keys(checksumUpdate).join(", ")}.`);
    }

    // (b) A mag-produced assembly: write a realistic FASTA on disk and create the
    //     Assembly row linked to a COMPLETED `mag` PipelineRun — i.e. exactly what
    //     the MAG pipeline leaves behind (there is no assembly-upload API). This is
    //     the input submg consumes for assembly submission; `createdByPipelineRunId`
    //     makes resolveAssemblySelection treat it as pipeline output (preferred).
    const hasAssemblyOnDisk = targetSample.assemblies.some(
      (assembly) => assembly.assemblyFile && resolveOnDisk(dataBasePath, assembly.assemblyFile),
    );
    if (!hasAssemblyOnDisk) {
      const relDir = path.join("submg-e2e-assemblies", study.id);
      // Try a REAL MEGAHIT assembly (nf-core/mag's assembler) of the seeded paired
      // reads, exactly what a mag run leaves behind. Fall back to the synthetic FASTA
      // when MEGAHIT is unavailable or yields no usable contig — keeps the leg green.
      const r1Abs = resolveOnDisk(dataBasePath, pairedRead.file1);
      const r2Abs = resolveOnDisk(dataBasePath, pairedRead.file2);
      const megahitGz = r1Abs && r2Abs ? buildMegahitAssemblyGz(r1Abs, r2Abs) : null;
      const useReal = Boolean(megahitGz);
      const relPath = path.join(
        relDir,
        useReal ? `${targetSample.id}.contigs.fa.gz` : `${targetSample.id}.fasta`,
      );
      const absPath = path.resolve(dataBasePath, relPath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, useReal ? megahitGz : buildAssemblyFasta());
      console.log(
        useReal
          ? `Built REAL mag MEGAHIT assembly: ${relPath}`
          : `MEGAHIT unavailable/empty — using synthetic assembly fallback: ${relPath}`,
      );
      // Simulate the upstream mag run that generated this assembly.
      let magRunId = null;
      if (adminUserId) {
        const magRun = await prisma.pipelineRun.create({
          data: {
            runNumber: `MAG-SUBMGE2E-${Date.now()}`,
            pipelineId: "mag",
            status: "completed",
            targetType: "study",
            studyId: study.id,
            userId: adminUserId,
            completedAt: new Date(),
          },
        });
        magRunId = magRun.id;
      }
      await prisma.assembly.create({
        data: {
          sampleId: targetSample.id,
          assemblyName: `${targetSample.sampleId}_mag_assembly`,
          assemblyFile: relPath,
          ...(magRunId ? { createdByPipelineRunId: magRunId } : {}),
        },
      });
      console.log(
        `Created mag-style assembly fixture at ${relPath}${magRunId ? ` (mag run ${magRunId})` : ""}.`,
      );
    }

    // (b2) ENA-valid library metadata on the order (only matters for read submission).
    //      NOTE: instrumentModel is intentionally NOT pinned — the seed stores
    //      "NovaSeq 6000", and the submg runner now normalizes it to the ENA-valid
    //      "Illumina NovaSeq 6000", so this leg exercises that normalization end to end.
    if (targetSample.orderId) {
      await prisma.order.update({
        where: { id: targetSample.orderId },
        data: {
          platform: "ILLUMINA",
          librarySource: "METAGENOMIC",
          librarySelection: "RANDOM",
          libraryStrategy: "WGS",
        },
      });
      console.log("Pinned ENA-valid library metadata on the order.");
    }

    // (c) taxId / scientificName / checklist metadata. The ENA study registration
    //     below submits EVERY sample in the study, and ENA's default sample
    //     checklist (ERC000011) requires the BioSample attributes "collection date"
    //     and "geographic location (country and/or sea)" under those EXACT names
    //     (the submissions route sends checklistData keys verbatim). The seed stores
    //     underscored aliases, which BioSamples rejects — so normalize the canonical
    //     names onto every sample, and backfill taxId/scientificName defensively.
    let normalized = 0;
    for (const sample of study.samples) {
      const update = {};
      if (!sample.taxId) update.taxId = "408170"; // human gut metagenome
      if (!sample.scientificName) update.scientificName = "human gut metagenome";
      let checklist = {};
      try {
        checklist = sample.checklistData ? JSON.parse(sample.checklistData) : {};
      } catch {
        checklist = {};
      }
      const collectionDate =
        checklist["collection date"] || checklist["collection_date"] || "2026-01-01";
      // "Germany" is INSDC-country-valid and matches the proven live registration.
      const geoLocation = "Germany";
      if (
        checklist["collection date"] !== collectionDate ||
        checklist["geographic location (country and/or sea)"] !== geoLocation
      ) {
        checklist["collection date"] = collectionDate;
        checklist["geographic location (country and/or sea)"] = geoLocation;
        update.checklistData = JSON.stringify(checklist);
      }
      if (Object.keys(update).length > 0) {
        await prisma.sample.update({ where: { id: sample.id }, data: update });
        normalized += 1;
      }
    }
    if (normalized > 0) {
      console.log(`Normalized ENA checklist attributes on ${normalized} sample(s).`);
    }

    // ---- Register the study on ENA TEST (gets PRJ* + fresh testRegisteredAt) ----
    const submitResponse = await client.request("/api/admin/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityType: "study", entityId: study.id, isTest: true }),
    });
    const submitBody = await parseJson(submitResponse, "ENA study registration");
    if (!submitResponse.ok) {
      fail(`ENA study registration failed (${submitResponse.status})`, JSON.stringify(submitBody, null, 2));
    }
    const registered = await prisma.study.findUnique({
      where: { id: study.id },
      select: { studyAccessionId: true, testRegisteredAt: true },
    });
    if (!registered?.studyAccessionId || !/^PRJ/.test(registered.studyAccessionId)) {
      fail(
        "Study was not assigned a PRJ* accession after ENA test registration",
        JSON.stringify({ studyId: study.id, ...registered, submitBody }, null, 2),
      );
    }
    if (!registered.testRegisteredAt) {
      fail("Study registration did not set testRegisteredAt", JSON.stringify({ studyId: study.id }, null, 2));
    }
    console.log(`Study registered on ENA TEST: ${registered.studyAccessionId}.`);

    // ---- Clear pre-registered accessions so the submg writeback is observable ----
    await prisma.sample.update({
      where: { id: targetSample.id },
      data: { sampleAccessionNumber: null, biosampleNumber: null },
    });
    await prisma.read.updateMany({
      where: { sampleId: targetSample.id },
      data: { runAccessionNumber: null, experimentAccessionNumber: null },
    });
    await prisma.assembly.updateMany({
      where: { sampleId: targetSample.id },
      data: { assemblyAccession: null },
    });

    // ---- Start the submg run (study-scoped, one sample, local execution) ----
    // The runner activates the conda env named by config.condaEnv (default "submg").
    // CI provisions a uniquely-named env, so pass its name through explicitly.
    const condaEnv = process.env.SEQDESK_SUBMG_E2E_CONDA_ENV;
    const config = {
      skipChecks: true,
      submitReads,
      submitAssembly,
      submitBins: false,
      ...(condaEnv ? { condaEnv } : {}),
    };
    const createPayload = await requestJson(
      client,
      "/api/pipelines/runs",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pipelineId: "submg",
          studyId: study.id,
          sampleIds: [targetSample.id],
          config,
          executionMode: "local",
        }),
      },
      "Create submg run",
    );
    const runId = createPayload?.run?.id;
    if (typeof runId !== "string" || !runId) {
      fail("Create submg run did not return run.id", JSON.stringify(createPayload, null, 2));
    }
    console.log(
      `Created submg run ${runId} (submitReads=${submitReads}, submitAssembly=${submitAssembly}).`,
    );

    const startResponse = await client.request(`/api/pipelines/runs/${runId}/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ executionMode: "local", sampleIds: [targetSample.id] }),
    });
    if (!startResponse.ok) {
      fail(`Start submg run failed (${startResponse.status})`, summarizeBody(await startResponse.text()));
    }
    console.log("submg run started; polling to completion...");

    // ---- Poll to completion (sync first, then read, to ride out the writer race) ----
    const deadline = Date.now() + timeoutSeconds * 1000;
    let run = null;
    while (Date.now() < deadline) {
      await client.request(`/api/pipelines/runs/${runId}/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = await requestJson(client, `/api/pipelines/runs/${runId}`, {}, "Fetch submg run");
      run = payload?.run || payload;
      if (run?.status === "completed") break;
      if (["failed", "cancelled", "canceled"].includes(run?.status)) {
        const logs = await client
          .request(`/api/pipelines/runs/${runId}/logs?type=error&tail=200`)
          .then((r) => r.text())
          .catch(() => "");
        fail(
          `submg run ${runId} finished with status ${run.status}`,
          JSON.stringify(
            { runId, errorTail: run?.errorTail, runFolder: run?.runFolder, errLog: summarizeBody(logs) },
            null,
            2,
          ),
        );
      }
      await sleep(5000);
    }
    if (run?.status !== "completed") {
      fail(
        `submg run ${runId} did not complete within ${timeoutSeconds}s (status=${run?.status})`,
        JSON.stringify({ runId, runFolder: run?.runFolder }, null, 2),
      );
    }
    console.log(`submg run ${runId} completed.`);

    // Let the completion handler (processSubmgRunResults) ingest, then re-read DB.
    await sleep(3000);

    const sampleAfter = await prisma.sample.findUnique({
      where: { id: targetSample.id },
      select: {
        sampleAccessionNumber: true,
        biosampleNumber: true,
        reads: {
          where: { isActive: true },
          select: { runAccessionNumber: true, experimentAccessionNumber: true },
        },
        assemblies: { select: { assemblyAccession: true } },
      },
    });

    // HARD #1 — SeqDesk took up submg's response: processSubmgRunResults parsed the
    // ENA receipts and recorded what it ingested in PipelineRun.results. Proves the
    // SeqDesk *integration* handled the response, not just that submg exited 0.
    const runRow = await prisma.pipelineRun.findUnique({
      where: { id: runId },
      select: { results: true },
    });
    let processing = null;
    try {
      processing = runRow?.results ? JSON.parse(runRow.results) : null;
    } catch {
      processing = null;
    }
    if (!processing || Number(processing.samplesUpdated) < 1) {
      fail(
        "SeqDesk did not record ingesting a sample accession (PipelineRun.results.samplesUpdated < 1)",
        JSON.stringify({ runId, results: processing }, null, 2),
      );
    }
    console.log(
      `SeqDesk ingested submg's response: samplesUpdated=${processing.samplesUpdated}` +
        `, readsUpdated=${processing.readsUpdated ?? 0}, assembliesUpdated=${processing.assembliesUpdated ?? 0}.`,
    );

    // HARD #2 — the ingested accession landed on the Sample row (ERS/SAMEA), persisted
    // by SeqDesk from submg's sample_preliminary_accessions.txt.
    const sampleAccession = sampleAfter?.sampleAccessionNumber || sampleAfter?.biosampleNumber;
    if (!sampleAccession || !ACCESSION_RE.test(sampleAccession)) {
      fail(
        "submg did not write a sample ENA accession back after a completed run",
        JSON.stringify({ runId, studyId: study.id, sampleId: targetSample.id, sampleAfter }, null, 2),
      );
    }
    console.log(`OK: submg wrote sample accession ${sampleAccession}.`);

    // When read submission was requested, assert SeqDesk took up the read accession.
    if (submitReads) {
      const readAccession = sampleAfter?.reads?.find(
        (r) => r.runAccessionNumber || r.experimentAccessionNumber,
      );
      if (!readAccession) {
        fail(
          "--submit-reads was requested but SeqDesk wrote back no read accession",
          JSON.stringify({ runId, sampleId: targetSample.id, sampleAfter }, null, 2),
        );
      }
      console.log(
        `OK: submg wrote read accession (run=${readAccession.runAccessionNumber}, exp=${readAccession.experimentAccessionNumber}).`,
      );
    }

    // HARD (when requested) — the mag-style assembly was submitted and SeqDesk took
    // up the assembly accession (ERZ/GCA). This is the "samples + reads + assembly"
    // integration: SeqDesk fed submg the mag-produced assembly and ingested ENA's
    // analysis accession back onto the Assembly row.
    if (submitAssembly) {
      if (Number(processing.assembliesUpdated) < 1) {
        fail(
          "--submit-assembly was requested but SeqDesk recorded no assembly ingestion (results.assembliesUpdated < 1)",
          JSON.stringify({ runId, results: processing }, null, 2),
        );
      }
      const assemblyAccession = sampleAfter?.assemblies?.find(
        (a) => a.assemblyAccession && ACCESSION_RE.test(a.assemblyAccession),
      );
      if (!assemblyAccession) {
        fail(
          "--submit-assembly was requested but SeqDesk wrote back no assembly ENA accession",
          JSON.stringify({ runId, sampleId: targetSample.id, sampleAfter }, null, 2),
        );
      }
      console.log(`OK: submg wrote assembly accession ${assemblyAccession.assemblyAccession}.`);
    }

    return {
      success: true,
      runId,
      studyId: study.id,
      studyAccessionId: registered.studyAccessionId,
      sampleId: targetSample.id,
      sampleAccession,
      submitReads,
      submitAssembly,
    };
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((summary) => {
    // Exit explicitly once the assertions have passed (flush stdout first). The
    // app's keep-alive HTTP sockets / DB handles can otherwise keep the event loop
    // alive and a late, post-success teardown rejection has surfaced as a spurious
    // non-zero exit (seen only on the installed-app leg). The integration is already
    // proven by the time we get here.
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`, () => process.exit(0));
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
