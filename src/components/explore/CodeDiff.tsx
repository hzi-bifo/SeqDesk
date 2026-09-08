"use client";

import { useEffect, useRef, type ReactElement } from "react";
import { MergeView } from "@codemirror/merge";
import { basicSetup } from "codemirror";
import { cn } from "@/lib/utils";
import { editorTheme, languageExtension, readOnlyExtension, type CodeLanguage } from "./CodeEditor";

export interface CodeDiffProps {
  original: string;
  modified: string;
  language: CodeLanguage;
  /** Pane captions. Defaults to "Revision A" / "Revision B". */
  labels?: [string, string];
  /** CSS height of the diff area. Defaults to "420px". */
  height?: string;
  className?: string;
}

const DEFAULT_LABELS: [string, string] = ["Revision A", "Revision B"];

/**
 * Side-by-side, read-only comparison of two code revisions rendered with the
 * CodeMirror merge view. The view is rebuilt whenever the inputs change; the
 * panes are not editable, so there is no cursor state worth preserving.
 */
export function CodeDiff({
  original,
  modified,
  language,
  labels = DEFAULT_LABELS,
  height = "420px",
  className,
}: CodeDiffProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [labelA, labelB] = labels;

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;
    const extensions = [basicSetup, editorTheme, languageExtension(language), readOnlyExtension(true)];
    const view = new MergeView({
      a: { doc: original, extensions },
      b: { doc: modified, extensions },
      parent,
      highlightChanges: true,
      gutter: true,
      collapseUnchanged: { margin: 3, minSize: 6 },
    });
    // The merge view is not scrollable by default; give it the full height of
    // the container and let it scroll both panes together.
    view.dom.style.height = "100%";
    view.dom.style.overflow = "auto";
    return () => {
      view.destroy();
    };
  }, [original, modified, language]);

  return (
    <div
      className={cn("overflow-hidden rounded-md border bg-background text-sm", className)}
      data-testid="code-diff"
      data-language={language}
    >
      <div className="grid grid-cols-2 border-b bg-muted/50 text-xs font-medium text-muted-foreground">
        <div className="truncate px-3 py-1.5" data-testid="code-diff-label-a">
          {labelA}
        </div>
        <div className="truncate border-l px-3 py-1.5" data-testid="code-diff-label-b">
          {labelB}
        </div>
      </div>
      <div
        ref={containerRef}
        role="region"
        aria-label={`Code comparison: ${labelA} versus ${labelB}`}
        style={{ height }}
      />
    </div>
  );
}
