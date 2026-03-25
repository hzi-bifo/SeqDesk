import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODULE_STATES } from "@/lib/modules/types";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    siteSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    department: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    sample: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

import { GET as getAdminModules, PUT as putAdminModules } from "./admin/modules/route";
import {
  GET as getAdminDepartments,
  POST as postAdminDepartments,
} from "./admin/departments/route";
import { DELETE as deleteSampleStudy } from "./samples/[id]/study/route";

const adminSession = {
  user: {
    id: "admin-1",
    role: "FACILITY_ADMIN",
  },
};

function jsonRequest(path: string, method: string, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
}

function lastModulesConfig() {
  const call = mocks.db.siteSettings.upsert.mock.calls.at(-1)?.[0] as {
    update: { modulesConfig: string };
  };
  return JSON.parse(call.update.modulesConfig) as {
    modules: Record<string, boolean>;
    globalDisabled: boolean;
  };
}

describe("admin modules, departments, and sample-study quick wins", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});

    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      modulesConfig: null,
    });
    mocks.db.siteSettings.upsert.mockResolvedValue(undefined);
    mocks.db.department.findMany.mockResolvedValue([
      { id: "dep-1", name: "Biology", _count: { users: 3 } },
    ]);
    mocks.db.department.findUnique.mockResolvedValue(null);
    mocks.db.department.create.mockResolvedValue({
      id: "dep-2",
      name: "Genomics",
      description: "Sequencing support",
    });
    mocks.db.sample.findUnique.mockResolvedValue({
      id: "sample-1",
      order: {
        userId: "user-1",
      },
    });
    mocks.db.sample.update.mockResolvedValue(undefined);
  });

  it("covers admin modules GET and PUT branches", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorizedGet = await getAdminModules();
    expect(unauthorizedGet.status).toBe(401);
    expect(await unauthorizedGet.json()).toEqual({ error: "Unauthorized" });

    mocks.getServerSession.mockResolvedValueOnce({ user: { id: "user-1", role: "RESEARCHER" } });
    mocks.db.siteSettings.findUnique.mockResolvedValueOnce({
      modulesConfig: JSON.stringify({
        "billing-info": true,
        notifications: true,
      }),
    });
    const oldFormat = await getAdminModules();
    expect(oldFormat.status).toBe(200);
    expect(await oldFormat.json()).toEqual({
      modules: {
        ...DEFAULT_MODULE_STATES,
        "billing-info": true,
        notifications: true,
      },
      globalDisabled: false,
    });

    mocks.db.siteSettings.findUnique.mockResolvedValueOnce({
      modulesConfig: JSON.stringify({
        modules: { "funding-info": true },
        globalDisabled: true,
      }),
    });
    const newFormat = await getAdminModules();
    expect(newFormat.status).toBe(200);
    expect(await newFormat.json()).toEqual({
      modules: {
        ...DEFAULT_MODULE_STATES,
        "funding-info": true,
      },
      globalDisabled: true,
    });

    mocks.db.siteSettings.findUnique.mockRejectedValueOnce(new Error("db down"));
    const failedGet = await getAdminModules();
    expect(failedGet.status).toBe(500);
    expect(await failedGet.json()).toEqual({
      error: "Failed to fetch module configuration",
    });

    mocks.getServerSession.mockResolvedValueOnce({ user: { id: "user-2", role: "RESEARCHER" } });
    const unauthorizedPut = await putAdminModules(
      jsonRequest("/api/admin/modules", "PUT", {
        moduleId: "funding-info",
        enabled: true,
      })
    );
    expect(unauthorizedPut.status).toBe(401);
    expect(await unauthorizedPut.json()).toEqual({ error: "Unauthorized" });

    mocks.db.siteSettings.findUnique.mockResolvedValueOnce({
      modulesConfig: JSON.stringify({
        modules: { "billing-info": true },
        globalDisabled: false,
      }),
    });
    const saved = await putAdminModules(
      jsonRequest("/api/admin/modules", "PUT", {
        moduleId: "funding-info",
        enabled: true,
        globalDisabled: true,
      })
    );
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({
      modules: {
        ...DEFAULT_MODULE_STATES,
        "billing-info": true,
        "funding-info": true,
      },
      globalDisabled: true,
    });
    expect(lastModulesConfig()).toEqual({
      modules: {
        ...DEFAULT_MODULE_STATES,
        "billing-info": true,
        "funding-info": true,
      },
      globalDisabled: true,
    });

    mocks.db.siteSettings.upsert.mockRejectedValueOnce(new Error("write failed"));
    const failedPut = await putAdminModules(
      jsonRequest("/api/admin/modules", "PUT", {
        globalDisabled: false,
      })
    );
    expect(failedPut.status).toBe(500);
    expect(await failedPut.json()).toEqual({
      error: "Failed to update module configuration",
    });
  });

  it("covers admin departments GET and POST branches", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorizedGet = await getAdminDepartments();
    expect(unauthorizedGet.status).toBe(401);
    expect(await unauthorizedGet.json()).toEqual({ error: "Unauthorized" });

    const success = await getAdminDepartments();
    expect(success.status).toBe(200);
    expect(mocks.db.department.findMany).toHaveBeenCalledWith({
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { users: true },
        },
      },
    });
    expect(await success.json()).toEqual([
      { id: "dep-1", name: "Biology", _count: { users: 3 } },
    ]);

    mocks.db.department.findMany.mockRejectedValueOnce(new Error("db down"));
    const failedGet = await getAdminDepartments();
    expect(failedGet.status).toBe(500);
    expect(await failedGet.json()).toEqual({
      error: "Failed to fetch departments",
    });

    mocks.getServerSession.mockResolvedValueOnce({ user: { id: "user-1", role: "RESEARCHER" } });
    const unauthorizedPost = await postAdminDepartments(
      jsonRequest("/api/admin/departments", "POST", {
        name: "Genomics",
      })
    );
    expect(unauthorizedPost.status).toBe(401);
    expect(await unauthorizedPost.json()).toEqual({ error: "Unauthorized" });

    const missingName = await postAdminDepartments(
      jsonRequest("/api/admin/departments", "POST", {
        name: "   ",
      })
    );
    expect(missingName.status).toBe(400);
    expect(await missingName.json()).toEqual({
      error: "Department name is required",
    });

    mocks.db.department.findUnique.mockResolvedValueOnce({
      id: "dep-existing",
      name: "Genomics",
    });
    const duplicate = await postAdminDepartments(
      jsonRequest("/api/admin/departments", "POST", {
        name: "Genomics",
      })
    );
    expect(duplicate.status).toBe(400);
    expect(await duplicate.json()).toEqual({
      error: "Department with this name already exists",
    });

    const created = await postAdminDepartments(
      jsonRequest("/api/admin/departments", "POST", {
        name: "  Genomics  ",
        description: "  Sequencing support  ",
      })
    );
    expect(created.status).toBe(201);
    expect(mocks.db.department.create).toHaveBeenCalledWith({
      data: {
        name: "Genomics",
        description: "Sequencing support",
      },
    });
    expect(await created.json()).toEqual({
      id: "dep-2",
      name: "Genomics",
      description: "Sequencing support",
    });

    mocks.db.department.create.mockRejectedValueOnce(new Error("write failed"));
    const failedPost = await postAdminDepartments(
      jsonRequest("/api/admin/departments", "POST", {
        name: "Proteomics",
      })
    );
    expect(failedPost.status).toBe(500);
    expect(await failedPost.json()).toEqual({
      error: "Failed to create department",
    });
  });

  it("covers sample study unassignment branches", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorized = await deleteSampleStudy(new Request("http://localhost") as never, {
      params: Promise.resolve({ id: "sample-1" }),
    });
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });

    mocks.getServerSession.mockResolvedValueOnce({ user: { id: "user-1", role: "RESEARCHER" } });
    mocks.db.sample.findUnique.mockResolvedValueOnce(null);
    const missing = await deleteSampleStudy(new Request("http://localhost") as never, {
      params: Promise.resolve({ id: "sample-1" }),
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Sample not found" });

    mocks.getServerSession.mockResolvedValueOnce({ user: { id: "user-2", role: "RESEARCHER" } });
    mocks.db.sample.findUnique.mockResolvedValueOnce({
      id: "sample-1",
      order: {
        userId: "user-1",
      },
    });
    const forbidden = await deleteSampleStudy(new Request("http://localhost") as never, {
      params: Promise.resolve({ id: "sample-1" }),
    });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "Forbidden" });

    const success = await deleteSampleStudy(new Request("http://localhost") as never, {
      params: Promise.resolve({ id: "sample-1" }),
    });
    expect(success.status).toBe(200);
    expect(mocks.db.sample.update).toHaveBeenCalledWith({
      where: { id: "sample-1" },
      data: { studyId: null },
    });
    expect(await success.json()).toEqual({ success: true });

    mocks.db.sample.findUnique.mockRejectedValueOnce(new Error("db down"));
    const failed = await deleteSampleStudy(new Request("http://localhost") as never, {
      params: Promise.resolve({ id: "sample-1" }),
    });
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: "Failed to unassign sample",
    });
  });
});
