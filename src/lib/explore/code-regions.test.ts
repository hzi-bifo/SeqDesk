import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { codeRegions, normaliseLines, stripComment } from "./code-regions";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

describe("code regions", () => {
  it("splits at blank lines and hashes the normalised text", () => {
    const code = "import pandas as pd  # tables\n\ncounts = sx.input('counts')\nkeep = counts[counts.reads >=  10]\n\n# just a comment\n";
    expect(codeRegions(code)).toEqual([
      { index: 0, lineStart: 1, lineEnd: 1, regionHash: sha("import pandas as pd") },
      { index: 1, lineStart: 3, lineEnd: 4, regionHash: sha("counts = sx.input('counts')\nkeep = counts[counts.reads >= 10]") },
    ]);
  });
  it("splits at # --- lines when there are any", () => {
    const code = "a <- 1\n\nb <- 2\n# ---\nc <- 3\r\n#-----\n\n";
    expect(codeRegions(code).map((region) => [region.lineStart, region.lineEnd])).toEqual([[1, 3], [5, 5]]);
    expect(codeRegions(code)[0].regionHash).toBe(sha("a <- 1\nb <- 2"));
  });
  it("keeps # inside strings and ignores comment and whitespace edits", () => {
    expect(stripComment(`x = "#fff" # colour`)).toBe(`x = "#fff" `);
    expect(stripComment(`y = 'it\\'s # here' # c`)).toBe(`y = 'it\\'s # here' `);
    const before = codeRegions("x = 1  # first\ny = 2")[0].regionHash;
    const after = codeRegions("x =   1  # changed comment\n  y = 2")[0].regionHash;
    expect(after).toBe(before);
    expect(normaliseLines(["", "  # only", " z  =  3 "])).toBe("z = 3");
  });
});
