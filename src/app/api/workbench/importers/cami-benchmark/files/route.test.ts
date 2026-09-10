import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ session: vi.fn(), module: vi.fn(), fileInfo: vi.fn() }));
vi.mock("next-auth", () => ({ getServerSession: mocks.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/modules/input-modules.server", () => ({ requireRawReadImporter: mocks.module }));
// Stub SeqDesk's internal file-information contract, not the external source.
vi.mock("@/lib/workbench/cami-file-info.server", () => ({ getCamiSampleFileInfo: mocks.fileInfo }));
import { GET } from "./route";
const request = (query = "dataset=cami2-marine&technology=short") => new NextRequest("http://localhost/api/workbench/importers/cami-benchmark/files?" + query);

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SEQDESK_DEPLOYMENT_PROFILE", "research-workbench");
  mocks.session.mockResolvedValue({ user: { id: "owner", role: "RESEARCHER" } });
  mocks.fileInfo.mockResolvedValue([{ sample: 0, downloadBytes: 123 }, { sample: 1, downloadBytes: null }]);
});
afterEach(() => vi.unstubAllEnvs());

it("returns per-sample source sizes, preserving unknown sizes without making up values", async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ files: [{ sample: 0, downloadBytes: 123 }, { sample: 1, downloadBytes: null }] });
  expect(mocks.fileInfo).toHaveBeenCalledWith({ dataset: "cami2-marine", technology: "short" });
});
it("requires login before inspecting source headers", async () => {
  mocks.session.mockResolvedValue(null);
  expect((await GET(request())).status).toBe(401);
  expect(mocks.fileInfo).not.toHaveBeenCalled();
});
it("respects disabled import modules", async () => {
  mocks.module.mockRejectedValue(new Error("disabled"));
  expect((await GET(request())).status).toBe(403);
  expect(mocks.fileInfo).not.toHaveBeenCalled();
});
it.each(["", "dataset=other&technology=short", "dataset=cami2-marine&technology=assembly", "dataset=cami2-marine&technology=short&url=http://localhost/private", "dataset=cami2-marine&technology=short&sample=1000"])("rejects unsupported selections or arbitrary URLs: %s", async query => {
  expect((await GET(request(query))).status).toBe(400);
  expect(mocks.fileInfo).not.toHaveBeenCalled();
});
it("returns a controlled error when metadata lookup fails", async () => {
  mocks.fileInfo.mockRejectedValue(new Error("Internal details"));
  const response = await GET(request());
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "Could not check CAMI file sizes" });
});
