import { describe, expect, it } from "vitest";
import { buildVariables, formatVariableValue, parseVariableRef, resolveVariable, resolveVariablesInMarkdown, stepSlug, variableReference } from "./variables";

const variables = buildVariables([
  { analysisId: "a1", name: "Cohort overview", runNumber: "EXP-13", metrics: { n_samples: 874, n_taxa: 1567, total_reads: 49178386.2, group: "Urine", ok: true, missing: null } },
  { analysisId: "a2", name: "Beta diversity (PCoA)", runNumber: "EXP-15", metrics: { permanova_group_p: 0.001, permanova_group_R2: 0.062867 } },
  { analysisId: "a3", name: "Beta diversity (PCoA)", runNumber: null, metrics: {} },
]);

describe("variables", () => {
  it("names steps by slug and keeps duplicates apart", () => {
    expect(stepSlug("Beta diversity (PCoA)")).toBe("beta_diversity_pcoa");
    expect(stepSlug("Äpfel & Birnen")).toBe("apfel_birnen");
    expect(variables.steps.map((step) => step.slug)).toEqual(["cohort_overview", "beta_diversity_pcoa", "beta_diversity_pcoa_2"]);
  });

  it("reads R-style references with optional decimals", () => {
    expect(parseVariableRef("r cohort_overview.n_samples")).toEqual({ step: "cohort_overview", metric: "n_samples", digits: null });
    expect(parseVariableRef(" r Beta_Diversity_PCoA.permanova_group_R2 | 3 ")).toEqual({ step: "beta_diversity_pcoa", metric: "permanova_group_R2", digits: 3 });
    expect(parseVariableRef("r n_samples")).toBeNull();
    expect(parseVariableRef("print(x)")).toBeNull();
  });

  it("formats values the way a reader expects", () => {
    expect(formatVariableValue(874)).toBe("874");
    expect(formatVariableValue(49178386.2)).toBe("49.2M");
    expect(formatVariableValue(1417113.3)).toBe("1.4M");
    expect(formatVariableValue(0.062867)).toBe("0.0629");
    expect(formatVariableValue(13.0745)).toBe("13.07");
    expect(formatVariableValue(0.062867, 3)).toBe("0.063");
    expect(formatVariableValue(true)).toBe("yes");
    expect(formatVariableValue(null)).toBe("n/a");
  });

  it("resolves references and marks unknown ones instead of failing", () => {
    expect(resolveVariable("r cohort_overview.n_samples", variables)).toMatchObject({ found: true, text: "874", step: { runNumber: "EXP-13" } });
    expect(resolveVariable("r beta_diversity_pcoa.permanova_group_R2 | 2", variables)?.text).toBe("0.06");
    expect(resolveVariable("r beta_diversity_pcoa.permanova_group_r2 | 2", variables)?.text).toBe("0.06");
    expect(resolveVariable("r cohort_overview.nope", variables)).toMatchObject({ found: false, text: "?cohort_overview.nope" });
    expect(resolveVariable("r gone.n_samples", variables)).toMatchObject({ found: false, step: null });
    expect(resolveVariable("ls -la", variables)).toBeNull();
  });

  it("rewrites Markdown for renderers without a code element", () => {
    const markdown = "Of `r cohort_overview.n_samples` samples, PERMANOVA p = `r beta_diversity_pcoa.permanova_group_p | 3`; `code stays` and `r gone.x` is marked.";
    expect(resolveVariablesInMarkdown(markdown, variables)).toBe("Of 874 samples, PERMANOVA p = 0.001; `code stays` and ?gone.x is marked.");
    expect(variableReference(variables.steps[0], "n_taxa")).toBe("`r cohort_overview.n_taxa`");
  });
});
