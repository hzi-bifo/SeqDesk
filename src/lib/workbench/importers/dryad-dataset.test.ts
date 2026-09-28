import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { dryadDatasetImporter, parseDryadRef } from "./dryad-dataset";
import type { WorkbenchImportStartContext } from "./types";

const sha = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const DATASET = "https://datadryad.org/api/v2/datasets/doi%3A10.5061%2Fdryad.2bvq83bnv";
// Trimmed shapes of the Dryad v2 API (dataset, then its latest version's files).
const dataset = (overrides: Record<string, unknown> = {}) => ({
  identifier: "doi:10.5061/dryad.2bvq83bnv", title: "Health literacy\tprofile", license: "https://spdx.org/licenses/CC0-1.0.html",
  versionNumber: 5, publicationDate: "2020-10-07", visibility: "public",
  _links: { "stash:version": { href: "/api/v2/versions/85949" } }, ...overrides,
});
const file = (id: number, name: string, body: string) => ({ path: name, size: body.length, digest: sha(body), digestType: "sha-256", _links: { "stash:download": { href: `/api/v2/files/${id}/download` } } });
const files = (list: unknown[], next?: string) => ({ _links: next ? { next: { href: next } } : {}, _embedded: { "stash:files": list } });
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
function stubFetch(routes: Record<string, (init?: RequestInit) => Response>) {
  const mock = vi.fn(async (url: string | URL, init?: RequestInit) => routes[String(url)]?.(init) ?? new Response("missing", { status: 404 }));
  vi.stubGlobal("fetch", mock);
  return mock;
}
const input = (value: string, extra: Record<string, unknown> = {}) => dryadDatasetImporter.inputSchema.parse({ dataset: value, ...extra });

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Dryad dataset importer", () => {
  it.each([
    ["10.5061/dryad.2bvq83bnv", "10.5061/dryad.2bvq83bnv"],
    ["doi:10.5061/DRYAD.2BVQ83BNV", "10.5061/dryad.2bvq83bnv"],
    ["https://doi.org/10.5061/dryad.2bvq83bnv", "10.5061/dryad.2bvq83bnv"],
    ["https://datadryad.org/stash/dataset/doi:10.5061/dryad.2bvq83bnv", "10.5061/dryad.2bvq83bnv"],
    ["https://datadryad.org/dataset/doi:10.5061/dryad.2bvq83bnv", "10.5061/dryad.2bvq83bnv"],
  ])("reads %s", (value, doi) => { expect(parseDryadRef(value)).toBe(doi); });

  it.each(["", "10.5281/zenodo.1", "https://evil.example/dataset/doi:10.5061/dryad.2bvq83bnv", "10.5061/dryad.x"])("rejects %s", (value) => {
    expect(() => input(value)).toThrow();
  });

  it("previews files with Dryad's SHA-256, licence and version across pages, and says downloads need an account", async () => {
    vi.stubEnv("SEQDESK_DRYAD_CLIENT_ID", "");
    stubFetch({
      [DATASET]: () => json(dataset()),
      "https://datadryad.org/api/v2/versions/85949/files": () => json(files([file(1, "data.xlsx", "hello")], "/api/v2/versions/85949/files?page=2")),
      "https://datadryad.org/api/v2/versions/85949/files?page=2": () => json(files([file(2, "README.md", "world")])),
    });
    const preview = await dryadDatasetImporter.preview(input("10.5061/dryad.2bvq83bnv"));
    expect(preview).toMatchObject({
      providerId: "dryad-dataset",
      summary: { label: "Dryad 10.5061/dryad.2bvq83bnv v5 · Health literacy profile", totalFound: 2, selectedCount: 2 },
      records: [{ id: "10.5061/dryad.2bvq83bnv", detail: "10.5061/dryad.2bvq83bnv · v5 · CC0 1.0 · 2020" }],
      sampleMetadata: { licence: "CC0 1.0", version: "v5" },
    });
    expect(preview.assets?.find(asset => asset.filename === "README.md")).toMatchObject({ etag: `sha256:${sha("world")}` });
    expect(preview.warnings).toContainEqual(expect.stringContaining("registered API accounts"));
    expect(await dryadDatasetImporter.preflight()).toMatchObject({ ok: false, previewOnly: true });
  });

  it("records Dryad's citation with author names only, never their e-mail addresses", async () => {
    stubFetch({
      [DATASET]: () => json(dataset({ authors: [
        { firstName: "Karumathil", lastName: "Murali", email: "someone@example.org" },
        { firstName: "Judy", lastName: "Mullan", email: "" },
      ] })),
      "https://datadryad.org/api/v2/versions/85949/files": () => json(files([file(1, "data.xlsx", "hello")])),
    });
    const preview = await dryadDatasetImporter.preview(input("10.5061/dryad.2bvq83bnv"));
    expect(preview.sampleMetadata?.citation).toBe("Murali, K., & Mullan, J. (2020). Health literacy profile [Dataset]. Dryad. https://doi.org/10.5061/dryad.2bvq83bnv");
    expect(JSON.stringify(preview)).not.toContain("someone@example.org");
  });

  it("refuses unexpected download addresses", async () => {
    stubFetch({
      [DATASET]: () => json(dataset()),
      "https://datadryad.org/api/v2/versions/85949/files": () => json(files([{ ...file(1, "x", "x"), _links: { "stash:download": { href: "https://evil.example/x" } } }])),
    });
    await expect(dryadDatasetImporter.preview(input("10.5061/dryad.2bvq83bnv"))).rejects.toThrow("unexpected download address");
  });

  it("downloads with the API account's token and checks SHA-256", async () => {
    vi.stubEnv("SEQDESK_DRYAD_CLIENT_ID", "id");
    vi.stubEnv("SEQDESK_DRYAD_CLIENT_SECRET", "secret");
    stubFetch({ [DATASET]: () => json(dataset()), "https://datadryad.org/api/v2/versions/85949/files": () => json(files([file(1, "data.csv", "hello")])) });
    const parsed = input("10.5061/dryad.2bvq83bnv");
    const preview = await dryadDatasetImporter.preview(parsed);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dryad-test-"));
    const context = (cacheDir: string): WorkbenchImportStartContext<typeof parsed> => ({
      jobId: "job", workspaceId: "ws", userId: "user", input: parsed, preview, cacheKey: "key",
      storage: { baseDir: root, cacheRoot: root, jobsRoot: root, cacheDir, jobDir: root, logPath: path.join(root, "log") },
      update: async () => {}, log: async () => {},
    });
    try {
      let auth = "";
      stubFetch({
        "https://datadryad.org/oauth/token": () => json({ access_token: "t0k" }),
        "https://datadryad.org/api/v2/files/1/download": (init) => { auth = String((init?.headers as Record<string, string>).authorization); return new Response("hello"); },
      });
      const result = await dryadDatasetImporter.start(context(path.join(root, "ok")));
      expect(auth).toBe("Bearer t0k");
      expect(result.sourceMetadata).toMatchObject({ source: "Dryad", record: "10.5061/dryad.2bvq83bnv", licence: "CC0 1.0", version: "v5" });
      expect(JSON.stringify(result.sourceMetadata)).not.toContain("t0k");
      stubFetch({ "https://datadryad.org/oauth/token": () => json({ access_token: "t0k" }), "https://datadryad.org/api/v2/files/1/download": () => new Response("HELLO") });
      await expect(dryadDatasetImporter.start(context(path.join(root, "bad")))).rejects.toThrow("did not match the checksum Dryad published");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
