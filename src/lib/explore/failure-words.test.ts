import { describe, expect, it } from "vitest";
import { failureWords } from "./failure-words";

describe("failure words", () => {
  it("names a missing column", () => {
    expect(failureWords("4", "Traceback (most recent call last):\n  File \"analysis.py\", line 3\nKeyError: 'sample'")).toBe("Step 4 needs a column named sample, which the table does not have.");
    expect(failureWords("2", "Error in eval(expr): object 'condition' not found\nCalls: ...\nExecution halted")).toBe("Step 2 needs a column named condition, which the table does not have.");
    expect(failureWords("3", "Error in `[.data.frame`(x, , c(\"a\")) : undefined columns selected")).toBe("Step 3 asks for a column the table does not have.");
  });
  it("recognises memory, time, files and packages", () => {
    expect(failureWords("1", "MemoryError")).toBe("Step 1 ran out of memory.");
    expect(failureWords("1", "", 137)).toBe("Step 1 ran out of memory.");
    expect(failureWords("5", "slurmstepd: error: *** JOB 12 CANCELLED DUE TO TIME LIMIT ***")).toBe("Step 5 ran longer than the time limit allows.");
    expect(failureWords("2", "FileNotFoundError: [Errno 2] No such file or directory: '/data/x/samples.tsv'")).toBe("Step 2 could not find the file samples.tsv.");
    expect(failureWords("4b", "ModuleNotFoundError: No module named 'edgeR'")).toBe("Step 4b uses the edgeR package, which its environment does not have.");
    expect(failureWords("4b", "Error in library(DESeq2) : there is no package called ‘DESeq2’")).toBe("Step 4b uses the R package DESeq2, which its environment does not have.");
  });
  it("keeps the error's own line otherwise, clipped to 280 characters", () => {
    expect(failureWords("3", "some log\nValueError: groups must have two levels")).toBe("Step 3 stopped with an error: ValueError: groups must have two levels");
    expect(failureWords("3", null, 2)).toBe("Step 3 stopped with exit code 2.");
    expect(failureWords("3", `RuntimeError: ${"x".repeat(400)}`).length).toBe(280);
  });
});
