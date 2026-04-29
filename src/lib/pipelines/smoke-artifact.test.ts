import { describe, expect, it } from "vitest";
import {
  inspectSmokeArtifactZip,
  listZipEntries,
} from "./smoke-artifact";

function makeCentralDirectoryEntry(path: string, sizeBytes: number): Buffer {
  const name = Buffer.from(path, "utf8");
  const entry = Buffer.alloc(46 + name.length);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt32LE(sizeBytes, 20);
  entry.writeUInt32LE(sizeBytes, 24);
  entry.writeUInt16LE(name.length, 28);
  name.copy(entry, 46);
  return entry;
}

function makeZipWithEntries(entries: Array<{ path: string; sizeBytes?: number }>): Buffer {
  const centralEntries = entries.map((entry) =>
    makeCentralDirectoryEntry(entry.path, entry.sizeBytes ?? 0)
  );
  const centralDirectory = Buffer.concat(centralEntries);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(0, 16);
  return Buffer.concat([centralDirectory, eocd]);
}

describe("smoke-artifact", () => {
  it("lists ZIP central directory entries without extracting files", () => {
    const zip = makeZipWithEntries([
      { path: "results/run_20260309/final/report.html", sizeBytes: 123 },
      { path: "work/aa/internal.txt", sizeBytes: 55 },
    ]);

    expect(listZipEntries(zip)).toEqual([
      {
        path: "results/run_20260309/final/report.html",
        sizeBytes: 123,
        isDirectory: false,
      },
      {
        path: "work/aa/internal.txt",
        sizeBytes: 55,
        isDirectory: false,
      },
    ]);
  });

  it("inspects published result paths and suggests output globs", () => {
    const zip = makeZipWithEntries([
      { path: "report.html", sizeBytes: 1000 },
      { path: "results/run_20260309/final/flye/metaxpath.combined_report.top50.html" },
      { path: "results/run_20260309/final/flye/metaxpath.combined_report.simple.dotplot.pdf" },
      { path: "results/run_20260309/final/flye/metaxpath.combined_report.top50.txt" },
      { path: "results/run_20260309/profiling/metax/test_sample.metax.profile.txt" },
      { path: "results/run_20260309/amr/flye/test_sample/predict_amrs_summary.txt" },
      { path: "results/run_20260309/virulence/flye/test_sample/blast_vfs_summary.txt" },
      { path: "results/run_20260309/qc/nohuman/test_sample.nohuman_fract.stats" },
      { path: "work/03/internal.txt" },
    ]);

    const result = inspectSmokeArtifactZip(zip);

    expect(result.summary).toEqual({
      totalFiles: 9,
      publishedFiles: 8,
      ignoredWorkFiles: 1,
      suggestedOutputs: 7,
    });
    expect(result.entries.map((entry) => entry.path)).not.toContain("work/03/internal.txt");
    expect(result.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "final-html-reports",
          pattern: "results/**/final/**/*.html",
          count: 1,
        }),
        expect.objectContaining({
          id: "amr-summaries",
          pattern: "results/**/amr/**/predict_amrs_summary.txt",
          count: 1,
        }),
        expect.objectContaining({
          id: "virulence-summaries",
          pattern: "results/**/virulence/**/blast_vfs_summary.txt",
          count: 1,
        }),
      ])
    );
  });

  it("rejects invalid ZIP buffers", () => {
    expect(() => listZipEntries(Buffer.from("not a zip"))).toThrow(/central directory/);
  });
});
