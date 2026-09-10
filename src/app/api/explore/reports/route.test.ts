import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(), isExploreModuleEnabled: vi.fn(),
  listReports: vi.fn(), study: vi.fn(), order: vi.fn(),
}));
vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/explore/module", () => ({ isExploreModuleEnabled: mocks.isExploreModuleEnabled }));
vi.mock("@/lib/db", () => ({ db: {
  study: { findUnique: mocks.study }, order: { findUnique: mocks.order },
} }));
vi.mock("@/lib/explore/reports", () => ({
  listReports: mocks.listReports, createReport: vi.fn(),
  ExploreReportError: class extends Error { status = 400; },
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getServerSession.mockResolvedValue({ user: { id: "owner", role: "RESEARCHER", isDemo: false } });
  mocks.isExploreModuleEnabled.mockResolvedValue(true);
  mocks.study.mockResolvedValue({ userId: "owner" });
  mocks.order.mockResolvedValue({ userId: "owner" });
  mocks.listReports.mockResolvedValue([{ id: "report-1", title: "Report" }]);
});

describe("report list action permissions", () => {
  it.each(["study:s1", "order:o1"])("allows the owner to manage reports in %s", async (scope) => {
    const response = await GET(new NextRequest(`http://localhost/api/explore/reports?targetKey=${scope}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reports: [{ id: "report-1", title: "Report" }], canEdit: true });
    expect(mocks.listReports).toHaveBeenCalledWith(scope);
  });

  it("keeps demo navigation read-only", async () => {
    mocks.getServerSession.mockResolvedValue({ user: { id: "owner", role: "RESEARCHER", isDemo: true } });
    const response = await GET(new NextRequest("http://localhost/api/explore/reports?targetKey=study:s1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ canEdit: false });
  });

  it("does not disclose reports to another owner", async () => {
    mocks.study.mockResolvedValue({ userId: "someone-else" });
    const response = await GET(new NextRequest("http://localhost/api/explore/reports?targetKey=study:s1"));
    expect(response.status).toBe(404);
    expect(mocks.listReports).not.toHaveBeenCalled();
  });

  it("requires authentication before loading reports", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const response = await GET(new NextRequest("http://localhost/api/explore/reports?targetKey=study:s1"));
    expect(response.status).toBe(401);
    expect(mocks.listReports).not.toHaveBeenCalled();
  });
});
