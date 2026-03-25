import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ACCOUNT_VALIDATION_SETTINGS,
  DEFAULT_BILLING_SETTINGS,
} from "@/lib/modules/types";

const defaultSequencingFilesConfig = {
  allowedExtensions: [".fastq.gz", ".fq.gz", ".fastq", ".fq"],
  scanDepth: 2,
  ignorePatterns: ["**/tmp/**", "**/undetermined/**"],
  allowSingleEnd: true,
  autoAssign: false,
  simulationMode: "auto",
  simulationTemplateDir: "",
};

const mocks = vi.hoisted(() => ({
  studyFormDefaultsVersion: 7,
  getServerSession: vi.fn(),
  resolveDataBasePathFromStoredValue: vi.fn(),
  loadStudyFormSchema: vi.fn(),
  getFixedStudySections: vi.fn(),
  normalizeStudyFormSchema: vi.fn(),
  db: {
    siteSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    department: {
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

vi.mock("@/lib/files/data-base-path", () => ({
  resolveDataBasePathFromStoredValue: mocks.resolveDataBasePathFromStoredValue,
}));

vi.mock("@/lib/studies/schema", () => ({
  loadStudyFormSchema: mocks.loadStudyFormSchema,
}));

vi.mock("@/lib/studies/fixed-sections", () => ({
  getFixedStudySections: mocks.getFixedStudySections,
  normalizeStudyFormSchema: mocks.normalizeStudyFormSchema,
}));

vi.mock("@/lib/modules/default-form-fields", () => ({
  STUDY_FORM_DEFAULTS_VERSION: mocks.studyFormDefaultsVersion,
}));

import {
  GET as getAccountValidation,
  PUT as putAccountValidation,
} from "./modules/account-validation/route";
import { GET as getBilling, PUT as putBilling } from "./modules/billing/route";
import {
  GET as getDepartmentImportUrl,
  POST as postDepartmentImportUrl,
} from "./departments/import-url/route";
import { GET as getSequencingFiles, PUT as putSequencingFiles } from "./settings/sequencing-files/route";
import { GET as getStudyFormConfig, PUT as putStudyFormConfig } from "./study-form-config/route";
import { GET as getDepartments } from "../departments/route";

const adminSession = {
  user: {
    id: "admin-1",
    role: "FACILITY_ADMIN",
  },
};

function jsonRequest(path: string, method: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  }) as never;
}

function lastUpsertCall() {
  return mocks.db.siteSettings.upsert.mock.calls.at(-1)?.[0] as {
    update: {
      extraSettings: string;
      dataBasePath?: string | null;
      postSubmissionInstructions?: string | null;
    };
    create: {
      id: string;
      extraSettings: string;
      dataBasePath?: string | null;
      postSubmissionInstructions?: string | null;
    };
  };
}

describe("admin settings and modules coverage quick wins", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-25T12:00:00.000Z"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.resolveDataBasePathFromStoredValue.mockReturnValue({
      dataBasePath: "/resolved/base",
      source: "stored",
      isImplicit: false,
    });
    mocks.getFixedStudySections.mockReturnValue([
      { id: "fixed", title: "Fixed section", fields: [] },
    ]);
    mocks.normalizeStudyFormSchema.mockImplementation((schema) => schema);
    mocks.loadStudyFormSchema.mockResolvedValue({
      fields: [{ id: "study-field" }],
      groups: [{ id: "study-group" }],
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      extraSettings: null,
      dataBasePath: null,
      postSubmissionInstructions: null,
    });
    mocks.db.siteSettings.upsert.mockResolvedValue(undefined);
    mocks.db.department.findMany.mockResolvedValue([
      {
        id: "dep-1",
        name: "Biology",
        description: "Core biology",
      },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("covers account validation settings branches", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorized = await getAccountValidation();
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });

    mocks.getServerSession.mockResolvedValueOnce({ user: { id: "user-1", role: "RESEARCHER" } });
    mocks.db.siteSettings.findUnique.mockResolvedValueOnce({
      extraSettings: JSON.stringify({
        accountValidationSettings: "{bad-json",
      }),
    });
    const defaults = await getAccountValidation();
    expect(defaults.status).toBe(200);
    expect(await defaults.json()).toEqual({
      settings: DEFAULT_ACCOUNT_VALIDATION_SETTINGS,
    });

    mocks.db.siteSettings.findUnique.mockRejectedValueOnce(new Error("db down"));
    const failedGet = await getAccountValidation();
    expect(failedGet.status).toBe(500);
    expect(await failedGet.json()).toEqual({
      error: "Failed to fetch settings",
    });

    mocks.getServerSession.mockResolvedValueOnce({ user: { id: "user-2", role: "RESEARCHER" } });
    const unauthorizedPut = await putAccountValidation(
      jsonRequest("/api/admin/modules/account-validation", "PUT", {
        settings: DEFAULT_ACCOUNT_VALIDATION_SETTINGS,
      })
    );
    expect(unauthorizedPut.status).toBe(401);
    expect(await unauthorizedPut.json()).toEqual({ error: "Unauthorized" });

    const missingSettings = await putAccountValidation(
      jsonRequest("/api/admin/modules/account-validation", "PUT", {})
    );
    expect(missingSettings.status).toBe(400);
    expect(await missingSettings.json()).toEqual({
      error: "Settings are required",
    });

    mocks.db.siteSettings.findUnique.mockResolvedValueOnce({
      extraSettings: JSON.stringify({
        keep: "value",
      }),
    });
    const success = await putAccountValidation(
      jsonRequest("/api/admin/modules/account-validation", "PUT", {
        settings: {
          allowedDomains: [" HZI.DE ", "", "invalid", "Example.org "],
          enforceValidation: false,
        },
      })
    );
    expect(success.status).toBe(200);
    expect(await success.json()).toEqual({
      settings: {
        allowedDomains: ["hzi.de", "example.org"],
        enforceValidation: false,
      },
    });
    expect(JSON.parse(lastUpsertCall().update.extraSettings)).toEqual({
      keep: "value",
      accountValidationSettings: JSON.stringify({
        allowedDomains: ["hzi.de", "example.org"],
        enforceValidation: false,
      }),
    });

    mocks.db.siteSettings.upsert.mockRejectedValueOnce(new Error("write failed"));
    const failedPut = await putAccountValidation(
      jsonRequest("/api/admin/modules/account-validation", "PUT", {
        settings: DEFAULT_ACCOUNT_VALIDATION_SETTINGS,
      })
    );
    expect(failedPut.status).toBe(500);
    expect(await failedPut.json()).toEqual({
      error: "Failed to update settings",
    });
  });

  it("covers billing settings branches and validation errors", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorized = await getBilling();
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });

    mocks.getServerSession.mockResolvedValueOnce({ user: { id: "user-1", role: "RESEARCHER" } });
    mocks.db.siteSettings.findUnique.mockResolvedValueOnce({
      extraSettings: JSON.stringify({
        billingSettings: "{bad-json",
      }),
    });
    const defaults = await getBilling();
    expect(defaults.status).toBe(200);
    expect(await defaults.json()).toEqual({
      settings: DEFAULT_BILLING_SETTINGS,
    });

    mocks.db.siteSettings.findUnique.mockRejectedValueOnce(new Error("db down"));
    const failedGet = await getBilling();
    expect(failedGet.status).toBe(500);
    expect(await failedGet.json()).toEqual({
      error: "Failed to fetch settings",
    });

    mocks.getServerSession.mockResolvedValueOnce({ user: { id: "user-2", role: "RESEARCHER" } });
    const unauthorizedPut = await putBilling(
      jsonRequest("/api/admin/modules/billing", "PUT", {
        settings: DEFAULT_BILLING_SETTINGS,
      })
    );
    expect(unauthorizedPut.status).toBe(401);
    expect(await unauthorizedPut.json()).toEqual({ error: "Unauthorized" });

    const missingSettings = await putBilling(
      jsonRequest("/api/admin/modules/billing", "PUT", {})
    );
    expect(missingSettings.status).toBe(400);
    expect(await missingSettings.json()).toEqual({
      error: "Settings are required",
    });

    const invalidPrefix = await putBilling(
      jsonRequest("/api/admin/modules/billing", "PUT", {
        settings: {
          ...DEFAULT_BILLING_SETTINGS,
          pspPrefixRange: { min: -1, max: 9 },
        },
      })
    );
    expect(invalidPrefix.status).toBe(400);
    expect(await invalidPrefix.json()).toEqual({
      error: "PSP prefix range must be between 0 and 9",
    });

    const invalidMainDigits = await putBilling(
      jsonRequest("/api/admin/modules/billing", "PUT", {
        settings: {
          ...DEFAULT_BILLING_SETTINGS,
          pspMainDigits: 21,
        },
      })
    );
    expect(invalidMainDigits.status).toBe(400);
    expect(await invalidMainDigits.json()).toEqual({
      error: "PSP main digits must be between 1 and 20",
    });

    const invalidSuffix = await putBilling(
      jsonRequest("/api/admin/modules/billing", "PUT", {
        settings: {
          ...DEFAULT_BILLING_SETTINGS,
          pspSuffixRange: { min: 0, max: 100 },
        },
      })
    );
    expect(invalidSuffix.status).toBe(400);
    expect(await invalidSuffix.json()).toEqual({
      error: "PSP suffix range must be between 0 and 99",
    });

    mocks.db.siteSettings.findUnique.mockResolvedValueOnce({
      extraSettings: "{bad-json",
    });
    const success = await putBilling(
      jsonRequest("/api/admin/modules/billing", "PUT", {
        settings: {
          ...DEFAULT_BILLING_SETTINGS,
          costCenterPattern: "^[0-9]{8}$",
        },
      })
    );
    expect(success.status).toBe(200);
    expect(await success.json()).toEqual({
      settings: {
        ...DEFAULT_BILLING_SETTINGS,
        costCenterPattern: "^[0-9]{8}$",
      },
    });
    expect(JSON.parse(lastUpsertCall().update.extraSettings)).toEqual({
      billingSettings: JSON.stringify({
        ...DEFAULT_BILLING_SETTINGS,
        costCenterPattern: "^[0-9]{8}$",
      }),
    });

    mocks.db.siteSettings.upsert.mockRejectedValueOnce(new Error("write failed"));
    const failedPut = await putBilling(
      jsonRequest("/api/admin/modules/billing", "PUT", {
        settings: DEFAULT_BILLING_SETTINGS,
      })
    );
    expect(failedPut.status).toBe(500);
    expect(await failedPut.json()).toEqual({
      error: "Failed to update settings",
    });
  });

  it("covers sequencing files settings branches", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorized = await getSequencingFiles();
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });

    mocks.db.siteSettings.findUnique.mockResolvedValueOnce({
      dataBasePath: "/configured/base",
      extraSettings: JSON.stringify({
        sequencingFiles: {
          scanDepth: 5,
          allowSingleEnd: false,
          autoAssign: true,
        },
      }),
    });
    const success = await getSequencingFiles();
    expect(success.status).toBe(200);
    expect(mocks.resolveDataBasePathFromStoredValue).toHaveBeenCalledWith("/configured/base");
    expect(await success.json()).toEqual({
      dataBasePath: "/resolved/base",
      configuredDataBasePath: "/configured/base",
      dataBasePathSource: "stored",
      dataBasePathIsImplicit: false,
      config: {
        ...defaultSequencingFilesConfig,
        scanDepth: 5,
        autoAssign: true,
        allowSingleEnd: true,
      },
    });

    mocks.db.siteSettings.findUnique.mockRejectedValueOnce(new Error("db down"));
    const fallback = await getSequencingFiles();
    expect(fallback.status).toBe(200);
    expect(await fallback.json()).toEqual({
      dataBasePath: "",
      configuredDataBasePath: "",
      dataBasePathSource: "none",
      dataBasePathIsImplicit: false,
      config: defaultSequencingFilesConfig,
    });

    mocks.getServerSession.mockResolvedValueOnce({ user: { id: "user-1", role: "RESEARCHER" } });
    const unauthorizedPut = await putSequencingFiles(
      jsonRequest("/api/admin/settings/sequencing-files", "PUT", {
        dataBasePath: "/configured/base",
      })
    );
    expect(unauthorizedPut.status).toBe(401);
    expect(await unauthorizedPut.json()).toEqual({ error: "Unauthorized" });

    mocks.db.siteSettings.findUnique.mockResolvedValueOnce({
      extraSettings: JSON.stringify({
        sequencingFiles: {
          autoAssign: true,
          ignorePatterns: ["**/keep/**"],
        },
      }),
    });
    const saved = await putSequencingFiles(
      jsonRequest("/api/admin/settings/sequencing-files", "PUT", {
        dataBasePath: "   ",
        config: {
          scanDepth: 4,
          allowSingleEnd: false,
          simulationMode: "synthetic",
        },
      })
    );
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ success: true });
    expect(lastUpsertCall().update.dataBasePath).toBeNull();
    expect(JSON.parse(lastUpsertCall().update.extraSettings)).toEqual({
      sequencingFiles: {
        ...defaultSequencingFilesConfig,
        autoAssign: true,
        ignorePatterns: ["**/keep/**"],
        scanDepth: 4,
        simulationMode: "synthetic",
        allowSingleEnd: true,
      },
    });

    mocks.db.siteSettings.findUnique.mockRejectedValueOnce(new Error("write failed"));
    const failedPut = await putSequencingFiles(
      jsonRequest("/api/admin/settings/sequencing-files", "PUT", {
        config: { scanDepth: 3 },
      })
    );
    expect(failedPut.status).toBe(500);
    expect(await failedPut.json()).toEqual({
      error: "Failed to save settings",
    });
  });

  it("covers department import url routes", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorized = await getDepartmentImportUrl();
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });

    mocks.db.siteSettings.findUnique.mockResolvedValueOnce(null);
    const empty = await getDepartmentImportUrl();
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({
      url: null,
      lastImportedAt: null,
    });

    mocks.db.siteSettings.findUnique.mockResolvedValueOnce({
      extraSettings: "{bad-json",
    });
    const fallback = await getDepartmentImportUrl();
    expect(fallback.status).toBe(200);
    expect(await fallback.json()).toEqual({
      url: null,
      lastImportedAt: null,
    });

    mocks.getServerSession.mockResolvedValueOnce({ user: { id: "user-1", role: "RESEARCHER" } });
    const unauthorizedPost = await postDepartmentImportUrl(
      jsonRequest("/api/admin/departments/import-url", "POST", {
        url: "https://example.test/departments.csv",
      })
    );
    expect(unauthorizedPost.status).toBe(401);
    expect(await unauthorizedPost.json()).toEqual({ error: "Unauthorized" });

    mocks.db.siteSettings.findUnique.mockResolvedValueOnce({
      extraSettings: JSON.stringify({
        keep: "value",
      }),
    });
    const saved = await postDepartmentImportUrl(
      jsonRequest("/api/admin/departments/import-url", "POST", {
        url: "https://example.test/departments.csv",
      })
    );
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ success: true });
    expect(JSON.parse(lastUpsertCall().update.extraSettings)).toEqual({
      keep: "value",
      departmentImportUrl: "https://example.test/departments.csv",
      departmentImportLastUsed: "2026-03-25T12:00:00.000Z",
    });

    mocks.db.siteSettings.upsert.mockRejectedValueOnce(new Error("write failed"));
    const failed = await postDepartmentImportUrl(
      jsonRequest("/api/admin/departments/import-url", "POST", {
        url: "https://example.test/departments.csv",
      })
    );
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: "Failed to save URL",
    });
  });

  it("covers study form configuration routes", async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);
    const unauthorized = await getStudyFormConfig();
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });

    const success = await getStudyFormConfig();
    expect(success.status).toBe(200);
    expect(mocks.loadStudyFormSchema).toHaveBeenCalledWith({
      isFacilityAdmin: true,
      applyRoleFilter: false,
      applyModuleFilter: false,
    });
    expect(await success.json()).toEqual({
      fields: [{ id: "study-field" }],
      groups: [{ id: "study-group" }],
    });

    mocks.loadStudyFormSchema.mockRejectedValueOnce(new Error("load failed"));
    const fallback = await getStudyFormConfig();
    expect(fallback.status).toBe(200);
    expect(await fallback.json()).toEqual({
      fields: [],
      groups: [{ id: "fixed", title: "Fixed section", fields: [] }],
    });

    mocks.getServerSession.mockResolvedValueOnce({ user: { id: "user-1", role: "RESEARCHER" } });
    const unauthorizedPut = await putStudyFormConfig(
      jsonRequest("/api/admin/study-form-config", "PUT", {
        fields: [],
        groups: [],
      })
    );
    expect(unauthorizedPut.status).toBe(401);
    expect(await unauthorizedPut.json()).toEqual({ error: "Unauthorized" });

    mocks.db.siteSettings.findUnique.mockResolvedValueOnce({
      extraSettings: JSON.stringify({
        keep: "value",
      }),
    });
    mocks.normalizeStudyFormSchema.mockReturnValueOnce({
      fields: [{ id: "normalized-field" }],
      groups: [{ id: "normalized-group" }],
    });
    const saved = await putStudyFormConfig(
      jsonRequest("/api/admin/study-form-config", "PUT", {
        fields: [{ id: "raw-field" }],
      })
    );
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ success: true });
    expect(mocks.normalizeStudyFormSchema).toHaveBeenCalledWith({
      fields: [{ id: "raw-field" }],
      groups: [{ id: "fixed", title: "Fixed section", fields: [] }],
    });
    expect(JSON.parse(lastUpsertCall().update.extraSettings)).toEqual({
      keep: "value",
      studyFormFields: [{ id: "normalized-field" }],
      studyFormGroups: [{ id: "normalized-group" }],
      studyFormDefaultsVersion: mocks.studyFormDefaultsVersion,
    });

    mocks.db.siteSettings.upsert.mockRejectedValueOnce(new Error("write failed"));
    const failedPut = await putStudyFormConfig(
      jsonRequest("/api/admin/study-form-config", "PUT", {
        fields: [],
        groups: [],
      })
    );
    expect(failedPut.status).toBe(500);
    expect(await failedPut.json()).toEqual({
      error: "Failed to save configuration",
    });
  });

  it("covers public departments route success and failure", async () => {
    const success = await getDepartments();
    expect(success.status).toBe(200);
    expect(mocks.db.department.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
      },
    });
    expect(await success.json()).toEqual([
      {
        id: "dep-1",
        name: "Biology",
        description: "Core biology",
      },
    ]);

    mocks.db.department.findMany.mockRejectedValueOnce(new Error("db down"));
    const failed = await getDepartments();
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: "Failed to fetch departments",
    });
  });
});
