// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Session } from "next-auth";
import { getDeploymentProfileDefinition } from "@/lib/deployment-profile";

const mocks = vi.hoisted(() => ({
  profile: vi.fn(), base: vi.fn(), minknow: vi.fn(), module: vi.fn(),
  db: {
    order: { findUnique: vi.fn() }, sample: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    read: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    sequencingArtifact: { findMany: vi.fn() }, streamRun: { findMany: vi.fn() },
    workbenchWorkspaceDataset: { findMany: vi.fn() }, $queryRaw: vi.fn(), $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/deployment-profile/server", () => ({ getServerDeploymentProfile: mocks.profile }));
vi.mock("@/lib/files/data-base-path", () => ({ getResolvedDataBasePath: mocks.base }));
vi.mock("@/lib/minknow/config", () => ({ loadMinknowConfig: mocks.minknow }));
vi.mock("@/lib/modules/input-modules.server", () => ({ inputModuleEnabled: mocks.module }));

import { addDataFilesReadSet, authorizeDataFiles, DATA_FILES_UPLOAD_LIMIT, getDataFilesInventory, listDataFilesStorage, uploadDataFiles } from "./data-files.server";

const member = { user: { id: "owner", role: "RESEARCHER", authorizationValid: true }, expires: "2099-01-01" } as Session;
const admin = { user: { id: "owner", role: "FACILITY_ADMIN", authorizationValid: true }, expires: "2099-01-01" } as Session;
const importedOrder = { id: "collection", userId: "owner", name: "Data", dataOrigin: "import", status: "COMPLETED", sourceMetadata: null, sequencingFilesPublishedAt: null };
const fastq = (name = "read", mate = 1, sequence = "ACGT") => `@${name}/${mate}\n${sequence}\n+\n${"I".repeat(sequence.length)}\n`;

describe("neutral collection file operations", () => {
  let base: string;
  let ownRoot: string;
  beforeEach(async () => {
    vi.resetAllMocks();
    base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-data-files-")));
    ownRoot = path.join("_uploads", "orders", "collection");
    await fs.mkdir(path.join(base, ownRoot), { recursive: true });
    mocks.profile.mockReturnValue(getDeploymentProfileDefinition("research-workbench"));
    mocks.base.mockResolvedValue({ dataBasePath: base });
    mocks.db.order.findUnique.mockResolvedValue(importedOrder);
    mocks.db.sample.findMany.mockResolvedValue([]);
    mocks.db.sample.findFirst.mockResolvedValue({ id: "sample" });
    mocks.db.sample.create.mockResolvedValue({ id: "new-sample" });
    mocks.db.read.findFirst.mockResolvedValue(null);
    mocks.db.read.findUnique.mockResolvedValue(null);
    mocks.db.read.create.mockResolvedValue({ id: "new-read" });
    mocks.db.sequencingArtifact.findMany.mockResolvedValue([]);
    mocks.db.streamRun.findMany.mockResolvedValue([]);
    mocks.db.workbenchWorkspaceDataset.findMany.mockResolvedValue([]);
    mocks.db.$transaction.mockImplementation(callback => callback(mocks.db));
    mocks.minknow.mockResolvedValue({ enabled: false, outputRoot: "" });
    mocks.module.mockResolvedValue(true);
  });
  afterEach(async () => { await fs.rm(base, { recursive: true, force: true }); });
  async function put(name: string, content = fastq()) {
    const relative = path.join(ownRoot, name);
    await fs.writeFile(path.join(base, relative), content);
    return relative;
  }

  it("rejects invalid sessions and foreign collection owners before accessing files", async () => {
    await expect(authorizeDataFiles(null, "collection")).rejects.toMatchObject({ status: 401 });
    await expect(authorizeDataFiles({ ...member, user: { ...member.user, authorizationValid: false } }, "collection")).rejects.toMatchObject({ status: 401 });
    mocks.db.order.findUnique.mockResolvedValue({ ...importedOrder, userId: "other" });
    await expect(authorizeDataFiles(member, "collection", true)).rejects.toMatchObject({ status: 403 });
    expect(mocks.base).not.toHaveBeenCalled();
  });

  it("allows import owners, refuses facility requesters and demo writes", async () => {
    expect((await authorizeDataFiles(member, "collection", true)).canManage).toBe(true);
    await expect(authorizeDataFiles({ ...member, user: { ...member.user, isDemo: true } }, "collection", true)).rejects.toMatchObject({ status: 403 });
    mocks.profile.mockReturnValue(getDeploymentProfileDefinition("sequencing-center"));
    mocks.db.order.findUnique.mockResolvedValue({ ...importedOrder, dataOrigin: "facility" });
    await expect(authorizeDataFiles(member, "collection", true)).rejects.toMatchObject({ status: 403 });
    expect((await authorizeDataFiles(admin, "collection", true)).canManage).toBe(true);
  });

  it("creates an independent inactive read set and preserves the existing selection and provenance", async () => {
    const read1 = await put("sample_R1.fastq"), read2 = await put("sample_R2.fastq", fastq("read", 2));
    const result = await addDataFilesReadSet(await authorizeDataFiles(member, "collection", true), { sampleId: "sample", read1, read2 });
    expect(result).toEqual({ readId: "new-read", sampleId: "sample" });
    expect(mocks.db.read.update).not.toHaveBeenCalled();
    expect(mocks.db.read.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sampleId: "sample", isActive: false, dataClass: "unknown", file1: read1, file2: read2, readCount1: 1, readCount2: 1 }) }));
    const metadata = JSON.parse(mocks.db.read.create.mock.calls[0][0].data.pipelineSources);
    expect(metadata).toMatchObject({ sourceType: "local_files", linkedById: "owner", processing: { effectiveState: "unknown" } });
    expect(mocks.db.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("hides disabled facility operations while retaining ordinary import-owner file management", async () => {
    mocks.profile.mockReturnValue(getDeploymentProfileDefinition("sequencing-center"));
    mocks.module.mockResolvedValue(false);
    const imported = await authorizeDataFiles(admin, "collection", true);
    expect(imported.canManage).toBe(true);
    expect(imported.canManageFacility).toBe(false);
    mocks.db.order.findUnique.mockResolvedValue({ ...importedOrder, dataOrigin: "facility" });
    const facility = await authorizeDataFiles(admin, "collection");
    expect(facility.canManageFacility).toBe(false);
    expect(facility.canManage).toBe(false);
    await expect(authorizeDataFiles(admin, "collection", true)).rejects.toMatchObject({ status: 403 });
  });

  it("validates pairing and file existence before writing a sample or read", async () => {
    const access = await authorizeDataFiles(member, "collection", true);
    const read1 = await put("R1.fastq"), mismatch = await put("R2.fastq", fastq("different", 2));
    await expect(addDataFilesReadSet(access, { newSample: { sampleId: "NEW" }, read1, read2: mismatch })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("mismatched") });
    await expect(addDataFilesReadSet(access, { sampleId: "sample", read1, read2: read1 })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("different files") });
    await expect(addDataFilesReadSet(access, { sampleId: "sample", read1: path.join(ownRoot, "missing.fastq") })).rejects.toMatchObject({ status: 404 });
    expect(mocks.db.sample.create).not.toHaveBeenCalled();
    expect(mocks.db.read.create).not.toHaveBeenCalled();
  });

  it("allows distinct mate files with identical sequence content but rejects hard links to the same file", async () => {
    const access = await authorizeDataFiles(member, "collection", true);
    const read1 = await put("same_R1.fastq"), read2 = await put("same_R2.fastq");
    await expect(addDataFilesReadSet(access, { sampleId: "sample", read1, read2 })).resolves.toMatchObject({ readId: "new-read" });
    const hardlink = path.join(ownRoot, "alias_R2.fastq");
    await fs.link(path.join(base, read1), path.join(base, hardlink));
    await expect(addDataFilesReadSet(access, { sampleId: "sample", read1, read2: hardlink })).rejects.toMatchObject({ status: 400 });
  });

  it("rejects malformed FASTQ, unsupported extensions and processing claims without evidence", async () => {
    const access = await authorizeDataFiles(member, "collection", true);
    const read1 = await put("bad.fastq", "not a FASTQ\n");
    await expect(addDataFilesReadSet(access, { sampleId: "sample", read1 })).rejects.toMatchObject({ status: 400 });
    await expect(addDataFilesReadSet(access, { sampleId: "sample", read1: "report.txt" })).rejects.toMatchObject({ status: 400 });
    await expect(addDataFilesReadSet(access, { sampleId: "sample", read1, processing: "cleaned" })).rejects.toMatchObject({ status: 400 });
    expect(mocks.db.read.create).not.toHaveBeenCalled();
  });

  it("creates a new imported sample and its read inside one transaction", async () => {
    mocks.db.sample.findFirst.mockResolvedValue(null);
    const read1 = await put("reads.fastq");
    const result = await addDataFilesReadSet(await authorizeDataFiles(member, "collection", true), { newSample: { sampleId: "NEW", sampleTitle: "New specimen" }, read1, processing: "unprocessed", processingNote: "Direct instrument output" });
    expect(result.sampleId).toBe("new-sample");
    expect(mocks.db.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.db.sample.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sampleId: "NEW", orderId: "collection", facilityStatus: "NOT_APPLICABLE" }) }));
    expect(mocks.db.read.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sampleId: "new-sample", dataClass: "raw", isActive: false }) }));
  });

  it("refuses samples from another collection and existing file associations", async () => {
    const access = await authorizeDataFiles(member, "collection", true), read1 = await put("reads.fastq");
    mocks.db.sample.findFirst.mockResolvedValue(null);
    await expect(addDataFilesReadSet(access, { sampleId: "foreign", read1 })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("does not belong") });
    mocks.db.read.findFirst.mockResolvedValue({ id: "already-linked" });
    await expect(addDataFilesReadSet(access, { newSample: { sampleId: "NEW" }, read1 })).rejects.toMatchObject({ status: 409 });
    expect(mocks.db.sample.create).not.toHaveBeenCalled();
    expect(mocks.db.read.create).not.toHaveBeenCalled();
  });

  it("keeps all linked read sets visible, including inactive imported sets and missing files", async () => {
    const read1 = await put("available.fastq");
    mocks.db.sample.findMany.mockResolvedValue([{ id: "sample", sampleId: "S1", sampleTitle: null, reads: [
      { id: "raw", file1: read1, file2: null, isActive: false, dataClass: "raw", dataClassSource: "external_import", pipelineSources: '{"sourceType":"ena-fastq-accession","processing":{"effectiveState":"unknown"}}', runAccessionNumber: "ERR123" },
      { id: "clean", file1: path.join(ownRoot, "missing.fastq"), file2: null, isActive: true, dataClass: "cleaned", dataClassSource: "pipeline", pipelineSources: null, runAccessionNumber: null },
    ] }]);
    const inventory = await getDataFilesInventory(await authorizeDataFiles(member, "collection"));
    expect(inventory.readSets).toHaveLength(2);
    expect(inventory.readSets[0]).toMatchObject({ id: "raw", isActive: false, source: "ena-fastq-accession", processing: "unprocessed", files: [expect.objectContaining({ exists: true })] });
    expect(inventory.readSets[1].files[0].exists).toBe(false);
    expect(mocks.db.sample.findMany.mock.calls[0][0].include.reads.where).toBeUndefined();
  });

  it("shows the current classification while retaining original source evidence and supersession", async () => {
    const read1 = await put("reclassified.fastq");
    mocks.db.sample.findMany.mockResolvedValue([{ id: "sample", sampleId: "S1", sampleTitle: null, reads: [
      { id: "reclassified", file1: read1, file2: null, isActive: false, dataClass: "cleaned", dataClassSource: "manual", supersededByReadId: "successor",
        pipelineSources: '{"sourceType":"local_files","processing":{"effectiveState":"unknown"}}', runAccessionNumber: null },
    ] }]);
    const inventory = await getDataFilesInventory(await authorizeDataFiles(member, "collection"));
    expect(inventory.readSets[0]).toMatchObject({ processing: "cleaned", supersededByReadId: "successor", metadata: { processing: { effectiveState: "unknown" } } });
  });

  it("preserves facility publication restrictions and excludes stream chunks for requesters", async () => {
    mocks.profile.mockReturnValue(getDeploymentProfileDefinition("sequencing-center"));
    mocks.db.order.findUnique.mockResolvedValue({ ...importedOrder, dataOrigin: "facility", sequencingFilesPublishedAt: new Date() });
    await getDataFilesInventory(await authorizeDataFiles(member, "collection"));
    expect(mocks.db.sample.findMany.mock.calls[0][0].include.reads.where).toEqual({ isActive: true, dataClass: "cleaned" });
    expect(mocks.db.sequencingArtifact.findMany.mock.calls[0][0].where.visibility).toBe("customer");
    expect(mocks.db.streamRun.findMany).not.toHaveBeenCalled();
    mocks.db.order.findUnique.mockResolvedValue({ ...importedOrder, dataOrigin: "facility" });
    await getDataFilesInventory(await authorizeDataFiles(member, "collection"));
    expect(mocks.db.sample.findMany.mock.calls[1][0].include.reads.where).toEqual({ id: "__unreleased__" });
  });

  it("confines members to their upload root and linked datasets, including symlinks", async () => {
    await put("mine.fastq");
    await fs.mkdir(path.join(base, "other"));
    await fs.writeFile(path.join(base, "other", "private.fastq"), fastq());
    await fs.symlink(path.join(base, "other"), path.join(base, ownRoot, "escape"));
    const access = await authorizeDataFiles(member, "collection", true);
    const listing = await listDataFilesStorage(access);
    expect(listing.entries.map(file => file.name)).toEqual(["mine.fastq"]);
    // The picker sends an empty path on first open; members start in their own root.
    expect(await listDataFilesStorage(access, "")).toEqual(listing);
    await expect(listDataFilesStorage(access, "other")).rejects.toMatchObject({ status: 403 });
    await expect(listDataFilesStorage(access, path.join(ownRoot, "escape"))).rejects.toMatchObject({ status: 403 });
    await expect(addDataFilesReadSet(access, { sampleId: "sample", read1: path.join(ownRoot, "escape", "private.fastq") })).rejects.toMatchObject({ status: 403 });
    await expect(addDataFilesReadSet(access, { sampleId: "sample", read1: "../../private.fastq" })).rejects.toMatchObject({ status: 403 });
    expect(mocks.db.workbenchWorkspaceDataset.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workspace: { ownerId: "owner" } } }));
  });

  it("allows installation admins to link existing files under the configured base in Workbench", async () => {
    await fs.writeFile(path.join(base, "local.fastq"), fastq());
    const access = await authorizeDataFiles(admin, "collection", true);
    expect(access.browseAll).toBe(true);
    expect((await listDataFilesStorage(access)).entries.some(file => file.name === "local.fastq")).toBe(true);
    await expect(addDataFilesReadSet(access, { sampleId: "sample", read1: "local.fastq" })).resolves.toEqual({ readId: "new-read", sampleId: "sample" });
  });

  it("validates and persists an actual multipart upload and removes failed uploads", async () => {
    const access = await authorizeDataFiles(member, "collection", true);
    const form = new FormData();
    form.set("sampleId", "sample");
    form.set("file1", new File([fastq()], "uploaded.fastq"));
    expect(await uploadDataFiles(access, new Request("http://localhost/upload", { method: "POST", body: form }))).toEqual({ readId: "new-read", sampleId: "sample" });
    const stored = mocks.db.read.create.mock.calls[0][0].data.file1;
    expect(await fs.readFile(path.join(base, stored), "utf8")).toBe(fastq());
    expect(JSON.parse(mocks.db.read.create.mock.calls[0][0].data.pipelineSources).sourceType).toBe("upload");
    const before = await fs.readdir(path.join(base, ownRoot, "linked"));
    const bad = new FormData(); bad.set("sampleId", "sample"); bad.set("file1", new File(["invalid FASTQ"], "bad.fastq"));
    await expect(uploadDataFiles(access, new Request("http://localhost/upload", { method: "POST", body: bad }))).rejects.toMatchObject({ status: 400 });
    expect(await fs.readdir(path.join(base, ownRoot, "linked"))).toEqual(before);
  });

  it("rejects oversized uploads before reading the request body", async () => {
    const request = new Request("http://localhost/upload", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=test", "content-length": String(DATA_FILES_UPLOAD_LIMIT * 2) }, body: "no body read" });
    await expect(uploadDataFiles(await authorizeDataFiles(member, "collection", true), request)).rejects.toMatchObject({ status: 413 });
    expect(request.bodyUsed).toBe(false);
  });

  it("replays acknowledged uploads safely, cleans staged retries, and rejects a changed payload for the same request", async () => {
    const access = await authorizeDataFiles(member, "collection", true);
    const requestId = randomUUID();
    const saved = new Map<string, { id: string; sampleId: string; pipelineSources: string; sample: { orderId: string } }>();
    mocks.db.read.findUnique.mockImplementation(({ where }: { where: { id: string } }) => saved.get(where.id) ?? null);
    mocks.db.read.create.mockImplementation(({ data }: { data: { id: string; sampleId: string; pipelineSources: string } }) => {
      saved.set(data.id, { ...data, sample: { orderId: "collection" } });
      return { id: data.id };
    });
    function request(key = requestId, contents = fastq()) {
      const form = new FormData(); form.set("sampleId", "sample"); form.set("requestId", key);
      form.set("file1", new File([contents], "retry.fastq"));
      return new Request("http://localhost/upload", { method: "POST", body: form });
    }
    const first = await uploadDataFiles(access, request());
    const folders = await fs.readdir(path.join(base, ownRoot, "linked"));
    expect(await uploadDataFiles(access, request())).toEqual(first);
    expect(mocks.db.read.create).toHaveBeenCalledTimes(1);
    expect(await fs.readdir(path.join(base, ownRoot, "linked"))).toEqual(folders);
    await expect(uploadDataFiles(access, request(requestId, fastq("changed")))).rejects.toMatchObject({ status: 409 });
    expect(await fs.readdir(path.join(base, ownRoot, "linked"))).toEqual(folders);
    expect(await uploadDataFiles(access, request(randomUUID()))).not.toEqual(first);
    expect(mocks.db.read.create).toHaveBeenCalledTimes(2);
  });
});
