/**
 * Code regions for glosses (FLOW-GAPS D14). The web client runs the same
 * algorithm (SERVER-API "Glosses"), so a region hash computed on either side
 * names the same code:
 *  1. lines split on \n (a trailing \r removed);
 *  2. regions are the runs of lines between `# ---` lines when the code has
 *     any, otherwise the runs of lines separated by blank lines;
 *  3. each line loses its comment (from the first # outside a '…' or "…"
 *     string), is trimmed and has whitespace runs collapsed; empty lines go;
 *  4. regions whose normalised text is empty are dropped; the hash is the
 *     lowercase hex SHA-256 of the normalised text joined with \n.
 */
import { createHash } from "node:crypto";

export interface CodeRegion {
  index: number;
  lineStart: number;
  lineEnd: number;
  regionHash: string;
}

const DELIMITER = /^\s*#\s*-{3,}\s*$/;

/** A line without its comment: the first # outside a single- or double-quoted string. */
export function stripComment(line: string): string {
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === "\\") { index += 1; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === "#") return line.slice(0, index);
  }
  return line;
}

export function normaliseLines(lines: string[]): string {
  return lines.map((line) => stripComment(line).trim().replace(/\s+/g, " ")).filter(Boolean).join("\n");
}

export function regionHashOf(lines: string[]): string {
  return createHash("sha256").update(normaliseLines(lines), "utf8").digest("hex");
}

export function codeRegions(code: string): CodeRegion[] {
  const lines = code.split("\n").map((line) => line.replace(/\r$/, ""));
  const delimited = lines.some((line) => DELIMITER.test(line));
  const groups: Array<{ start: number; lines: string[] }> = [];
  let current: { start: number; lines: string[] } | null = null;
  lines.forEach((line, index) => {
    const breaks = delimited ? DELIMITER.test(line) : line.trim() === "";
    if (breaks) {
      if (current) groups.push(current);
      current = null;
      return;
    }
    if (!current) current = { start: index, lines: [] };
    current.lines.push(line);
  });
  if (current) groups.push(current);
  const regions: CodeRegion[] = [];
  for (const group of groups) {
    if (!normaliseLines(group.lines)) continue;
    const first = group.lines.findIndex((line) => line.trim() !== "");
    let last = group.lines.length - 1;
    while (last > first && group.lines[last].trim() === "") last -= 1;
    regions.push({ index: regions.length, lineStart: group.start + first + 1, lineEnd: group.start + last + 1, regionHash: regionHashOf(group.lines) });
  }
  return regions;
}
