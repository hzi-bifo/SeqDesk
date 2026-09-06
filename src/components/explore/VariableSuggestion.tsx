"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import { Extension } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import { Suggestion, type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { cn } from "@/lib/utils";
import type { ReportVariables } from "@/lib/explore/variables";
import { listVariables } from "@/components/explore/VariableNode";

type Row = ReturnType<typeof listVariables>[number];

interface ListHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

/** The list under the caret: Up and Down move, Enter or Tab insert, Escape closes. */
const SuggestionList = forwardRef<ListHandle, { items: Row[]; command: (row: Row) => void; query: string }>(function SuggestionList({ items, command, query }, ref) {
  // The selection belongs to one query; a new query starts at the top without an effect.
  const [selection, setSelection] = useState({ query, index: 0 });
  const selected = selection.query === query ? selection.index : 0;
  const setSelected = (next: (index: number) => number) => setSelection({ query, index: next(selected) });
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") {
        setSelected((index) => (index + items.length - 1) % Math.max(1, items.length));
        return true;
      }
      if (event.key === "ArrowDown") {
        setSelected((index) => (index + 1) % Math.max(1, items.length));
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        if (items[selected]) command(items[selected]);
        return true;
      }
      return false;
    },
  }));
  return (
    <div className="w-72 rounded-md border bg-popover p-1 text-xs shadow-md" role="listbox" aria-label="Numbers to cite">
      {items.length === 0 && <p className="px-2 py-1.5 text-muted-foreground">{query ? `Nothing matches "${query}"` : "No analysis has recorded numbers yet."}</p>}
      {items.slice(0, 12).map((row, index) => (
        <button
          key={row.ref}
          type="button"
          role="option"
          aria-selected={index === selected}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setSelected(() => index)}
          onClick={() => command(row)}
          className={cn("flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left", index === selected ? "bg-secondary" : "hover:bg-secondary/60")}
        >
          <span className="min-w-0">
            <span className="block truncate font-mono text-[11px]">{row.metric}</span>
            <span className="block truncate text-[10px] text-muted-foreground">{row.step.name}</span>
          </span>
          <span className="shrink-0 tabular-nums text-muted-foreground">{row.text}</span>
        </button>
      ))}
      {items.length > 12 && <p className="px-2 py-1 text-[10px] text-muted-foreground">Keep typing to narrow the list.</p>}
    </div>
  );
});

function matches(row: Row, query: string): boolean {
  const needle = query.toLowerCase();
  return !needle || row.metric.toLowerCase().includes(needle) || row.ref.toLowerCase().includes(needle) || row.step.name.toLowerCase().includes(needle);
}

/** Rank exact metric names first, then prefixes, then anything containing the query. */
function rank(row: Row, query: string): number {
  const needle = query.toLowerCase();
  const metric = row.metric.toLowerCase();
  if (!needle) return 0;
  if (metric === needle) return 0;
  if (metric.startsWith(needle)) return 1;
  if (row.ref.toLowerCase().startsWith(needle)) return 2;
  return 3;
}

export interface VariableSuggestionStorage {
  /** The report's variables at the moment of typing; set with the setReportVariables command as they change. */
  variables: ReportVariables | null;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    variableSuggestion: {
      /** Give the `@` list the report's current variables. */
      setReportVariables: (variables: ReportVariables | null) => ReturnType;
    };
  }
}

/**
 * Typing `@` opens the list of numbers the report can cite, filtered by
 * what follows; Enter inserts the chosen one as a chip. Nothing is stored
 * for the trigger itself, so the Markdown stays the R-style reference.
 */
export const VariableSuggestion = Extension.create<Record<string, never>, VariableSuggestionStorage>({
  name: "variableSuggestion",

  addStorage() {
    return { variables: null };
  },

  addCommands() {
    return {
      setReportVariables:
        (variables) =>
        () => {
          this.storage.variables = variables;
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const { editor } = this;
    const getVariables = () => this.storage.variables;
    return [
      Suggestion<Row, Row>({
        editor,
        char: "@",
        allowSpaces: false,
        allowedPrefixes: [" ", "(", "[", "\n"],
        items: ({ query }) => {
          const variables = getVariables();
          if (!variables) return [];
          return listVariables(variables)
            .filter((row) => matches(row, query))
            .sort((a, b) => rank(a, query) - rank(b, query) || a.metric.localeCompare(b.metric));
        },
        command: ({ editor: current, range, props }) => {
          current
            .chain()
            .focus()
            .insertContentAt(range, [{ type: "variable", attrs: { ref: props.ref, digits: null } }, { type: "text", text: " " }])
            .run();
        },
        render: () => {
          let component: ReactRenderer<ListHandle> | null = null;
          let popup: HTMLDivElement | null = null;
          const place = (props: SuggestionProps<Row, Row>) => {
            if (!popup) return;
            const rect = props.clientRect?.();
            if (!rect) return;
            const width = 288;
            const left = Math.min(rect.left, window.innerWidth - width - 8);
            const below = rect.bottom + 4;
            popup.style.left = `${Math.max(8, left)}px`;
            popup.style.top = `${below + 260 < window.innerHeight ? below : Math.max(8, rect.top - 264)}px`;
          };
          return {
            onStart: (props) => {
              component = new ReactRenderer(SuggestionList, { props: { items: props.items, command: props.command, query: props.query }, editor: props.editor });
              popup = document.createElement("div");
              popup.className = "fixed z-50";
              popup.appendChild(component.element);
              document.body.appendChild(popup);
              place(props);
            },
            onUpdate: (props) => {
              component?.updateProps({ items: props.items, command: props.command, query: props.query });
              place(props);
            },
            onKeyDown: (props) => {
              if (props.event.key === "Escape") {
                popup?.remove();
                popup = null;
                return true;
              }
              return component?.ref?.onKeyDown(props) ?? false;
            },
            onExit: () => {
              popup?.remove();
              popup = null;
              component?.destroy();
              component = null;
            },
          };
        },
      }),
    ];
  },
});
