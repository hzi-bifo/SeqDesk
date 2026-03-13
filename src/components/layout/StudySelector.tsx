"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BookOpen, ChevronDown, Search, Layers, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { getStudyHref } from "./entityNavigation";

interface StudyItem {
  id: string;
  title: string;
  submitted: boolean;
  readyForSubmission: boolean;
  studyAccessionId: string | null;
  _count?: { samples: number };
  user?: {
    firstName: string | null;
    lastName: string | null;
    email: string;
  };
}

export interface StudySelectorProps {
  /** Current study ID detected from the URL (null = no study selected) */
  currentStudyId: string | null;
  /** Current study title (fetched externally) */
  currentStudyTitle?: string | null;
  /** Visual variant */
  variant: "sidebar" | "topbar";
  /** Whether sidebar is collapsed (only relevant for sidebar variant) */
  collapsed?: boolean;
}

export function StudySelector({
  currentStudyId,
  currentStudyTitle,
  variant,
  collapsed = false,
}: StudySelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<StudyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fetch studies when dropdown opens
  const fetchStudies = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/studies");
      if (res.ok) {
        const data = await res.json();
        setItems(Array.isArray(data) ? data : []);
      }
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void fetchStudies();
      setSearch("");
    }
  }, [open, fetchStudies]);

  // Filter studies by search
  const filtered = search
    ? items.filter((s) => {
        const q = search.toLowerCase();
        const ownerName = s.user
          ? `${s.user.firstName || ""} ${s.user.lastName || ""} ${s.user.email || ""}`.trim().toLowerCase()
          : "";
        return (
          s.title.toLowerCase().includes(q) ||
          (s.studyAccessionId || "").toLowerCase().includes(q) ||
          ownerName.includes(q)
        );
      })
    : items;

  const handleSelect = (studyId: string | null) => {
    setOpen(false);
    router.push(getStudyHref(studyId, pathname, searchParams));
  };

  const displayLabel = currentStudyTitle || "All Studies";
  const hasStudy = !!currentStudyId;
  const isSidebar = variant === "sidebar";
  const isCollapsedSidebar = isSidebar && collapsed;

  return (
    <div
      ref={ref}
      className={cn(
        "relative",
        isSidebar && (isCollapsedSidebar ? "px-2 pb-2" : "px-3 pb-2"),
      )}
    >
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg text-sm transition-colors",
          isCollapsedSidebar
            ? "justify-center p-2 text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
            : isSidebar
            ? "border border-border px-3 py-2 hover:bg-secondary/50"
            : "px-3 py-1.5 hover:bg-secondary/50",
          open && "bg-secondary/50"
        )}
        title={isCollapsedSidebar ? displayLabel : undefined}
      >
        {isCollapsedSidebar ? (
          hasStudy ? (
            <BookOpen className="h-5 w-5" />
          ) : (
            <Layers className="h-5 w-5" />
          )
        ) : (
          <>
            {isSidebar &&
              (hasStudy ? (
                <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
              ))}
            <span className="min-w-0 truncate flex-1 text-left font-medium">
              {displayLabel}
            </span>
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
                open && "rotate-180"
              )}
            />
          </>
        )}
      </button>

      {open && (
        <div
          className={cn(
            "absolute z-50 rounded-lg border border-border bg-card p-2 shadow-md",
            isCollapsedSidebar
              ? "left-full top-0 ml-2 w-72"
              : isSidebar
                ? "left-3 right-3 mt-1"
                : "left-0 mt-1 min-w-[260px]"
          )}
        >
          {/* Search */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
              }}
              placeholder="Search studies..."
              className="h-8 rounded-md border-0 bg-secondary/50 pl-8 text-sm shadow-none focus-visible:bg-background"
            />
          </div>

          {/* "All Studies" + "New Study" */}
          <div className="mt-1.5 space-y-0.5">
            <button
              type="button"
              onClick={() => handleSelect(null)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                !currentStudyId
                  ? "bg-secondary font-medium text-foreground"
                  : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
              )}
            >
              <Layers className="h-3.5 w-3.5 shrink-0" />
              All Studies
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                router.push("/studies/new");
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              New Study
            </button>
          </div>

          {/* Divider */}
          <div className="my-1 h-px bg-border" />

          {/* Study list */}
          <div className="max-h-64 overflow-y-auto">
            {loading ? (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                Loading...
              </p>
            ) : filtered.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                {search ? "No studies found." : "No studies yet."}
              </p>
            ) : (
              <div className="space-y-0.5">
                {filtered.map((study) => {
                  const isActive = study.id === currentStudyId;
                  const statusLabel = study.submitted
                    ? "Registered"
                    : study.readyForSubmission
                      ? "Ready"
                      : "Draft";

                  return (
                    <button
                      key={study.id}
                      type="button"
                      onClick={() => handleSelect(study.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                        isActive
                          ? "bg-secondary font-medium text-foreground"
                          : "text-foreground hover:bg-secondary/50"
                      )}
                    >
                      <span className="min-w-0 truncate flex-1">{study.title}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {statusLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
