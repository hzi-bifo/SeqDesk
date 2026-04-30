"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
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
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  ArrowUpRight,
  Search,
  Redo2,
  StickyNote,
  Undo2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  buildUnavailableMentionLabel,
  extractNoteMentionHrefs,
  makeNoteMentionHref,
  parseNoteMentionHref,
  type NoteMentionGroup,
  type NoteMentionItem,
} from "@/lib/notes/mentions";

const ICON_CLASSNAME = "h-3.5 w-3.5";
const MIN_WIDTH = 240;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 320;
const SAVE_STATUS_DELAY_MS = 350;
const SAVED_STATUS_MIN_MS = 750;
const EMPTY_EDITOR_HTML_VALUES = new Set(["", "<br>", "<div><br></div>", "<p><br></p>"]);
const MENTION_CHIP_CLASSNAME =
  "inline-flex cursor-pointer items-center rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary no-underline";

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clampPanelWidth(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_WIDTH;
  }

  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value));
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

function enhanceMentionLinks(html: string, mentionsByHref: Map<string, NoteMentionItem>): string {
  if (typeof window === "undefined" || !html) {
    return html;
  }

  const template = document.createElement("template");
  template.innerHTML = html;

  for (const anchor of template.content.querySelectorAll<HTMLAnchorElement>("a[href^='seqdesk-mention://']")) {
    const parsed = parseNoteMentionHref(anchor.getAttribute("href") ?? "");
    if (!parsed) {
      continue;
    }

    const mention = mentionsByHref.get(parsed.href);
    const label = mention?.label ?? buildUnavailableMentionLabel(parsed.type);
    anchor.textContent = `@${label}`;
    anchor.setAttribute("data-note-mention", parsed.type);
    anchor.setAttribute("data-note-mention-id", parsed.id);
    anchor.setAttribute("contenteditable", "false");
    anchor.setAttribute("class", MENTION_CHIP_CLASSNAME);
    anchor.setAttribute("title", mention?.detail ?? label);
    anchor.setAttribute("aria-label", mention?.detail ? `@${label}: ${mention.detail}` : `@${label}`);
    if (!mention || mention.status === "missing" || mention.status === "deleted") {
      anchor.classList.add("opacity-70", "border-amber-300", "bg-amber-50", "text-amber-700");
    }
  }

  return template.innerHTML;
}

function toSentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatEditedAt(value: string | null): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatEditorName(user: EntityNotesUser | null): string {
  if (!user) {
    return "";
  }

  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return name || user.email;
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
  id?: string;
  title?: string | null;
  alias?: string | null;
  orderNumber?: string | null;
  name?: string | null;
  notes: string | null;
  notesEditedAt: string | null;
  notesEditedById: string | null;
  notesEditedBy: EntityNotesUser | null;
  notesSupported?: boolean;
  notesEnabled?: boolean;
  samples?: Array<{
    orderId?: string | null;
    order?: {
      id: string;
      orderNumber: string;
      name: string | null;
    } | null;
  }>;
}

type SaveState = "idle" | "saving" | "saved" | "error";
type SaveStatusKey = "loading" | "saving" | "error" | "unsaved" | "saved";

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
  const [visibleSaveStatusKey, setVisibleSaveStatusKey] = useState<SaveStatusKey>("loading");
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);
  const [linkEditorOpen, setLinkEditorOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [mentionGroups, setMentionGroups] = useState<NoteMentionGroup[]>([]);
  const [mentionItems, setMentionItems] = useState<NoteMentionItem[]>([]);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionError, setMentionError] = useState("");
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const lastServerNotesRef = useRef("");
  const notesContentRef = useRef("");
  const mentionGroupsRef = useRef<NoteMentionGroup[]>([]);
  const hasLoadedRef = useRef(false);
  const isResizingRef = useRef(false);
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  const savedSelectionRef = useRef<Range | null>(null);
  const mentionRangeRef = useRef<Range | null>(null);
  const shouldFocusEditorRef = useRef(false);
  const savedStatusShownAtRef = useRef(0);

  const entityLabelTitle = toSentenceCase(entityLabel);
  const panelAttributes = { [panelDataAttribute]: "" };

  useEffect(() => {
    notesContentRef.current = notesContent;
  }, [notesContent]);

  useEffect(() => {
    mentionGroupsRef.current = mentionGroups;
  }, [mentionGroups]);

  useEffect(() => {
    const stored = window.localStorage.getItem(desktopPanelStateKey);
    if (stored !== null) {
      setDesktopOpen(stored === "true");
    }
    const storedWidth = window.localStorage.getItem(`${desktopPanelStateKey}-width`);
    if (storedWidth !== null) {
      const w = parseInt(storedWidth, 10);
      if (!isNaN(w)) {
        const clampedWidth = clampPanelWidth(w);
        setPanelWidth(clampedWidth);
        if (clampedWidth !== w) {
          window.localStorage.setItem(`${desktopPanelStateKey}-width`, String(clampedWidth));
        }
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
        const newWidth = clampPanelWidth(startWidth + delta);
        setPanelWidth(newWidth);
      };

      const handleMouseUp = () => {
        isResizingRef.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.body.style.webkitUserSelect = "";
        setPanelWidth((w) => {
          const clampedWidth = clampPanelWidth(w);
          window.localStorage.setItem(`${desktopPanelStateKey}-width`, String(clampedWidth));
          return clampedWidth;
        });
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.body.style.webkitUserSelect = "none";
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [desktopPanelStateKey, panelWidth]
  );

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileOpen]);

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
        id: typeof payload.id === "string" ? payload.id : undefined,
        title: typeof payload.title === "string" ? payload.title : null,
        alias: typeof payload.alias === "string" ? payload.alias : null,
        orderNumber: typeof payload.orderNumber === "string" ? payload.orderNumber : null,
        name: typeof payload.name === "string" ? payload.name : null,
        notes: typeof payload.notes === "string" ? payload.notes : null,
        notesEditedAt: typeof payload.notesEditedAt === "string" ? payload.notesEditedAt : null,
        notesEditedById:
          typeof payload.notesEditedById === "string" ? payload.notesEditedById : null,
        notesEditedBy: payload.notesEditedBy ?? null,
        notesSupported: payload.notesSupported !== false,
        notesEnabled: payload.notesEnabled !== false,
        samples: Array.isArray(payload.samples) ? payload.samples : undefined,
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
  const showSaveNow = notesSupported && notesEnabled && (hasUnsavedChanges || saveState === "error");
  const hasNotebookContent = Boolean(notesContent.trim() || (data?.notes ?? "").trim());
  const mentionContextId = data?.id ?? null;
  const mentionContextType = entityLabel === "order" || entityLabel === "study" ? entityLabel : null;
  const mentionsByHref = useMemo(
    () => new Map(mentionItems.map((mention) => [makeNoteMentionHref(mention.type, mention.id), mention])),
    [mentionItems]
  );
  const flatMentionItems = useMemo(
    () => mentionGroups.flatMap((group) => group.items.map((item) => ({ ...item, groupLabel: group.label }))),
    [mentionGroups]
  );

  const metadataText = useMemo(() => {
    const editedAt = formatEditedAt(data?.notesEditedAt ?? null);
    const editedBy = formatEditorName(data?.notesEditedBy ?? null);

    if (editedAt && editedBy) {
      return `Edited ${editedAt} by ${editedBy}`;
    }

    if (editedAt) {
      return `Edited ${editedAt}`;
    }

    if (!notesContent.trim()) {
      return "No notes yet";
    }

    return "";
  }, [data?.notesEditedAt, data?.notesEditedBy, notesContent]);

  const notesContext = useMemo(() => {
    if (entityLabel === "order") {
      const orderLabel = data?.orderNumber || data?.name || "this order";
      return {
        title: "Notepad",
        subject: `For order ${orderLabel}`,
        hint: "Study notepads open from each study",
        href: null,
      };
    }

    if (entityLabel === "study") {
      const subject = data?.title || data?.alias || "this study";
      const relatedOrders = new Map<
        string,
        {
          id: string;
          label: string;
        }
      >();

      for (const sample of data?.samples ?? []) {
        const order = sample.order;
        if (order?.id) {
          relatedOrders.set(order.id, {
            id: order.id,
            label: order.orderNumber || order.name || "related order",
          });
        } else if (sample.orderId) {
          relatedOrders.set(sample.orderId, {
            id: sample.orderId,
            label: "related order",
          });
        }
      }

      const orders = Array.from(relatedOrders.values());
      const onlyOrder = orders.length === 1 ? orders[0] : null;

      return {
        title: "Notepad",
        subject: `For study ${subject}`,
        hint:
          orders.length > 1
            ? `${orders.length} related orders`
            : onlyOrder
              ? `Open order notepad ${onlyOrder.label}`
              : "Attached to this study",
        href: onlyOrder ? `/orders/${onlyOrder.id}` : null,
      };
    }

    return {
      title: "Notepad",
      subject: "",
      hint: "",
      href: null,
    };
  }, [data?.alias, data?.name, data?.orderNumber, data?.samples, data?.title, entityLabel]);
  const sharedAccessText = `Shared with everyone who can access this ${entityLabel}, including admins.`;

  const actualSaveStatusKey = useMemo<SaveStatusKey>(() => {
    if (loading) {
      return "loading";
    }

    if (saveState === "saving") {
      return "saving";
    }

    if (saveState === "error") {
      return "error";
    }

    if (hasUnsavedChanges) {
      return "unsaved";
    }

    return "saved";
  }, [hasUnsavedChanges, loading, saveState]);

  useEffect(() => {
    const now = Date.now();
    const savedVisibleRemainingMs =
      visibleSaveStatusKey === "saved" && actualSaveStatusKey !== "saved"
        ? Math.max(0, SAVED_STATUS_MIN_MS - (now - savedStatusShownAtRef.current))
        : 0;
    const delayMs = actualSaveStatusKey === "error" ? 0 : Math.max(SAVE_STATUS_DELAY_MS, savedVisibleRemainingMs);
    const timeoutId = window.setTimeout(() => {
      setVisibleSaveStatusKey(actualSaveStatusKey);
      if (actualSaveStatusKey === "saved") {
        savedStatusShownAtRef.current = Date.now();
      }
    }, delayMs);

    return () => window.clearTimeout(timeoutId);
  }, [actualSaveStatusKey, visibleSaveStatusKey]);

  const saveStatus = useMemo(() => {
    switch (visibleSaveStatusKey) {
      case "loading":
        return {
          label: "Loading notes",
          dotClassName: "bg-muted-foreground/50",
          animated: true,
        };
      case "saving":
        return {
          label: "Saving notes",
          dotClassName: "bg-amber-500",
          animated: true,
        };
      case "error":
        return {
          label: "Save failed",
          dotClassName: "bg-destructive",
          animated: false,
        };
      case "unsaved":
        return {
          label: "Unsaved changes",
          dotClassName: "bg-amber-500",
          animated: false,
        };
      case "saved":
      default:
        return {
          label: "Saved",
          dotClassName: "bg-emerald-500",
          animated: false,
        };
    }
  }, [visibleSaveStatusKey]);

  const focusEditor = useCallback(() => {
    window.setTimeout(() => {
      const editor = editorContainerRef.current?.querySelector<HTMLElement>(".rsw-ce");
      editor?.focus();
    }, 0);
  }, []);

  useEffect(() => {
    if (
      !shouldFocusEditorRef.current ||
      loading ||
      !notesSupported ||
      !notesEnabled ||
      (!desktopOpen && !mobileOpen)
    ) {
      return;
    }

    shouldFocusEditorRef.current = false;
    focusEditor();
  }, [desktopOpen, focusEditor, loading, mobileOpen, notesEnabled, notesSupported]);

  useEffect(() => {
    if (!linkEditorOpen) {
      return;
    }

    window.setTimeout(() => linkInputRef.current?.focus(), 0);
  }, [linkEditorOpen]);

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
    saveEditorSelection();
    setLinkUrl("");
    setLinkEditorOpen(true);
  }, [saveEditorSelection]);

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
  }, [closeLinkEditor, focusEditor, linkUrl, restoreEditorSelection]);

  const fetchMentions = useCallback(
    async (query: string) => {
      if (!mentionContextType || !mentionContextId || !notesSupported || !notesEnabled) {
        return;
      }

      const hasExistingResults = mentionGroupsRef.current.some((group) => group.items.length > 0);
      setMentionLoading(!hasExistingResults);
      setMentionError("");

      try {
        const params = new URLSearchParams({
          entityType: mentionContextType,
          entityId: mentionContextId,
          q: query,
        });
        const refs = extractNoteMentionHrefs(notesContentRef.current);
        if (refs.length > 0) {
          params.set("refs", refs.join(","));
        }

        const response = await fetch(`/api/notes/mentions?${params.toString()}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => ({}))) as {
          groups?: NoteMentionGroup[];
          mentions?: NoteMentionItem[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error || "Failed to load mentions");
        }

        setMentionGroups(Array.isArray(payload.groups) ? payload.groups : []);
        setMentionItems(Array.isArray(payload.mentions) ? payload.mentions : []);
        setMentionSelectedIndex(0);
      } catch (mentionFetchError) {
        setMentionError(mentionFetchError instanceof Error ? mentionFetchError.message : "Failed to load mentions");
      } finally {
        setMentionLoading(false);
      }
    },
    [mentionContextId, mentionContextType, notesEnabled, notesSupported]
  );

  useEffect(() => {
    if (!mentionContextId || !mentionContextType || loading || !notesSupported || !notesEnabled) {
      return;
    }

    void fetchMentions("");
  }, [fetchMentions, loading, mentionContextId, mentionContextType, notesEnabled, notesSupported]);

  useEffect(() => {
    if (!mentionOpen) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void fetchMentions(mentionQuery);
    }, 150);

    return () => window.clearTimeout(timeoutId);
  }, [fetchMentions, mentionOpen, mentionQuery]);

  useEffect(() => {
    if (!data || hasUnsavedChanges) {
      return;
    }

    setEditorHtml(enhanceMentionLinks(convertMarkdownToEditorHtml(data.notes ?? ""), mentionsByHref));
  }, [data, hasUnsavedChanges, mentionsByHref]);

  const updateMentionQueryFromSelection = useCallback(() => {
    const editor = editorContainerRef.current?.querySelector<HTMLElement>(".rsw-ce");
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0 || !selection.isCollapsed) {
      setMentionOpen(false);
      return;
    }

    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      setMentionOpen(false);
      return;
    }

    const beforeRange = range.cloneRange();
    beforeRange.selectNodeContents(editor);
    beforeRange.setEnd(range.endContainer, range.endOffset);
    const beforeText = beforeRange.toString();
    const match = /(?:^|\s)@([^\s@]{0,40})$/.exec(beforeText);

    if (!match) {
      setMentionOpen(false);
      mentionRangeRef.current = null;
      return;
    }

    const mentionRange = range.cloneRange();
    try {
      mentionRange.setStart(range.endContainer, Math.max(0, range.endOffset - match[1].length - 1));
      mentionRangeRef.current = mentionRange;
    } catch {
      mentionRangeRef.current = null;
    }

    setMentionQuery(match[1]);
    setMentionOpen(true);
  }, []);

  const closeMentionPicker = useCallback(() => {
    setMentionOpen(false);
    setMentionQuery("");
    setMentionSelectedIndex(0);
    mentionRangeRef.current = null;
  }, []);

  const insertMention = useCallback(
    (mention: NoteMentionItem) => {
      const selection = window.getSelection();
      const mentionRange = mentionRangeRef.current;
      if (selection && mentionRange) {
        selection.removeAllRanges();
        selection.addRange(mentionRange);
      }

      const href = makeNoteMentionHref(mention.type, mention.id);
      document.execCommand(
        "insertHTML",
        false,
        `<a href="${escapeHtml(href)}" data-note-mention="${escapeHtml(mention.type)}" data-note-mention-id="${escapeHtml(
          mention.id
        )}" class="${MENTION_CHIP_CLASSNAME}" contenteditable="false" title="${escapeHtml(
          mention.detail ?? mention.label
        )}" aria-label="${escapeHtml(
          mention.detail ? `@${mention.label}: ${mention.detail}` : `@${mention.label}`
        )}">@${escapeHtml(mention.label)}</a>&nbsp;`
      );

      closeMentionPicker();
      focusEditor();

      window.setTimeout(() => {
        const editor = editorContainerRef.current?.querySelector<HTMLElement>(".rsw-ce");
        const nextHtml = editor?.innerHTML ?? editorHtml;
        setEditorHtml(nextHtml);
        setNotesContent(convertEditorHtmlToMarkdown(nextHtml));
      }, 0);
    },
    [closeMentionPicker, editorHtml, focusEditor]
  );

  const handleEditorClick = useCallback(
    (event: ReactMouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const mentionLink = target.closest<HTMLAnchorElement>("a[data-note-mention]");
      if (!mentionLink || !editorContainerRef.current?.contains(mentionLink)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const parsed = parseNoteMentionHref(mentionLink.getAttribute("href") ?? "");
      if (!parsed) {
        return;
      }

      const replacementRange = document.createRange();
      replacementRange.selectNode(mentionLink);
      mentionRangeRef.current = replacementRange;

      const label = mentionLink.textContent?.replace(/^@/, "").trim() ?? "";
      setMentionQuery(label);
      setMentionOpen(true);
      setMentionSelectedIndex(0);
      void fetchMentions(label);
    },
    [fetchMentions]
  );

  const handleEditorMouseUp = useCallback(
    (event: ReactMouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("a[data-note-mention]")) {
        return;
      }

      window.setTimeout(updateMentionQueryFromSelection, 0);
    },
    [updateMentionQueryFromSelection]
  );

  const handleEditorKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (!mentionOpen) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionSelectedIndex((index) => Math.min(index + 1, Math.max(0, flatMentionItems.length - 1)));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionSelectedIndex((index) => Math.max(0, index - 1));
      } else if (event.key === "Enter" || event.key === "Tab") {
        const selected = flatMentionItems[mentionSelectedIndex];
        if (selected) {
          event.preventDefault();
          insertMention(selected);
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeMentionPicker();
      }
    },
    [closeMentionPicker, flatMentionItems, insertMention, mentionOpen, mentionSelectedIndex]
  );

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
                    orderNumber: null,
                    name: null,
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
                    orderNumber: null,
                    name: null,
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

        setData((current) => ({
          ...current,
          notes: typeof payload.notes === "string" ? payload.notes : null,
          notesEditedAt: typeof payload.notesEditedAt === "string" ? payload.notesEditedAt : null,
          notesEditedById:
            typeof payload.notesEditedById === "string" ? payload.notesEditedById : null,
          notesEditedBy: payload.notesEditedBy ?? null,
          notesSupported: payload.notesSupported !== false,
          notesEnabled: payload.notesEnabled !== false,
        }));
        const savedNotes = typeof payload.notes === "string" ? payload.notes : "";
        setNotesContent(savedNotes);
        setEditorHtml(convertMarkdownToEditorHtml(savedNotes));
        setSaveState("saved");

        if (showToast) {
          toast.success(`${entityLabelTitle} notepad saved`);
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
    window.setTimeout(updateMentionQueryFromSelection, 0);
  }, [updateMentionQueryFromSelection]);

  if (!loading && !notesEnabled) {
    return null;
  }

  const panelBody = (
    <div {...panelAttributes} className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-12 shrink-0 items-start justify-between gap-2 px-3 py-2">
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2 font-geist-pixel text-xs font-medium text-muted-foreground">
            <StickyNote className="h-3.5 w-3.5 shrink-0" />
            <span>{notesContext.title}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-border/60"
                  aria-label={`Saved status: ${saveStatus.label}`}
                  tabIndex={0}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full transition-colors duration-300",
                      saveStatus.dotClassName,
                      saveStatus.animated && "animate-pulse"
                    )}
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                Saved status: {saveStatus.label}
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="space-y-0.5 pl-5 text-[11px] leading-4 text-muted-foreground">
            <p className="truncate">
              {notesContext.subject}
              {notesContext.hint ? (
                <>
                  <span className="px-1.5 text-border">/</span>
                  {notesContext.href ? (
                    <Link
                      href={notesContext.href}
                      className="inline-flex items-center gap-0.5 text-primary hover:underline"
                    >
                      {notesContext.hint}
                      <ArrowUpRight className="h-2.5 w-2.5" />
                    </Link>
                  ) : (
                    <span>{notesContext.hint}</span>
                  )}
                </>
              ) : null}
            </p>
            {metadataText && <p className="truncate">{metadataText}</p>}
            <p className="text-[10px] leading-4 text-muted-foreground/90">
              {sharedAccessText}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {showSaveNow && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void saveNotes({ showToast: true })}
              disabled={saveState === "saving"}
              className="h-7 px-2 text-[11px]"
            >
              {saveState === "saving" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Save now
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setMobileOpen(false)}
            className="xl:hidden h-7 w-7"
            aria-label={`Close ${entityLabel} notepad`}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setDesktopOpen(false)}
            className="hidden xl:inline-flex h-7 w-7"
            aria-label={`Hide ${entityLabel} notepad`}
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
          <div className="min-h-0 flex-1 overflow-hidden">
            <EditorProvider>
              <div ref={editorContainerRef} className="relative flex h-full min-h-0 flex-col">
                <Editor
                  value={editorHtml}
                  onChange={handleEditorChange}
                  placeholder="No notes yet. Write notes..."
                  containerProps={{
                    className:
                      "order-notes-wysiwyg flex h-full min-h-0 flex-col overflow-hidden bg-transparent",
                    onClick: handleEditorClick,
                    onKeyDown: handleEditorKeyDown,
                    onKeyUp: () => window.setTimeout(updateMentionQueryFromSelection, 0),
                    onMouseUp: handleEditorMouseUp,
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
                    <ToolbarBtn title="Link" command={openLinkEditor}>
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
                {mentionOpen && (
                  <div className="absolute left-3 right-3 top-12 z-20 max-h-72 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
                    <div className="flex items-center gap-2 border-b border-border/60 px-2.5 py-2 text-xs text-muted-foreground">
                      <Search className="h-3.5 w-3.5" />
                      <span>
                        {mentionQuery ? `Mention "${mentionQuery}"` : "Type to mention sample, file, run, or artifact"}
                      </span>
                    </div>
                    {mentionLoading ? (
                      <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Loading mentions...
                      </div>
                    ) : mentionError ? (
                      <div className="px-3 py-3 text-xs text-destructive">{mentionError}</div>
                    ) : flatMentionItems.length === 0 ? (
                      <div className="px-3 py-3 text-xs text-muted-foreground">No matching mentions.</div>
                    ) : (
                      <div className="max-h-60 overflow-y-auto py-1">
                        {mentionGroups.map((group) => {
                          const groupItems = group.items;
                          if (groupItems.length === 0) {
                            return null;
                          }

                          return (
                            <div key={group.key} className="py-1">
                              <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                {group.label}
                              </div>
                              {groupItems.map((mention) => {
                                const itemIndex = flatMentionItems.findIndex(
                                  (item) => item.type === mention.type && item.id === mention.id
                                );
                                const selected = itemIndex === mentionSelectedIndex;

                                return (
                                  <button
                                    key={`${mention.type}:${mention.id}`}
                                    type="button"
                                    className={cn(
                                      "flex w-full min-w-0 flex-col items-start px-3 py-1.5 text-left text-xs transition-colors",
                                      selected ? "bg-secondary text-foreground" : "hover:bg-secondary/70"
                                    )}
                                    onMouseDown={(event) => {
                                      event.preventDefault();
                                      insertMention(mention);
                                    }}
                                  >
                                    <span className="max-w-full truncate font-medium">@{mention.label}</span>
                                    {mention.detail && (
                                      <span className="max-w-full truncate text-[11px] text-muted-foreground">
                                        {mention.detail}
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </EditorProvider>
          </div>
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
                  onClick={() => {
                    setDesktopOpen(true);
                  }}
                  className="relative flex min-h-24 w-8 items-center justify-center rounded-lg px-1.5 py-3 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  aria-label={`Show ${entityLabel} notepad`}
                >
                  {hasNotebookContent && (
                    <span
                      className="absolute right-1.5 top-2 h-1.5 w-1.5 rounded-full bg-primary"
                      aria-hidden
                    />
                  )}
                  <span className="origin-center rotate-180 [writing-mode:vertical-rl] font-geist-pixel text-[10px] font-medium">
                    Notepad
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={4}>
                {notesContext.subject || `${entityLabelTitle} notepad`}
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
            onClick={() => {
              shouldFocusEditorRef.current = true;
              setMobileOpen(true);
            }}
            className="fixed bottom-6 right-6 z-30 shadow-lg"
          >
            <StickyNote className="h-4 w-4" />
            Notepad
          </Button>
        )}

        {mobileOpen && (
          <>
            <div
              className="fixed inset-0 z-30 bg-black/40"
              onClick={() => setMobileOpen(false)}
            />
            <div className="fixed bottom-0 right-0 top-0 z-40 flex w-[min(92vw,20rem)] flex-col overflow-hidden border-l border-border bg-card shadow-2xl [height:100dvh] [max-height:100dvh]">
              {panelBody}
            </div>
          </>
        )}
      </div>
    </>
  );
}
