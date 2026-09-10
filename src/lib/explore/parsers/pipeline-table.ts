import { parseDelimited } from "./delimited";
import { coerceCell } from "../schema";
import type { ExploreRowData } from "../types";

/** Standard interchange formats. Tool-specific normalization belongs in its pipeline package. */
export function parsePipelineTable(text: string, spec: { format?: "csv" | "tsv" | "json"; skipLinesStartingWith?: string; headerLinePrefix?: string }) {
  if (spec.format !== "json") return parseDelimited(text, {
    delimiter: spec.format === "csv" ? "," : spec.format === "tsv" ? "\t" : "auto",
    skipLinesStartingWith: spec.skipLinesStartingWith, headerLinePrefix: spec.headerLinePrefix,
  });
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value) || value.some(row => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error("A JSON table must be an array of row objects.");
  }
  const rows: ExploreRowData[] = value.map(row => Object.fromEntries(Object.entries(row).map(([key, cell]) => [key, coerceCell(cell)])));
  return { columns: [...new Set(rows.flatMap(row => Object.keys(row)))], rows };
}
