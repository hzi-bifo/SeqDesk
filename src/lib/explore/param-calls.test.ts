import { describe, expect, it } from "vitest";
import { schemaFromCode } from "./param-calls";

describe("schemaFromCode", () => {
  it("turns literal-default param calls into a schema and skips computed defaults", () => {
    const code = 'n = int(sx.param("max_columns", 12) or 12)  # Numeric columns to plot\nm = sx.param(\'metric\', "shannon")\nf = sx.param("flag", False)\nc = sx.param("computed", len(rows))\nn2 = sx.param("max_columns", 99)';
    expect(schemaFromCode(code)).toEqual({ type: "object", properties: {
      max_columns: { type: "integer", default: 12, title: "Numeric columns to plot" }, metric: { type: "string", default: "shannon" }, flag: { type: "boolean", default: false },
      computed: { computed: true, description: "The default is computed in the code. Change it there." },
    } });
  });
  it("reads R calls and returns null for code without parameters", () => {
    expect(schemaFromCode('x <- sx$param("x", 2.5)')).toEqual({ type: "object", properties: { x: { type: "number", default: 2.5 } } });
    expect(schemaFromCode("print(1)")).toBeNull();
  });
});
