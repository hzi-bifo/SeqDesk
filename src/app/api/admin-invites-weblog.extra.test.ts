import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  randomBytes: vi.fn(),
  getExecutionSettings: vi.fn(),
  db: {
    adminInvite: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    pipelineRun: {
      findUnique: vi.fn(),
    },
    pipelineRunEvent: {
      findMany: vi.fn(),
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

vi.mock("crypto", () => ({
  randomBytes: mocks.randomBytes,
}));

vi.mock("@/lib/pipelines/execution-settings", () => ({
  getExecutionSettings: mocks.getExecutionSettings,
}));

vi.mock("@prisma/client", () => {
  class PrismaClientKnownRequestError extends Error {
    code: string;

    constructor(message: string, options: { code: string }) {
      super(message);
      this.code = options.code;
    }
  }

  return {
    Prisma: {
      PrismaClientKnownRequestError,
    },
  };
});

import { Prisma } from "@prisma/client";
import { GET as getAdminInvites, POST as postAdminInvites } from "./admin/invites/route";
import { GET as getRunWeblog } from "./pipelines/runs/[id]/weblog/route";

const adminSession = {
  user: {
    id: "admin-1",
    role: "FACILITY_ADMIN",
  },
};

const researcherSession = {
  user: {
    id: "user-1",
    role: "RESEARCHER",
  },
};

function jsonRequest(path: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function duplicateInviteError() {
  return new Prisma.PrismaClientKnownRequestError("duplicate", {
    code: "P2002",
  });
}

describe("admin invites and run weblog quick wins", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-25T15:30:00.000Z"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.randomBytes
      .mockReturnValueOnce(Buffer.from([0xab, 0xcd, 0xef, 0x01]))
      .mockReturnValue(Buffer.from([0x12, 0x34, 0x56, 0x78]));
    mocks.getExecutionSettings.mockResolvedValue({
      weblogSecret: "secret-token",
    });
    mocks.db.adminInvite.findMany.mockResolvedValue([
      {
        id: "invite-1",
        code: "ABCDEF01",
        email: "admin@example.test",
        createdBy: {
          firstName: "Ada",
          lastName: "Admin",
        },
        usedBy: null,
      },
    ]);
    mocks.db.adminInvite.create.mockResolvedValue({
      id: "invite-1",
      code: "ABCDEF01",
      email: "admin@example.test",
      expiresAt: new Date("2026-04-01T15:30:00.000Z"),
      createdById: "admin-1",
      createdBy: {
        firstName: "Ada",
        lastName: "Admin",
      },
    });
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      runNumber: 42,
      pipelineId: "fastqc",
      study: {
        userId: "user-1",
      },
      order: null,
    });
    mocks.db.pipelineRunEvent.findMany.mockResolvedValue([
      {
        id: "event-1",
        eventType: "task",
        processName: "FASTQC",
        stepId: "step-1",
        status: "COMPLETED",
        message: "done",
        payload: "{\"progress\":100}",
        source: "weblog",
        occurredAt: new Date("2026-03-25T12:00:00.000Z"),
      },
      {
        id: "event-2",
        eventType: "task",
        processName: "FASTQC",
        stepId: "step-2",
        status: "FAILED",
        message: "bad payload",
        payload: "{bad-json",
        source: "weblog",
        occurredAt: new Date("2026-03-25T11:00:00.000Z"),
      },
      {
        id: "event-3",
        eventType: "task",
        processName: null,
        stepId: null,
        status: "QUEUED",
        message: null,
        payload: null,
        source: "system",
        occurredAt: new Date("2026-03-25T10:00:00.000Z"),
      },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("covers admin invites GET success, unauthorized, and failure branches", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorized = await getAdminInvites();
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });

    const success = await getAdminInvites();
    expect(success.status).toBe(200);
    expect(mocks.db.adminInvite.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      include: {
        createdBy: {
          select: { firstName: true, lastName: true },
        },
        usedBy: {
          select: { firstName: true, lastName: true, email: true },
        },
      },
    });
    expect(await success.json()).toEqual([
      {
        id: "invite-1",
        code: "ABCDEF01",
        email: "admin@example.test",
        createdBy: {
          firstName: "Ada",
          lastName: "Admin",
        },
        usedBy: null,
      },
    ]);

    mocks.db.adminInvite.findMany.mockRejectedValueOnce(new Error("db down"));
    const failed = await getAdminInvites();
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: "Failed to fetch invites",
    });
  });

  it("validates invite creation inputs and authorization", async () => {
    mocks.getServerSession.mockResolvedValueOnce({ user: { id: "user-1", role: "RESEARCHER" } });
    const unauthorized = await postAdminInvites(
      jsonRequest("/api/admin/invites", "POST", {
        email: "admin@example.test",
      })
    );
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });

    const invalidDays = await postAdminInvites(
      jsonRequest("/api/admin/invites", "POST", {
        expiresInDays: 0,
      })
    );
    expect(invalidDays.status).toBe(400);
    expect(await invalidDays.json()).toEqual({
      error: "expiresInDays must be an integer between 1 and 30",
    });

    const invalidEmail = await postAdminInvites(
      jsonRequest("/api/admin/invites", "POST", {
        email: "not-an-email",
      })
    );
    expect(invalidEmail.status).toBe(400);
    expect(await invalidEmail.json()).toEqual({
      error: "Invalid invite email address",
    });
  });

  it("creates invites, retries duplicate codes, and exhausts after repeated collisions", async () => {
    const success = await postAdminInvites(
      jsonRequest("/api/admin/invites", "POST", {
        email: " ADMIN@Example.TEST ",
        expiresInDays: "7",
      })
    );
    expect(success.status).toBe(201);
    expect(mocks.db.adminInvite.create).toHaveBeenCalledWith({
      data: {
        code: "ABCDEF01",
        email: "admin@example.test",
        expiresAt: new Date("2026-04-01T14:30:00.000Z"),
        createdById: "admin-1",
      },
      include: {
        createdBy: {
          select: { firstName: true, lastName: true },
        },
      },
    });
    expect(await success.json()).toEqual({
      id: "invite-1",
      code: "ABCDEF01",
      email: "admin@example.test",
      expiresAt: "2026-04-01T15:30:00.000Z",
      createdById: "admin-1",
      createdBy: {
        firstName: "Ada",
        lastName: "Admin",
      },
    });

    mocks.randomBytes
      .mockReset()
      .mockReturnValueOnce(Buffer.from([0xaa, 0xaa, 0xaa, 0xaa]))
      .mockReturnValueOnce(Buffer.from([0xbb, 0xbb, 0xbb, 0xbb]));
    mocks.db.adminInvite.create
      .mockReset()
      .mockRejectedValueOnce(duplicateInviteError())
      .mockResolvedValueOnce({
        id: "invite-2",
        code: "BBBBBBBB",
        email: null,
        expiresAt: new Date("2026-03-28T15:30:00.000Z"),
        createdById: "admin-1",
        createdBy: {
          firstName: "Ada",
          lastName: "Admin",
        },
      });
    const retried = await postAdminInvites(
      jsonRequest("/api/admin/invites", "POST", {
        expiresInDays: 3,
      })
    );
    expect(retried.status).toBe(201);
    expect(mocks.db.adminInvite.create).toHaveBeenNthCalledWith(1, {
      data: {
        code: "AAAAAAAA",
        email: null,
        expiresAt: new Date("2026-03-28T15:30:00.000Z"),
        createdById: "admin-1",
      },
      include: {
        createdBy: {
          select: { firstName: true, lastName: true },
        },
      },
    });
    expect(mocks.db.adminInvite.create).toHaveBeenNthCalledWith(2, {
      data: {
        code: "BBBBBBBB",
        email: null,
        expiresAt: new Date("2026-03-28T15:30:00.000Z"),
        createdById: "admin-1",
      },
      include: {
        createdBy: {
          select: { firstName: true, lastName: true },
        },
      },
    });

    mocks.randomBytes.mockReset().mockReturnValue(Buffer.from([0xcc, 0xcc, 0xcc, 0xcc]));
    mocks.db.adminInvite.create.mockReset().mockRejectedValue(duplicateInviteError());
    const exhausted = await postAdminInvites(
      jsonRequest("/api/admin/invites", "POST", {
        expiresInDays: 2,
      })
    );
    expect(exhausted.status).toBe(500);
    expect(await exhausted.json()).toEqual({
      error: "Failed to generate a unique invite code",
    });
    expect(mocks.db.adminInvite.create).toHaveBeenCalledTimes(5);
  });

  it("maps non-duplicate invite creation failures", async () => {
    mocks.db.adminInvite.create.mockRejectedValueOnce(new Error("write failed"));

    const response = await postAdminInvites(
      jsonRequest("/api/admin/invites", "POST", {
        email: "admin@example.test",
      })
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to create invite",
    });
  });

  it("covers run weblog auth, not-found, forbidden, success, and failure branches", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorized = await getRunWeblog(
      new NextRequest("http://localhost/api/pipelines/runs/run-1/weblog?limit=25"),
      { params: Promise.resolve({ id: "run-1" }) }
    );
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });

    mocks.getServerSession.mockResolvedValueOnce(researcherSession);
    mocks.db.pipelineRun.findUnique.mockResolvedValueOnce(null);
    const missing = await getRunWeblog(
      new NextRequest("http://localhost/api/pipelines/runs/run-1/weblog?limit=25"),
      { params: Promise.resolve({ id: "run-1" }) }
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Run not found" });

    mocks.getServerSession.mockResolvedValueOnce(researcherSession);
    mocks.db.pipelineRun.findUnique.mockResolvedValueOnce({
      id: "run-1",
      runNumber: 42,
      pipelineId: "fastqc",
      study: {
        userId: "other-user",
      },
      order: {
        userId: "different-user",
      },
    });
    const forbidden = await getRunWeblog(
      new NextRequest("http://localhost/api/pipelines/runs/run-1/weblog?limit=25"),
      { params: Promise.resolve({ id: "run-1" }) }
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "Forbidden" });

    mocks.getServerSession.mockResolvedValueOnce(researcherSession);
    const success = await getRunWeblog(
      new NextRequest("http://localhost/api/pipelines/runs/run-1/weblog?limit=999"),
      { params: Promise.resolve({ id: "run-1" }) }
    );
    expect(success.status).toBe(200);
    expect(mocks.db.pipelineRunEvent.findMany).toHaveBeenCalledWith({
      where: { pipelineRunId: "run-1" },
      orderBy: { occurredAt: "desc" },
      take: 500,
      select: {
        id: true,
        eventType: true,
        processName: true,
        stepId: true,
        status: true,
        message: true,
        payload: true,
        source: true,
        occurredAt: true,
      },
    });
    expect(await success.json()).toEqual({
      run: {
        id: "run-1",
        runNumber: 42,
        pipelineId: "fastqc",
      },
      webhook: {
        method: "POST",
        endpoint: "http://localhost/api/pipelines/weblog?runId=run-1&token=%3Cyour-weblog-secret%3E",
        tokenRequired: true,
      },
      count: 3,
      events: [
        {
          id: "event-1",
          eventType: "task",
          processName: "FASTQC",
          stepId: "step-1",
          status: "COMPLETED",
          message: "done",
          payload: { progress: 100 },
          payloadRaw: "{\"progress\":100}",
          source: "weblog",
          occurredAt: "2026-03-25T12:00:00.000Z",
        },
        {
          id: "event-2",
          eventType: "task",
          processName: "FASTQC",
          stepId: "step-2",
          status: "FAILED",
          message: "bad payload",
          payload: "{bad-json",
          payloadRaw: "{bad-json",
          source: "weblog",
          occurredAt: "2026-03-25T11:00:00.000Z",
        },
        {
          id: "event-3",
          eventType: "task",
          processName: null,
          stepId: null,
          status: "QUEUED",
          message: null,
          payloadRaw: null,
          payload: null,
          source: "system",
          occurredAt: "2026-03-25T10:00:00.000Z",
        },
      ],
    });

    mocks.getExecutionSettings.mockResolvedValueOnce({
      weblogSecret: "",
    });
    await getRunWeblog(
      new NextRequest("http://localhost/api/pipelines/runs/run-1/weblog?limit=bogus"),
      { params: Promise.resolve({ id: "run-1" }) }
    );
    expect(mocks.db.pipelineRunEvent.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 100 })
    );

    mocks.db.pipelineRun.findUnique.mockRejectedValueOnce(new Error("db down"));
    const failed = await getRunWeblog(
      new NextRequest("http://localhost/api/pipelines/runs/run-1/weblog"),
      { params: Promise.resolve({ id: "run-1" }) }
    );
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: "Failed to fetch raw weblog events",
    });
  });
});
