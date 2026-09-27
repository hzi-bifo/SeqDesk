import { afterEach, describe, expect, it, vi } from "vitest";

import { importPreviewFingerprint } from "../import-preview-fingerprint";
import { alphafoldModelImporter, mapAlphafoldPrediction } from "./alphafold-model";

// Trimmed shape of https://alphafold.ebi.ac.uk/api/prediction/{accession} (canonical model plus isoforms).
const model = (accession: string, suffix = "") => ({
  modelEntityId: `AF-${accession}${suffix}-F1`,
  uniprotAccession: `${accession}${suffix}`,
  uniprotDescription: "Hypoxia-inducible factor 1-alpha",
  gene: "HIF1A",
  organismScientificName: "Homo sapiens",
  globalMetricValue: 60.75,
  latestVersion: 6,
  modelCreatedDate: "2025-08-01T00:00:00Z",
  cifUrl: `https://alphafold.ebi.ac.uk/files/AF-${accession}${suffix}-F1-model_v6.cif`,
  paeDocUrl: `https://alphafold.ebi.ac.uk/files/AF-${accession}${suffix}-F1-predicted_aligned_error_v6.json`,
});

function stubFetch(routes: Record<string, () => Response>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => routes[String(url)]?.() ?? new Response("missing", { status: 404 })));
}
const input = (accessions: unknown) => alphafoldModelImporter.inputSchema.parse({ accessions });

afterEach(() => { vi.unstubAllGlobals(); });

describe("AlphaFold model importer", () => {
  it("normalises UniProt accessions", () => {
    expect(input([" q16665", "Q16665", "A0A023GPI8"]).accessions).toEqual(["Q16665", "A0A023GPI8"]);
  });

  it.each([[[]], [["Q1666"]], [["Q16665-2"]], [["HIF1A_HUMAN"]], [["Q16665 OR 1"]], [Array.from({ length: 21 }, (_, i) => `P${String(10000 + i)}`)]])("rejects %j", (accessions) => {
    expect(() => input(accessions)).toThrow();
  });

  it("picks the canonical model, not an isoform", () => {
    const mapped = mapAlphafoldPrediction("Q16665", [model("Q16665", "-3"), model("Q16665")]);
    expect(mapped).toMatchObject({
      filename: "AF-Q16665-F1-model_v6.cif",
      paeDocUrl: "https://alphafold.ebi.ac.uk/files/AF-Q16665-F1-predicted_aligned_error_v6.json",
      record: { id: "Q16665", title: "Hypoxia-inducible factor 1-alpha", detail: "HIF1A · Homo sapiens · model v6 · mean pLDDT 60.8" },
    });
  });

  it("rejects foreign download addresses", () => {
    expect(() => mapAlphafoldPrediction("Q16665", [{ ...model("Q16665"), cifUrl: "https://evil.example/AF-Q16665-F1-model_v6.cif" }])).toThrow("unexpected download address");
  });

  it("previews deterministically and names missing models", async () => {
    stubFetch({ "https://alphafold.ebi.ac.uk/api/prediction/Q16665": () => new Response(JSON.stringify([model("Q16665")])) });
    const parsed = input(["Q16665"]);
    const preview = await alphafoldModelImporter.preview(parsed);
    expect(preview).toMatchObject({
      providerId: "alphafold-model",
      summary: { label: "AlphaFold Q16665 · Hypoxia-inducible factor 1-alpha", totalFound: 1, selectedCount: 1 },
      assets: [{ url: "https://alphafold.ebi.ac.uk/files/AF-Q16665-F1-model_v6.cif", filename: "AF-Q16665-F1-model_v6.cif", bytes: 0, etag: "AF-Q16665-F1-v6", role: "model" }],
    });
    expect(importPreviewFingerprint("alphafold-model", parsed, preview)).toBe(importPreviewFingerprint("alphafold-model", parsed, await alphafoldModelImporter.preview(parsed)));
    await expect(alphafoldModelImporter.preview(input(["P12345"]))).rejects.toThrow("AlphaFold DB has no model for P12345.");
  });
});
