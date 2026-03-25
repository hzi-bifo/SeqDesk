import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  isDemoSession: vi.fn(),
  getAvailableAssemblies: vi.fn(),
  resolveAssemblySelection: vi.fn(),
  db: {
    siteSettings: {
      findUnique: vi.fn(),
    },
    sample: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    ticket: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  tx: {
    ticketMessage: {
      create: vi.fn(),
    },
    ticket: {
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

vi.mock("@/lib/demo/server", () => ({
  isDemoSession: mocks.isDemoSession,
}));

vi.mock("@/lib/pipelines/assembly-selection", () => ({
  getAvailableAssemblies: mocks.getAvailableAssemblies,
  resolveAssemblySelection: mocks.resolveAssemblySelection,
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

import { GET as getAssemblies } from "./assemblies/route";
import { PUT as putPreferredAssembly } from "./samples/[id]/preferred-assembly/route";
import { POST as postTicketMessage } from "./tickets/[id]/messages/route";

const researcherSession = {
  user: {
    id: "user-1",
    role: "RESEARCHER",
  },
};

const adminSession = {
  user: {
    id: "admin-1",
    role: "FACILITY_ADMIN",
  },
};

function jsonRequest(path: string, method: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("assemblies, preferred assembly, and ticket messages quick wins", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-25T14:00:00.000Z"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    mocks.getServerSession.mockResolvedValue(researcherSession);
    mocks.isDemoSession.mockReturnValue(false);
    mocks.getAvailableAssemblies.mockReturnValue([
      { id: "asm-1" },
      { id: "asm-2" },
    ]);
    mocks.resolveAssemblySelection.mockImplementation((sample) => ({
      source: "preferred",
      preferredMissing: false,
      assembly: sample.assemblies?.find((assembly: { id: string }) => assembly.id === "asm-1") || null,
    }));
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({
        allowUserAssemblyDownload: true,
      }),
    });
    mocks.db.sample.findMany.mockResolvedValue([
      {
        id: "sample-b",
        sampleId: "S2",
        preferredAssemblyId: "asm-1",
        study: {
          id: "study-b",
          title: "Beta Study",
          alias: "BETA",
        },
        order: {
          id: "order-2",
          orderNumber: "ORD-002",
          name: "Second Order",
          status: "COMPLETED",
        },
        assemblies: [
          {
            id: "asm-1",
            assemblyName: "Assembly One",
            assemblyFile: "/tmp/results/assembly-one.fa",
            createdByPipelineRunId: "run-1",
            createdByPipelineRun: {
              id: "run-1",
              runNumber: 11,
              status: "COMPLETED",
              createdAt: new Date("2026-03-24T12:00:00.000Z"),
              completedAt: new Date("2026-03-24T13:00:00.000Z"),
            },
          },
        ],
      },
      {
        id: "sample-a",
        sampleId: "S1",
        preferredAssemblyId: null,
        study: {
          id: "study-a",
          title: "Alpha Study",
          alias: "ALPHA",
        },
        order: {
          id: "order-1",
          orderNumber: "ORD-001",
          name: "First Order",
          status: "COMPLETED",
        },
        assemblies: [
          {
            id: "asm-3",
            assemblyName: "Assembly Three",
            assemblyFile: "/tmp/results/assembly-three.fa",
            createdByPipelineRunId: null,
            createdByPipelineRun: null,
          },
        ],
      },
    ]);
    mocks.db.sample.findUnique.mockResolvedValue({
      id: "sample-1",
      sampleId: "S1",
      studyId: "study-1",
      order: {
        userId: "user-1",
      },
      study: {
        id: "study-1",
        userId: "user-1",
      },
      assemblies: [
        {
          id: "asm-1",
          assemblyName: "Assembly One",
          assemblyFile: "/tmp/results/assembly-one.fa",
          createdByPipelineRunId: "run-1",
          createdByPipelineRun: {
            id: "run-1",
            runNumber: 11,
            status: "COMPLETED",
            createdAt: new Date("2026-03-24T12:00:00.000Z"),
            completedAt: new Date("2026-03-24T13:00:00.000Z"),
          },
        },
        {
          id: "asm-empty",
          assemblyName: "Broken Assembly",
          assemblyFile: null,
          createdByPipelineRunId: null,
          createdByPipelineRun: null,
        },
      ],
    });
    mocks.db.sample.update.mockImplementation(async ({ where, data }) => ({
      id: where.id,
      preferredAssemblyId: data.preferredAssemblyId,
    }));
    mocks.db.ticket.findUnique.mockResolvedValue({
      id: "ticket-1",
      userId: "user-1",
      status: "RESOLVED",
    });
    mocks.tx.ticketMessage.create.mockResolvedValue({
      id: "msg-1",
      content: "Hello from user",
      ticketId: "ticket-1",
      userId: "user-1",
      user: {
        id: "user-1",
        firstName: "Research",
        lastName: "User",
        role: "RESEARCHER",
      },
    });
    mocks.tx.ticket.update.mockResolvedValue({ id: "ticket-1" });
    mocks.db.$transaction.mockImplementation((callback: (tx: typeof mocks.tx) => Promise<unknown>) =>
      callback(mocks.tx)
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("covers assemblies route auth, demo, disabled, success, and failure branches", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorized = await getAssemblies();
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });

    mocks.getServerSession.mockResolvedValueOnce(researcherSession);
    mocks.isDemoSession.mockReturnValueOnce(true);
    const demo = await getAssemblies();
    expect(demo.status).toBe(403);
    expect(await demo.json()).toEqual({
      error: "Assemblies are disabled in the public demo.",
    });

    mocks.db.siteSettings.findUnique.mockResolvedValueOnce({
      extraSettings: JSON.stringify({
        allowUserAssemblyDownload: false,
      }),
    });
    const disabled = await getAssemblies();
    expect(disabled.status).toBe(403);
    expect(await disabled.json()).toEqual({
      error: "Assembly downloads are disabled by the facility administrator.",
    });

    mocks.resolveAssemblySelection
      .mockReturnValueOnce({
        source: "preferred",
        preferredMissing: false,
        assembly: {
          id: "asm-1",
          assemblyName: "Assembly One",
          assemblyFile: "/tmp/results/assembly-one.fa",
          createdByPipelineRunId: "run-1",
          createdByPipelineRun: {
            id: "run-1",
            runNumber: 11,
            status: "COMPLETED",
            createdAt: new Date("2026-03-24T12:00:00.000Z"),
            completedAt: new Date("2026-03-24T13:00:00.000Z"),
          },
        },
      })
      .mockReturnValueOnce({
        source: "none",
        preferredMissing: true,
        assembly: null,
      });
    const success = await getAssemblies();
    expect(success.status).toBe(200);
    expect(mocks.db.sample.findMany).toHaveBeenCalledWith({
      where: {
        studyId: { not: null },
        assemblies: {
          some: {
            assemblyFile: { not: null },
          },
        },
        study: { userId: "user-1" },
        order: { status: "COMPLETED" },
      },
      select: expect.any(Object),
    });
    expect(await success.json()).toEqual({
      assemblies: [
        {
          sample: {
            id: "sample-b",
            sampleId: "S2",
          },
          study: {
            id: "study-b",
            title: "Beta Study",
            alias: "BETA",
          },
          order: {
            id: "order-2",
            orderNumber: "ORD-002",
            name: "Second Order",
            status: "COMPLETED",
          },
          selection: {
            mode: "explicit",
            preferredAssemblyId: "asm-1",
            preferredMissing: false,
          },
          finalAssembly: {
            id: "asm-1",
            assemblyName: "Assembly One",
            assemblyFile: "/tmp/results/assembly-one.fa",
            fileName: "assembly-one.fa",
            createdByPipelineRunId: "run-1",
            createdByPipelineRun: {
              id: "run-1",
              runNumber: 11,
              createdAt: "2026-03-24T12:00:00.000Z",
            },
          },
          availableAssembliesCount: 2,
        },
      ],
      total: 1,
    });

    mocks.db.sample.findMany.mockRejectedValueOnce(new Error("db down"));
    const failed = await getAssemblies();
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: "Failed to fetch assemblies",
    });
  });

  it("covers preferred assembly updates across validation and success branches", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorized = await putPreferredAssembly(
      jsonRequest("/api/samples/sample-1/preferred-assembly", "PUT", {
        assemblyId: "asm-1",
      }),
      { params: Promise.resolve({ id: "sample-1" }) }
    );
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });

    const invalidType = await putPreferredAssembly(
      jsonRequest("/api/samples/sample-1/preferred-assembly", "PUT", {
        assemblyId: 123,
      }),
      { params: Promise.resolve({ id: "sample-1" }) }
    );
    expect(invalidType.status).toBe(400);
    expect(await invalidType.json()).toEqual({
      error: "assemblyId must be a string or null",
    });

    mocks.db.sample.findUnique.mockResolvedValueOnce(null);
    const missing = await putPreferredAssembly(
      jsonRequest("/api/samples/sample-1/preferred-assembly", "PUT", {
        assemblyId: "asm-1",
      }),
      { params: Promise.resolve({ id: "sample-1" }) }
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Sample not found" });

    mocks.getServerSession.mockResolvedValueOnce({ user: { id: "other-user", role: "RESEARCHER" } });
    const forbidden = await putPreferredAssembly(
      jsonRequest("/api/samples/sample-1/preferred-assembly", "PUT", {
        assemblyId: "asm-1",
      }),
      { params: Promise.resolve({ id: "sample-1" }) }
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "Forbidden" });

    const wrongStudy = await putPreferredAssembly(
      jsonRequest("/api/samples/sample-1/preferred-assembly", "PUT", {
        studyId: "study-2",
        assemblyId: "asm-1",
      }),
      { params: Promise.resolve({ id: "sample-1" }) }
    );
    expect(wrongStudy.status).toBe(400);
    expect(await wrongStudy.json()).toEqual({
      error: "Sample is not assigned to the requested study",
    });

    const unknownAssembly = await putPreferredAssembly(
      jsonRequest("/api/samples/sample-1/preferred-assembly", "PUT", {
        studyId: "study-1",
        assemblyId: "missing-asm",
      }),
      { params: Promise.resolve({ id: "sample-1" }) }
    );
    expect(unknownAssembly.status).toBe(400);
    expect(await unknownAssembly.json()).toEqual({
      error: "Assembly not found for this sample",
    });

    const missingFile = await putPreferredAssembly(
      jsonRequest("/api/samples/sample-1/preferred-assembly", "PUT", {
        studyId: "study-1",
        assemblyId: "asm-empty",
      }),
      { params: Promise.resolve({ id: "sample-1" }) }
    );
    expect(missingFile.status).toBe(400);
    expect(await missingFile.json()).toEqual({
      error: "Cannot select an assembly without a file path",
    });

    const success = await putPreferredAssembly(
      jsonRequest("/api/samples/sample-1/preferred-assembly", "PUT", {
        studyId: "study-1",
        assemblyId: "asm-1",
      }),
      { params: Promise.resolve({ id: "sample-1" }) }
    );
    expect(success.status).toBe(200);
    expect(await success.json()).toEqual({
      success: true,
      sampleId: "sample-1",
      preferredAssemblyId: "asm-1",
      preferredAssembly: {
        id: "asm-1",
        assemblyName: "Assembly One",
        assemblyFile: "/tmp/results/assembly-one.fa",
        createdByPipelineRunId: "run-1",
        createdByPipelineRun: {
          id: "run-1",
          runNumber: 11,
          status: "COMPLETED",
          createdAt: "2026-03-24T12:00:00.000Z",
          completedAt: "2026-03-24T13:00:00.000Z",
        },
      },
    });

    const cleared = await putPreferredAssembly(
      jsonRequest("/api/samples/sample-1/preferred-assembly", "PUT", {
        assemblyId: null,
      }),
      { params: Promise.resolve({ id: "sample-1" }) }
    );
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({
      success: true,
      sampleId: "sample-1",
      preferredAssemblyId: null,
      preferredAssembly: null,
    });

    mocks.db.sample.findUnique.mockRejectedValueOnce(new Error("db down"));
    const failed = await putPreferredAssembly(
      jsonRequest("/api/samples/sample-1/preferred-assembly", "PUT", {
        assemblyId: null,
      }),
      { params: Promise.resolve({ id: "sample-1" }) }
    );
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: "Failed to update preferred assembly",
    });
  });

  it("covers ticket message auth and validation branches", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorized = await postTicketMessage(
      jsonRequest("/api/tickets/ticket-1/messages", "POST", {
        content: "Hello",
      }),
      { params: Promise.resolve({ id: "ticket-1" }) }
    );
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });

    mocks.db.ticket.findUnique.mockResolvedValueOnce(null);
    const missing = await postTicketMessage(
      jsonRequest("/api/tickets/ticket-1/messages", "POST", {
        content: "Hello",
      }),
      { params: Promise.resolve({ id: "ticket-1" }) }
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Ticket not found" });

    mocks.getServerSession.mockResolvedValueOnce({ user: { id: "other-user", role: "RESEARCHER" } });
    const forbidden = await postTicketMessage(
      jsonRequest("/api/tickets/ticket-1/messages", "POST", {
        content: "Hello",
      }),
      { params: Promise.resolve({ id: "ticket-1" }) }
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "Forbidden" });

    mocks.db.ticket.findUnique.mockResolvedValueOnce({
      id: "ticket-1",
      userId: "user-1",
      status: "CLOSED",
    });
    const closed = await postTicketMessage(
      jsonRequest("/api/tickets/ticket-1/messages", "POST", {
        content: "Hello",
      }),
      { params: Promise.resolve({ id: "ticket-1" }) }
    );
    expect(closed.status).toBe(400);
    expect(await closed.json()).toEqual({
      error: "Cannot add messages to closed tickets",
    });

    const missingContent = await postTicketMessage(
      jsonRequest("/api/tickets/ticket-1/messages", "POST", {
        content: "   ",
      }),
      { params: Promise.resolve({ id: "ticket-1" }) }
    );
    expect(missingContent.status).toBe(400);
    expect(await missingContent.json()).toEqual({
      error: "Message content is required",
    });
  });

  it("creates user and admin ticket messages and maps failures", async () => {
    const userResponse = await postTicketMessage(
      jsonRequest("/api/tickets/ticket-1/messages", "POST", {
        content: "  Hello from user  ",
      }),
      { params: Promise.resolve({ id: "ticket-1" }) }
    );
    expect(userResponse.status).toBe(201);
    expect(mocks.tx.ticketMessage.create).toHaveBeenCalledWith({
      data: {
        content: "Hello from user",
        userId: "user-1",
        ticketId: "ticket-1",
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
    });
    expect(mocks.tx.ticket.update).toHaveBeenCalledWith({
      where: { id: "ticket-1" },
      data: {
        updatedAt: new Date("2026-03-25T14:00:00.000Z"),
        lastUserMessageAt: new Date("2026-03-25T14:00:00.000Z"),
        userReadAt: new Date("2026-03-25T14:00:00.000Z"),
        status: "OPEN",
      },
      select: { id: true },
    });
    expect(await userResponse.json()).toEqual({
      id: "msg-1",
      content: "Hello from user",
      ticketId: "ticket-1",
      userId: "user-1",
      user: {
        id: "user-1",
        firstName: "Research",
        lastName: "User",
        role: "RESEARCHER",
      },
    });

    mocks.getServerSession.mockResolvedValueOnce(adminSession);
    mocks.db.ticket.findUnique.mockResolvedValueOnce({
      id: "ticket-1",
      userId: "user-1",
      status: "OPEN",
    });
    mocks.tx.ticketMessage.create.mockResolvedValueOnce({
      id: "msg-2",
      content: "Hello from admin",
      ticketId: "ticket-1",
      userId: "admin-1",
      user: {
        id: "admin-1",
        firstName: "Admin",
        lastName: "User",
        role: "FACILITY_ADMIN",
      },
    });
    const adminResponse = await postTicketMessage(
      jsonRequest("/api/tickets/ticket-1/messages", "POST", {
        content: "Hello from admin",
      }),
      { params: Promise.resolve({ id: "ticket-1" }) }
    );
    expect(adminResponse.status).toBe(201);
    expect(mocks.tx.ticket.update).toHaveBeenLastCalledWith({
      where: { id: "ticket-1" },
      data: {
        updatedAt: new Date("2026-03-25T14:00:00.000Z"),
        lastAdminMessageAt: new Date("2026-03-25T14:00:00.000Z"),
        adminReadAt: new Date("2026-03-25T14:00:00.000Z"),
        status: "IN_PROGRESS",
      },
      select: { id: true },
    });
    expect(await adminResponse.json()).toEqual({
      id: "msg-2",
      content: "Hello from admin",
      ticketId: "ticket-1",
      userId: "admin-1",
      user: {
        id: "admin-1",
        firstName: "Admin",
        lastName: "User",
        role: "FACILITY_ADMIN",
      },
    });

    mocks.db.$transaction.mockRejectedValueOnce(new Error("tx failed"));
    const failed = await postTicketMessage(
      jsonRequest("/api/tickets/ticket-1/messages", "POST", {
        content: "Hello again",
      }),
      { params: Promise.resolve({ id: "ticket-1" }) }
    );
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: "Failed to add message",
    });
  });
});
