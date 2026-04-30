import { describe, expect, it } from "vitest";
import {
  buildUnavailableMentionLabel,
  extractNoteMentionHrefs,
  makeNoteMentionHref,
  parseNoteMentionHref,
} from "./mentions";

describe("note mention helpers", () => {
  it("round-trips typed mention hrefs", () => {
    const href = makeNoteMentionHref("sample", "sample/with spaces");

    expect(href).toBe("seqdesk-mention://sample/sample%2Fwith%20spaces");
    expect(parseNoteMentionHref(href)).toEqual({
      type: "sample",
      id: "sample/with spaces",
      href,
    });
  });

  it("encodes closing parentheses so markdown links stay parseable", () => {
    const href = makeNoteMentionHref("file", "reads/sample (R1).fastq.gz");

    expect(href).toBe("seqdesk-mention://file/reads%2Fsample%20%28R1%29.fastq.gz");
    expect(parseNoteMentionHref(href)?.id).toBe("reads/sample (R1).fastq.gz");
  });

  it("extracts mention hrefs from markdown links", () => {
    const sampleHref = makeNoteMentionHref("sample", "sample-1");
    const fileHref = makeNoteMentionHref("file", "reads/A_R1.fastq.gz");

    expect(extractNoteMentionHrefs(`See [@S1](${sampleHref}) and [@A_R1](${fileHref}).`)).toEqual([
      sampleHref,
      fileHref,
    ]);
  });

  it("rejects unsupported schemes and types", () => {
    expect(parseNoteMentionHref("https://example.com")).toBeNull();
    expect(parseNoteMentionHref("seqdesk-mention://unknown/id")).toBeNull();
  });

  it("provides readable unavailable labels", () => {
    expect(buildUnavailableMentionLabel("sample")).toBe("Deleted sample");
    expect(buildUnavailableMentionLabel("file")).toBe("Missing file");
  });
});
