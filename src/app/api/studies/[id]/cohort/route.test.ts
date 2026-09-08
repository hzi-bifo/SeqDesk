import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  db: {
    study: { findFirst: vi.fn() },
    sample: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    studySample: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  },
}));
vi.mock("next-auth", () => ({ getServerSession: mocks.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));

import { GET, POST, DELETE } from "./route";
const params = { params: Promise.resolve({ id: "comparison" }) };
const url = "http://localhost/api/studies/comparison/cohort";
const request = (body: unknown) => new NextRequest(url, { method: "POST", body: JSON.stringify(body) });

describe("study-specific sample membership", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.SEQDESK_DEPLOYMENT_PROFILE = "sequencing-center";
    mocks.session.mockResolvedValue({ user: { id: "owner", role: "RESEARCHER" } });
    mocks.db.study.findFirst.mockResolvedValue({ id: "comparison" });
    mocks.db.sample.findFirst.mockResolvedValue({ id: "sample" });
    mocks.db.studySample.findMany.mockResolvedValue([]);
    mocks.db.studySample.upsert.mockResolvedValue({ sampleId: "sample", role: "control" });
  });
  it("requires authentication", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await GET(new NextRequest(url), params)).status).toBe(404);
    expect(mocks.db.studySample.findMany).not.toHaveBeenCalled();
  });
  it("scopes both study and returned samples", async () => {
    expect((await GET(new NextRequest(url), params)).status).toBe(200);
    expect(mocks.db.study.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "comparison", userId: "owner" } }));
    expect(mocks.db.studySample.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { studyId: "comparison", sample: { OR: [{ order: { userId: "owner" } }, { orderId: null, study: { userId: "owner" } }] } } }));
  });
  it("adds a role without moving the primary sample or modifying its files", async () => {
    expect((await POST(request({ sampleId: "sample", role: "control", groupLabel: "External controls" }), params)).status).toBe(200);
    expect(mocks.db.study.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "comparison", userId: "owner", submitted: false } }));
    expect(mocks.db.sample.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "sample", OR: [{ order: { userId: "owner" } }, { orderId: null, study: { userId: "owner" } }] } }));
    expect(mocks.db.studySample.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { studyId: "comparison", sampleId: "sample", role: "control", groupLabel: "External controls" } }));
    expect(mocks.db.sample.update).not.toHaveBeenCalled();
  });
  it.each(["submitted", "inaccessible"])("rejects a %s study", async () => {
    mocks.db.study.findFirst.mockResolvedValue(null);
    expect((await POST(request({ sampleId: "sample" }), params)).status).toBe(404);
    expect(mocks.db.studySample.upsert).not.toHaveBeenCalled();
  });
  it("rejects an inaccessible sample", async () => {
    mocks.db.sample.findFirst.mockResolvedValue(null);
    expect((await POST(request({ sampleId: "sample" }), params)).status).toBe(404);
    expect(mocks.db.studySample.upsert).not.toHaveBeenCalled();
  });
  it.each([{ sampleId: "sample", role: "admin" }, { sampleId: "sample", userId: "someone-else" }, { sampleId: "sample", groupLabel: "x".repeat(121) }])("rejects invalid/extra membership fields", async (input) => {
    expect((await POST(request(input), params)).status).toBe(400);
    expect(mocks.db.studySample.upsert).not.toHaveBeenCalled();
  });
  it("unlinking only removes the scoped relationship", async () => {
    expect((await DELETE(new NextRequest(`${url}?sampleId=sample`, { method: "DELETE" }), params)).status).toBe(200);
    expect(mocks.db.studySample.deleteMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ studyId: "comparison", sampleId: "sample", sample: expect.any(Object) }) }));
    expect(mocks.db.sample.delete).not.toHaveBeenCalled();
    expect(mocks.db.sample.update).not.toHaveBeenCalled();
  });
});
