/**
 * Key figures: the cards of a report's numbers block. A figure comes from
 * an analysis run (a metric it recorded) or from a table column (a statistic
 * of it). Pure helpers shared by the view, the editor and the shared page.
 */
import type { MetricStat } from "./report-blocks";

export interface TableFigure {
  id: string;
  datasetId: string;
  column: string;
  stat: MetricStat;
}

export interface FigureTarget {
  /** The value should be at least this. */
  min?: number;
  /** The value should be at most this. */
  max?: number;
}

export type TargetStatus = "met" | "low" | "high";

/** The key a table figure is stored under in the per-figure records. */
export function tableFigureKey(figure: Pick<TableFigure, "id">): string {
  return `f:${figure.id}`;
}

export function isTableFigureKey(key: string): boolean {
  return key.startsWith("f:");
}

/**
 * Every figure of a block in display order: the stored order when there is
 * one, else the run figures followed by the table figures. Keys that no
 * longer exist are dropped; new ones are appended.
 */
export function figureKeys(block: { metrics: string[]; figures?: TableFigure[]; order?: string[] }): string[] {
  const known = [...block.metrics, ...(block.figures ?? []).map(tableFigureKey)];
  const ordered = (block.order ?? []).filter((key) => known.includes(key));
  for (const key of known) if (!ordered.includes(key)) ordered.push(key);
  return ordered;
}

/** Whether a value meets its target, and a short reason when it does not. */
export function targetStatus(value: number | null | undefined, target: FigureTarget | null | undefined, format: (value: number) => string): { status: TargetStatus; note: string } | null {
  if (!target || (target.min === undefined && target.max === undefined)) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (target.min !== undefined && value < target.min) return { status: "low", note: `below the target of ${format(target.min)}` };
  if (target.max !== undefined && value > target.max) return { status: "high", note: `above the limit of ${format(target.max)}` };
  const bounds = [target.min !== undefined ? `at least ${format(target.min)}` : null, target.max !== undefined ? `at most ${format(target.max)}` : null].filter(Boolean);
  return { status: "met", note: `meets the target (${bounds.join(", ")})` };
}

/** "48.9M reads": the unit follows the number with a space, unless it is a symbol. */
export function withUnit(text: string, unit: string | null | undefined): string {
  const trimmed = unit?.trim();
  if (!trimmed) return text;
  return /^[%‰°]/.test(trimmed) ? `${text}${trimmed}` : `${text} ${trimmed}`;
}
