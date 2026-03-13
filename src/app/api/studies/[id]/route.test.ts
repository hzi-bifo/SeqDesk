import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  loadStudyFormSchema: vi.fn(),
  db: {
    study: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    sample: {
      findMany: vi.fn(),
    },
    assembly: {
      findMany: vi.fn(),
    },
    order: {
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

vi.mock("@/lib/studies/schema", () => ({
  loadStudyFormSchema: mocks.loadStudyFormSchema,
}));

import { PUT } from "./route";

function buildFetchedStudy() {
  return {
    id: "study-1",
    title: "Study 1",
    alias: "study-1",
    description: "Description",
    checklistType: "soil",
    studyMetadata: JSON.stringify({
      visible_field: "new visible value",
      hidden_admin_only: "keep me",
    }),
    readyForSubmission: false,
    readyAt: null,
    studyAccessionId: null,
    submitted: false,
    submittedAt: null,
    testRegisteredAt: null,
    createdAt: new Date("2026-03-01T10:00:00.000Z"),
    updatedAt: new Date("2026-03-01T10:00:00.000Z"),
    userId: "user-1",
    user: {
      id: "user-1",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
    },
    samples: [],
    notes: null,
    notesEditedAt: null,
    notesEditedById: null,
    notesEditedBy: null,
  };
}

describe("PUT /api/studies/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "user-1",
        role: "RESEARCHER",
      },
    });
    mocks.loadStudyFormSchema.mockResolvedValue({
      studyFields: [
        {
          id: "field-visible",
          name: "visible_field",
          label: "Visible Field",
          type: "text",
          order: 0,
        },
      ],
      perSampleFields: [],
      fields: [],
      groups: [],
      modules: {},
    });
    mocks.db.study.findFirst.mockResolvedValue(null);
    mocks.db.study.update.mockResolvedValue({ id: "study-1" });
    mocks.db.sample.findMany.mockResolvedValue([]);
    mocks.db.assembly.findMany.mockResolvedValue([]);
    mocks.db.order.findMany.mockResolvedValue([]);
    mocks.db.study.findUnique.mockImplementation(async ({ select }) => {
      if (select?.title && select?.samples) {
        return buildFetchedStudy();
      }

      if (select?.id) {
        return { id: "study-1" };
      }

      if (select?.userId && select?.studyMetadata) {
        return {
          userId: "user-1",
          studyMetadata: JSON.stringify({
            visible_field: "old visible value",
            hidden_admin_only: "keep me",
          }),
        };
      }

      return null;
    });
  });

  it("preserves hidden facility-only study metadata when a researcher updates visible fields", async () => {
    const request = new NextRequest("http://localhost:3000/api/studies/study-1", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        studyMetadata: {
          visible_field: "new visible value",
        },
      }),
    });

    const response = await PUT(request, {
      params: Promise.resolve({ id: "study-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.loadStudyFormSchema).toHaveBeenCalledWith({
      isFacilityAdmin: false,
      applyRoleFilter: true,
      applyModuleFilter: true,
    });
    expect(mocks.db.study.update).toHaveBeenCalledWith({
      where: { id: "study-1" },
      data: {
        studyMetadata: JSON.stringify({
          visible_field: "new visible value",
          hidden_admin_only: "keep me",
        }),
      },
    });
  });
});
