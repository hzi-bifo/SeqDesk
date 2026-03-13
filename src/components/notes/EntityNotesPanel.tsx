"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { marked } from "marked";
import TurndownService from "turndown";
import {
  type ContentEditableEvent,
  Editor,
  EditorProvider,
  Toolbar,
} from "react-simple-wysiwyg";
import { toast } from "sonner";
import {
  Bold,
  ChevronLeft,
  GripVertical,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Redo2,
  StickyNote,
  Undo2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const ICON_CLASSNAME = "h-3.5 w-3.5";
const MIN_WIDTH = 240;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 320;
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

function convertMarkdownToEditorHtml(markdown: string): string {
  if (!markdown.trim()) {
    return "";
  }

  return marked.parse(markdown) as string;
}

function convertEditorHtmlToMarkdown(html: string): string {
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

function toSentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function ToolbarBtn({
  title,
  command,
  children,
}: {
  title: string;
  command: string | (() => void);
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="rsw-btn"
      title={title}
      tabIndex={-1}
      onMouseDown={(event) => {
        event.preventDefault();
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

interface EntityNotesUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
}

interface EntityNotesResponse {
  notes: string | null;
  notesEditedAt: string | null;
  notesEditedById: string | null;
  notesEditedBy: EntityNotesUser | null;
  notesSupported?: boolean;
  notesEnabled?: boolean;
}

type SaveState = "idle" | "saving" | "saved" | "error";

interface EntityNotesPanelProps {
  desktopPanelStateKey: string;
  entityLabel: string;
  fetchUrl: string;
  panelDataAttribute: string;
  saveRequestBody?: (notes: string | null) => Record<string, unknown>;
  saveMethod?: "PUT" | "PATCH";
  saveUrl: string;
}

export function EntityNotesPanel({
  desktopPanelStateKey,
  entityLabel,
  fetchUrl,
  panelDataAttribute,
  saveRequestBody,
  saveMethod = "PUT",
  saveUrl,
}: EntityNotesPanelProps) {
  const pathname = usePathname();
  const [desktopOpen, setDesktopOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<EntityNotesResponse | null>(null);
  const [notesContent, setNotesContent] = useState("");
  const [editorHtml, setEditorHtml] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);
  const lastServerNotesRef = useRef("");
  const hasLoadedRef = useRef(false);
  const isResizingRef = useRef(false);

  const entityLabelTitle = toSentenceCase(entityLabel);
  const panelAttributes = { [panelDataAttribute]: "" };

  useEffect(() => {
    const stored = window.localStorage.getItem(desktopPanelStateKey);
    if (stored !== null) {
      setDesktopOpen(stored === "true");
    }
    const storedWidth = window.localStorage.getItem(`${desktopPanelStateKey}-width`);
    if (storedWidth !== null) {
      const w = parseInt(storedWidth, 10);
      if (!isNaN(w) && w >= MIN_WIDTH && w <= MAX_WIDTH) {
        setPanelWidth(w);
      }
    }
  }, [desktopPanelStateKey]);

  useEffect(() => {
    window.localStorage.setItem(desktopPanelStateKey, String(desktopOpen));
  }, [desktopOpen, desktopPanelStateKey]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizingRef.current = true;
      const startX = e.clientX;
      const startWidth = panelWidth;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isResizingRef.current) return;
        const delta = startX - moveEvent.clientX;
        const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
        setPanelWidth(newWidth);
      };

      const handleMouseUp = () => {
        isResizingRef.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setPanelWidth((w) => {
          window.localStorage.setItem(`${desktopPanelStateKey}-width`, String(w));
          return w;
        });
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [desktopPanelStateKey, panelWidth]
  );

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const fetchNotes = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(fetchUrl, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as Partial<EntityNotesResponse> & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || `Failed to load ${entityLabel} notes`);
      }

      setData({
        notes: typeof payload.notes === "string" ? payload.notes : null,
        notesEditedAt: typeof payload.notesEditedAt === "string" ? payload.notesEditedAt : null,
        notesEditedById:
          typeof payload.notesEditedById === "string" ? payload.notesEditedById : null,
        notesEditedBy: payload.notesEditedBy ?? null,
        notesSupported: payload.notesSupported !== false,
        notesEnabled: payload.notesEnabled !== false,
      });
      const nextNotes = typeof payload.notes === "string" ? payload.notes : "";
      setNotesContent(nextNotes);
      setEditorHtml(convertMarkdownToEditorHtml(nextNotes));
      setSaveState("idle");
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : `Failed to load ${entityLabel} notes`);
    } finally {
      setLoading(false);
    }
  }, [entityLabel, fetchUrl]);

  useEffect(() => {
    void fetchNotes();
  }, [fetchNotes]);

  useEffect(() => {
    if (!data) return;

    const incomingNotes = data.notes ?? "";
    const hasUnsavedLocalChanges = notesContent !== lastServerNotesRef.current;

    if (!hasUnsavedLocalChanges) {
      setNotesContent(incomingNotes);
      setEditorHtml(convertMarkdownToEditorHtml(incomingNotes));
    }

    lastServerNotesRef.current = incomingNotes;
    hasLoadedRef.current = true;
  }, [data, notesContent]);

  const notesSupported = data?.notesSupported !== false;
  const notesEnabled = data?.notesEnabled !== false;
  const hasUnsavedChanges = notesContent !== lastServerNotesRef.current;

  const saveNotes = useCallback(
    async ({
      nextNotes,
      showToast = false,
    }: {
      nextNotes?: string;
      showToast?: boolean;
    } = {}) => {
      if (!data || data.notesSupported === false) {
        return false;
      }

      const notesToSave = nextNotes ?? notesContent;

      if (notesToSave === lastServerNotesRef.current) {
        setSaveState("saved");
        return true;
      }

      setSaveState("saving");

      try {
        const response = await fetch(saveUrl, {
          method: saveMethod,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            saveRequestBody
              ? saveRequestBody(notesToSave || null)
              : { notes: notesToSave || null }
          ),
        });

        const payload = (await response.json().catch(() => ({}))) as Partial<EntityNotesResponse> & {
          error?: string;
        };

        if (!response.ok) {
          if (payload.notesSupported === false) {
            setData((current) =>
              current
                ? { ...current, notesSupported: false }
                : {
                    notes: null,
                    notesEditedAt: null,
                    notesEditedById: null,
                    notesEditedBy: null,
                    notesSupported: false,
                    notesEnabled: true,
                  }
            );
          }

          if (payload.notesEnabled === false) {
            setData((current) =>
              current
                ? { ...current, notesEnabled: false }
                : {
                    notes: null,
                    notesEditedAt: null,
                    notesEditedById: null,
                    notesEditedBy: null,
                    notesSupported: true,
                    notesEnabled: false,
                  }
            );
          }

          throw new Error(payload.error || `Failed to save ${entityLabel} notes`);
        }

        setData({
          notes: typeof payload.notes === "string" ? payload.notes : null,
          notesEditedAt: typeof payload.notesEditedAt === "string" ? payload.notesEditedAt : null,
          notesEditedById:
            typeof payload.notesEditedById === "string" ? payload.notesEditedById : null,
          notesEditedBy: payload.notesEditedBy ?? null,
          notesSupported: payload.notesSupported !== false,
          notesEnabled: payload.notesEnabled !== false,
        });
        const savedNotes = typeof payload.notes === "string" ? payload.notes : "";
        setNotesContent(savedNotes);
        setEditorHtml(convertMarkdownToEditorHtml(savedNotes));
        setSaveState("saved");

        if (showToast) {
          toast.success(`${entityLabelTitle} notes saved`);
        }

        return true;
      } catch (saveError) {
        setSaveState("error");

        if (showToast) {
          toast.error(
            saveError instanceof Error ? saveError.message : `Failed to save ${entityLabel} notes`
          );
        }

        return false;
      }
    },
    [data, entityLabel, entityLabelTitle, notesContent, saveMethod, saveRequestBody, saveUrl]
  );

  useEffect(() => {
    if (
      !hasLoadedRef.current ||
      loading ||
      !data ||
      data.notesSupported === false ||
      data.notesEnabled === false
    ) {
      return;
    }

    if (!hasUnsavedChanges) {
      return;
    }

    if (saveState !== "saving") {
      setSaveState("idle");
    }

    const timeoutId = window.setTimeout(() => {
      void saveNotes({ nextNotes: notesContent });
    }, 1000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [data, hasUnsavedChanges, loading, notesContent, saveNotes, saveState]);

  const handleEditorChange = useCallback((event: ContentEditableEvent) => {
    const nextHtml = event.target.value;
    setEditorHtml(nextHtml);
    setNotesContent(convertEditorHtmlToMarkdown(nextHtml));
  }, []);

  if (!loading && !notesEnabled) {
    return null;
  }

  const saveIndicator = (
    <span
      className={cn(
        "inline-block h-1.5 w-1.5 rounded-full transition-colors",
        saveState === "saving"
          ? "bg-amber-400 animate-pulse"
          : saveState === "error"
            ? "bg-destructive"
            : hasUnsavedChanges
              ? "bg-amber-400"
              : "bg-emerald-500"
      )}
      title={
        saveState === "saving"
          ? "Saving..."
          : saveState === "error"
            ? "Save failed"
            : hasUnsavedChanges
              ? "Unsaved changes"
              : "Saved"
      }
    />
  );

  const panelBody = (
    <div {...panelAttributes} className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between px-3">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <StickyNote className="h-3.5 w-3.5 shrink-0" />
          <span className="uppercase tracking-wider">Notes</span>
          {saveIndicator}
        </div>

        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setMobileOpen(false)}
            className="xl:hidden h-7 w-7"
            aria-label={`Close ${entityLabel} notes`}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setDesktopOpen(false)}
            className="hidden xl:inline-flex h-7 w-7"
            aria-label={`Hide ${entityLabel} notes`}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex flex-1 flex-col justify-center gap-3 px-3">
          <p className="text-sm text-destructive">{error}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void fetchNotes()}>
            Try again
          </Button>
        </div>
      ) : !notesSupported ? (
        <div className="flex flex-1 flex-col justify-center gap-3 px-3">
          <p className="text-sm text-muted-foreground">
            Database schema update required for notes.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void fetchNotes()}>
            Recheck
          </Button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <EditorProvider>
            <Editor
              value={editorHtml}
              onChange={handleEditorChange}
              placeholder={`Write notes for this ${entityLabel}...`}
              containerProps={{
                className:
                  "order-notes-wysiwyg flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent",
              }}
            >
              <Toolbar className="order-notes-toolbar shrink-0 bg-card">
                <ToolbarBtn title="Bold" command="bold">
                  <Bold className={ICON_CLASSNAME} />
                </ToolbarBtn>
                <ToolbarBtn title="Italic" command="italic">
                  <Italic className={ICON_CLASSNAME} />
                </ToolbarBtn>
                <span className="order-notes-toolbar-sep" />
                <ToolbarBtn title="Bullet list" command="insertUnorderedList">
                  <List className={ICON_CLASSNAME} />
                </ToolbarBtn>
                <ToolbarBtn title="Numbered list" command="insertOrderedList">
                  <ListOrdered className={ICON_CLASSNAME} />
                </ToolbarBtn>
                <span className="order-notes-toolbar-sep" />
                <ToolbarBtn
                  title="Link"
                  command={() => {
                    const url = prompt("URL", "");
                    if (url) {
                      document.execCommand("createLink", false, url);
                    }
                  }}
                >
                  <Link2 className={ICON_CLASSNAME} />
                </ToolbarBtn>
                <span className="order-notes-toolbar-sep" />
                <ToolbarBtn title="Undo" command="undo">
                  <Undo2 className={ICON_CLASSNAME} />
                </ToolbarBtn>
                <ToolbarBtn title="Redo" command="redo">
                  <Redo2 className={ICON_CLASSNAME} />
                </ToolbarBtn>
              </Toolbar>
            </Editor>
          </EditorProvider>
        </div>
      )}
    </div>
  );

  return (
    <>
      <aside
        className={cn(
          "hidden xl:flex fixed top-0 right-0 bottom-0 flex-col border-l border-border bg-card z-30 transition-all duration-300",
          !desktopOpen && "w-10"
        )}
        style={desktopOpen ? { width: panelWidth } : undefined}
      >
        {desktopOpen && (
          <div
            className="absolute left-0 top-0 bottom-0 z-10 flex w-1.5 cursor-col-resize items-center justify-center -translate-x-1/2 group"
            onMouseDown={handleResizeStart}
          >
            <div className="h-8 w-1 rounded-full bg-border opacity-0 transition-opacity group-hover:opacity-100 group-active:opacity-100" />
          </div>
        )}

        {desktopOpen ? (
          panelBody
        ) : (
          <div className="flex h-full flex-col items-center pt-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setDesktopOpen(true)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  aria-label={`Show ${entityLabel} notes`}
                >
                  <StickyNote className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={4}>
                {entityLabelTitle} notes
              </TooltipContent>
            </Tooltip>
          </div>
        )}
      </aside>

      <div
        className={cn(
          "hidden xl:block shrink-0 transition-all duration-300",
          !desktopOpen && "w-10"
        )}
        style={desktopOpen ? { width: panelWidth } : undefined}
        aria-hidden
      />

      <div className="xl:hidden">
        {!mobileOpen && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setMobileOpen(true)}
            className="fixed bottom-6 right-6 z-30 shadow-lg"
          >
            <StickyNote className="h-4 w-4" />
            Notes
          </Button>
        )}

        {mobileOpen && (
          <>
            <div
              className="fixed inset-0 z-30 bg-black/40"
              onClick={() => setMobileOpen(false)}
            />
            <div className="fixed inset-y-0 right-0 z-40 flex w-[min(92vw,20rem)] flex-col overflow-hidden border-l border-border bg-card shadow-2xl">
              {panelBody}
            </div>
          </>
        )}
      </div>
    </>
  );
}
