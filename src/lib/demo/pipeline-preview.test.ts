import { describe, it, expect } from "vitest";
import { serveDemoPipelineFile } from "./pipeline-preview";

// These exercise the real bundled assets under public/demo/ (process.cwd() = repo root).
describe("serveDemoPipelineFile (bundled demo pipeline artifacts)", () => {
  it("serves a per-sample FastQC report from the bundled R1/R2 reports", async () => {
    const res = await serveDemoPipelineFile(
      "demo/abc/runs/fastqc-demo/fastqc_reports/GR-01_R1_fastqc.html"
    );
    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);
    expect(res?.headers.get("Content-Type")).toBe("text/html");
  });

  it("serves the bundled MultiQC report by basename", async () => {
    const res = await serveDemoPipelineFile(
      "demo/abc/runs/mag-demo/output/multiqc_report.html"
    );
    expect(res).not.toBeNull();
    expect(res?.headers.get("Content-Type")).toBe("text/html");
    expect(await res!.text()).toContain("MultiQC");
  });

  it("returns null for non-previewable or unbundled files", async () => {
    expect(
      await serveDemoPipelineFile("demo/abc/output/assembly/contigs.fasta")
    ).toBeNull(); // .fasta is not a previewable extension
    expect(
      await serveDemoPipelineFile("demo/abc/output/not-bundled.html")
    ).toBeNull(); // previewable ext but no bundled file
  });

  it("rejects path-traversal style inputs (basename only, safe charset)", async () => {
    expect(await serveDemoPipelineFile("../../etc/passwd")).toBeNull();
    expect(await serveDemoPipelineFile("demo/abc/..%2f..%2fsecret.html")).toBeNull();
  });
});
