import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  loadStudyFormSchema: vi.fn(),
  db: {
    study: {
      findUnique: vi.fn(),
    },
    sample: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
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

describe("PUT /api/studies/[id]/samples", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "user-1",
        role: "RESEARCHER",
      },
    });
    mocks.db.study.findUnique.mockResolvedValue({
      userId: "user-1",
    });
    mocks.loadStudyFormSchema.mockResolvedValue({
      studyFields: [],
      perSampleFields: [
        {
          id: "field-visible-sample",
          name: "visible_sample",
          label: "Visible Sample",
          type: "text",
          order: 0,
          perSample: true,
        },
      ],
      fields: [],
      groups: [],
      modules: {},
    });
    mocks.db.sample.update.mockResolvedValue({ id: "sample-1" });
    mocks.db.sample.updateMany.mockResolvedValue({ count: 0 });
    mocks.db.sample.findMany.mockImplementation(async ({ where, select }) => {
      if (where?.studyId && select?.id) {
        return [{ id: "sample-1" }];
      }

      if (where?.id?.in && select?.id && select?.checklistData) {
        return [
          {
            id: "sample-1",
            checklistData: JSON.stringify({
              visible_sample: "old value",
              hidden_admin_sample: "keep me",
            }),
          },
        ];
      }

      return [];
    });
  });

  it("preserves hidden facility-only per-sample values when a researcher updates visible columns", async () => {
    const request = new NextRequest("http://localhost:3000/api/studies/study-1/samples", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sampleIds: ["sample-1"],
        perSampleData: {
          "sample-1": {
            visible_sample: "new value",
          },
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
    expect(mocks.db.sample.update).toHaveBeenCalledWith({
      where: { id: "sample-1" },
      data: {
        checklistData: JSON.stringify({
          visible_sample: "new value",
          hidden_admin_sample: "keep me",
        }),
      },
    });
  });
});
