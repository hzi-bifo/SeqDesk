import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getLibraryFile, listLibraryFiles, readLibraryFile, stageLibraryFileInputs, validateFileBindings } from "./library";
import { createReport, deleteReport } from "@/lib/explore/reports";
import { createAnalysis, createRevision } from "@/lib/explore/analyses";
import { loadCanvasGraph } from "@/lib/explore/canvas";

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("next-auth", () => ({ getServerSession: mocks.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/explore/module", () => ({ isExploreModuleEnabled: async () => true }));

import { POST as upload } from "@/app/api/files/library/route";
import { GET as download } from "@/app/api/files/library/[id]/route";
import { POST as importTable } from "@/app/api/explore/datasets/import/route";
import { GET as reportFiles, POST as attach, DELETE as detach } from "@/app/api/explore/reports/[id]/files/route";

let root: string;
let userId: string;
let targetKey: string;
let projectId: string;

beforeAll(async () => {
  const database = new URL(process.env.DATABASE_URL ?? "").pathname.slice(1);
  if (database !== "seqdesk_test" && !database.startsWith("seqdesk_files_check_")) {
    throw new Error("File-library integration tests require a SeqDesk test database.");
  }
  root = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-file-library-"));
  vi.stubEnv("SEQDESK_EXPLORE_DIR", root);
  const user = await db.user.create({ data: { email: `files-${Date.now()}@example.test`, password: "test-only", firstName: "Files", lastName: "Test" } });
  userId = user.id;
  const project = await db.exploreProject.create({ data: { name: "File integration", ownerId: user.id } });
  projectId = project.id;
  targetKey = `project:${project.id}`;
  mocks.session.mockResolvedValue({ user: { id: userId, role: "RESEARCHER", isDemo: false } });
});

afterAll(async () => {
  if (targetKey) {
    await db.exploreReport.deleteMany({ where: { targetKey } });
    await db.exploreAnalysis.deleteMany({ where: { targetKey } });
    await db.exploreDataset.deleteMany({ where: { targetKey } });
    await db.managedFile.deleteMany({ where: { targetKey } });
    await db.exploreProject.delete({ where: { id: projectId } });
    await db.user.delete({ where: { id: userId } });
  }
  if (root) await fs.rm(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  await db.$disconnect();
});

async function uploadFile(name: string, bytes: Uint8Array | string) {
  const form = new FormData();
  form.set("targetKey", targetKey);
  form.set("file", new File([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], name));
  const response = await upload(new NextRequest("http://localhost/api/files/library", { method: "POST", body: form }));
  expect(response.status).toBe(201);
  return (await response.json()).file.id as string;
}

describe("original files through uploads, report references and analysis inputs", () => {
  it("preserves and downloads arbitrary binary files, enforcing owner access", async () => {
    const bytes = new Uint8Array([0, 255, 128, 10, 13, 0]);
    const id = await uploadFile("reference.bin", bytes);
    const response = await download(new NextRequest(`http://localhost/api/files/library/${id}?download=1`), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    mocks.session.mockResolvedValueOnce({ user: { id: "another-user", role: "RESEARCHER" } });
    const forbidden = await download(new NextRequest(`http://localhost/api/files/library/${id}`), { params: Promise.resolve({ id }) });
    expect(forbidden.status).toBe(404);
  });

  it("prepares a table from an existing upload and retains the source when its report is deleted", async () => {
    const id = await uploadFile("measurements.csv", "sample,value\nS1,7\nS2,9\n");
    const report = await createReport(targetKey, userId, "Measurements");
    const form = new FormData();
    form.set("fileId", id); form.set("targetKey", targetKey); form.set("reportId", report.id);
    const preview = await importTable(new NextRequest("http://localhost/api/explore/datasets/import?preview=1", { method: "POST", body: form }));
    expect(preview.status).toBe(200);
    expect((await preview.json()).rowCount).toBe(2);
    const imported = await importTable(new NextRequest("http://localhost/api/explore/datasets/import", { method: "POST", body: form }));
    expect(imported.status).toBe(201);
    const payload = await imported.json();
    expect(await db.exploreDataset.findUnique({ where: { id: payload.dataset.id } })).toMatchObject({ sourceFileId: id });
    expect((await listLibraryFiles(targetKey)).find((file) => file.id === id)).toMatchObject({
      datasets: [{ id: payload.dataset.id, name: "measurements" }], reports: [{ id: report.id, title: "Measurements" }],
    });
    const canvas = await loadCanvasGraph(targetKey, report.id);
    expect(canvas.edges).toContainEqual(expect.objectContaining({ source: `file:${id}`, target: `dataset:${payload.dataset.id}` }));
    await db.exploreReportFile.deleteMany({ where: { reportId: report.id } });
    await db.exploreReport.update({ where: { id: report.id }, data: { blocks: [{ id: "table-block", type: "table", datasetId: payload.dataset.id }] } });
    expect((await listLibraryFiles(targetKey)).find((file) => file.id === id)?.reports).toEqual([{ id: report.id, title: "Measurements", attached: false, usedInReport: true }]);
    await deleteReport(report.id);
    expect(await getLibraryFile(id)).toMatchObject({ id });
    expect((await listLibraryFiles(targetKey)).find((file) => file.id === id)?.reports).toEqual([]);
  });

  it("attaches a reference idempotently and rejects files from another scope", async () => {
    const id = await uploadFile("protocol.pdf", "%PDF-reference");
    const report = await createReport(targetKey, userId, "References");
    for (let i = 0; i < 2; i++) {
      const response = await attach(new NextRequest("http://localhost/api/explore/reports/r/files", { method: "POST", body: JSON.stringify({ fileId: id }) }), { params: Promise.resolve({ id: report.id }) });
      expect(response.status).toBe(200);
    }
    expect(await db.exploreReportFile.count({ where: { reportId: report.id } })).toBe(1);
    await expect(validateFileBindings([{ alias: "source", fileId: id }], "project:other")).rejects.toMatchObject({ status: 400 });
  });

  it("copies exact file inputs into runs and refuses unsafe aliases or changed originals", async () => {
    const id = await uploadFile("input.json", '{"answer":42}');
    const runFolder = path.join(root, "run");
    const staged = await stageLibraryFileInputs(runFolder, targetKey, [{ alias: "source", fileId: id }]);
    expect(JSON.parse(await fs.readFile(path.join(runFolder, staged.source.path), "utf8"))).toEqual({ answer: 42 });
    await fs.writeFile(path.join(runFolder, staged.source.path), "changed by analysis");
    const file = await getLibraryFile(id);
    expect((await readLibraryFile(file)).toString()).toBe('{"answer":42}');
    await expect(stageLibraryFileInputs(runFolder, targetKey, [{ alias: "../../escape", fileId: id }])).rejects.toMatchObject({ status: 400 });
    await fs.writeFile(path.join(root, "imports", "files", file.storagePath), "changed original");
    await expect(readLibraryFile(file)).rejects.toMatchObject({ status: 409 });
  });

  it("keeps file bindings across revisions and shows their report and canvas connections", async () => {
    const id = await uploadFile("reference.json", '{"threshold":7}');
    const report = await createReport(targetKey, userId, "Custom analysis");
    const analysis = await createAnalysis({ targetKey, reportId: report.id, inputs: [], fileInputs: [{ alias: "reference", fileId: id }], createdById: userId });
    const createdRevision = await db.exploreAnalysisRevision.findUniqueOrThrow({ where: { id: analysis.currentRevision!.id } });
    expect(createdRevision.code).toContain('file_path("reference")');
    expect(analysis.currentRevision?.fileInputs).toEqual([{ alias: "reference", fileId: id }]);
    const revision = await createRevision({ analysisId: analysis.id, code: "print('updated')", author: "user", authorUserId: userId });
    expect(revision.fileInputs).toEqual([{ alias: "reference", fileId: id }]);
    expect((await listLibraryFiles(targetKey)).find((file) => file.id === id)?.reports).toEqual([{ id: report.id, title: "Custom analysis", attached: false, usedInReport: true }]);
    const graph = await loadCanvasGraph(targetKey, report.id);
    expect(graph.nodes).toContainEqual(expect.objectContaining({ id: `file:${id}`, data: expect.objectContaining({ label: "reference.json", kind: "source" }) }));
    expect(graph.edges).toContainEqual(expect.objectContaining({ source: `file:${id}`, target: `analysis:${analysis.id}`, label: "reference" }));
  });

  it("rejects binary-to-table conversion without creating a dataset", async () => {
    const id = await uploadFile("photo.png", new Uint8Array([137, 80, 78, 71, 0]));
    const count = await db.exploreDataset.count({ where: { targetKey } });
    const form = new FormData(); form.set("fileId", id); form.set("targetKey", targetKey);
    const response = await importTable(new NextRequest("http://localhost/api/explore/datasets/import", { method: "POST", body: form }));
    expect(response.status).toBe(400);
    expect(await db.exploreDataset.count({ where: { targetKey } })).toBe(count);
  });

  it("explains why removing an attachment keeps a file that an analysis still uses", async () => {
    const fileId = await uploadFile("analysis-reference.txt", "reference");
    const report = await createReport(targetKey, userId, "Referenced input");
    await createAnalysis({ targetKey, reportId: report.id, inputs: [], fileInputs: [{ alias: "source", fileId }], createdById: userId });
    const context = { params: Promise.resolve({ id: report.id }) };
    const url = `http://localhost/api/explore/reports/${report.id}/files`;
    await attach(new NextRequest(url, { method: "POST", body: JSON.stringify({ fileId }) }), context);
    const before = await reportFiles(new NextRequest(url), context);
    expect((await before.json()).files).toEqual([expect.objectContaining({ id: fileId, attached: true, usedInReport: true })]);
    const removed = await detach(new NextRequest(`${url}?fileId=${fileId}`, { method: "DELETE" }), context);
    expect(removed.status).toBe(200);
    const after = await reportFiles(new NextRequest(url), context);
    expect((await after.json()).files).toEqual([expect.objectContaining({ id: fileId, attached: false, usedInReport: true })]);
  });

  it("honors an explicitly cleared suggested column role", async () => {
    const fileId = await uploadFile("role-mapping.csv", "sample,value\nS1,7\n");
    const form = new FormData(); form.set("fileId", fileId); form.set("targetKey", targetKey); form.set("roles", JSON.stringify({ sample: "" }));
    const response = await importTable(new NextRequest("http://localhost/api/explore/datasets/import", { method: "POST", body: form }));
    expect(response.status).toBe(201);
    const dataset = (await response.json()).dataset;
    expect(dataset.roles.sample).toBeUndefined();
  });

  it("keeps compound extensions and separates same-name analysis inputs", async () => {
    const first = await uploadFile("reads.fasta.gz", new Uint8Array([31, 139, 8, 0]));
    const second = await uploadFile("reads.fasta.gz", new Uint8Array([31, 139, 8, 1]));
    const folder = path.join(root, "compound-inputs");
    const staged = await stageLibraryFileInputs(folder, targetKey, [{ alias: "first", fileId: first }, { alias: "second", fileId: second }]);
    expect(path.basename(staged.first.path)).toBe("reads.fasta.gz");
    expect(path.basename(staged.second.path)).toBe("reads.fasta.gz");
    expect(staged.first.path).not.toBe(staged.second.path);
    expect(await fs.readFile(path.join(folder, staged.first.path))).toEqual(Buffer.from([31, 139, 8, 0]));
    expect(await fs.readFile(path.join(folder, staged.second.path))).toEqual(Buffer.from([31, 139, 8, 1]));
  });
});
