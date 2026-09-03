import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE_ROOT = path.resolve(process.cwd(), "src");
const COMPATIBILITY_FILE = path.join(
  SOURCE_ROOT,
  "lib",
  "authorization",
  "principal.ts"
);
const DIRECT_SESSION_ROLE_COMPARISON =
  /\bsession\s*(?:\?\.|\.)\s*user\s*(?:\?\.|\.)\s*role\s*(?:===|!==|==|!=)/g;

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name)) return [];
    if (/\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name)) return [];
    return [fullPath];
  });
}

describe("authorization architecture", () => {
  it("keeps direct session-role authorization inside the compatibility adapter", () => {
    const violations = sourceFiles(SOURCE_ROOT)
      .filter((file) => file !== COMPATIBILITY_FILE)
      .flatMap((file) => {
        const source = fs.readFileSync(file, "utf8");
        return [...source.matchAll(DIRECT_SESSION_ROLE_COMPARISON)].map(
          (match) => {
            const line = source.slice(0, match.index).split("\n").length;
            return `${path.relative(process.cwd(), file)}:${line}`;
          }
        );
      });

    expect(
      violations,
      "Use decideCapability/hasCapability; legacy role mapping belongs only in principal.ts"
    ).toEqual([]);
  });
});
