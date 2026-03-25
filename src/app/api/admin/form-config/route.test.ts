import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    orderFormConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
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

import { GET, PUT } from "./route";

describe("GET /api/admin/form-config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "admin-1",
        role: "FACILITY_ADMIN",
      },
    });
    mocks.db.orderFormConfig.findUnique.mockResolvedValue(null);
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);
  });

  it("rejects non-admin requests", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "user-1",
        role: "USER",
      },
    });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns normalized defaults when no saved config exists", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      modulesConfig: JSON.stringify({
        modules: { "sequencing-tech": true },
        globalDisabled: false,
      }),
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe("singleton");
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
        (field: { name: string; adminOnly?: boolean }) =>
          field.name === "facility_qc_status" && field.adminOnly === true
      )
    ).toBe(true);
  });

  it("upgrades legacy saved schemas and normalizes custom sequencing groups", async () => {
    mocks.db.orderFormConfig.findUnique.mockResolvedValue({
      id: "singleton",
      schema: JSON.stringify({
        fields: [
          {
            id: "field_custom_seq",
            type: "text",
            label: "Library Notes",
            name: "libraryNotes",
            required: false,
            visible: true,
            order: 0,
            groupId: "custom_seq_group",
          },
        ],
        groups: [
          {
            id: "custom_seq_group",
            name: "Library sequencing notes",
            order: 7,
          },
        ],
        enabledMixsChecklists: ["soil"],
        moduleDefaultsVersion: 0,
      }),
      version: 7,
      updatedAt: new Date("2025-01-02T03:04:05.000Z"),
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      modulesConfig: JSON.stringify({
        modules: { "sequencing-tech": true },
      }),
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.version).toBe(7);
    expect(body.enabledMixsChecklists).toEqual(["soil"]);
    expect(
      body.fields.find((field: { id: string }) => field.id === "field_custom_seq")
    ).toMatchObject({
      groupId: "group_sequencing",
    });
    expect(
      body.fields.some((field: { name: string }) => field.name === "_sequencing_tech")
    ).toBe(true);
    expect(body.groups.map((group: { id: string }) => group.id)).toEqual([
      "group_details",
      "group_sequencing",
    ]);
  });
});

describe("PUT /api/admin/form-config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "admin-1",
        role: "FACILITY_ADMIN",
      },
    });
    mocks.db.orderFormConfig.findUnique.mockResolvedValue({
      id: "singleton",
      version: 3,
    });
    mocks.db.orderFormConfig.upsert.mockImplementation(
      async ({ update }: { update: { schema: string; version: number } }) => ({
        id: "singleton",
        schema: update.schema,
        version: update.version,
        updatedAt: new Date("2025-03-04T05:06:07.000Z"),
      })
    );
  });

  it("rejects invalid field payloads", async () => {
    const response = await PUT(
      new NextRequest("http://localhost:3000/api/admin/form-config", {
        method: "PUT",
        body: JSON.stringify({ fields: { id: "bad" } }),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Fields must be an array",
    });
  });

  it("rejects invalid group payloads", async () => {
    const response = await PUT(
      new NextRequest("http://localhost:3000/api/admin/form-config", {
        method: "PUT",
        body: JSON.stringify({ fields: [], groups: { id: "bad" } }),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Groups must be an array",
    });
  });

  it("upserts normalized schemas and returns the saved payload", async () => {
    const fields = [
      {
        id: "field_library_strategy",
        type: "text",
        label: "Library Strategy Notes",
        name: "libraryStrategyNotes",
        required: false,
        visible: true,
        order: 0,
        groupId: "custom_group",
      },
    ];
    const groups = [
      {
        id: "custom_group",
        name: "Sequencing custom section",
        order: 5,
      },
    ];

    const response = await PUT(
      new NextRequest("http://localhost:3000/api/admin/form-config", {
        method: "PUT",
        body: JSON.stringify({
          fields,
          groups,
          enabledMixsChecklists: ["air"],
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.db.orderFormConfig.upsert).toHaveBeenCalledTimes(1);
    const args = mocks.db.orderFormConfig.upsert.mock.calls[0][0] as {
      update: { schema: string; version: number };
    };
    const savedSchema = JSON.parse(args.update.schema) as {
      fields: Array<{ groupId?: string }>;
      groups: Array<{ id: string }>;
      enabledMixsChecklists: string[];
      moduleDefaultsVersion: number;
    };

    expect(args.update.version).toBe(4);
    expect(savedSchema.fields[0].groupId).toBe("group_sequencing");
    expect(savedSchema.groups.map((group) => group.id)).toEqual([
      "group_details",
      "group_sequencing",
    ]);
    expect(savedSchema.enabledMixsChecklists).toEqual(["air"]);
    expect(savedSchema.moduleDefaultsVersion).toBeTypeOf("number");

    expect(body).toMatchObject({
      id: "singleton",
      version: 4,
      enabledMixsChecklists: ["air"],
    });
    expect(body.fields[0].groupId).toBe("group_sequencing");
  });
});
