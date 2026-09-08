"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatVariableValue, parseVariableRef, resolveVariable, type ReportVariables, type VariableStep } from "@/lib/explore/variables";

/** The report's variables, for text editors on the page. */
export const VariablesContext = createContext<ReportVariables | null>(null);

export function useReportVariables(): ReportVariables | null {
  return useContext(VariablesContext);
}

/** Everything a picker lists: one row per step and metric, with the current value. */
export function listVariables(variables: ReportVariables): Array<{ ref: string; step: VariableStep; metric: string; text: string }> {
  return variables.steps.flatMap((step) => Object.keys(step.metrics).map((metric) => ({ ref: `${step.slug}.${metric}`, step, metric, text: formatVariableValue(step.metrics[metric]) })));
}

/** A searchable list of the report's variables; picking one calls back with its reference. */
export function VariablePicker({ variables, onPick, current }: { variables: ReportVariables; onPick: (ref: string) => void; current?: string | null }) {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const all = listVariables(variables);
    const needle = query.trim().toLowerCase();
    return needle ? all.filter((row) => row.ref.toLowerCase().includes(needle) || row.step.name.toLowerCase().includes(needle) || row.text.toLowerCase().includes(needle)) : all;
  }, [variables, query]);
  const steps = [...new Set(rows.map((row) => row.step.slug))];
  return (
    <div className="text-xs">
      <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a number by step, name or value" className="mb-1 h-7 text-xs" aria-label="Find a variable" />
      <div className="max-h-64 overflow-y-auto">
        {rows.length === 0 && <p className="px-2 py-2 text-muted-foreground">{variables.steps.length === 0 ? "No analysis has recorded numbers yet." : "Nothing matches."}</p>}
        {steps.map((slug) => {
          const group = rows.filter((row) => row.step.slug === slug);
          return (
            <div key={slug} className="mb-1">
              <p className="px-2 pt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{group[0].step.name}</p>
              {group.map((row) => (
                <button key={row.ref} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onPick(row.ref)} className={cn("flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left hover:bg-secondary", current === row.ref && "bg-secondary")} title={`\`r ${row.ref}\``}>
                  <span className="truncate font-mono text-[11px]">{row.metric}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{row.text}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The chip a variable shows in the editor: its value, and on click, what it is and what else it could be. */
function VariableChip({ node, updateAttributes, deleteNode, editor }: NodeViewProps) {
  const variables = useReportVariables();
  const ref = String(node.attrs.ref ?? "");
  const digits = node.attrs.digits === null || node.attrs.digits === undefined ? null : Number(node.attrs.digits);
  const resolved = variables ? resolveVariable(`r ${ref}${digits === null ? "" : ` | ${digits}`}`, variables) : null;
  const text = resolved ? resolved.text : `?${ref}`;
  const found = Boolean(resolved?.found);
  const title = resolved?.found && resolved.step ? `${ref} from ${resolved.step.name}${resolved.step.runNumber ? `, ${resolved.step.runNumber}` : ""}` : `No step defines ${ref}`;
  return (
    <NodeViewWrapper as="span" className="inline" contentEditable={false}>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn("inline-flex cursor-pointer items-center rounded-sm border-b border-dotted px-0.5 align-baseline hover:bg-secondary", found ? "border-foreground/50 font-medium" : "border-destructive bg-destructive/10 text-destructive")}
            title={title}
            data-variable={ref}
            aria-label={`Variable ${ref}, ${text}`}
          >
            {text}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 space-y-2 p-2 text-xs">
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="truncate font-mono text-[11px]" title={ref}>{ref}</span>
            <span className="tabular-nums text-muted-foreground">{text}</span>
          </div>
          {resolved?.found && typeof resolved.value === "number" && (
            <label className="flex items-center justify-between gap-2 px-1">
              <span className="text-muted-foreground">Decimals</span>
              <select value={digits === null ? "auto" : String(digits)} onChange={(event) => updateAttributes({ digits: event.target.value === "auto" ? null : Number(event.target.value) })} className="h-7 rounded-md border bg-background px-1 text-[11px]" aria-label="Decimals">
                <option value="auto">auto</option>
                {[0, 1, 2, 3, 4].map((count) => <option key={count} value={count}>{count}</option>)}
              </select>
            </label>
          )}
          {variables && (
            <div className="border-t pt-2">
              <p className="px-1 pb-1 text-[11px] text-muted-foreground">Replace with another number</p>
              <VariablePicker variables={variables} current={ref} onPick={(next) => { updateAttributes({ ref: next }); editor.commands.focus(); }} />
            </div>
          )}
          <div className="flex justify-end border-t pt-2">
            <button type="button" onClick={() => deleteNode()} className="rounded px-2 py-1 text-muted-foreground hover:bg-secondary hover:text-destructive">Remove</button>
          </div>
        </PopoverContent>
      </Popover>
    </NodeViewWrapper>
  );
}

/**
 * A number cited in the text, stored in Markdown as `` `r step.metric` ``
 * (with an optional `| digits`). In the editor it is one chip that shows
 * the current value; in Markdown it stays the R-style reference, so the
 * page, the shared page and the source view all agree.
 */
export const VariableNode = Node.create({
  name: "variable",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  // Before the code mark: a code span that is a reference becomes a variable, anything else stays code.
  priority: 1100,

  addAttributes() {
    return {
      ref: { default: "", parseHTML: (element) => element.getAttribute("data-variable") ?? "" },
      digits: { default: null, parseHTML: (element) => (element.getAttribute("data-digits") ? Number(element.getAttribute("data-digits")) : null) },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-variable]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const ref = String(node.attrs.ref ?? "");
    return ["span", mergeAttributes(HTMLAttributes, { "data-variable": ref, "data-digits": node.attrs.digits ?? undefined }), `r ${ref}`];
  },

  markdownTokenName: "codespan",
  parseMarkdown: (token, helpers) => {
    const parsed = parseVariableRef(String(token.text ?? ""));
    // An empty result hands the span to the next handler, the code mark.
    if (!parsed) return [];
    return helpers.createNode("variable", { ref: `${parsed.step}.${parsed.metric}`, digits: parsed.digits });
  },
  renderMarkdown: (node) => {
    const ref = String(node.attrs?.ref ?? "");
    const digits = node.attrs?.digits;
    return `\`r ${ref}${digits === null || digits === undefined ? "" : ` | ${digits}`}\``;
  },

  addNodeView() {
    return ReactNodeViewRenderer(VariableChip);
  },
});
