"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { Annotation, Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { StreamLanguage } from "@codemirror/language";
import { python } from "@codemirror/lang-python";
import { r } from "@codemirror/legacy-modes/mode/r";
import { basicSetup } from "codemirror";
import { cn } from "@/lib/utils";

export type CodeLanguage = "python" | "r";

export interface CodeEditorProps {
  value: string;
  language: CodeLanguage;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  /** CSS height of the editor. Defaults to "420px". */
  height?: string;
  /** Accessible name of the editor region. Defaults to "Code". */
  ariaLabel?: string;
  className?: string;
  lineWrapping?: boolean;
}

/**
 * Marks transactions that mirror an external `value` prop change so they are
 * not echoed back through `onChange`.
 */
const externalChange = Annotation.define<boolean>();

const rLanguage = StreamLanguage.define(r);

/** Language support extension for the given analysis language. */
export function languageExtension(language: CodeLanguage): Extension {
  return language === "r" ? rLanguage : python();
}

/** Read-only state plus a non-editable content element. */
export function readOnlyExtension(readOnly: boolean): Extension {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}

/**
 * Light editor theme wired to the design tokens from globals.css so the
 * editor follows the app palette (including the `.dark` variant).
 */
export const editorTheme: Extension = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "var(--background)",
      color: "var(--foreground)",
      fontSize: "13px",
    },
    ".cm-scroller": {
      fontFamily:
        "var(--font-mono, var(--font-geist-mono, ui-monospace)), ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      lineHeight: "1.55",
      overflow: "auto",
    },
    ".cm-content": {
      caretColor: "var(--foreground)",
      padding: "8px 0",
    },
    ".cm-line": {
      padding: "0 12px",
    },
    "&.cm-focused": {
      outline: "none",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--foreground)",
    },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      {
        backgroundColor: "color-mix(in srgb, var(--foreground) 14%, transparent)",
      },
    ".cm-activeLine": {
      backgroundColor: "color-mix(in srgb, var(--muted) 55%, transparent)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--muted)",
      color: "var(--muted-foreground)",
      borderRight: "1px solid var(--border)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "color-mix(in srgb, var(--muted-foreground) 12%, var(--muted))",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      minWidth: "2.75em",
      padding: "0 6px 0 10px",
    },
    ".cm-foldGutter .cm-gutterElement": {
      padding: "0 4px",
    },
    ".cm-matchingBracket": {
      backgroundColor: "transparent",
      outline: "1px solid var(--border)",
    },
    ".cm-tooltip": {
      backgroundColor: "var(--card)",
      color: "var(--card-foreground)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius)",
    },
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
      backgroundColor: "var(--muted)",
      color: "var(--foreground)",
    },
    ".cm-panels": {
      backgroundColor: "var(--muted)",
      color: "var(--foreground)",
      borderColor: "var(--border)",
    },
    ".cm-panels input, .cm-panels button": {
      fontFamily: "inherit",
    },
  },
  { dark: false }
);

function wrappingExtension(lineWrapping: boolean): Extension {
  return lineWrapping ? EditorView.lineWrapping : [];
}

/**
 * CodeMirror 6 editor for analysis code. The view is created once per mount;
 * prop changes are applied through compartments, and external `value`
 * changes replace the document while keeping the cursor inside the new text.
 */
export function CodeEditor({
  value,
  language,
  readOnly = false,
  onChange,
  height = "420px",
  ariaLabel = "Code",
  className,
  lineWrapping = false,
}: CodeEditorProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  // Snapshot of the props used when the view is first created; later changes
  // are applied incrementally by the effects below.
  const initialRef = useRef({ value, language, readOnly, lineWrapping });
  const [compartments] = useState(() => ({
    language: new Compartment(),
    readOnly: new Compartment(),
    wrapping: new Compartment(),
  }));

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: compartments.language.reconfigure(languageExtension(language)) });
  }, [language, compartments]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: compartments.readOnly.reconfigure(readOnlyExtension(readOnly)) });
  }, [readOnly, compartments]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: compartments.wrapping.reconfigure(wrappingExtension(lineWrapping)) });
  }, [lineWrapping, compartments]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    const { anchor, head } = view.state.selection.main;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      selection: { anchor: Math.min(anchor, value.length), head: Math.min(head, value.length) },
      annotations: externalChange.of(true),
    });
  }, [value]);

  // Declared last so the update effects above see no view on the mount pass
  // and only run for real prop changes afterwards.
  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;
    const initial = initialRef.current;
    const view = new EditorView({
      state: EditorState.create({
        doc: initial.value,
        extensions: [
          basicSetup,
          editorTheme,
          compartments.language.of(languageExtension(initial.language)),
          compartments.readOnly.of(readOnlyExtension(initial.readOnly)),
          compartments.wrapping.of(wrappingExtension(initial.lineWrapping)),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            if (update.transactions.some((transaction) => transaction.annotation(externalChange))) return;
            onChangeRef.current?.(update.state.doc.toString());
          }),
        ],
      }),
      parent,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [compartments]);

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={ariaLabel}
      data-testid="code-editor"
      data-language={language}
      data-readonly={readOnly ? "true" : undefined}
      className={cn("overflow-hidden rounded-md border bg-background text-sm", className)}
      style={{ height }}
    />
  );
}
