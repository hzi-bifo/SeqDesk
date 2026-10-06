import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ stored: null as string | null, db: { siteSettings: { findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn(), create: vi.fn() } } }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));

import {
  applySettingsChange, assertMayImport, DataSourcesError, dataSourcesHistory, dataSourcesStatus, DEFAULT_ASK_ABOVE_BYTES, DEFAULT_MAX_BYTES,
  dryadAccount, effectiveSource, GiB, importLimits, parseSettingsChange, previewHint, readDataSourcesSettings, runSourceTest, setSecret, sourceById, testSources,
} from "./data-sources";
import { decryptSecret, isEncrypted } from "@/lib/security/secret-store";
import { resetNcbiApiKeyCache } from "./importers/ncbi-client";

process.env.NEXTAUTH_SECRET ||= "test-secret-for-secret-store-unit-tests";
const deps = { moduleEnabled: async () => true, preflight: async () => ({ ok: true }) };
const files = (gib: number) => ({ files: [{ runAccession: "SRR1", url: "https://x", filename: "a.fastq.gz", bytes: gib * GiB }] });
const extra = () => JSON.parse(mocks.stored ?? "{}");
const reply = (status: number, body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

describe("data sources", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("NCBI_API_KEY", "");
    vi.stubEnv("SEQDESK_DRYAD_CLIENT_ID", "");
    vi.stubEnv("SEQDESK_DRYAD_CLIENT_SECRET", "");
    vi.stubEnv("SEQDESK_WORKBENCH_ENA_MAX_BYTES", "");
    vi.stubEnv("SEQDESK_WORKBENCH_RECORD_MAX_BYTES", "");
    resetNcbiApiKeyCache();
    mocks.stored = JSON.stringify({ ena: { centerName: "HZI" } });
    mocks.db.siteSettings.findUnique.mockImplementation(async () => ({ extraSettings: mocks.stored }));
    mocks.db.siteSettings.upsert.mockImplementation(async ({ update }: { update: { extraSettings: string } }) => { mocks.stored = update.extraSettings; });
    mocks.db.siteSettings.updateMany.mockImplementation(async ({ where, data }: { where: { extraSettings: string | null }; data: { extraSettings: string } }) => {
      if (mocks.stored !== where.extraSettings) return { count: 0 };
      mocks.stored = data.extraSettings;
      return { count: 1 };
    });
    mocks.db.siteSettings.create.mockImplementation(async ({ data }: { data: { extraSettings: string } }) => { mocks.stored = data.extraSettings; });
  });

  it("defaults to 250 GB per import and asks above 20 GB", async () => {
    const e = effectiveSource({}, sourceById("ena")!);
    expect(e).toMatchObject({ maxBytes: DEFAULT_MAX_BYTES, askAboveBytes: DEFAULT_ASK_ABOVE_BYTES, enabled: true, who: "members", maxFrom: "workspace" });
    expect(DEFAULT_MAX_BYTES).toBe(250 * GiB);
    expect(DEFAULT_ASK_ABOVE_BYTES).toBe(20 * GiB);
  });

  it("keeps the environment caps as the fallback until an admin sets a limit", () => {
    vi.stubEnv("SEQDESK_WORKBENCH_RECORD_MAX_BYTES", String(7 * GiB));
    expect(effectiveSource({}, sourceById("geo")!)).toMatchObject({ maxBytes: 7 * GiB, maxFrom: "environment" });
    expect(effectiveSource({}, sourceById("ena")!).maxBytes).toBe(DEFAULT_MAX_BYTES);
    expect(effectiveSource({ maxBytes: 100 * GiB }, sourceById("geo")!)).toMatchObject({ maxBytes: 100 * GiB, maxFrom: "workspace" });
    expect(effectiveSource({ sources: { geo: { maxBytes: 3 * GiB } } }, sourceById("geo")!)).toMatchObject({ maxBytes: 3 * GiB, maxFrom: "source" });
    // A source never exceeds the workspace limit.
    expect(effectiveSource({ maxBytes: 10 * GiB, sources: { geo: { maxBytes: 30 * GiB } } }, sourceById("geo")!).maxBytes).toBe(10 * GiB);
  });

  it("saves changes next to the other settings and writes one audit line per change", async () => {
    await applySettingsChange(parseSettingsChange({ askAboveBytes: 5 * GiB, sources: { structures: { enabled: false }, reference: { who: "admins" } } }), "Alex Morgan");
    expect(extra().ena).toEqual({ centerName: "HZI" });
    const settings = await readDataSourcesSettings();
    expect(settings.askAboveBytes).toBe(5 * GiB);
    const history = await dataSourcesHistory();
    expect(history.map((h) => h.what)).toEqual(["Bioconductor and MSigDB: admins only can import", "PDB, AlphaFold, UniProt turned off", "Asks before downloads above 5 GB (was 20 GB)"]);
    expect(history.every((h) => h.by === "Alex Morgan" && h.kind === "setting")).toBe(true);
    // Saving the same values again adds nothing.
    await applySettingsChange(parseSettingsChange({ askAboveBytes: 5 * GiB, sources: { structures: { enabled: false } } }), "Alex Morgan");
    expect((await dataSourcesHistory()).length).toBe(3);
  });

  it("refuses unknown sources and sizes that make no sense", () => {
    expect(() => parseSettingsChange({ sources: { nope: { enabled: true } } })).toThrow(DataSourcesError);
    expect(() => parseSettingsChange({ maxBytes: -1 })).toThrow(/size/);
    expect(() => parseSettingsChange({ sources: { ena: { who: "everyone" } } })).toThrow(/members or admins/);
  });

  it("stores the NCBI key and the Dryad account encrypted, never in the status, and audits the change", async () => {
    const KEY = "abcdef0123456789abcdef0123456789ab";
    await setSecret("ncbi-key", { apiKey: KEY }, "Mateus Oliveira");
    await setSecret("dryad-account", { clientId: "client-id-123", clientSecret: "client-secret-456" }, "Mateus Oliveira");
    expect(isEncrypted(extra().ncbi.apiKey)).toBe(true);
    expect(decryptSecret(extra().ncbi.apiKey)).toBe(KEY);
    expect(isEncrypted(extra().dryad.clientSecret)).toBe(true);
    expect(await dryadAccount()).toEqual({ value: { id: "client-id-123", secret: "client-secret-456" }, source: "settings" });
    const status = await dataSourcesStatus(deps, true);
    const text = JSON.stringify(status);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("client-secret-456");
    expect(status.sources.find((s) => s.id === "ncbi")).toMatchObject({ status: "ready", secrets: [{ set: true, source: "settings", changedBy: "Mateus Oliveira" }] });
    expect(status.sources.find((s) => s.id === "dryad")).toMatchObject({ status: "ready", needs: "A Dryad API account" });
    await setSecret("ncbi-key", { apiKey: "" }, "Mateus Oliveira");
    expect(extra().ncbi.apiKey).toBeUndefined();
    expect((await dataSourcesHistory())[0].what).toBe("NCBI API key removed");
    await expect(setSecret("ncbi-key", { apiKey: "short!" }, "x")).rejects.toThrow(/NCBI API key/);
    await expect(setSecret("dryad-account", { clientId: "only-the-id" }, "x")).rejects.toThrow(/both/);
  });

  it("falls back to the environment for the Dryad account", async () => {
    vi.stubEnv("SEQDESK_DRYAD_CLIENT_ID", "env-id");
    vi.stubEnv("SEQDESK_DRYAD_CLIENT_SECRET", "env-secret");
    expect(await dryadAccount()).toEqual({ value: { id: "env-id", secret: "env-secret" }, source: "environment" });
  });

  it("says each source's state in words", async () => {
    await applySettingsChange({ sources: { structures: { enabled: false } } }, "Alex Morgan");
    const status = await dataSourcesStatus({ moduleEnabled: async (id) => id !== "cami-benchmark", preflight: async (id) => id === "dryad-dataset" ? { ok: false, previewOnly: true } : { ok: true } }, false);
    const word = (id: string) => status.sources.find((s) => s.id === id)?.status;
    expect(word("ena")).toBe("ready");
    expect(word("ncbi")).toBe("slower");
    expect(word("dryad")).toBe("needs-account");
    expect(word("structures")).toBe("off");
    expect(status.sources.find((s) => s.id === "structures")?.offBy).toMatchObject({ by: "Alex Morgan" });
    expect(word("cami")).toBe("off");
    expect(status.canManage).toBe(false);
  });

  it("refuses a source that is off, and admins-only sources for members", async () => {
    await applySettingsChange({ sources: { structures: { enabled: false }, reference: { who: "admins" } } }, "Alex Morgan");
    await expect(assertMayImport("pdb-entry", true)).rejects.toMatchObject({ status: 403, message: "An admin turned PDB, AlphaFold, UniProt off for imports." });
    await expect(assertMayImport("reference-resource", false)).rejects.toMatchObject({ status: 403 });
    await expect(assertMayImport("reference-resource", true)).resolves.toBeUndefined();
    await expect(assertMayImport("ena-fastq-accession", false)).resolves.toBeUndefined();
  });

  it("refuses a selection over the limit and asks above the ask size at start", async () => {
    await applySettingsChange({ sources: { ena: { maxBytes: 100 * GiB } } }, "Alex Morgan");
    await expect(importLimits("ena-fastq-accession", files(120), { phase: "preview" })).rejects.toMatchObject({ status: 413 });
    const preview = await importLimits("ena-fastq-accession", files(30), { phase: "preview" });
    expect(preview).toMatchObject({ source: "ena", maxBytes: 100 * GiB, askAboveBytes: 20 * GiB, totalBytes: 30 * GiB, needsConfirmation: true });
    await expect(importLimits("ena-fastq-accession", files(30), { phase: "start", requireConfirmation: true })).rejects.toMatchObject({ status: 409 });
    await expect(importLimits("ena-fastq-accession", files(30), { phase: "start", requireConfirmation: true, confirmedBytes: 30 * GiB })).resolves.toMatchObject({ needsConfirmation: true });
    await expect(importLimits("ena-fastq-accession", files(5), { phase: "start", requireConfirmation: true })).resolves.toMatchObject({ needsConfirmation: false });
  });

  it("hints at an NCBI key only when the requests a preview sent make it more than 30 s slower, and says Dryad is preview only", async () => {
    expect(await previewHint("ncbi-sra-runs", 240)).toMatchObject({ kind: "ncbi-key", count: 240, seconds: 80, secondsWithKey: 24,
      sentence: "This search asks NCBI 240 times and takes about 80 s. With an NCBI key it takes about 24 s." });
    expect(await previewHint("ncbi-sra-runs", 100)).toBeNull();
    expect(await previewHint("ena-fastq-accession", 240)).toBeNull();
    expect(await previewHint("dryad-dataset", 0, true)).toMatchObject({ kind: "dryad-preview-only" });
    await setSecret("ncbi-key", { apiKey: "abcdef0123456789abcdef0123456789ab" }, "x");
    expect(await previewHint("ncbi-sra-runs", 240)).toBeNull();
  });

  it("tests a source with a small real query and answers in one sentence with the time", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).includes("ena/portal") ? reply(200, [{ run_accession: "SRR390728", fastq_ftp: "a_1.fq.gz;a_2.fq.gz" }]) : reply(200, {}));
    const ena = await runSourceTest("ena", fetcher as typeof fetch);
    expect(ena.result).toBe("passed");
    expect(ena.sentence).toMatch(/^ENA answered in \d+\.\d s and found run SRR390728 with 2 FASTQ files\.$/);
    const dryad = await runSourceTest("dryad", fetcher as typeof fetch);
    expect(dryad).toMatchObject({ result: "half", sentence: "Dryad previews work. Downloads were refused: no Dryad API account is set." });
  });

  it("says when NCBI refuses the key and when a source does not answer, and records both", async () => {
    await setSecret("ncbi-key", { apiKey: "abcdef0123456789abcdef0123456789ab" }, "x");
    const refused = await runSourceTest("ncbi", (async () => reply(400, '{"error":"API key invalid","api_key":"x"}')) as typeof fetch);
    expect(refused).toMatchObject({ result: "refused", sentence: "NCBI refused the key (HTTP 400: invalid api_key). Nothing was changed." });
    await testSources(["geo"], "Alex Morgan", (async () => reply(200, "GSE52778")) as typeof fetch);
    const [down] = await testSources(["geo"], "Alex Morgan", (async () => { throw new TypeError("fetch failed"); }) as typeof fetch);
    expect(down.result).toBe("unreachable");
    expect(down.sentence).toMatch(/^GEO did not answer in 20 s\. It last worked on \d+ \w+ at \d\d:\d\d\.$/);
    const settings = await readDataSourcesSettings();
    expect(settings.tests?.geo).toMatchObject({ result: "unreachable", by: "Alex Morgan" });
    expect((await dataSourcesHistory())[0]).toMatchObject({ kind: "test", what: "Tested GEO · GEO not reachable" });
    expect((await dataSourcesStatus(deps, true)).sources.find((s) => s.id === "geo")?.status).toBe("unreachable");
  });
});

describe("Find data's connector list", () => {
  beforeEach(() => {
    mocks.stored = null;
    mocks.db.siteSettings.findUnique.mockImplementation(async () => ({ extraSettings: mocks.stored }));
    mocks.db.siteSettings.upsert.mockImplementation(async ({ update }: { update: { extraSettings: string } }) => { mocks.stored = update.extraSettings; });
    mocks.db.siteSettings.updateMany.mockImplementation(async ({ where, data }: { where: { extraSettings: string | null }; data: { extraSettings: string } }) => {
      if (mocks.stored !== where.extraSettings) return { count: 0 };
      mocks.stored = data.extraSettings;
      return { count: 1 };
    });
    mocks.db.siteSettings.create.mockImplementation(async ({ data }: { data: { extraSettings: string } }) => { mocks.stored = data.extraSettings; });
  });
  it("keeps both of two concurrent admin saves (compare-and-set, no lost update)", async () => {
    const real = mocks.db.siteSettings.findUnique.getMockImplementation()!;
    // Both admins read the same document before either writes.
    let gate: (() => void) | null = null;
    const bothRead = new Promise<void>((resolve) => { gate = resolve; });
    let reads = 0;
    mocks.db.siteSettings.findUnique.mockImplementation(async (...args: unknown[]) => {
      const row = await (real as (...a: unknown[]) => Promise<unknown>)(...args);
      reads += 1;
      if (reads === 2) gate!();
      if (reads <= 2) await bothRead;
      return row;
    });
    await Promise.all([
      applySettingsChange({ maxBytes: 10 * GiB, sources: { ena: { who: "admins" } } }, "Admin A"),
      setSecret("ncbi-key", { apiKey: "a".repeat(32) }, "Admin B"),
    ]);
    const saved = JSON.parse(mocks.stored!);
    expect(saved.dataSources.maxBytes).toBe(10 * GiB);
    expect(saved.dataSources.sources.ena.who).toBe("admins");
    expect(saved.ncbi.apiKey).toBeTruthy();
    expect(saved.dataSources.history.map((h: { by: string }) => h.by).sort()).toEqual(["Admin A", "Admin A", "Admin B"]);
    mocks.db.siteSettings.findUnique.mockImplementation(real);
  });

  it("hides sources that are off, and admins-only sources from members", async () => {
    const { importAllowedFilter } = await import("./data-sources");
    await applySettingsChange({ sources: { structures: { enabled: false }, reference: { who: "admins" } } }, "Alex Morgan");
    const member = await importAllowedFilter(false);
    const admin = await importAllowedFilter(true);
    expect(member("pdb-entry")).toBe(false);
    expect(admin("uniprot-entry")).toBe(false);
    expect(member("reference-resource")).toBe(false);
    expect(admin("reference-resource")).toBe(true);
    expect(member("ena-fastq-accession")).toBe(true);
    expect(member("some-new-importer")).toBe(true);
  });
});
