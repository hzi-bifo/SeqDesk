import { describe, expect, it } from "vitest";
import {
  addDemoProjectsFieldToSchema,
  getDemoSiteSettingsUpdate,
} from "./seed";

describe("demo seed helpers", () => {
  it("adds the projects field to object-based order form schemas", () => {
    const updated = addDemoProjectsFieldToSchema(
      JSON.stringify({
        version: 1,
        groups: [{ id: "group_details", name: "Details", order: 0 }],
        fields: [
          {
            id: "name",
            type: "text",
            label: "Order Name",
            name: "name",
            required: true,
            visible: true,
            order: 0,
            groupId: "group_details",
          },
        ],
      })
    );

    const parsed = JSON.parse(updated) as {
      fields: Array<{ name: string }>;
    };

    expect(parsed.fields.map((field) => field.name)).toContain("_projects");
  });

  it("adds the projects field to array-based schemas without dropping existing fields", () => {
    const updated = addDemoProjectsFieldToSchema(
      JSON.stringify([
        {
          id: "name",
          type: "text",
          label: "Order Name",
          name: "name",
          required: true,
          visible: true,
          order: 0,
          groupId: "group_details",
        },
      ])
    );

    const parsed = JSON.parse(updated) as Array<{ name: string }>;

    expect(parsed).toHaveLength(2);
    expect(parsed.map((field) => field.name)).toEqual(["name", "_projects"]);
  });

  it("does not duplicate the projects field when it already exists", () => {
    const schema = JSON.stringify({
      fields: [
        {
          id: "demo_projects",
          type: "textarea",
          label: "Projects",
          name: "_projects",
          required: false,
          visible: true,
          order: 2,
          groupId: "group_details",
        },
      ],
    });

    expect(addDemoProjectsFieldToSchema(schema)).toBe(schema);
  });

  it("merges demo site settings with existing extra settings", () => {
    const updated = getDemoSiteSettingsUpdate(
      JSON.stringify({
        studyFormFields: [{ name: "principal_investigator" }],
        customFlag: true,
      })
    );

    const extraSettings = JSON.parse(updated.extraSettings) as Record<string, unknown>;

    expect(updated.siteName).toBe("SeqDesk Demo");
    expect(extraSettings.studyFormFields).toEqual([{ name: "principal_investigator" }]);
    expect(extraSettings.customFlag).toBe(true);
    expect(extraSettings.departmentSharing).toBe(false);
  });
});
