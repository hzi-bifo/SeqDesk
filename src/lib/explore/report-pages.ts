/** Named report pages reference the canonical blocks; no copied or independently stale outputs. */
import { z } from "zod";
export const MAX_REPORT_PAGES = 20;
export const ReportPageSchema = z.object({
  id: z.string().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  blockIds: z.array(z.string().min(1).max(120)).max(60),
}).strict();
export const ReportPagesSchema = z.array(ReportPageSchema).min(1).max(MAX_REPORT_PAGES);
export type ReportPage = z.infer<typeof ReportPageSchema>;

/** Legacy writes omit pages: retain membership, remove deleted IDs, put new blocks on the first page. */
export function reconcileReportPages(raw: unknown, blocks: { id: string }[]): ReportPage[] {
  const parsed = ReportPagesSchema.safeParse(raw);
  const pages = parsed.success ? parsed.data : [{ id: "overview", title: "Overview", blockIds: [] }];
  const present = new Set(blocks.map(b => b.id)), used = new Set<string>(), pageIds = new Set<string>();
  const result = pages.filter(page => { if (pageIds.has(page.id)) return false; pageIds.add(page.id); return true; }).map(page => ({ ...page, blockIds: page.blockIds.filter(id => { if (!present.has(id) || used.has(id)) return false; used.add(id); return true; }) }));
  result[0].blockIds.push(...blocks.filter(b => !used.has(b.id)).map(b => b.id));
  // Respect canonical block reordering by older editors within each named page.
  for (const page of result) { const ids = new Set(page.blockIds); page.blockIds = blocks.filter(b => ids.has(b.id)).map(b => b.id); }
  return result;
}
export function validateReportPages(pages: ReportPage[], blocks: { id: string }[]): string | null {
  const pageIds = new Set<string>(), assigned = new Set<string>(), known = new Set(blocks.map(b => b.id));
  for (const page of pages) {
    if (pageIds.has(page.id)) return `Page id ${page.id} is used twice`;
    pageIds.add(page.id);
    for (const id of page.blockIds) {
      if (!known.has(id)) return `Page ${page.id} references unknown block ${id}`;
      if (assigned.has(id)) return `Block ${id} belongs to more than one page`;
      assigned.add(id);
    }
  }
  if (assigned.size !== known.size) return "Every block must belong to exactly one page";
  return null;
}
