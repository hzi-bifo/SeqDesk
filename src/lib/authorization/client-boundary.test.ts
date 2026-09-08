import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

function files(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : /\.tsx?$/.test(file) && !file.includes(".test.") ? [file] : [];
  });
}

it("keeps client components off the server authorization barrel", () => {
  for (const file of files(path.join(process.cwd(), "src"))) {
    const source = fs.readFileSync(file, "utf8");
    if (!/^\s*["']use client["'];/m.test(source)) continue;
    expect(source, file).not.toMatch(/from\s+["']@\/lib\/authorization["']/);
  }
  const facade = fs.readFileSync(path.join(process.cwd(), "src/lib/authorization/client.ts"), "utf8");
  expect(facade).not.toMatch(/from\s+["']\.\/guards["']/);
});
