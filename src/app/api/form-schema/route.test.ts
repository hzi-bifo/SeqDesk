import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    orderFormConfig: {
      findUnique: vi.fn(),
    },
    siteSettings: {
      findUnique: vi.fn(),
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

import { GET } from "./route";

describe("GET /api/form-schema", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "user-1",
        role: "USER",
      },
    });
    mocks.db.orderFormConfig.findUnique.mockResolvedValue(null);
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);
  });

  it("rejects unauthenticated requests", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns default fields filtered by module state and user role", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      modulesConfig: JSON.stringify({
        modules: {
          "sequencing-tech": true,
          "mixs-metadata": false,
        },
      }),
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.version).toBe(1);
    expect(body.groups.map((group: { id: string }) => group.id)).toEqual([
      "group_details",
      "group_sequencing",
    ]);
    expect(
      body.fields.some((field: { name: string }) => field.name === "_sequencing_tech")
    ).toBe(true);
    expect(
      body.fields.some(
        (field: { name: string }) => field.name === "facility_qc_status"
      )
    ).toBe(false);
    expect(body.fields.some((field: { type: string }) => field.type === "mixs")).toBe(false);
    expect(body.enabledMixsChecklists).toEqual([]);
    expect(
      body.perSampleFields.every(
        (field: { perSample?: boolean; visible: boolean; adminOnly?: boolean }) =>
          field.perSample === true && field.visible === true && field.adminOnly !== true
      )
    ).toBe(true);
  });

  it("normalizes stored schemas, keeps admin fields for admins, and clears disabled MIxS checklists", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "admin-1",
        role: "FACILITY_ADMIN",
      },
    });
    mocks.db.orderFormConfig.findUnique.mockResolvedValue({
      id: "singleton",
      version: 6,
      schema: JSON.stringify({
        fields: [
          {
            id: "platform-field",
            type: "select",
            label: "Platform",
            name: "platform",
            required: false,
            visible: true,
            order: 1,
            groupId: "custom-group",
            isSystem: true,
            systemKey: "platform",
          },
          {
            id: "billing-field",
            type: "billing",
            label: "Billing",
            name: "_billing",
            required: false,
            visible: true,
            order: 2,
          },
          {
            id: "admin-only-field",
            type: "text",
            label: "Internal Note",
            name: "internal_note",
            required: false,
            visible: true,
            order: 3,
            adminOnly: true,
          },
          {
            id: "per-sample-field",
            type: "text",
            label: "Sample Note",
            name: "sample_note",
            required: false,
            visible: true,
            order: 4,
            perSample: true,
          },
        ],
        groups: [
          {
            id: "custom-group",
            name: "Sequencing custom fields",
            order: 9,
          },
        ],
        enabledMixsChecklists: ["soil", "water"],
        moduleDefaultsVersion: 3,
      }),
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      modulesConfig: JSON.stringify({
        modules: {
          "mixs-metadata": false,
          "billing-info": false,
          "sequencing-tech": false,
        },
      }),
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.version).toBe(6);
    expect(body.enabledMixsChecklists).toEqual([]);
    expect(
      body.fields.find((field: { id: string }) => field.id === "platform-field")
    ).toMatchObject({
      groupId: "group_sequencing",
    });
    expect(body.fields.some((field: { type: string }) => field.type === "billing")).toBe(false);
    expect(
      body.fields.some((field: { id: string }) => field.id === "admin-only-field")
    ).toBe(true);
    expect(body.perSampleFields).toEqual([
      expect.objectContaining({
        id: "per-sample-field",
        perSample: true,
      }),
    ]);
  });
});
