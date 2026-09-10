import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), session: vi.fn(), base: vi.fn(), inventory: vi.fn() }));
vi.mock("next-auth", () => ({ getServerSession: mocks.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/files/data-base-path", () => ({ getResolvedDataBasePath: mocks.base }));
vi.mock("@/lib/orders/data-files.server", () => ({
  authorizeDataFiles: mocks.authorize,
  getDataFilesInventory: mocks.inventory,
  DataFilesError: class DataFilesError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

import { DataFilesError } from "@/lib/orders/data-files.server";
import { GET } from "./route";

const params = { params: Promise.resolve({ id: "order-1" }) };
const request = (query = "readId=read-1&mate=1") => new Request(`http://localhost/api/orders/order-1/data-files/download?${query}`);
const first = { name: "sample_R1.fastq", path: "sample_R1.fastq", role: "R1", exists: true };
const second = { name: "sample_R2.fastq", path: "sample_R2.fastq", role: "R2", exists: true };
const report = { name: "QC résumé.html", path: "report.html", exists: true };
const fileInventory = { readSets: [{ id: "read-1", files: [first, second] }], artifacts: [{ id: "report-1", file: report }] };
let temp: string;
let storage: string;

describe("downloads scoped to the Files inventory", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-files-download-")));
    storage = path.join(temp, "data");
    await fs.mkdir(storage);
    await fs.writeFile(path.join(storage, first.path), "@read/1\nACGT\n+\nIIII\n");
    await fs.writeFile(path.join(storage, second.path), "@read/2\nTGCA\n+\nIIII\n");
    await fs.writeFile(path.join(storage, report.path), "<html>QC report</html>");
    mocks.session.mockResolvedValue({ user: { id: "owner" } });
    mocks.authorize.mockResolvedValue({ order: { id: "order-1", dataOrigin: "import" }, canManage: false, canManageFacility: false });
    mocks.base.mockResolvedValue({ dataBasePath: storage });
    mocks.inventory.mockResolvedValue(fileInventory);
  });
  afterEach(async () => { await fs.rm(temp, { recursive: true, force: true }); });

  it("streams imported reads visible to their owner without requiring facility permissions", async () => {
    const response = await GET(request(), params);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("@read/1\nACGT\n+\nIIII\n");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain('attachment; filename="sample_R1.fastq"');
    expect(mocks.authorize).toHaveBeenCalledWith({ user: { id: "owner" } }, "order-1");
    expect(mocks.inventory).toHaveBeenCalledWith(expect.objectContaining({ canManageFacility: false }));
  });

  it("chooses the requested mate, including single-end R1", async () => {
    const response = await GET(request("readId=read-1&mate=2"), params);
    expect(await response.text()).toBe("@read/2\nTGCA\n+\nIIII\n");
    mocks.inventory.mockResolvedValue({ readSets: [{ id: "read-1", files: [{ ...first, role: "single" }] }], artifacts: [] });
    expect(await (await GET(request(), params)).text()).toContain("@read/1");
    expect((await GET(request("readId=read-1&mate=2"), params)).status).toBe(404);
  });

  it("downloads a visible customer report as an attachment with a safe Unicode filename", async () => {
    mocks.authorize.mockResolvedValue({ order: { id: "order-1", dataOrigin: "facility" }, canManage: false });
    const response = await GET(request("artifactId=report-1"), params);
    expect(await response.text()).toBe("<html>QC report</html>");
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toContain("filename*=UTF-8''QC%20r%C3%A9sum%C3%A9.html");
  });

  it.each([401, 403])("propagates ownership/authentication denial (%s) before loading file data", async status => {
    mocks.authorize.mockRejectedValue(new DataFilesError(status, "Access denied"));
    expect((await GET(request(), params)).status).toBe(status);
    expect(mocks.inventory).not.toHaveBeenCalled();
    expect(mocks.base).not.toHaveBeenCalled();
  });

  it("does not download unreleased reads or internal reports omitted from the inventory", async () => {
    mocks.inventory.mockResolvedValue({ readSets: [], artifacts: [] });
    expect((await GET(request(), params)).status).toBe(404);
    expect((await GET(request("artifactId=report-1"), params)).status).toBe(404);
    expect(mocks.base).not.toHaveBeenCalled();
  });

  it("rejects IDs belonging to another collection", async () => {
    expect((await GET(request("readId=foreign-read&mate=1"), params)).status).toBe(404);
    expect((await GET(request("artifactId=foreign-report"), params)).status).toBe(404);
  });

  it("preserves the public-demo download restriction", async () => {
    mocks.session.mockResolvedValue({ user: { id: "owner", isDemo: true } });
    expect((await GET(request(), params)).status).toBe(403);
    expect(mocks.inventory).not.toHaveBeenCalled();
  });

  it("rechecks file existence after loading the inventory", async () => {
    await fs.rm(path.join(storage, first.path));
    expect((await GET(request(), params)).status).toBe(404);
  });

  it("rejects symlink targets outside server storage even for an inventory-visible ID", async () => {
    await fs.writeFile(path.join(temp, "outside.fastq"), "private content");
    await fs.rm(path.join(storage, first.path));
    await fs.symlink(path.join(temp, "outside.fastq"), path.join(storage, first.path));
    expect((await GET(request(), params)).status).toBe(404);
  });

  it.each(["path=/etc/passwd", "readId=read-1&mate=1&path=/etc/passwd", "readId=read-1&mate=1&artifactId=report-1", "readId=read-1&mate=3"])("rejects an invalid or ambiguous selection %s", async query => {
    expect((await GET(request(query), params)).status).toBe(400);
    expect(mocks.inventory).not.toHaveBeenCalled();
  });
});
