import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));
import { canCopyVersionFile, tsvEscape } from "./runner";

describe("run input staging", () => {
  it("keeps one physical line per row without quoting", () => {
    expect(tsvEscape("a\nb\tc\r\nd")).toBe("a b c  d");
    expect(tsvEscape('say "hi"')).toBe('say "hi"');
    expect(tsvEscape(null)).toBe("");
  });
  it("re-reads a quoted-v1 version instead of copying its quoted bytes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stage-"));
    expect(await canCopyVersionFile(dir)).toBe(true);
    await fs.writeFile(path.join(dir, "rows.fmt"), "quoted-v1\n");
    expect(await canCopyVersionFile(dir)).toBe(false);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
