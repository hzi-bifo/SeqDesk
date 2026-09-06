"use client";

import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { Bold, Code, FileCode2, Heading2, Heading3, Italic, Link2, List, ListOrdered, Quote, Sigma } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useReportVariables, VariableNode, VariablePicker } from "@/components/explore/VariableNode";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** The text block that had focus last, so the side panel can insert into it. */
let activeEditor: Editor | null = null;

/** Insert Markdown where the writer last was; false when no text block has had focus. */
export function insertIntoActiveEditor(markdown: string): boolean {
  if (!activeEditor || activeEditor.isDestroyed) return false;
  activeEditor.chain().focus().insertContent(markdown, { contentType: "markdown" }).run();
  return true;
}

/** Markdown the formatted view cannot hold yet (tables, task lists, raw HTML) is edited as source so nothing is lost. */
export function needsMarkdownSource(markdown: string): boolean {
  return /^\s*\|.*\|\s*$/m.test(markdown) || /^\s*[-*+]\s+\[[ xX]\]/m.test(markdown) || /<[a-zA-Z][^>]*>/.test(markdown);
}

interface RichTextEditorProps {
  /** Markdown, the format the report stores. */
  value: string;
  onChange: (markdown: string) => void;
  /** Extra controls at the end of the toolbar, such as the block's move and delete actions. */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * What you see is what the page shows: headings, lists, emphasis, links and
 * quotes edited in place, stored as Markdown. A Markdown view is one click
 * away for those who prefer the source.
 */
export function RichTextEditor({ value, onChange, actions, className }: RichTextEditorProps) {
  const variables = useReportVariables();
  const locked = needsMarkdownSource(value);
  const [source, setSource] = useState(() => needsMarkdownSource(value));
  const onChangeRef = useRef(onChange);
  const lastEmitted = useRef(value);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }), VariableNode, Markdown],
    content: value,
    contentType: "markdown",
    immediatelyRender: false,
    editorProps: { attributes: { class: "report-editor-content min-h-[6rem] px-4 py-3 text-sm leading-6 outline-none" } },
    onUpdate: ({ editor: current }) => {
      const markdown = current.getMarkdown();
      lastEmitted.current = markdown;
      onChangeRef.current(markdown);
    },
    onFocus: ({ editor: current }) => {
      activeEditor = current;
    },
    onDestroy: () => {
      if (activeEditor?.isDestroyed) activeEditor = null;
    },
  });

  // A value set from outside (Cancel, the Markdown view) replaces what the editor shows.
  useEffect(() => {
    if (!editor || value === lastEmitted.current) return;
    lastEmitted.current = value;
    editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
  }, [editor, value]);

  const setLink = () => {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const href = window.prompt("Link address", previous ?? "https://");
    if (href === null) return;
    if (!href.trim()) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
  };

  const tools: Array<{ label: string; icon: React.ComponentType<{ className?: string }>; active: boolean; run: () => void }> = editor
    ? [
        { label: "Section heading", icon: Heading2, active: editor.isActive("heading", { level: 2 }), run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
        { label: "Subheading", icon: Heading3, active: editor.isActive("heading", { level: 3 }), run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
        { label: "Bold", icon: Bold, active: editor.isActive("bold"), run: () => editor.chain().focus().toggleBold().run() },
        { label: "Italic", icon: Italic, active: editor.isActive("italic"), run: () => editor.chain().focus().toggleItalic().run() },
        { label: "Bullet list", icon: List, active: editor.isActive("bulletList"), run: () => editor.chain().focus().toggleBulletList().run() },
        { label: "Numbered list", icon: ListOrdered, active: editor.isActive("orderedList"), run: () => editor.chain().focus().toggleOrderedList().run() },
        { label: "Quote", icon: Quote, active: editor.isActive("blockquote"), run: () => editor.chain().focus().toggleBlockquote().run() },
        { label: "Code", icon: Code, active: editor.isActive("code"), run: () => editor.chain().focus().toggleCode().run() },
        { label: "Link", icon: Link2, active: editor.isActive("link"), run: setLink },
      ]
    : [];

  return (
    <div className={cn("rounded-lg border bg-card", className)}>
      <div className="flex flex-wrap items-center gap-0.5 rounded-t-lg border-b bg-muted/40 px-1.5 py-1 text-xs text-muted-foreground">
        {tools.map((tool) => (
          <button
            key={tool.label}
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={tool.run}
            disabled={source || locked}
            className={cn("rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40", tool.active && "bg-secondary text-foreground")}
            title={tool.label}
            aria-label={tool.label}
            aria-pressed={tool.active}
          >
            <tool.icon className="h-3.5 w-3.5" />
          </button>
        ))}
        {variables && editor && (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" onMouseDown={(event) => event.preventDefault()} disabled={source || locked} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40" title="Insert a number an analysis recorded; it updates when the analysis runs again" aria-label="Insert a value">
                <Sigma className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Value</span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-2">
              <VariablePicker variables={variables} onPick={(ref) => editor.chain().focus().insertContent({ type: "variable", attrs: { ref, digits: null } }).insertContent(" ").run()} />
            </PopoverContent>
          </Popover>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setSource((current) => !current)}
          disabled={locked}
          className={cn("inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60", (source || locked) && "bg-secondary text-foreground")}
          title={locked ? "This block has a table, task list or HTML, which the formatted view cannot keep; it is edited as Markdown" : source ? "Back to the formatted view" : "Edit the Markdown source"}
          aria-pressed={source || locked}
        >
          <FileCode2 className="h-3.5 w-3.5" /> Markdown
        </button>
        {actions && (
          <>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            {actions}
          </>
        )}
      </div>
      {source || locked ? (
        <Textarea value={value} onChange={(event) => onChange(event.target.value)} rows={Math.min(24, Math.max(6, value.split("\n").length + 1))} className="rounded-t-none border-0 font-mono text-xs shadow-none focus-visible:ring-0" aria-label="Markdown source" />
      ) : (
        <EditorContent editor={editor} />
      )}
    </div>
  );
}
