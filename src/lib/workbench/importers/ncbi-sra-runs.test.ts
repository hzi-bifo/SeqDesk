import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { siteSettings: { findUnique: vi.fn(async () => null) } } }));

import { resetNcbiApiKeyCache, resetNcbiLimiter } from "./ncbi-client";
import { isEnaFastqUrl, isNcbiSraUrl, ncbiSraRunsImporter, parseSraPackages, sraRunsTsv } from "./ncbi-sra-runs";
import type { WorkbenchImportStartContext } from "./types";

// Recorded from NCBI E-utilities and ENA on 2026-09-28 (SRR10008674, a 1,567-spot 16S run; submitter contacts removed).
const FIXTURES = path.join(__dirname, "__fixtures__", "ncbi");
const fixture = (name: string) => fs.readFile(path.join(FIXTURES, name), "utf8");
const md5 = (value: Buffer | string) => crypto.createHash("md5").update(value).digest("hex");

type Route = (url: URL, init?: RequestInit) => Response | Promise<Response>;
function stubFetch(route: Route) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return route(url, init);
  }));
  return calls;
}
const body = (init?: RequestInit) => new URLSearchParams(String(init?.body ?? ""));

async function ncbiRoutes(extra: Route = () => new Response("missing", { status: 404 })): Promise<Route> {
  const [esearch, efetch, ena] = await Promise.all([fixture("esearch-SRR10008674.json"), fixture("efetch-SRR10008674.xml"), fixture("ena-SRR10008674.json")]);
  return (url, init) => {
    if (url.pathname.endsWith("/esearch.fcgi") && url.searchParams.get("db") === "sra") return new Response(esearch);
    if (url.pathname.endsWith("/efetch.fcgi") && body(init).get("id") === "8887949") return new Response(efetch);
    if (url.hostname === "www.ebi.ac.uk") return new Response(ena);
    return extra(url, init);
  };
}

beforeEach(() => { resetNcbiLimiter(); resetNcbiApiKeyCache(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("NCBI SRA runs importer", () => {
  it("reads runs, files and MD5s from an SRA record without resolving entities", async () => {
    const [run] = parseSraPackages(await fixture("efetch-SRR10008674.xml"));
    expect(run).toMatchObject({
      run: "SRR10008674", experiment: "SRX6747018", study: "SRP218962", bioproject: "PRJNA561290", sample: "SRS5297270", biosample: "SAMN12613307",
      organism: "Homo sapiens", strategy: "AMPLICON", layout: "PAIRED", instrument: "Illumina MiniSeq", spots: 1567, isPublic: true,
      sra: { md5: "68c50ff25b2692e39ae1b7f54dd26006", bytes: 214276 },
    });
    expect(() => parseSraPackages("<!DOCTYPE x [<!ENTITY a 'b'>]><EXPERIMENT_PACKAGE_SET/>")).toThrow("does not read");
  });

  it("takes SRA, BioProject, BioSample and GEO accessions, and refuses others plainly", () => {
    expect(ncbiSraRunsImporter.inputSchema.parse({ accessions: "srr10008674, GSE52778 PRJNA561290" }).accessions).toEqual(["SRR10008674", "GSE52778", "PRJNA561290"]);
    expect(() => ncbiSraRunsImporter.inputSchema.parse({ accessions: ["SRR1", "hello"] })).toThrow(/is not an SRA or GEO accession|are not an SRA or GEO accession/);
  });

  it("previews a run with FASTQ from the ENA mirror, ENA's MD5s, licence and citation", async () => {
    const calls = stubFetch(await ncbiRoutes());
    const preview = await ncbiSraRunsImporter.preview(ncbiSraRunsImporter.inputSchema.parse({ accessions: ["SRR10008674"] }));
    expect(preview.assets).toEqual([
      { url: "https://ftp.sra.ebi.ac.uk/vol1/fastq/SRR100/074/SRR10008674/SRR10008674_1.fastq.gz", filename: "SRR10008674_1.fastq.gz", bytes: 86866, etag: "md5:948993099eaeb6adb4b308ebb9fc4371", role: "fastq" },
      { url: "https://ftp.sra.ebi.ac.uk/vol1/fastq/SRR100/074/SRR10008674/SRR10008674_2.fastq.gz", filename: "SRR10008674_2.fastq.gz", bytes: 58603, etag: "md5:7cad0586f8079252d75bb77aaa45acf4", role: "fastq" },
    ]);
    expect(preview.records?.[0]).toMatchObject({ id: "SRR10008674", detail: expect.stringContaining("FASTQ from the ENA mirror") });
    expect(preview.sampleMetadata).toMatchObject({ licence: expect.stringContaining("NCBI"), citation: "Run SRR10008674 of PRJNA561290, NCBI Sequence Read Archive, https://www.ncbi.nlm.nih.gov/sra" });
    // E-utilities identify SeqDesk; no key is sent when none is set.
    expect(calls[0].url.searchParams.get("tool")).toBe("seqdesk");
    expect(calls.some(call => call.url.searchParams.has("api_key") || body(call.init).has("api_key"))).toBe(false);
  });

  it("falls back to NCBI's .sra file with NCBI's MD5 when ENA has no FASTQ", async () => {
    stubFetch(await ncbiRoutes().then(routes => (url, init) => url.hostname === "www.ebi.ac.uk" ? new Response(null, { status: 204 }) : routes(url, init)));
    const preview = await ncbiSraRunsImporter.preview(ncbiSraRunsImporter.inputSchema.parse({ accessions: ["SRR10008674"] }));
    expect(preview.assets).toEqual([{ url: "https://sra-pub-run-odp.s3.amazonaws.com/sra/SRR10008674/SRR10008674", filename: "SRR10008674.sra", bytes: 214276, etag: "md5:68c50ff25b2692e39ae1b7f54dd26006", role: "sra" }]);
    expect(preview.warnings).toContainEqual(expect.stringContaining("fasterq-dump"));
  });

  it("retries ENA once and then says it did not answer, using NCBI's files", async () => {
    let ena = 0;
    stubFetch(await ncbiRoutes().then(routes => (url, init) => { if (url.hostname === "www.ebi.ac.uk") { ena += 1; return new Response("", { status: 503 }); } return routes(url, init); }));
    const preview = await ncbiSraRunsImporter.preview(ncbiSraRunsImporter.inputSchema.parse({ accessions: ["SRR10008674"] }));
    expect(ena).toBe(2);
    expect(preview.assets?.[0].role).toBe("sra");
    expect(preview.warnings).toContainEqual(expect.stringContaining("ENA did not answer"));
  });

  it("follows a GEO series to its SRA runs", async () => {
    const calls = stubFetch(await ncbiRoutes((url) => {
      if (url.pathname.endsWith("/esearch.fcgi") && url.searchParams.get("db") === "gds") return new Response(JSON.stringify({ esearchresult: { idlist: ["200134000"] } }));
      if (url.pathname.endsWith("/elink.fcgi")) return new Response(JSON.stringify({ linksets: [{ linksetdbs: [{ dbto: "sra", linkname: "gds_sra", links: ["8887949"] }] }] }));
      return new Response("missing", { status: 404 });
    }));
    const preview = await ncbiSraRunsImporter.preview(ncbiSraRunsImporter.inputSchema.parse({ accessions: ["GSE134000"] }));
    expect(calls.find(call => call.url.pathname.endsWith("/esearch.fcgi"))?.url.searchParams.get("term")).toBe("GSE134000[ACCN] AND gse[ETYP]");
    expect(preview.records?.map(record => record.id)).toEqual(["SRR10008674"]);
    expect(preview.sampleMetadata).toMatchObject({ geo: "GSE134000", citation: expect.stringContaining("(GEO GSE134000)") });
  });

  it("says when NCBI has no run for an accession", async () => {
    stubFetch(() => new Response(JSON.stringify({ esearchresult: { idlist: [] } })));
    const preview = await ncbiSraRunsImporter.preview(ncbiSraRunsImporter.inputSchema.parse({ accessions: ["SRR99999999"] }));
    expect(preview.assets).toEqual([]);
    expect(preview.warnings).toContainEqual("NCBI has no public SRA runs for SRR99999999.");
  });

  it("sends the API key to NCBI only and never puts it in an error", async () => {
    const key = "abcdef0123456789abcdef0123456789ab";
    vi.stubEnv("NCBI_API_KEY", key);
    const calls = stubFetch((url) => url.hostname === "eutils.ncbi.nlm.nih.gov" ? new Response("", { status: 502 }) : new Response("", { status: 404 }));
    const error = await ncbiSraRunsImporter.preview(ncbiSraRunsImporter.inputSchema.parse({ accessions: ["SRR10008674"] })).catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("NCBI SRA did not answer as expected (HTTP 502). Try again later.");
    expect((error as Error).message).not.toContain(key);
    expect(calls).toHaveLength(2); // one retry
    expect(calls.every(call => call.url.searchParams.get("api_key") === key)).toBe(true);
  });

  it("only downloads from ENA's FASTQ tree or NCBI's public SRA bucket", () => {
    expect(isEnaFastqUrl("https://ftp.sra.ebi.ac.uk/vol1/fastq/SRR100/074/SRR10008674/SRR10008674_1.fastq.gz")).toBe(true);
    expect(isEnaFastqUrl("https://ftp.sra.ebi.ac.uk/vol1/../etc/x.fastq.gz")).toBe(false);
    expect(isEnaFastqUrl("https://evil.example/vol1/fastq/x.fastq.gz")).toBe(false);
    expect(isNcbiSraUrl("https://sra-pub-run-odp.s3.amazonaws.com/sra/SRR10008674/SRR10008674")).toBe(true);
    expect(isNcbiSraUrl("https://sra-pub-run-odp.s3.amazonaws.com/sra/SRR10008674/SRR1")).toBe(false);
  });

  it("downloads, checks each MD5 and writes the runs table with its provenance", async () => {
    const r1 = zlib.gzipSync("@r1\nACGT\n+\nIIII\n");
    const r2 = zlib.gzipSync("@r1\nTTTT\n+\nIIII\n");
    const ena = JSON.stringify([{ run_accession: "SRR10008674", fastq_ftp: "ftp.sra.ebi.ac.uk/vol1/fastq/SRR100/074/SRR10008674/SRR10008674_1.fastq.gz;ftp.sra.ebi.ac.uk/vol1/fastq/SRR100/074/SRR10008674/SRR10008674_2.fastq.gz", fastq_md5: `${md5(r1)};${md5(r2)}`, fastq_bytes: `${r1.length};${r2.length}` }]);
    const routes = await ncbiRoutes();
    const serve = (corrupt: boolean): Route => (url, init) => {
      if (url.hostname === "www.ebi.ac.uk") return new Response(ena);
      if (url.hostname === "ftp.sra.ebi.ac.uk") return new Response(new Uint8Array(url.pathname.endsWith("_1.fastq.gz") ? (corrupt ? zlib.gzipSync("x") : r1) : r2));
      return routes(url, init);
    };
    stubFetch(serve(false));
    const input = ncbiSraRunsImporter.inputSchema.parse({ accessions: ["SRR10008674"] });
    const preview = await ncbiSraRunsImporter.preview(input);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "sra-test-"));
    const context = (cacheDir: string): WorkbenchImportStartContext<typeof input> => ({
      jobId: "job", workspaceId: "ws", userId: "user", input, preview, cacheKey: "key",
      storage: { baseDir: root, cacheRoot: root, jobsRoot: root, cacheDir, jobDir: root, logPath: path.join(root, "log") },
      update: async () => {}, log: async () => {},
    });
    try {
      const result = await ncbiSraRunsImporter.start(context(path.join(root, "ok")));
      const meta = result.sourceMetadata as { files: { filename: string; role: string; md5: string; sourceVersion?: string }[]; citation: string; licence: string };
      expect(meta.files.map(file => [file.filename, file.role])).toEqual([["SRR10008674_1.fastq.gz", "fastq"], ["SRR10008674_2.fastq.gz", "fastq"], ["sra_runs.tsv", "runs"]]);
      expect(meta.files[0].md5).toBe(md5(r1));
      expect(meta.files[2].sourceVersion).toBe("derived:ncbi-sra-metadata");
      // The pair becomes a read record like an ENA import: study = BioProject, sample = BioSample, R1 then R2.
      expect(result.scientificImports).toHaveLength(1);
      expect(result.scientificImports![0]).toMatchObject({ studyKey: "PRJNA561290", sampleKey: "SAMN12613307", readKey: "SRR10008674", technology: "short", synthetic: false,
        metadata: { pairingValidated: true, instrumentModel: "Illumina MiniSeq" } });
      expect(result.scientificImports![0].reads.map(read => [path.basename(read.path), read.records])).toEqual([["0001-SRR10008674_1.fastq.gz", 1], ["0002-SRR10008674_2.fastq.gz", 1]]);
      expect(meta.citation).toContain("PRJNA561290");
      const tsv = await fs.readFile(path.join(result.storagePath, "sra_runs.tsv"), "utf8");
      expect(tsv.split("\n")[1]).toMatch(/^SRR10008674\tSRX6747018\tSRS5297270\tSAMN12613307\t/);
      expect(tsv).toContain("ENA FASTQ");
      stubFetch(serve(true));
      await expect(ncbiSraRunsImporter.start(context(path.join(root, "bad")))).rejects.toThrow(/larger than NCBI SRA declared|did not match the checksum NCBI SRA published|arrived incomplete/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("writes a runs table that keeps one line per run", () => {
    const tsv = sraRunsTsv([{ run: "SRR1", experiment: "SRX1", title: "a\tb\nc", isPublic: true }], () => "NCBI .sra");
    expect(tsv.trim().split("\n")).toHaveLength(2);
    expect(tsv).toContain("a b c");
  });
});
