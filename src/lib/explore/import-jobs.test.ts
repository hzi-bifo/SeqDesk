import { describe, expect, it } from "vitest";
import { cancelImportJob, createImportJob, finishImportJob, getImportJob, importJobSentence } from "./import-jobs";
import { pageRowLimit } from "./table-page";

describe("import jobs", () => {
  it("say how far an import is, and what came of it", () => {
    const job = createImportJob({ targetKey: "study:s", userId: "u", fileName: "counts.tsv", sizeBytes: 10, expectedRows: 1_000_000 });
    expect(getImportJob(job.id)).toBe(job);
    expect(importJobSentence(job)).toBe("Reading counts.tsv…");
    job.rows = 250_000;
    expect(importJobSentence(job, job.startedAt + 30_000)).toBe("Read 250,000 of about 1,000,000 rows (25%) · about 2 min left.");
    cancelImportJob(job);
    expect(job.controller.signal.aborted).toBe(true);
    finishImportJob(job, { state: "cancelled" });
    expect(importJobSentence(job)).toBe("Import cancelled; nothing was kept.");
    const done = createImportJob({ targetKey: "study:s", userId: "u", fileName: "x.csv", sizeBytes: 1, expectedRows: null });
    done.rows = 12;
    finishImportJob(done, { state: "done", datasetId: "d" });
    expect(importJobSentence(done)).toMatch(/^Imported 12 rows in \d+ s\.$/);
  });
});

describe("table pages", () => {
  it("give a wide table fewer rows", () => {
    expect(pageRowLimit(2000, 20)).toEqual({ limit: 2000, limitedBy: null });
    expect(pageRowLimit(2000, 10_000)).toEqual({ limit: 100, limitedBy: "cells" });
    expect(pageRowLimit(1_000_000, 2)).toEqual({ limit: 250_000, limitedBy: null });
  });
});

describe("import requests with a key", () => {
  it("finds the running or finished job again, but not one that ended without a table", async () => {
    const { findImportJobByKey } = await import("./import-jobs");
    const job = createImportJob({ targetKey: "study:k", userId: "u", fileName: "a.csv", sizeBytes: 1, expectedRows: 2, requestKey: "key-1" });
    expect(findImportJobByKey("u", "study:k", "key-1")).toBe(job);
    expect(findImportJobByKey("other", "study:k", "key-1")).toBeNull();
    expect(findImportJobByKey("u", "study:other", "key-1")).toBeNull();
    finishImportJob(job, { state: "done", datasetId: "d" });
    expect(findImportJobByKey("u", "study:k", "key-1")).toBe(job);
    const failed = createImportJob({ targetKey: "study:k", userId: "u", fileName: "b.csv", sizeBytes: 1, expectedRows: 2, requestKey: "key-2" });
    finishImportJob(failed, { state: "failed", error: "bad" });
    expect(findImportJobByKey("u", "study:k", "key-2")).toBeNull();
  });
});
