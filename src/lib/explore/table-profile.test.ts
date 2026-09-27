import { describe, expect, it } from "vitest";
import { checkColumns } from "./flow-inputs";
import { profileLine, profileNumericMatrix } from "./table-profile";

const cols = [{ key: "gene", type: "string" }, { key: "s1", type: "number" }, { key: "s2", type: "number" }, { key: "s3", type: "number" }];

describe("table profile", () => {
  it("calls whole non-negative numbers raw counts", () => {
    const profile = profileNumericMatrix(cols, [{ gene: "A", s1: 10, s2: 0, s3: "4" }, { gene: "B", s1: 3, s2: 7, s3: "1" }]);
    expect(profile?.verdict).toBe("raw-counts");
    expect(profile?.sentence).toBe("raw counts, whole numbers");
  });

  it("calls decimals with equal column sums normalised", () => {
    const profile = profileNumericMatrix(cols, [{ gene: "A", s1: 400.5, s2: 700.25, s3: "500.5" }, { gene: "B", s1: 599.5, s2: 299.75, s3: "499.5" }]);
    expect(profile?.verdict).toBe("normalised");
    expect(profile?.sentence).toBe("normalised, not raw counts");
    expect(profile?.why).toContain("column sums are all");
  });

  it("hints log scale for negative values or a small range", () => {
    expect(profileNumericMatrix(cols, [{ gene: "A", s1: -1.2, s2: 3.4, s3: 1.5 }, { gene: "B", s1: 5.1, s2: 8.2, s3: 2.5 }])?.verdict).toBe("log-scale");
    expect(profileNumericMatrix(cols, [{ gene: "A", s1: 1.2, s2: 3.4, s3: 1.5 }, { gene: "B", s1: 5.1, s2: 12.2, s3: 2.5 }])?.verdict).toBe("log-scale");
  });

  it("is null for tables that are not matrices", () => {
    expect(profileNumericMatrix([{ key: "gene", type: "string" }, { key: "s1", type: "number" }], [{ gene: "A", s1: 1 }])).toBeNull();
    // A sample sheet (Phenodata: id, dose, time, replicate, condition, RIN) is not a matrix.
    const sheet = [{ key: "sample_ID", type: "string", role: "sample" }, { key: "dose", type: "number" }, { key: "time", type: "number" }, { key: "rep", type: "number" }, { key: "condition", type: "string" }, { key: "RIN", type: "number" }];
    expect(profileNumericMatrix(sheet, [{ sample_ID: "TR1", dose: 0, time: 24, rep: 1, condition: "c", RIN: 9.1 }])).toBeNull();
  });

  it("puts the finding into the input check sentence", () => {
    const rows = [{ gene: "A", s1: 400.5, s2: 700.25, s3: 500.5 }, { gene: "B", s1: 599.5, s2: 299.75, s3: 499.5 }];
    const profile = profileNumericMatrix(cols, rows)!;
    const counts = checkColumns({ kind: "counts", columns: [] }, cols, 2, rows, profile);
    expect(counts.ok).toBe(false);
    expect(counts.sentence.startsWith(profileLine(profile))).toBe(true);
    const table = checkColumns({ kind: "table", columns: [] }, cols, 2, rows, profile);
    expect(table.ok).toBe(true);
    expect(table.sentence).toContain("Normalised, not raw counts");
    const raw = [{ gene: "A", s1: 1, s2: 2, s3: 3 }, { gene: "B", s1: 3, s2: 4, s3: 5 }];
    expect(checkColumns({ kind: "counts", columns: [] }, cols, 2, raw, profileNumericMatrix(cols, raw)).sentence).toContain("raw counts, whole numbers");
  });
});
