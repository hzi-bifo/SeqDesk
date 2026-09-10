import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ session: vi.fn(), enabled: vi.fn(), access: vi.fn(), report: vi.fn(), create: vi.fn(), list: vi.fn(), append: vi.fn(), start: vi.fn() }));
vi.mock("next-auth", () => ({ getServerSession: mocks.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/explore/module", () => ({ isExploreModuleEnabled: mocks.enabled }));
vi.mock("@/lib/explore/authorization", async () => ({ ...await vi.importActual<typeof import("@/lib/explore/authorization")>("@/lib/explore/authorization"), requireTargetAccess: mocks.access }));
vi.mock("@/lib/explore/report-generation-service", () => ({ requireGenerationReport: mocks.report, createReportGeneration: mocks.create, listReportGenerations: mocks.list, appendReportGeneration: mocks.append, startReportGeneration: mocks.start }));
import { GET, POST } from "./route";
import { POST as ACTION } from "./[analysisId]/route";
import { ExploreReportError } from "@/lib/explore/reports";
import { ExploreAuthorizationError } from "@/lib/explore/authorization";
const request = (body: unknown = {}) => new NextRequest("http://localhost/api/explore/reports/r1/generations", { method: "POST", body: JSON.stringify(body) });
const context = { params: Promise.resolve({ id: "r1" }) };
const actionContext = { params: Promise.resolve({ id: "r1", analysisId: "a1" }) };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockResolvedValue(true);
  mocks.session.mockResolvedValue({ user: { id: "u1", role: "FACILITY_ADMIN" } });
  mocks.access.mockResolvedValue({ type: "order", id: "o1" });
  mocks.report.mockResolvedValue({ id: "r1", targetKey: "order:o1", updatedAt: new Date("2026-09-09") });
  mocks.list.mockResolvedValue([]);
  mocks.create.mockResolvedValue({ analysisId: "a1", run: { status: "running" } });
  mocks.append.mockResolvedValue({ added: 1 });
  mocks.start.mockResolvedValue({ analysisId: "a1" });
});
describe("report generation API permissions and explicit actions", () => {
  it("loads progress with read access and never starts work from GET", async () => {
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.access).toHaveBeenCalledWith(expect.anything(), "order:o1", "read");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("uses the report's scope and authenticated author, not caller overrides", async () => {
    const response = await POST(request({ requestId: "test", targetKey: "order:foreign", userId: "other" }), context);
    expect(response.status).toBe(201);
    expect(mocks.access).toHaveBeenCalledWith(expect.anything(), "order:o1", "write");
    expect(mocks.create).toHaveBeenCalledWith("r1", "u1", expect.anything());
  });
  it("requires write access for starting and appending, and rejects unknown actions", async () => {
    expect((await ACTION(request({ action: "start" }), actionContext)).status).toBe(200);
    expect((await ACTION(request({ action: "add", itemIds: ["item1"], expectedUpdatedAt: "date" }), actionContext)).status).toBe(200);
    expect(mocks.access.mock.calls.every(call => call[2] === "write")).toBe(true);
    expect((await ACTION(request({ action: "delete" }), actionContext)).status).toBe(400);
  });
  it("rejects expired sessions before reading reports or creating anything", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await POST(request(), context)).status).toBe(401);
    expect((await GET(request(), context)).status).toBe(401);
    expect(mocks.report).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects disabled modules and unauthorized scopes", async () => {
    mocks.enabled.mockResolvedValue(false);
    expect((await POST(request(), context)).status).toBe(404);
    mocks.enabled.mockResolvedValue(true);
    mocks.access.mockRejectedValue(new ExploreAuthorizationError(404, "Not found"));
    expect((await ACTION(request({ action: "add" }), actionContext)).status).toBe(404);
    expect(mocks.append).not.toHaveBeenCalled();
  });
  it("returns actionable conflicts instead of generic 500 errors", async () => {
    mocks.append.mockRejectedValue(new ExploreReportError(409, "The report changed in another tab."));
    const response = await ACTION(request({ action: "add" }), actionContext);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "The report changed in another tab." });
  });
});
