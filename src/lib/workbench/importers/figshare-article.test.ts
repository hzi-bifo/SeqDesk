import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { importPreviewFingerprint } from "../import-preview-fingerprint";
import { figshareArticleImporter, parseFigshareRef } from "./figshare-article";
import type { WorkbenchImportStartContext } from "./types";

const md5 = (value: string) => crypto.createHash("md5").update(value).digest("hex");
// Trimmed shape of https://api.figshare.com/v2/articles/{id}.
function article(overrides: Record<string, unknown> = {}, files?: unknown[]) {
  return {
    id: 33917185, title: "Host tree and abundance tables", doi: "10.6084/m9.figshare.33917185.v6", version: 6,
    published_date: "2026-09-21T06:32:43Z", license: { value: 1, name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
    is_embargoed: false, is_confidential: false, views: Math.random(),
    files: files ?? [
      { id: 2, name: "b.tree", size: 5, computed_md5: md5("world"), download_url: "https://ndownloader.figshare.com/files/2", is_link_only: false },
      { id: 1, name: "a.csv", size: 5, computed_md5: md5("hello"), download_url: "https://ndownloader.figshare.com/files/1", is_link_only: false },
    ],
    ...overrides,
  };
}
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
function stubFetch(routes: Record<string, () => Response>) {
  const mock = vi.fn(async (url: string | URL) => routes[String(url)]?.() ?? new Response("missing", { status: 404 }));
  vi.stubGlobal("fetch", mock);
  return mock;
}
const input = (article: string, extra: Record<string, unknown> = {}) => figshareArticleImporter.inputSchema.parse({ article, ...extra });

afterEach(() => { vi.unstubAllGlobals(); });

describe("figshare article importer", () => {
  it.each([
    ["33917185", { id: "33917185" }],
    ["10.6084/m9.figshare.33917185.v6", { id: "33917185", version: 6 }],
    ["https://doi.org/10.6084/m9.figshare.33917185", { id: "33917185" }],
    ["https://figshare.com/articles/dataset/Host_tree/33917185/3", { id: "33917185", version: 3 }],
    ["https://hku.figshare.com/articles/dataset/x/32812934", { id: "32812934" }],
  ])("reads %s", (value, ref) => {
    expect(parseFigshareRef(value)).toEqual(ref);
    const stored = input(value).article;
    expect(input(stored).article).toBe(stored);
  });

  it.each(["", "abc", "0", "10.6084/zenodo.1", "https://figshare.com.evil/articles/x/1", "https://evil.example/articles/x/1"])("rejects %s", (value) => {
    expect(() => input(value)).toThrow();
  });

  it("previews files, licence and the version it pins, deterministically", async () => {
    const fetchMock = stubFetch({ "https://api.figshare.com/v2/articles/33917185": () => json(article()) });
    const first = await figshareArticleImporter.preview(input("33917185"));
    expect(first).toMatchObject({
      providerId: "figshare-article",
      summary: { label: "figshare 33917185 v6 · Host tree and abundance tables", totalFound: 2, selectedCount: 2 },
      records: [{ id: "33917185.v6", detail: "10.6084/m9.figshare.33917185.v6 · v6 · CC BY 4.0 · 2026" }],
      sampleMetadata: { licence: "CC BY 4.0", version: "v6", doi: "10.6084/m9.figshare.33917185.v6" },
    });
    expect(first.assets?.map(asset => asset.filename)).toEqual(["a.csv", "b.tree"]);
    expect(first.warnings?.[0]).toContain("version 6, the latest today");
    const second = await figshareArticleImporter.preview(input("33917185"));
    expect(importPreviewFingerprint("figshare-article", input("33917185"), first)).toBe(importPreviewFingerprint("figshare-article", input("33917185"), second));
    stubFetch({ "https://api.figshare.com/v2/articles/33917185/versions/3": () => json(article({ version: 3 })) });
    const pinned = await figshareArticleImporter.preview(input("10.6084/m9.figshare.33917185.v3"));
    expect(pinned.records?.[0].id).toBe("33917185.v3");
    expect(pinned.warnings ?? []).not.toContainEqual(expect.stringContaining("latest today"));
    expect(fetchMock).toHaveBeenCalled();
  });

  it("downloads nothing from embargoed articles and skips link-only files", async () => {
    stubFetch({ "https://api.figshare.com/v2/articles/33917185": () => json(article({ is_embargoed: true, embargo_date: "2030-01-01" })) });
    const embargoed = await figshareArticleImporter.preview(input("33917185"));
    expect(embargoed.summary.selectedCount).toBe(0);
    expect(embargoed.warnings).toContainEqual(expect.stringContaining("embargo until 2030-01-01"));
    stubFetch({ "https://api.figshare.com/v2/articles/33917185": () => json(article({}, [{ id: 9, name: "site", size: 0, download_url: "https://example.org/", is_link_only: true }])) });
    const links = await figshareArticleImporter.preview(input("33917185"));
    expect(links.summary.totalFound).toBe(0);
    expect(links.warnings).toContainEqual(expect.stringContaining("1 file is a link"));
  });

  it("refuses foreign download hosts and explains missing articles", async () => {
    stubFetch({ "https://api.figshare.com/v2/articles/33917185": () => json(article({}, [{ id: 1, name: "x", size: 1, download_url: "https://evil.example/files/1" }])) });
    await expect(figshareArticleImporter.preview(input("33917185"))).rejects.toThrow("unexpected download address");
    stubFetch({});
    await expect(figshareArticleImporter.preview(input("1234"))).rejects.toThrow("figshare has no public article 1234.");
  });

  it("downloads the ticked files through the S3 redirect, verifies MD5 and records licence", async () => {
    stubFetch({ "https://api.figshare.com/v2/articles/33917185": () => json(article()) });
    const parsed = input("33917185", { files: ["a.csv"] });
    const preview = await figshareArticleImporter.preview(parsed);
    expect(preview.assets?.map(asset => asset.filename)).toEqual(["a.csv"]);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "figshare-test-"));
    const context = (cacheDir: string): WorkbenchImportStartContext<typeof parsed> => ({
      jobId: "job", workspaceId: "ws", userId: "user", input: parsed, preview, cacheKey: "key",
      storage: { baseDir: root, cacheRoot: root, jobsRoot: root, cacheDir, jobDir: root, logPath: path.join(root, "log") },
      update: async () => {}, log: async () => {},
    });
    try {
      stubFetch({ "https://ndownloader.figshare.com/files/1": () => new Response("hello") });
      const result = await figshareArticleImporter.start(context(path.join(root, "ok")));
      expect(result.sourceMetadata).toMatchObject({ source: "figshare", record: "33917185.v6", licence: "CC BY 4.0", version: "v6", sourcePage: "https://figshare.com/articles/dataset/_/33917185/6" });
      expect((result.sourceMetadata as { files: Array<{ sha256: string }> }).files[0].sha256).toBe(crypto.createHash("sha256").update("hello").digest("hex"));
      stubFetch({ "https://ndownloader.figshare.com/files/1": () => new Response("HELLO") });
      await expect(figshareArticleImporter.start(context(path.join(root, "bad")))).rejects.toThrow("did not match the checksum figshare published");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
