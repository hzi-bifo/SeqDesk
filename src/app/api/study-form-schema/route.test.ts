import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
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
import {
  STUDY_INFORMATION_SECTION_ID,
  STUDY_METADATA_SECTION_ID,
} from "@/lib/studies/fixed-sections";

describe("GET /api/study-form-schema", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: JSON.stringify({
        studyFormFields: [
          {
            id: "field-study-visible",
            type: "text",
            label: "Legacy Field",
            name: "legacy_field",
            required: false,
            visible: true,
            order: 0,
            groupId: "legacy-metadata",
          },
          {
            id: "field-study-admin",
            type: "text",
            label: "Internal Study Note",
            name: "internal_study_note",
            required: false,
            visible: true,
            order: 1,
            adminOnly: true,
          },
          {
            id: "field-sample-visible",
            type: "text",
            label: "Host ID",
            name: "host_id",
            required: false,
            visible: true,
            order: 0,
            perSample: true,
          },
          {
            id: "field-sample-admin",
            type: "text",
            label: "Internal Sample Note",
            name: "internal_sample_note",
            required: false,
            visible: true,
            order: 1,
            perSample: true,
            adminOnly: true,
          },
        ],
        studyFormGroups: [
          {
            id: "legacy-metadata",
            name: "Legacy Metadata",
            description: "Old metadata bucket",
            icon: "FileText",
            order: 0,
          },
        ],
        studyFormDefaultsVersion: 9999,
      }),
      modulesConfig: JSON.stringify({
        modules: {
          "mixs-metadata": true,
          "funding-info": true,
        },
        globalDisabled: false,
      }),
    });
  });

  it("filters out facility-only fields for researchers and normalizes groups", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "user-1",
        role: "RESEARCHER",
      },
    });

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.fields.map((field: { name: string }) => field.name)).toEqual([
      "legacy_field",
      "host_id",
    ]);
    expect(body.studyFields.map((field: { name: string }) => field.name)).toEqual([
      "legacy_field",
    ]);
    expect(body.perSampleFields.map((field: { name: string }) => field.name)).toEqual([
      "host_id",
    ]);
    expect(body.groups).toEqual([
      expect.objectContaining({
        id: STUDY_INFORMATION_SECTION_ID,
        name: "Study Information",
      }),
      expect.objectContaining({
        id: STUDY_METADATA_SECTION_ID,
        name: "Metadata",
      }),
    ]);
    expect(
      body.studyFields.find((field: { name: string }) => field.name === "legacy_field")
    ).toEqual(
      expect.objectContaining({
        groupId: STUDY_METADATA_SECTION_ID,
      })
    );
  });

  it("keeps facility-only study and sample fields for facility admins", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        id: "admin-1",
        role: "FACILITY_ADMIN",
      },
    });

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.fields.map((field: { name: string }) => field.name)).toEqual([
      "legacy_field",
      "host_id",
      "internal_study_note",
      "internal_sample_note",
    ]);
    expect(body.studyFields.map((field: { name: string }) => field.name)).toEqual([
      "legacy_field",
      "internal_study_note",
    ]);
    expect(body.perSampleFields.map((field: { name: string }) => field.name)).toEqual([
      "host_id",
      "internal_sample_note",
    ]);
  });
});
