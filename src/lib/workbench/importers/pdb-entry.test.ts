import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { importPreviewFingerprint } from "../import-preview-fingerprint";
import { mapPdbEntry, pdbEntryImporter } from "./pdb-entry";
import type { WorkbenchImportStartContext } from "./types";

// Trimmed shape of https://data.rcsb.org/rest/v1/core/entry/{id}.
const entry = (id: string) => ({
  rcsb_id: id,
  struct: { title: `Structure ${id}` },
  exptl: [{ method: "X-RAY DIFFRACTION" }],
  rcsb_entry_info: { resolution_combined: [1.85] },
  rcsb_accession_info: { initial_release_date: "2002-06-12T00:00:00.000+00:00", revision_date: new Date().toISOString() },
});

function stubFetch(routes: Record<string, () => Response>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => routes[String(url)]?.() ?? new Response("missing", { status: 404 })));
}
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const input = (ids: unknown) => pdbEntryImporter.inputSchema.parse({ ids });

afterEach(() => { vi.unstubAllGlobals(); });

describe("PDB entry importer", () => {
  it("trims, uppercases and deduplicates ids", () => {
    expect(input([" 1lm8", "1LM8", "4zqk "]).ids).toEqual(["1LM8", "4ZQK"]);
    expect(input("1lm8, 4zqk").ids).toEqual(["1LM8", "4ZQK"]);
  });

  it.each([[[]], [["LM8"]], [["1LM8X"]], [["ABCD"]], [["1LM*"]], [Array.from({ length: 21 }, (_, i) => `1A${String(i).padStart(2, "0")}`)]])("rejects %j", (ids) => {
    expect(() => input(ids)).toThrow();
  });

  it("maps entry details", () => {
    expect(mapPdbEntry("1LM8", entry("1LM8"))).toEqual({ id: "1LM8", title: "Structure 1LM8", detail: "X-ray Diffraction · 1.85 Å · released 2002" });
    expect(mapPdbEntry("2K2K", { rcsb_id: "2K2K", struct: { title: "NMR thing" }, exptl: [{ method: "SOLUTION NMR" }] }).detail).toBe("Solution NMR");
  });

  it("previews one record and one mmCIF asset per id, deterministically", async () => {
    stubFetch({
      "https://data.rcsb.org/rest/v1/core/entry/1LM8": () => json(entry("1LM8")),
      "https://data.rcsb.org/rest/v1/core/entry/4ZQK": () => json(entry("4ZQK")),
    });
    const parsed = input(["1LM8", "4ZQK"]);
    const preview = await pdbEntryImporter.preview(parsed);
    expect(preview).toMatchObject({
      providerId: "pdb-entry",
      summary: { label: "PDB · 2 structures", totalFound: 2, selectedCount: 2, capped: false, cap: 20, hardMax: 20 },
      assets: [
        { url: "https://files.rcsb.org/download/1LM8.cif", filename: "1LM8.cif", bytes: 0, etag: "", role: "structure" },
        { url: "https://files.rcsb.org/download/4ZQK.cif", filename: "4ZQK.cif", bytes: 0, etag: "", role: "structure" },
      ],
      records: [{ id: "1LM8", title: "Structure 1LM8" }, { id: "4ZQK" }],
    });
    expect(preview.warnings).toEqual(["PDB does not publish file sizes in advance; sizes are measured during the download."]);
    expect(importPreviewFingerprint("pdb-entry", parsed, preview)).toBe(importPreviewFingerprint("pdb-entry", parsed, await pdbEntryImporter.preview(parsed)));
  });

  it("names missing entries", async () => {
    stubFetch({ "https://data.rcsb.org/rest/v1/core/entry/1LM8": () => json(entry("1LM8")) });
    await expect(pdbEntryImporter.preview(input(["1LM8", "9ZZZ"]))).rejects.toThrow("PDB has no entry 9ZZZ.");
    await expect(pdbEntryImporter.preview(input(["9ZZZ", "8ZZZ"]))).rejects.toThrow("PDB has no entries 9ZZZ, 8ZZZ.");
  });

  it("downloads mmCIF files and rejects other content", async () => {
    stubFetch({ "https://data.rcsb.org/rest/v1/core/entry/1LM8": () => json(entry("1LM8")) });
    const parsed = input(["1LM8"]);
    const preview = await pdbEntryImporter.preview(parsed);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pdb-test-"));
    const context = (cacheDir: string): WorkbenchImportStartContext<typeof parsed> => ({
      jobId: "job", workspaceId: "ws", userId: "user", input: parsed, preview, cacheKey: "key",
      storage: { baseDir: root, cacheRoot: root, jobsRoot: root, cacheDir, jobDir: root, logPath: path.join(root, "log") },
      update: async () => {}, log: async () => {},
    });
    try {
      stubFetch({ "https://files.rcsb.org/download/1LM8.cif": () => new Response("data_1LM8\n#\n") });
      const result = await pdbEntryImporter.start(context(path.join(root, "ok")));
      expect(result).toMatchObject({ sourceType: "pdb-entry", sizeBytes: 12 });
      stubFetch({ "https://files.rcsb.org/download/1LM8.cif": () => new Response("<html>") });
      await expect(pdbEntryImporter.start(context(path.join(root, "bad")))).rejects.toThrow("other than an mmCIF file");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
