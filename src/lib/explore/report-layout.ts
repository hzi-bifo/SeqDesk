import { MAX_REPORT_BLOCKS, type ReportBlock } from "./report-blocks";

/** Stable anchors, rather than indexes which can change while a data picker is open. Null means the end. */
export type ReportInsertPosition = { blockId: string; edge: "before" | "after" } | null;

export function reportBlockSpan(block: ReportBlock): 1 | 2 {
  return block.span ?? (block.type === "figure" || block.type === "chart" || block.type === "metric" ? 1 : 2);
}

function insertionIndex(blocks: ReportBlock[], position: ReportInsertPosition): number {
  if (!position) return blocks.length;
  const index = blocks.findIndex(block => block.id === position.blockId);
  if (index < 0) throw new Error("The insertion point is no longer on the page. Choose where to add this content again.");
  return index + (position.edge === "after" ? 1 : 0);
}

export function insertReportBlock(blocks: ReportBlock[], block: ReportBlock, position: ReportInsertPosition = null): ReportBlock[] {
  if (blocks.some(entry => entry.id === block.id)) return blocks;
  if (blocks.length >= MAX_REPORT_BLOCKS) throw new Error(`This page already has ${MAX_REPORT_BLOCKS} blocks. Remove one before adding another.`);
  const next = [...blocks];
  next.splice(insertionIndex(blocks, position), 0, block);
  return next;
}

export function moveReportBlock(blocks: ReportBlock[], id: string, position: ReportInsertPosition): ReportBlock[] {
  const block = blocks.find(entry => entry.id === id);
  if (!block || position?.blockId === id) return blocks;
  const next = blocks.filter(entry => entry.id !== id);
  next.splice(insertionIndex(next, position), 0, block);
  return next.every((entry, index) => entry === blocks[index]) ? blocks : next;
}
