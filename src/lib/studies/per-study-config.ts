// Per-study questionnaire storage (the `dynamic-studies` module). These helpers
// read/write the StudyFormConfig 1:1 row for a study, and seed new studies
// (blank-with-defaults or cloned from an existing study). When the module is
// off, nothing here is used — loaders fall back to the global study form.
import { db } from "@/lib/db";
import {
  STUDY_INFORMATION_SECTION_ID,
  STUDY_METADATA_SECTION_ID,
  getFixedStudySections,
  normalizeStudyFormSchema,
} from "@/lib/studies/fixed-sections";
import { STUDY_FORM_DEFAULTS_VERSION } from "@/lib/modules/default-form-fields";
import type { FormFieldDefinition, FormFieldGroup } from "@/types/form-config";

export interface StoredStudyForm {
  fields: FormFieldDefinition[];
  groups: FormFieldGroup[];
  defaultsVersion: number;
}

function newFieldId(prefix = "field"): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

// Minimal default questionnaire for a brand-new ("blank") study — mirrors the
// admin builder's getDefaultStudyFields so a blank study opens functional, not
// empty. Deliberately NOT a copy of the global study form.
export function buildDefaultStudyForm(): StoredStudyForm {
  const fields: FormFieldDefinition[] = [
    {
      id: newFieldId("field_sample_association"),
      type: "text",
      label: "Sample Association",
      name: "_sample_association",
      required: false,
      visible: true,
      helpText: "Interface to associate samples from orders to this study",
      order: 0,
    },
    {
      id: newFieldId("field_pi"),
      type: "text",
      label: "Principal Investigator",
      name: "principal_investigator",
      required: false,
      visible: true,
      helpText: "Lead researcher responsible for this study",
      order: 1,
      groupId: STUDY_INFORMATION_SECTION_ID,
      perSample: false,
    },
    {
      id: newFieldId("field_abstract"),
      type: "textarea",
      label: "Study Abstract",
      name: "study_abstract",
      required: false,
      visible: true,
      helpText: "Brief description of the study",
      order: 2,
      groupId: STUDY_INFORMATION_SECTION_ID,
      perSample: false,
    },
    {
      id: newFieldId("field_mixs"),
      type: "mixs",
      label: "MIxS Metadata",
      name: "_mixs",
      required: false,
      visible: true,
      helpText: "Environment-specific metadata fields following MIxS standards",
      order: 3,
      groupId: STUDY_METADATA_SECTION_ID,
      perSample: false,
      moduleSource: "mixs-metadata",
    },
  ];
  const normalized = normalizeStudyFormSchema({
    fields,
    groups: getFixedStudySections(),
  });
  return {
    fields: normalized.fields,
    groups: normalized.groups,
    defaultsVersion: STUDY_FORM_DEFAULTS_VERSION,
  };
}

// Load a study's stored per-study form (parsed), or null if none exists.
export async function loadStudyFormConfigRow(
  studyId: string
): Promise<StoredStudyForm | null> {
  const row = await db.studyFormConfig.findUnique({
    where: { studyId },
    select: { fields: true, groups: true, defaultsVersion: true },
  });
  if (!row) return null;
  try {
    const fields = JSON.parse(row.fields);
    const groups = JSON.parse(row.groups);
    return {
      fields: Array.isArray(fields) ? fields : [],
      groups:
        Array.isArray(groups) && groups.length > 0
          ? groups
          : getFixedStudySections(),
      defaultsVersion: row.defaultsVersion,
    };
  } catch {
    return null;
  }
}

// Normalize + upsert a study's form config.
export async function saveStudyFormConfig(
  studyId: string,
  input: { fields: FormFieldDefinition[]; groups: FormFieldGroup[] }
): Promise<StoredStudyForm> {
  const normalized = normalizeStudyFormSchema({
    fields: input.fields || [],
    groups: input.groups || getFixedStudySections(),
  });
  const fieldsJson = JSON.stringify(normalized.fields);
  const groupsJson = JSON.stringify(normalized.groups);
  await db.studyFormConfig.upsert({
    where: { studyId },
    update: {
      fields: fieldsJson,
      groups: groupsJson,
      defaultsVersion: STUDY_FORM_DEFAULTS_VERSION,
    },
    create: {
      studyId,
      fields: fieldsJson,
      groups: groupsJson,
      defaultsVersion: STUDY_FORM_DEFAULTS_VERSION,
    },
  });
  return {
    fields: normalized.fields,
    groups: normalized.groups,
    defaultsVersion: STUDY_FORM_DEFAULTS_VERSION,
  };
}

// Deep-copy a form with regenerated field ids (clone correctness — field ids
// must be unique within a form; group ids are kept so groupId refs stay valid).
export function cloneStudyForm(source: StoredStudyForm): StoredStudyForm {
  return {
    fields: source.fields.map((field) => ({ ...field, id: newFieldId() })),
    groups: source.groups.map((group) => ({ ...group })),
    defaultsVersion: STUDY_FORM_DEFAULTS_VERSION,
  };
}

// Seed a new study's form config: blank (defaults) or cloned from another study.
export async function seedStudyFormConfig(
  studyId: string,
  seed: { mode: "blank" } | { mode: "clone"; sourceStudyId: string }
): Promise<StoredStudyForm> {
  let form: StoredStudyForm;
  if (seed.mode === "clone") {
    const source =
      (await loadStudyFormConfigRow(seed.sourceStudyId)) ??
      buildDefaultStudyForm();
    form = cloneStudyForm(source);
  } else {
    form = buildDefaultStudyForm();
  }
  return saveStudyFormConfig(studyId, {
    fields: form.fields,
    groups: form.groups,
  });
}
