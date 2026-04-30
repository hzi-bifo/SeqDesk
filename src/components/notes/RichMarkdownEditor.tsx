"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { marked } from "marked";
import TurndownService from "turndown";
import {
  type ContentEditableEvent,
  Editor,
  EditorProvider,
  Toolbar,
} from "react-simple-wysiwyg";
import { Bold, Italic, Link2, List, ListOrdered, Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const ICON_CLASSNAME = "h-3.5 w-3.5";
const EMPTY_EDITOR_HTML_VALUES = new Set(["", "<br>", "<div><br></div>", "<p><br></p>"]);

marked.setOptions({
  async: false,
  breaks: true,
  gfm: true,
});

const turndownService = new TurndownService({
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  headingStyle: "atx",
});

turndownService.addRule("taskListCheckbox", {
  filter(node) {
    return (
      node.nodeName === "INPUT" &&
      node instanceof HTMLInputElement &&
      node.type === "checkbox"
    );
  },
  replacement(_content, node) {
    if (!(node instanceof HTMLInputElement)) {
      return "";
    }

    return node.checked ? "[x] " : "[ ] ";
  },
});

export function convertMarkdownToEditorHtml(markdown: string): string {
  if (!markdown.trim()) {
    return "";
  }

  return marked.parse(markdown) as string;
}

export function convertEditorHtmlToMarkdown(html: string): string {
  if (EMPTY_EDITOR_HTML_VALUES.has(html.trim())) {
    return "";
  }

  if (typeof window !== "undefined") {
    const template = document.createElement("template");
    template.innerHTML = html;

    const visibleText = template.content.textContent?.replace(/\u00a0/g, " ").trim() ?? "";
    const hasCheckbox = template.content.querySelector('input[type="checkbox"]') !== null;

    if (!visibleText && !hasCheckbox) {
      return "";
    }
  }

  return turndownService
    .turndown(html)
    .replace(/\u00a0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function ToolbarBtn({
  title,
  command,
  disabled,
  children,
}: {
  title: string;
  command: string | (() => void);
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="rsw-btn"
      title={title}
      tabIndex={-1}
      disabled={disabled}
      onMouseDown={(event) => {
        event.preventDefault();
        if (disabled) {
          return;
        }
        if (typeof command === "string") {
          document.execCommand(command);
        } else {
          command();
        }
      }}
    >
      {children}
    </button>
  );
}

interface RichMarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  minHeightClassName?: string;
}

export function RichMarkdownEditor({
  value,
  onChange,
  placeholder = "Write...",
  disabled = false,
  className,
  minHeightClassName = "min-h-[200px]",
}: RichMarkdownEditorProps) {
  const [editorState, setEditorState] = useState(() => ({
    html: convertMarkdownToEditorHtml(value),
    markdown: value,
  }));
  const [linkEditorOpen, setLinkEditorOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  const savedSelectionRef = useRef<Range | null>(null);

  let editorHtml = editorState.html;
  if (value !== editorState.markdown) {
    editorHtml = convertMarkdownToEditorHtml(value);
    setEditorState({ html: editorHtml, markdown: value });
  }

  useEffect(() => {
    if (!linkEditorOpen) {
      return;
    }

    window.setTimeout(() => linkInputRef.current?.focus(), 0);
  }, [linkEditorOpen]);

  const focusEditor = useCallback(() => {
    window.setTimeout(() => {
      const editor = editorContainerRef.current?.querySelector<HTMLElement>(".rsw-ce");
      editor?.focus();
    }, 0);
  }, []);

  const saveEditorSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      savedSelectionRef.current = null;
      return;
    }

    const range = selection.getRangeAt(0);
    if (!editorContainerRef.current?.contains(range.commonAncestorContainer)) {
      savedSelectionRef.current = null;
      return;
    }

    savedSelectionRef.current = range.cloneRange();
  }, []);

  const restoreEditorSelection = useCallback(() => {
    const range = savedSelectionRef.current;
    if (!range) {
      focusEditor();
      return;
    }

    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [focusEditor]);

  const openLinkEditor = useCallback(() => {
    if (disabled) {
      return;
    }

    saveEditorSelection();
    setLinkUrl("");
    setLinkEditorOpen(true);
  }, [disabled, saveEditorSelection]);

  const closeLinkEditor = useCallback(() => {
    setLinkEditorOpen(false);
    setLinkUrl("");
    savedSelectionRef.current = null;
  }, []);

  const applyLink = useCallback(() => {
    const url = linkUrl.trim();
    if (!url) {
      closeLinkEditor();
      return;
    }

    restoreEditorSelection();
    document.execCommand("createLink", false, url);
    closeLinkEditor();
    focusEditor();

    window.setTimeout(() => {
      const editor = editorContainerRef.current?.querySelector<HTMLElement>(".rsw-ce");
      const nextHtml = editor?.innerHTML ?? editorHtml;
      const nextMarkdown = convertEditorHtmlToMarkdown(nextHtml);
      setEditorState({ html: nextHtml, markdown: nextMarkdown });
      onChange(nextMarkdown);
    }, 0);
  }, [closeLinkEditor, editorHtml, focusEditor, linkUrl, onChange, restoreEditorSelection]);

  const handleEditorChange = useCallback(
    (event: ContentEditableEvent) => {
      const nextHtml = event.target.value;
      const nextMarkdown = convertEditorHtmlToMarkdown(nextHtml);
      setEditorState({ html: nextHtml, markdown: nextMarkdown });
      onChange(nextMarkdown);
    },
    [onChange]
  );

  return (
    <EditorProvider>
      <div ref={editorContainerRef} className={cn("relative", className)}>
        <Editor
          value={editorHtml}
          onChange={handleEditorChange}
          placeholder={placeholder}
          disabled={disabled}
          containerProps={{
            className: cn(
              "order-notes-wysiwyg flex flex-col overflow-hidden rounded-md border border-input bg-background",
              disabled && "opacity-70",
              minHeightClassName
            ),
          }}
        >
          <Toolbar className="order-notes-toolbar shrink-0 bg-card">
            <ToolbarBtn title="Bold" command="bold" disabled={disabled}>
              <Bold className={ICON_CLASSNAME} />
            </ToolbarBtn>
            <ToolbarBtn title="Italic" command="italic" disabled={disabled}>
              <Italic className={ICON_CLASSNAME} />
            </ToolbarBtn>
            <span className="order-notes-toolbar-sep" />
            <ToolbarBtn title="Bullet list" command="insertUnorderedList" disabled={disabled}>
              <List className={ICON_CLASSNAME} />
            </ToolbarBtn>
            <ToolbarBtn title="Numbered list" command="insertOrderedList" disabled={disabled}>
              <ListOrdered className={ICON_CLASSNAME} />
            </ToolbarBtn>
            <span className="order-notes-toolbar-sep" />
            <ToolbarBtn title="Link" command={openLinkEditor} disabled={disabled}>
              <Link2 className={ICON_CLASSNAME} />
            </ToolbarBtn>
            <span className="order-notes-toolbar-sep" />
            <ToolbarBtn title="Undo" command="undo" disabled={disabled}>
              <Undo2 className={ICON_CLASSNAME} />
            </ToolbarBtn>
            <ToolbarBtn title="Redo" command="redo" disabled={disabled}>
              <Redo2 className={ICON_CLASSNAME} />
            </ToolbarBtn>
          </Toolbar>
          {linkEditorOpen && (
            <form
              className="flex shrink-0 items-center gap-1 border-b border-border/40 bg-card px-2.5 py-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                applyLink();
              }}
            >
              <Input
                ref={linkInputRef}
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    closeLinkEditor();
                    focusEditor();
                  }
                }}
                placeholder="Paste URL"
                className="h-7 rounded-md px-2 text-xs"
              />
              <Button type="submit" size="sm" className="h-7 px-2 text-[11px]">
                Apply
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  closeLinkEditor();
                  focusEditor();
                }}
                className="h-7 px-2 text-[11px]"
              >
                Cancel
              </Button>
            </form>
          )}
        </Editor>
      </div>
    </EditorProvider>
  );
}
