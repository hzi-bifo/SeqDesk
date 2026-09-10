"use client";

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { BarChart3, Database, GripVertical, Plus, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { MAX_REPORT_BLOCKS, type ReportBlock } from "@/lib/explore/report-blocks";
import { reportBlockSpan, type ReportInsertPosition } from "@/lib/explore/report-layout";

export type ReportInsertKind = "text" | "chart" | "data";
interface Props {
  blocks: ReportBlock[];
  editing: boolean;
  disabled?: boolean;
  onMove: (id: string, position: ReportInsertPosition) => boolean;
  onInsert: (kind: ReportInsertKind, position: ReportInsertPosition) => void;
  renderBlock: (block: ReportBlock, index: number, dragHandle?: ReactNode) => ReactNode;
}

function InsertMenu({ label, disabled, prominent = false, onChoose }: {
  label: string; disabled: boolean; prominent?: boolean; onChoose: (kind: ReportInsertKind) => void;
}) {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button type="button" variant="outline" size="sm" disabled={disabled} aria-label={label}
      title={disabled ? "Remove a block to make room, or resolve the editing conflict." : label}
      className={cn("relative z-10 gap-1.5 bg-background text-xs shadow-none", prominent ? "h-9 rounded-lg px-4" : "h-6 rounded-full px-2")}>
      <Plus className="h-3.5 w-3.5" />{prominent ? "Add content" : <span className="hidden group-hover/report-block:inline group-focus-within/report-block:inline">Add here</span>}
    </Button></PopoverTrigger>
    <PopoverContent align="center" className="w-72 max-w-[calc(100vw-2rem)] p-2" aria-label="Add content here">
      <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Add at this position</p>
      {([
        ["text", Type, "Text", "Write a heading or explanation"],
        ["chart", BarChart3, "Chart from a table", "Choose data and preview a chart"],
        ["data", Database, "Saved data & figures", "Metadata, pipeline outputs and your files"],
      ] as const).map(([kind, Icon, title, hint]) => <button key={kind} type="button" disabled={disabled} className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { setOpen(false); onChoose(kind); }}>
        <span className="rounded-md border bg-muted/30 p-2"><Icon className="h-4 w-4" /></span><span><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
      </button>)}
    </PopoverContent>
  </Popover>;
}

/** Presentation-only layout editing: move on drop, never on hover. Chart/text interactions stay native. */
export function ReportPageComposer({ blocks, editing, disabled = false, onMove, onInsert, renderBlock }: Props) {
  const source = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<ReportInsertPosition | undefined>(undefined);
  const [notice, setNotice] = useState("");
  const canInsert = !disabled && blocks.length < MAX_REPORT_BLOCKS;
  const clear = () => { source.current = null; setDragging(null); setOver(undefined); };
  const move = (id: string, position: ReportInsertPosition) => {
    if (disabled) return;
    if (onMove(id, position)) setNotice("Block moved. Use Undo to restore its previous position.");
  };
  const dragOver = (event: DragEvent, position: ReportInsertPosition) => {
    // Only a drag started by a handle in this mounted editor is accepted.
    if (!source.current || disabled) return;
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    if (position?.blockId === source.current) { setOver(undefined); return; }
    setOver(previous => previous?.blockId === position?.blockId && previous?.edge === position?.edge && previous !== undefined ? previous : position);
  };
  const drop = (event: DragEvent, position: ReportInsertPosition) => {
    if (!source.current) return;
    event.preventDefault(); event.stopPropagation();
    const id = source.current;
    clear();
    move(id, position);
  };
  const positionAt = (event: DragEvent<HTMLDivElement>, blockId: string): ReportInsertPosition => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { blockId, edge: event.clientY < rect.top + rect.height / 2 ? "before" : "after" };
  };
  if (!editing) return <div className="mt-6 grid gap-4 md:grid-cols-2">{blocks.map((block, index) => renderBlock(block, index))}</div>;
  return <div className="mt-5" onKeyDown={event => { if (event.key === "Escape" && source.current) { clear(); setNotice("Move cancelled."); } }}
    onDragEnd={clear}
    onDragOver={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "none"; } }}
    onDrop={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setNotice("Use Add content, then Saved data & figures, to import your file."); } }}>
    <p className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1"><GripVertical className="h-3.5 w-3.5" />Drag to rearrange</span><span className="inline-flex items-center gap-1"><Plus className="h-3.5 w-3.5" />Add between blocks</span></p>
    <p id="report-move-instructions" className="sr-only">Drag this handle to move a block. With the handle focused, use the up and down arrow keys instead. Escape cancels a drag.</p>
    <p role="status" className={notice.startsWith("Use Add content") ? "mb-4 text-sm text-muted-foreground" : "sr-only"}>{notice}</p>
    <div className="grid gap-x-4 gap-y-8 md:grid-cols-2" aria-label="Report layout"
      onDragOver={event => { if (over !== undefined) dragOver(event, over); }} onDrop={event => { if (over !== undefined) drop(event, over); }}>
      {blocks.map((block, index) => {
        const target = over?.blockId === block.id ? over.edge : null;
        const dragHandle = <button type="button" draggable={!disabled} disabled={disabled} aria-label="Drag to move block" aria-describedby="report-move-instructions" title="Drag to move · or use arrow keys"
          className="cursor-grab rounded p-1 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing disabled:cursor-default disabled:opacity-40"
          onDragStart={event => { if (disabled) { event.preventDefault(); return; } source.current = block.id; setDragging(block.id); setNotice("Choose where to move the block."); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-seqdesk-report-block", block.id); }}
          onDragEnd={clear} onKeyDown={event => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            const neighbor = blocks[index + (event.key === "ArrowUp" ? -1 : 1)];
            if (neighbor) move(block.id, { blockId: neighbor.id, edge: event.key === "ArrowUp" ? "before" : "after" });
          }}><GripVertical className="h-3.5 w-3.5" /></button>;
        return <div key={block.id} data-report-block-id={block.id} className={cn("group/report-block relative min-w-0", reportBlockSpan(block) === 2 && "md:col-span-2", dragging === block.id && "opacity-40")}
          onDragOver={event => dragOver(event, positionAt(event, block.id))} onDrop={event => drop(event, positionAt(event, block.id))}>
          <div className={cn("absolute -top-5 left-0 right-0 z-10 flex h-8 items-center justify-center transition-opacity", dragging ? "pointer-events-none opacity-0" : "opacity-60 hover:opacity-100 focus-within:opacity-100 group-hover/report-block:opacity-100")}>
            <InsertMenu label={`Add content before block ${index + 1}`} disabled={!canInsert} onChoose={kind => onInsert(kind, { blockId: block.id, edge: "before" })} />
          </div>
          {renderBlock(block, index, dragHandle)}
          {target && dragging && <div aria-hidden="true" className={cn("pointer-events-none absolute -left-0.5 -right-0.5 z-20 border-t-2 border-teal-500", target === "before" ? "-top-4" : "-bottom-4")}><span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-teal-600 px-2 py-0.5 text-[10px] font-medium text-white">Move here</span></div>}
        </div>;
      })}
      <div className={cn("flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-center md:col-span-2", dragging && over === null ? "border-teal-500 bg-teal-50/50 dark:bg-teal-950/20" : "border-border bg-muted/10")}
        data-report-drop-end onDragOver={event => dragOver(event, null)} onDrop={event => drop(event, null)}>
        {dragging ? <p className="text-sm text-teal-700 dark:text-teal-300">Drop here to move to the end</p> : <>
          <InsertMenu label={blocks.length ? "Add content at the end" : "Add the first block"} disabled={!canInsert} prominent onChoose={kind => onInsert(kind, null)} />
          <p className="text-xs text-muted-foreground">{!canInsert ? disabled ? "Resolve the editing conflict before changing the page." : `This page has reached its ${MAX_REPORT_BLOCKS}-block limit.` : blocks.length ? "Text, charts, tables and saved figures" : "Start with an explanation, your data, or a chart."}</p>
        </>}
      </div>
    </div>
  </div>;
}
