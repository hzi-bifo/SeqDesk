import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(), session: vi.fn(), base: vi.fn(), order: vi.fn(), moduleEnabled: vi.fn(),
  read: vi.fn(), updateMany: vi.fn(), update: vi.fn(), lock: vi.fn(),
}));
vi.mock("next-auth", () => ({ getServerSession: mocks.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/modules/input-modules.server", () => ({ inputModuleEnabled: mocks.moduleEnabled }));
vi.mock("@/lib/files/data-base-path", () => ({ getResolvedDataBasePath: mocks.base }));
vi.mock("@/lib/orders/data-files.server", () => ({
  authorizeDataFiles: mocks.authorize,
  DataFilesError: class DataFilesError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));
vi.mock("@/lib/db", () => ({ db: {
  $transaction: (callback: (tx: unknown) => unknown) => callback({
    $queryRaw: mocks.lock,
    order: { findUnique: mocks.order },
    read: { findFirst: mocks.read, updateMany: mocks.updateMany, update: mocks.update },
  }),
} }));

import { DataFilesError } from "@/lib/orders/data-files.server";
import { PUT } from "./route";

const params = { params: Promise.resolve({ id: "order-1" }) };
const request = (body: unknown = { sampleId: "sample-1", readId: "read-1" }) => new Request(
  "http://localhost/api/orders/order-1/data-files/selection",
  { method: "PUT", body: JSON.stringify(body) }
);
const order = {
  id: "order-1", userId: "requester", dataOrigin: "facility", status: "SUBMITTED", sequencingFilesPublishedAt: null as Date | null,
};
let temp: string;
let storage: string;

describe("facility read-set selection", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-facility-selection-")));
    storage = path.join(temp, "data");
    await fs.mkdir(storage);
    await fs.writeFile(path.join(storage, "sample_R1.fastq"), "@read/1\nACGT\n+\nIIII\n");
    await fs.writeFile(path.join(storage, "sample_R2.fastq"), "@read/2\nTGCA\n+\nIIII\n");
    mocks.session.mockResolvedValue({ user: { id: "operator" } });
    mocks.authorize.mockResolvedValue({ order, canManageFacility: true });
    mocks.base.mockResolvedValue({ dataBasePath: storage });
    mocks.moduleEnabled.mockResolvedValue(true);
    mocks.order.mockResolvedValue({ ...order });
    mocks.read.mockResolvedValue({ id: "read-1", file1: "sample_R1.fastq", file2: "sample_R2.fastq" });
  });
  afterEach(async () => { await fs.rm(temp, { recursive: true, force: true }); });

  it("activates only the requested existing read set and preserves classifications and provenance", async () => {
    expect((await PUT(request(), params)).status).toBe(200);
    expect(mocks.authorize).toHaveBeenCalledWith({ user: { id: "operator" } }, "order-1", true);
    expect(mocks.read).toHaveBeenCalledWith({
      where: { id: "read-1", sampleId: "sample-1", sample: { orderId: "order-1" }, supersededByReadId: null },
      select: { id: true, file1: true, file2: true },
    });
    expect(mocks.updateMany).toHaveBeenCalledExactlyOnceWith({ where: { sampleId: "sample-1", isActive: true }, data: { isActive: false } });
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ where: { id: "read-1" }, data: { isActive: true } });
    expect(mocks.updateMany.mock.invocationCallOrder[0]).toBeLessThan(mocks.update.mock.invocationCallOrder[0]);
  });

  it.each([401, 403])("propagates an authorization denial (%s) without examining files", async status => {
    mocks.authorize.mockRejectedValue(new DataFilesError(status, "Access denied"));
    expect((await PUT(request(), params)).status).toBe(status);
    expect(mocks.base).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rejects file managers without facility management permission", async () => {
    mocks.authorize.mockResolvedValue({ order, canManageFacility: false });
    expect((await PUT(request(), params)).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rejects facility selection when the sequencing management module is disabled", async () => {
    mocks.moduleEnabled.mockResolvedValue(false);
    const response = await PUT(request(), params);
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("Facility sequencing management is disabled for this installation");
    expect(mocks.moduleEnabled).toHaveBeenCalledWith("sequencing-management");
    expect(mocks.base).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("keeps imported read selection in Pipelines", async () => {
    mocks.authorize.mockResolvedValue({ order: { ...order, dataOrigin: "import" }, canManageFacility: true });
    expect((await PUT(request(), params)).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each(["initial", "transaction"])("requires unpublishing an existing delivery at the %s check", async stage => {
    const published = { ...order, sequencingFilesPublishedAt: new Date() };
    if (stage === "initial") mocks.authorize.mockResolvedValue({ order: published, canManageFacility: true });
    else mocks.order.mockResolvedValue(published);
    const response = await PUT(request(), params);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("Unpublish the delivery in Facility processing before changing selected files");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("rejects draft orders and ownership changes before mutation", async () => {
    mocks.order.mockResolvedValue({ ...order, status: "DRAFT" });
    expect((await PUT(request(), params)).status).toBe(409);
    mocks.order.mockResolvedValue({ ...order, userId: "new-owner" });
    expect((await PUT(request(), params)).status).toBe(409);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a foreign, superseded, or empty read set without deactivating existing reads", async () => {
    mocks.read.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "read-1", file1: null });
    expect((await PUT(request(), params)).status).toBe(404);
    expect((await PUT(request(), params)).status).toBe(404);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("requires both paired files to remain available", async () => {
    await fs.rm(path.join(storage, "sample_R2.fastq"));
    expect((await PUT(request(), params)).status).toBe(409);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a stored path that resolves outside the configured storage", async () => {
    await fs.writeFile(path.join(temp, "outside.fastq"), "@read\nACGT\n+\nIIII\n");
    await fs.symlink(path.join(temp, "outside.fastq"), path.join(storage, "escape.fastq"));
    mocks.read.mockResolvedValue({ id: "read-1", file1: "escape.fastq", file2: null });
    expect((await PUT(request(), params)).status).toBe(409);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("does not accept caller-supplied file paths or processing classifications", async () => {
    expect((await PUT(request({ sampleId: "sample-1", readId: "read-1", dataClass: "cleaned", file1: "/tmp/file.fastq" }), params)).status).toBe(400);
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
