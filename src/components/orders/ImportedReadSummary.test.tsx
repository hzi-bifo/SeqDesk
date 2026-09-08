// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ImportedReadSummary } from "./ImportedReadSummary";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function setup(metadata: unknown) {
  // Internal SeqDesk record contract, not an external service response.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ samples: [{ id: "sample", sampleId: "internal", reads: [{ id: "read", file1: "internal.fastq", file2: null, dataClass: "raw", pipelineSources: JSON.stringify(metadata), runAccessionNumber: null }] }] }))));
  render(<ImportedReadSummary orderId="internal" />);
}
it.each([null, [], {}, { processing: { source: { details: {} }, userDeclaration: { details: {}, recordedAt: {} } } }])("does not infer processing for legacy or malformed metadata %s", async metadata => {
  setup(metadata);
  expect(await screen.findByText(/Processing unknown \(not recorded\)/)).toBeTruthy();
});
it("shows declared classification separately from retained source evidence and synthetic status", async () => {
  setup({ synthetic: true, processing: { effectiveState: "cleaned", source: { details: "Source did not specify processing" }, userDeclaration: { details: "User reviewed filtering notes", recordedAt: "2026-09-07T00:00:00Z" } } });
  expect(await screen.findByText("Cleaned / filtered reads · Synthetic benchmark · User-declared")).toBeTruthy();
  expect(screen.getByText("Source did not specify processing")).toBeTruthy();
  expect(screen.getByText(/User declaration: User reviewed filtering notes/)).toBeTruthy();
});
