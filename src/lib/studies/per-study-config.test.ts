import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    studyFormConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));

vi.mock("@/lib/studies/fixed-sections", () => ({
  STUDY_INFORMATION_SECTION_ID: "group_study_info",
  STUDY_METADATA_SECTION_ID: "group_metadata",
  getFixedStudySections: () => [
    { id: "group_study_info", name: "Study Information", order: 0 },
  ],
  // Pass-through normalization so tests assert the helper's own behavior.
  normalizeStudyFormSchema: (input: {
    fields: unknown[];
    groups: unknown[];
  }) => ({ fields: input.fields, groups: input.groups }),
}));

vi.mock("@/lib/modules/default-form-fields", () => ({
  STUDY_FORM_DEFAULTS_VERSION: 3,
}));

import {
  buildDefaultStudyForm,
  cloneStudyForm,
  loadStudyFormConfigRow,
  saveStudyFormConfig,
  seedStudyFormConfig,
} from "./per-study-config";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.studyFormConfig.upsert.mockResolvedValue({});
});

describe("buildDefaultStudyForm", () => {
  it("produces the default study fields with unique ids and the defaults version", () => {
    const form = buildDefaultStudyForm();
    const names = form.fields.map((f) => f.name);
    expect(names).toContain("_sample_association");
    expect(names).toContain("principal_investigator");
    expect(names).toContain("_mixs");
    const ids = form.fields.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(form.groups.length).toBeGreaterThan(0);
    expect(form.defaultsVersion).toBe(3);
  });
});

describe("loadStudyFormConfigRow", () => {
  it("returns null when no row exists", async () => {
    mocks.db.studyFormConfig.findUnique.mockResolvedValue(null);
    expect(await loadStudyFormConfigRow("s1")).toBeNull();
  });

  it("parses stored JSON fields and groups", async () => {
    mocks.db.studyFormConfig.findUnique.mockResolvedValue({
      fields: JSON.stringify([
        { id: "f1", name: "x", type: "text", label: "X", required: false, visible: true, order: 0 },
      ]),
      groups: JSON.stringify([{ id: "g1", name: "G", order: 0 }]),
      defaultsVersion: 2,
    });
    const row = await loadStudyFormConfigRow("s1");
    expect(row?.fields[0].name).toBe("x");
    expect(row?.groups[0].id).toBe("g1");
    expect(row?.defaultsVersion).toBe(2);
  });

  it("returns null when stored JSON is invalid", async () => {
    mocks.db.studyFormConfig.findUnique.mockResolvedValue({
      fields: "not json",
      groups: "not json",
      defaultsVersion: 0,
    });
    expect(await loadStudyFormConfigRow("s1")).toBeNull();
  });
});

describe("saveStudyFormConfig", () => {
  it("upserts the study form as JSON keyed by studyId", async () => {
    const fields = [
      { id: "f1", name: "title", type: "text", label: "T", required: false, visible: true, order: 0 },
    ];
    const groups = [{ id: "g1", name: "G", order: 0 }];
    await saveStudyFormConfig("s1", { fields: fields as never, groups: groups as never });

    expect(mocks.db.studyFormConfig.upsert).toHaveBeenCalledTimes(1);
    const call = mocks.db.studyFormConfig.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ studyId: "s1" });
    expect(typeof call.create.fields).toBe("string");
    const savedFields = JSON.parse(call.create.fields);
    expect(savedFields.some((f: { name: string }) => f.name === "title")).toBe(true);
    expect(call.create.defaultsVersion).toBe(3);
  });
});

describe("cloneStudyForm", () => {
  it("regenerates field ids but keeps field data and group ids", () => {
    const source = {
      fields: [
        { id: "orig1", name: "a", type: "text", label: "A", required: false, visible: true, order: 0 },
      ],
      groups: [{ id: "g1", name: "G", order: 0 }],
      defaultsVersion: 1,
    };
    const clone = cloneStudyForm(source as never);
    expect(clone.fields[0].id).not.toBe("orig1");
    expect(clone.fields[0].name).toBe("a");
    expect(clone.groups[0].id).toBe("g1");
  });
});

describe("seedStudyFormConfig", () => {
  it("seeds a blank study from the defaults", async () => {
    await seedStudyFormConfig("s1", { mode: "blank" });
    expect(mocks.db.studyFormConfig.upsert).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(
      mocks.db.studyFormConfig.upsert.mock.calls[0][0].create.fields
    );
    expect(saved.some((f: { name: string }) => f.name === "_sample_association")).toBe(true);
  });

  it("seeds by cloning an existing study's form with fresh field ids", async () => {
    mocks.db.studyFormConfig.findUnique.mockResolvedValue({
      fields: JSON.stringify([
        { id: "src1", name: "cloned_field", type: "text", label: "C", required: false, visible: true, order: 0 },
      ]),
      groups: JSON.stringify([{ id: "g1", name: "G", order: 0 }]),
      defaultsVersion: 1,
    });
    await seedStudyFormConfig("s2", { mode: "clone", sourceStudyId: "s1" });

    const saved = JSON.parse(
      mocks.db.studyFormConfig.upsert.mock.calls[0][0].create.fields
    );
    const cloned = saved.find((f: { name: string }) => f.name === "cloned_field");
    expect(cloned).toBeDefined();
    expect(cloned.id).not.toBe("src1");
  });

  it("falls back to defaults when cloning a source with no form", async () => {
    mocks.db.studyFormConfig.findUnique.mockResolvedValue(null);
    await seedStudyFormConfig("s2", { mode: "clone", sourceStudyId: "missing" });
    const saved = JSON.parse(
      mocks.db.studyFormConfig.upsert.mock.calls[0][0].create.fields
    );
    expect(saved.some((f: { name: string }) => f.name === "_sample_association")).toBe(true);
  });
});
