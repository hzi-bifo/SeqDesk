import { describe, expect, it } from "vitest";
import { checkColumns } from "./flow-inputs";

describe("an input's check sentence", () => {
  it("does not count the internal sample id column, which is never shown or exported", () => {
    const columns = [
      { key: "sample_db_id", label: "Sample", type: "string" },
      { key: "sample_id", label: "Sample ID", type: "string" },
      { key: "reads", label: "Reads", type: "number" },
    ] as unknown as Parameters<typeof checkColumns>[1];
    const result = checkColumns({ kind: "table", columns: [] }, columns, 2, []);
    expect(result.ok).toBe(true);
    expect(result.sentence).toContain("2 columns");
  });
});
