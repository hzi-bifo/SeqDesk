// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ImportFileDetails, safeSourceUrl } from "./ImportFileDetails";
afterEach(cleanup);
it("distinguishes local digests and ETags from repository verification", () => {
  render(<ImportFileDetails file={{ filename: "reads.fastq.gz", url: "https://example.org/reads.fastq.gz", etag: "a".repeat(32), localSha256: "b".repeat(64) }} />);
  expect(screen.getByText(/Repository checksum: not provided/)).toBeTruthy();
  expect(screen.getByText(/not treated as an MD5/)).toBeTruthy();
  expect(screen.getByText(/no repository checksum match established/)).toBeTruthy();
  expect(screen.getByText(/example.org · HTTPS/)).toBeTruthy();
});
it("reports verified repository matches separately", () => {
  render(<ImportFileDetails file={{ filename: "reads", sourceMd5: "a".repeat(32), verifiedMd5: "A".repeat(32) }} />);
  expect(screen.getByText("Repository MD5 match verified after download.")).toBeTruthy();
});
it("does not report a mismatch as verified", () => {
  render(<ImportFileDetails file={{ filename: "reads", sourceMd5: "a".repeat(32), verifiedMd5: "b".repeat(32) }} />);
  expect(screen.getByText(/does not match/)).toBeTruthy();
});
it.each(["javascript:alert(1)", "data:text/html,test", "https://user:password@example.org/file", "file:///etc/passwd"])("does not expose unsafe source links: %s", url => {
  expect(safeSourceUrl(url)).toBeNull();
  render(<ImportFileDetails file={{ filename: "reads", url }} />);
  expect(screen.queryByRole("link", { hidden: true })).toBeNull();
});
