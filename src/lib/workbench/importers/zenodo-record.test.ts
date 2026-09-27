import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { importPreviewFingerprint } from "../import-preview-fingerprint";
import { parseZenodoRecordRef, zenodoRecordImporter, zenodoVersion } from "./zenodo-record";
import type { WorkbenchImportStartContext } from "./types";

// Trimmed shape of https://zenodo.org/api/records/{id} (legacy JSON serialization).
function record(overrides: Record<string, unknown> = {}, files?: unknown[]) {
  return {
    id: 6977322, doi: "10.5281/zenodo.6977322", stats: { views: Math.random() }, updated: new Date().toISOString(),
    metadata: { title: "binny benchmark data", version: "1.2", license: { id: "cc-by-4.0" }, publication_date: "2022-05-30", access_right: "open", ...overrides },
    files: files ?? [
      { key: "b.zip", size: 5, checksum: "md5:" + crypto.createHash("md5").update("world").digest("hex"), links: { self: "https://zenodo.org/api/records/6977322/files/b.zip/content" } },
      { key: "a.txt", size: 5, checksum: "md5:" + crypto.createHash("md5").update("hello").digest("hex"), links: { self: "https://zenodo.org/api/records/6977322/files/a.txt/content" } },
    ],
  };
}

function stubFetch(routes: Record<string, () => Response>) {
  const fetchMock = vi.fn(async (url: string | URL) => {
    const route = routes[String(url)];
    return route ? route() : new Response("missing", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
const input = (record: string, extra: Record<string, unknown> = {}) => zenodoRecordImporter.inputSchema.parse({ record, ...extra });

afterEach(() => { vi.unstubAllGlobals(); });

describe("Zenodo record importer", () => {
  it.each([
    ["6977322", "6977322"],
    ["https://zenodo.org/records/6977322", "6977322"],
    ["zenodo.org/record/6977322?preview=1", "6977322"],
    ["https://zenodo.org/api/records/6977322", "6977322"],
    ["10.5281/zenodo.6977322", "6977322"],
    ["doi:10.5281/ZENODO.6977322", "6977322"],
    ["https://doi.org/10.5281/zenodo.6977322", "6977322"],
  ])("normalises %s to the record id", (value, id) => {
    expect(parseZenodoRecordRef(value)).toBe(id);
    expect(input(value).record).toBe(id);
  });

  it.each(["", "abc", "10.1234/zenodo.1", "https://evil.example/records/1", "https://zenodo.org.evil/records/1", "0", "1 OR 2"])("rejects %s", (value) => {
    expect(() => input(value)).toThrow();
  });

  it("defaults and bounds maxFiles", () => {
    expect(input("1").maxFiles).toBe(20);
    expect(() => input("1", { maxFiles: 101 })).toThrow();
  });

  it("formats versions", () => {
    expect(zenodoVersion("1.2")).toBe("v1.2");
    expect(zenodoVersion("v3.1")).toBe("v3.1");
    expect(zenodoVersion("https://github.com/ohickl/binny_manuscript")).toBe("https://github.com/ohickl/binny_manuscr…");
  });

  it("maps a record to a deterministic preview, files sorted by name", async () => {
    stubFetch({ "https://zenodo.org/api/records/6977322": () => json(record()) });
    const first = await zenodoRecordImporter.preview(input("10.5281/zenodo.6977322"));
    expect(first).toMatchObject({
      providerId: "zenodo-record",
      summary: { label: "Zenodo 6977322 · binny benchmark data", totalFound: 2, selectedCount: 2, capped: false, cap: 20, hardMax: 100 },
      records: [{ id: "6977322", title: "binny benchmark data", detail: "10.5281/zenodo.6977322 · v1.2 · cc-by-4.0 · 2022" }],
    });
    expect(first.assets?.map(asset => asset.filename)).toEqual(["a.txt", "b.zip"]);
    expect(first.assets?.[0]).toMatchObject({ bytes: 5, role: "file", etag: expect.stringMatching(/^md5:/) });
    expect(first.warnings).toBeUndefined();
    const second = await zenodoRecordImporter.preview(input("6977322"));
    const parsed = input("6977322");
    expect(importPreviewFingerprint("zenodo-record", parsed, first)).toBe(importPreviewFingerprint("zenodo-record", parsed, second));
  });

  it("caps files and warns", async () => {
    stubFetch({ "https://zenodo.org/api/records/6977322": () => json(record()) });
    const preview = await zenodoRecordImporter.preview(input("6977322", { maxFiles: 1 }));
    expect(preview.summary).toMatchObject({ totalFound: 2, selectedCount: 1, capped: true, cap: 1 });
    expect(preview.warnings?.[0]).toContain("2 files");
  });

  it("selects nothing from restricted or embargoed records", async () => {
    stubFetch({ "https://zenodo.org/api/records/6977322": () => json(record({ access_right: "embargoed", embargo_date: "2030-01-01" }, [])) });
    const preview = await zenodoRecordImporter.preview(input("6977322"));
    expect(preview.summary.selectedCount).toBe(0);
    expect(preview.warnings?.[0]).toBe("This record is under embargo until 2030-01-01; its files cannot be downloaded yet.");
  });

  it("follows a concept record to its latest version", async () => {
    stubFetch({
      "https://zenodo.org/api/records/5779793": () => new Response(null, { status: 302, headers: { location: "https://zenodo.org/api/records/6977322" } }),
      "https://zenodo.org/api/records/6977322": () => json(record()),
    });
    const preview = await zenodoRecordImporter.preview(input("5779793"));
    expect(preview.records?.[0].id).toBe("6977322");
    expect(preview.warnings?.[0]).toContain("latest version, record 6977322");
    stubFetch({
      "https://zenodo.org/api/records/5779793": () => new Response(null, { status: 302, headers: { location: "/api/records/6977322" } }),
      "https://zenodo.org/api/records/6977322": () => json(record()),
    });
    expect((await zenodoRecordImporter.preview(input("5779793"))).records?.[0].id).toBe("6977322");
    stubFetch({ "https://zenodo.org/api/records/5779793": () => new Response(null, { status: 302, headers: { location: "https://evil.example/api/records/1" } }) });
    await expect(zenodoRecordImporter.preview(input("5779793"))).rejects.toThrow("unexpected address");
  });

  it("explains missing records and foreign download hosts in plain sentences", async () => {
    stubFetch({});
    await expect(zenodoRecordImporter.preview(input("123456"))).rejects.toThrow("Zenodo has no record 123456.");
    stubFetch({ "https://zenodo.org/api/records/6977322": () => json(record({}, [{ key: "x", size: 1, checksum: "md5:00", links: { self: "https://evil.example/x" } }])) });
    await expect(zenodoRecordImporter.preview(input("6977322"))).rejects.toThrow("unexpected download address");
    stubFetch({ "https://zenodo.org/api/records/6977322": () => new Response("busy", { status: 429 }) });
    await expect(zenodoRecordImporter.preview(input("6977322"))).rejects.toThrow("Zenodo is limiting requests right now. Try again in a minute.");
  });

  it("downloads, verifies MD5 and records SHA-256, refusing corrupted files", async () => {
    stubFetch({ "https://zenodo.org/api/records/6977322": () => json(record()) });
    const parsed = input("6977322");
    const preview = await zenodoRecordImporter.preview(parsed);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zenodo-test-"));
    const context = (cacheDir: string): WorkbenchImportStartContext<typeof parsed> => ({
      jobId: "job", workspaceId: "ws", userId: "user", input: parsed, preview, cacheKey: "key",
      storage: { baseDir: root, cacheRoot: root, jobsRoot: root, cacheDir, jobDir: root, logPath: path.join(root, "log") },
      update: async () => {}, log: async () => {},
    });
    try {
      stubFetch({
        "https://zenodo.org/api/records/6977322/files/a.txt/content": () => new Response("hello"),
        "https://zenodo.org/api/records/6977322/files/b.zip/content": () => new Response("world"),
      });
      const cacheDir = path.join(root, "ok");
      const result = await zenodoRecordImporter.start(context(cacheDir));
      expect(result).toMatchObject({ sourceType: "zenodo-record", sizeBytes: 10, storagePath: path.join(cacheDir, "files") });
      expect(await fs.readFile(path.join(cacheDir, "files", "0001-a.txt"), "utf8")).toBe("hello");
      const files = (result.sourceMetadata as { files: Array<{ sha256: string }> }).files;
      expect(files[0].sha256).toBe(crypto.createHash("sha256").update("hello").digest("hex"));

      stubFetch({
        "https://zenodo.org/api/records/6977322/files/a.txt/content": () => new Response("HELLO"),
        "https://zenodo.org/api/records/6977322/files/b.zip/content": () => new Response("world"),
      });
      const bad = path.join(root, "bad");
      await expect(zenodoRecordImporter.start(context(bad))).rejects.toThrow("did not match the checksum Zenodo published");
      expect(await fs.readdir(path.join(bad, "files"))).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("downloads only the ticked files, and the selection changes fingerprint and cache key", async () => {
    stubFetch({ "https://zenodo.org/api/records/6977322": () => json(record()) });
    const all = await zenodoRecordImporter.preview(input("6977322"));
    expect(all.choices?.map(choice => [choice.filename, choice.selected, choice.table])).toEqual([["a.txt", true, true], ["b.zip", true, false]]);
    const picked = input("6977322", { files: ["a.txt"] });
    const one = await zenodoRecordImporter.preview(picked);
    expect(one.assets?.map(asset => asset.filename)).toEqual(["a.txt"]);
    expect(one.choices?.find(choice => choice.filename === "b.zip")?.selected).toBe(false);
    expect(importPreviewFingerprint("zenodo-record", picked, one)).not.toBe(importPreviewFingerprint("zenodo-record", input("6977322"), all));
    expect(zenodoRecordImporter.getCacheKey(picked, one)).not.toBe(zenodoRecordImporter.getCacheKey(input("6977322"), all));
    await expect(zenodoRecordImporter.preview(input("6977322", { files: ["nope.csv"] }))).rejects.toThrow("no file named nope.csv");
  });

  it("does not pre-tick large files that are not data tables", async () => {
    const big = { key: "raw.tar", size: 50 * 1024 ** 2, checksum: "md5:" + "0".repeat(32), links: { self: "https://zenodo.org/api/records/6977322/files/raw.tar/content" } };
    const table = { key: "counts.tsv", size: 40 * 1024 ** 2, checksum: "md5:" + "1".repeat(32), links: { self: "https://zenodo.org/api/records/6977322/files/counts.tsv/content" } };
    stubFetch({ "https://zenodo.org/api/records/6977322": () => json(record({}, [big, table])) });
    const preview = await zenodoRecordImporter.preview(input("6977322"));
    expect(preview.assets?.map(asset => asset.filename)).toEqual(["counts.tsv"]);
    expect(preview.warnings?.some(warning => warning.includes("1 of 2 files are not ticked"))).toBe(true);
  });
});
