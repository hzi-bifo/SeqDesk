import { describe, expect, it } from "vitest";
import { gunzipSync } from "node:zlib";
import { readFailureWords } from "./import-words";

describe("readFailureWords", () => {
  it("explains a .gz file that is not gzip, from the error zlib really raises", () => {
    let raised: unknown;
    try { gunzipSync(Buffer.from("a,b\n1,2\n")); } catch (error) { raised = error; }
    expect(readFailureWords(raised)).toMatch(/damaged or is not gzip data/);
    expect(readFailureWords(raised)).not.toMatch(/\.$/);
  });
  it("names a full disk and leaves other errors alone", () => {
    expect(readFailureWords(Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" }))).toBe("The server has no space left to store this");
    expect(readFailureWords(new Error("The file has no data rows"))).toBeNull();
  });
});
