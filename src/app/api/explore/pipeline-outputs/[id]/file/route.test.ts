import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), authorize: vi.fn(), artifacts: vi.fn(), spec: vi.fn() }));
vi.mock("../../../_shared", () => ({ requireExploreSession: mocks.session, exploreErrorResponse: (error: { status?: number; message: string }) => NextResponse.json({ error: error.message }, { status: error.status ?? 500 }) }));
vi.mock("@/lib/explore/authorization", () => ({ requireTargetAccess: mocks.authorize, exploreBuildContext: (_session: unknown, target: unknown, targetKey: string) => ({ target, targetKey }) }));
vi.mock("@/lib/explore/pipeline-outputs", () => ({ accessiblePipelineArtifacts: mocks.artifacts }));
vi.mock("@/lib/explore/builders/pipeline-table", () => ({ resolveTableSpec: mocks.spec }));
import { GET } from "./route";
let root: string;
let file: string;
const request = (mode: string, id = "a1") => GET(new NextRequest(`http://localhost/api/explore/pipeline-outputs/${id}/file?targetKey=study:mine&mode=${mode}`), { params: Promise.resolve({ id }) });
beforeEach(async () => {
  vi.clearAllMocks();
  root = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-output-route-"));
  file = path.join(root, "report.html");
  await fs.writeFile(file, "<h1>Saved report</h1>");
  mocks.session.mockResolvedValue({ user: { id: "owner" } });
  mocks.authorize.mockResolvedValue({ type: "study", id: "mine" });
  mocks.artifacts.mockImplementation(async () => [{ artifact: { id: "a1", path: file, outputId: "report" }, run: { pipelineId: "generic-tool", runFolder: root } }]);
  mocks.spec.mockReturnValue({ spec: null, output: null });
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
describe("authorized pipeline output files", () => {
  it("checks scope access before looking for files", async () => {
    mocks.authorize.mockRejectedValue({ status: 403, message: "Forbidden" });
    expect((await request("preview")).status).toBe(403);
    expect(mocks.artifacts).not.toHaveBeenCalled();
  });
  it("cannot retrieve an artifact outside the authorized catalog", async () => {
    expect((await request("download", "foreign")).status).toBe(404);
  });
  it("serves HTML with an opaque sandbox and no network access", async () => {
    const response = await request("preview");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Security-Policy")).toContain("sandbox allow-scripts;");
    expect(response.headers.get("Content-Security-Policy")).not.toContain("allow-same-origin");
    expect(response.headers.get("Content-Security-Policy")).toContain("connect-src 'none'");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).toBe("<h1>Saved report</h1>");
  });
  it("streams originals as attachments", async () => {
    const response = await request("download");
    expect(response.headers.get("Content-Disposition")).toContain("attachment;");
    expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(await response.text()).toContain("Saved report");
  });
  it("returns a useful missing-file response", async () => {
    file = path.join(root, "missing.html");
    expect((await request("preview")).status).toBe(404);
  });
  it("does not follow a symlink outside the run directory", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-outside-test-"));
    try {
      await fs.writeFile(path.join(outside, "private.html"), "private content");
      file = path.join(root, "escape.html");
      await fs.symlink(path.join(outside, "private.html"), file);
      const response = await request("download");
      expect(response.status).not.toBe(200);
      expect(await response.text()).not.toContain("private content");
    } finally { await fs.rm(outside, { recursive: true, force: true }); }
  });
  it("limits table previews and carries labels and units", async () => {
    file = path.join(root, "values.tsv");
    await fs.writeFile(file, "x\n" + Array.from({ length: 30 }, (_, index) => `${index}\n`).join(""));
    mocks.spec.mockReturnValue({ spec: { tableKind: "custom", format: "tsv", columns: { x: { type: "number", label: "Measured", unit: "reads" } } } });
    const response = await request("table");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ columns: [{ key: "x", label: "Measured", unit: "reads" }], rows: expect.any(Array), truncated: true });
    const data = await (await request("table")).json();
    expect(data.rows).toHaveLength(10);
  });
  it("keeps custom binary formats download-only", async () => {
    file = path.join(root, "unusual.custom");
    await fs.writeFile(file, "data");
    expect((await request("preview")).status).toBe(400);
    const response = await request("download");
    expect(response.status).toBe(200);
    await response.arrayBuffer();
  });
  it("honors disabled previews", async () => {
    mocks.spec.mockReturnValue({ spec: null, output: { result: { preview: { previewable: false } } } });
    expect((await request("preview")).status).toBe(400);
  });
});
