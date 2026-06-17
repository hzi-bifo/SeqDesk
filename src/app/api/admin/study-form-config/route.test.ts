import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  loadStudyFormSchema: vi.fn(),
  getFixedStudySections: vi.fn(),
  normalizeStudyFormSchema: vi.fn(),
  loadStudyFormConfigRow: vi.fn(),
  buildDefaultStudyForm: vi.fn(),
  saveStudyFormConfig: vi.fn(),
  db: {
    siteSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
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

vi.mock("@/lib/studies/fixed-sections", () => ({
  getFixedStudySections: mocks.getFixedStudySections,
  normalizeStudyFormSchema: mocks.normalizeStudyFormSchema,
}));

vi.mock("@/lib/modules/default-form-fields", () => ({
  STUDY_FORM_DEFAULTS_VERSION: 1,
}));

vi.mock("@/lib/studies/per-study-config", () => ({
  loadStudyFormConfigRow: mocks.loadStudyFormConfigRow,
  buildDefaultStudyForm: mocks.buildDefaultStudyForm,
  saveStudyFormConfig: mocks.saveStudyFormConfig,
}));

import { GET, PUT } from "./route";

describe("GET /api/admin/study-form-config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.getFixedStudySections.mockReturnValue([{ id: "general", label: "General" }]);
    mocks.loadStudyFormSchema.mockResolvedValue({
      fields: [{ id: "field-1", label: "Field 1" }],
      groups: [{ id: "general", label: "General" }],
    });
  });

  it("returns form schema for admin", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/admin/study-form-config")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.fields).toHaveLength(1);
    expect(body.groups).toHaveLength(1);
  });

  it("returns 401 for non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const response = await GET(
      new NextRequest("http://localhost/api/admin/study-form-config")
    );
    expect(response.status).toBe(401);
  });

  it("returns fallback when schema loading fails", async () => {
    mocks.loadStudyFormSchema.mockRejectedValue(new Error("parse error"));

    const response = await GET(
      new NextRequest("http://localhost/api/admin/study-form-config")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.fields).toEqual([]);
  });

  it("returns the study's own form for ?studyId when a row exists", async () => {
    mocks.loadStudyFormConfigRow.mockResolvedValue({
      fields: [{ id: "ps1", name: "per_study" }],
      groups: [{ id: "g", name: "G" }],
      defaultsVersion: 1,
    });
    const response = await GET(
      new NextRequest("http://localhost/api/admin/study-form-config?studyId=s1")
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(mocks.loadStudyFormConfigRow).toHaveBeenCalledWith("s1");
    expect(body.fields[0].name).toBe("per_study");
    expect(mocks.loadStudyFormSchema).not.toHaveBeenCalled();
  });

  it("returns default form fields for ?studyId when no row exists yet", async () => {
    mocks.loadStudyFormConfigRow.mockResolvedValue(null);
    mocks.buildDefaultStudyForm.mockReturnValue({
      fields: [{ id: "d1", name: "_sample_association" }],
      groups: [{ id: "g", name: "G" }],
      defaultsVersion: 1,
    });
    const response = await GET(
      new NextRequest("http://localhost/api/admin/study-form-config?studyId=s1")
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(mocks.buildDefaultStudyForm).toHaveBeenCalled();
    expect(body.fields[0].name).toBe("_sample_association");
  });
});

describe("PUT /api/admin/study-form-config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);
    mocks.db.siteSettings.upsert.mockResolvedValue({});
    mocks.normalizeStudyFormSchema.mockReturnValue({
      fields: [{ id: "field-1", label: "Field 1" }],
      groups: [{ id: "general", label: "General" }],
    });
    mocks.getFixedStudySections.mockReturnValue([{ id: "general", label: "General" }]);
  });

  it("saves form configuration", async () => {
    const request = new NextRequest(
      "http://localhost/api/admin/study-form-config",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fields: [{ id: "field-1", label: "Field 1" }],
          groups: [{ id: "general", label: "General" }],
        }),
      }
    );

    const response = await PUT(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mocks.db.siteSettings.upsert).toHaveBeenCalledTimes(1);
  });

  it("returns 401 for non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const request = new NextRequest(
      "http://localhost/api/admin/study-form-config",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fields: [], groups: [] }),
      }
    );

    const response = await PUT(request);
    expect(response.status).toBe(401);
  });

  it("returns 500 when db save fails", async () => {
    mocks.db.siteSettings.upsert.mockRejectedValue(new Error("db error"));

    const request = new NextRequest(
      "http://localhost/api/admin/study-form-config",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fields: [{ id: "f1", label: "F1" }],
          groups: [{ id: "general", label: "General" }],
        }),
      }
    );

    const response = await PUT(request);
    expect(response.status).toBe(500);
  });

  it("saves the per-study form for ?studyId via saveStudyFormConfig (not global settings)", async () => {
    mocks.saveStudyFormConfig.mockResolvedValue({});
    const request = new NextRequest(
      "http://localhost/api/admin/study-form-config?studyId=s1",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fields: [{ id: "f1", name: "x" }],
          groups: [{ id: "g", name: "G" }],
        }),
      }
    );
    const response = await PUT(request);
    expect(response.status).toBe(200);
    expect(mocks.saveStudyFormConfig).toHaveBeenCalledWith("s1", {
      fields: [{ id: "f1", name: "x" }],
      groups: [{ id: "g", name: "G" }],
    });
    expect(mocks.db.siteSettings.upsert).not.toHaveBeenCalled();
  });
});
