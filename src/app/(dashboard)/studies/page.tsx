"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/PageContainer";
import { Skeleton } from "@/components/ui/skeleton";
import { HelpBox } from "@/components/ui/help-box";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Loader2,
  ChevronRight,
  Search,
  ArrowUpDown,
  ChevronDown,
  X,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ErrorBanner } from "@/components/ui/error-banner";

interface Study {
  id: string;
  title: string;
  description: string | null;
  checklistType: string | null;
  submitted: boolean;
  submittedAt: string | null;
  studyAccessionId: string | null;
  createdAt: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  _count: {
    samples: number;
  };
  samplesWithReads: number;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  draft: { label: "Draft", color: "text-muted-foreground", dot: "bg-muted-foreground" },
  published: { label: "Published", color: "text-emerald-600", dot: "bg-emerald-500" },
};

type SortField = "created" | "title" | "status" | "samples";
type SortDirection = "asc" | "desc";

export default function StudiesPage() {
  const { data: session } = useSession();
  const [studies, setStudies] = useState<Study[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [userFilter, setUserFilter] = useState<string>("");
  const [sortField, setSortField] = useState<SortField>("created");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingStudy, setDeletingStudy] = useState<Study | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedStudyIds, setSelectedStudyIds] = useState<Set<string>>(new Set());
  const [bulkEditMode, setBulkEditMode] = useState(false);

  const isResearcher = session?.user?.role === "RESEARCHER";
  const isFacilityAdmin = session?.user?.role === "FACILITY_ADMIN";
  const canCreateStudy = isResearcher || isFacilityAdmin;

  useEffect(() => {
    const fetchStudies = async () => {
      try {
        const res = await fetch("/api/studies");
        if (!res.ok) throw new Error("Failed to fetch studies");
        const data = await res.json();
        setStudies(data);
      } catch {
        setError("Failed to load studies");
      } finally {
        setLoading(false);
      }
    };

    fetchStudies();
  }, []);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Get unique users for filter dropdown
  const uniqueUsers = useMemo(() => {
    const users = new Map<string, { id: string; name: string }>();
    studies.forEach((study) => {
      if (!users.has(study.user.id)) {
        users.set(study.user.id, {
          id: study.user.id,
          name: `${study.user.firstName} ${study.user.lastName}`,
        });
      }
    });
    return Array.from(users.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [studies]);

  // Filter and sort studies
  const filteredStudies = useMemo(() => {
    const result = studies.filter((study) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          study.title.toLowerCase().includes(query) ||
          study.checklistType?.toLowerCase().includes(query) ||
          study.user.firstName.toLowerCase().includes(query) ||
          study.user.lastName.toLowerCase().includes(query) ||
          study.user.email.toLowerCase().includes(query) ||
          study.studyAccessionId?.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }

      // Status filter
      if (statusFilter) {
        const studyStatus = study.submitted ? "published" : "draft";
        if (studyStatus !== statusFilter) return false;
      }

      // User filter
      if (userFilter && study.user.id !== userFilter) return false;

      return true;
    });

    // Sort
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "created":
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case "title":
          comparison = a.title.localeCompare(b.title);
          break;
        case "status":
          comparison = (a.submitted ? 1 : 0) - (b.submitted ? 1 : 0);
          break;
        case "samples":
          comparison = a._count.samples - b._count.samples;
          break;
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });

    return result;
  }, [studies, searchQuery, statusFilter, userFilter, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("");
    setUserFilter("");
  };

  const deletableStudies = useMemo(
    () =>
      studies.filter(
        (study) => !study.submitted && (session?.user?.id === study.user.id || isFacilityAdmin)
      ),
    [studies, session?.user?.id, isFacilityAdmin]
  );
  const selectedStudies = useMemo(
    () => deletableStudies.filter((study) => selectedStudyIds.has(study.id)),
    [deletableStudies, selectedStudyIds]
  );
  const toggleStudySelection = (studyId: string, checked: boolean) => {
    setSelectedStudyIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(studyId);
      } else {
        next.delete(studyId);
      }
      return next;
    });
  };

  const exitBulkEditMode = () => {
    setBulkEditMode(false);
    setSelectedStudyIds(new Set());
  };

  const handleDeleteStudy = async () => {
    const targetStudies = deletingStudy ? [deletingStudy] : selectedStudies;
    if (targetStudies.length === 0) return;

    setDeleting(true);
    try {
      const results = await Promise.all(
        targetStudies.map(async (study) => {
          const res = await fetch(`/api/studies/${study.id}`, { method: "DELETE" });
          if (res.ok) {
            return { id: study.id, ok: true as const };
          }

          const data = await res.json().catch(() => ({}));
          return {
            id: study.id,
            ok: false as const,
            error: data.error || `Failed to delete ${study.title}`,
          };
        })
      );

      const deletedIds = results.filter((result) => result.ok).map((result) => result.id);
      const failed = results.filter((result) => !result.ok);

      if (deletedIds.length > 0) {
        setStudies((prev) => prev.filter((study) => !deletedIds.includes(study.id)));
        setSelectedStudyIds((prev) => {
          const next = new Set(prev);
          deletedIds.forEach((id) => next.delete(id));
          return next;
        });
      }

      if (failed.length > 0) {
        toast.error(failed[0].error || "Failed to delete some studies");
        return;
      }

      toast.success(targetStudies.length === 1 ? "Study deleted" : "Studies deleted");
    } catch {
      toast.error("Failed to delete study");
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
      setDeletingStudy(null);
    }
  };

  const hasActiveFilters = searchQuery || statusFilter || userFilter;

  if (loading) {
    return (
      <PageContainer>
        {/* Header skeleton */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-4 w-16 mt-1.5" />
          </div>
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
        {/* Table skeleton */}
        <div className="bg-card rounded-xl overflow-hidden border border-border">
          <div className="px-4 py-3 border-b border-border">
            <Skeleton className="h-9 w-full rounded-lg" />
          </div>
          <div className="hidden md:grid grid-cols-12 gap-4 px-5 py-2.5 border-b border-border bg-secondary/50">
            <Skeleton className="col-span-5 h-3 w-12" />
            <Skeleton className="col-span-2 h-3 w-12" />
            <Skeleton className="col-span-2 h-3 w-20" />
            <Skeleton className="col-span-1 h-3 w-14 ml-auto" />
            <Skeleton className="col-span-2 h-3 w-16" />
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="hidden md:grid grid-cols-12 gap-4 px-5 py-4 items-center">
                <div className="col-span-5 space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-28" />
                </div>
                <div className="col-span-2">
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
                <Skeleton className="col-span-2 h-3 w-24" />
                <Skeleton className="col-span-1 h-3 w-6 ml-auto" />
                <Skeleton className="col-span-2 h-3 w-20" />
              </div>
            ))}
          </div>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">
            {isFacilityAdmin ? "All Studies" : "My Studies"}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {studies.length} stud{studies.length !== 1 ? "ies" : "y"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
          {isFacilityAdmin && (
            bulkEditMode ? (
              <Button size="sm" variant="outline" onClick={exitBulkEditMode}>
                Done
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setBulkEditMode(true)}>
                Edit Multiple
              </Button>
            )
          )}
          {canCreateStudy && (
            <Button size="sm" variant="outline" asChild>
              <Link href="/studies/new">
                New Study
              </Link>
            </Button>
          )}
        </div>
      </div>

      <HelpBox title="What are studies?">
        A study groups samples that share the same environment type (e.g., human gut, soil, water).
        Each study uses a specific MIxS checklist to capture standardized metadata for ENA submission.
      </HelpBox>

      {error && <ErrorBanner message={error} />}

      {studies.length === 0 ? (
        <div className="bg-card rounded-xl p-12 text-center border border-border">
          <h2 className="text-lg font-medium mb-2">No studies yet</h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            {isResearcher
              ? "Studies group samples for ENA submission. First create an order with samples, then create a study to associate those samples with metadata."
              : "Studies group samples for ENA submission. Create an order with samples first, then create a study to associate metadata."}
          </p>
          {canCreateStudy && (
            <div className="flex flex-col items-center gap-3">
              <Button size="sm" variant="outline" asChild>
                <Link href="/studies/new">
                  New Study
                </Link>
              </Button>
              <Link href="/orders" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                Or create an order first
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-card rounded-xl overflow-hidden border border-border">
          {isFacilityAdmin && bulkEditMode && selectedStudies.length > 0 && (
            <div className="flex items-center justify-between gap-3 border-b border-border bg-secondary/40 px-4 py-3">
              <p className="text-sm text-muted-foreground">
                {selectedStudies.length} stud{selectedStudies.length !== 1 ? "ies" : "y"} selected
              </p>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  setDeletingStudy(null);
                  setDeleteDialogOpen(true);
                }}
              >
                Delete Selected
              </Button>
            </div>
          )}

          {/* Search & Filters */}
          <div className="px-4 py-3 border-b border-border">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              {/* Search */}
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search studies..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm bg-secondary border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-foreground/20"
                />
              </div>

              <div className="flex items-center gap-2 sm:gap-3">
                {/* Status Filter */}
                <div className="relative flex-1 sm:flex-none">
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="w-full sm:w-auto appearance-none pl-3 pr-8 py-2 text-sm bg-secondary border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-foreground/20 cursor-pointer"
                  >
                    <option value="">All Status</option>
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>

                {/* User Filter (Admin only) */}
                {isFacilityAdmin && (
                  <div className="relative flex-1 sm:flex-none">
                    <select
                      value={userFilter}
                      onChange={(e) => setUserFilter(e.target.value)}
                      className="w-full sm:w-auto appearance-none pl-3 pr-8 py-2 text-sm bg-secondary border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-foreground/20 cursor-pointer"
                    >
                      <option value="">All Researchers</option>
                      {uniqueUsers.map((user) => (
                        <option key={user.id} value={user.id}>{user.name}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  </div>
                )}

                {/* Clear Filters */}
                {hasActiveFilters && (
                  <button
                    onClick={clearFilters}
                    className="flex items-center gap-1 px-2 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  >
                    <X className="h-3 w-3" />
                    Clear
                  </button>
                )}
              </div>

              {/* Mobile sort controls */}
              <div className="flex items-center gap-2 md:hidden">
                <select
                  value={sortField}
                  onChange={(e) => setSortField(e.target.value as SortField)}
                  className="flex-1 appearance-none pl-3 pr-8 py-2 text-sm bg-secondary border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-foreground/20 cursor-pointer"
                >
                  <option value="created">Sort: Created</option>
                  <option value="title">Sort: Title</option>
                  <option value="status">Sort: Status</option>
                  <option value="samples">Sort: Samples</option>
                </select>
                <button
                  onClick={() => setSortDirection(sortDirection === "asc" ? "desc" : "asc")}
                  className="px-3 py-2 text-xs bg-secondary rounded-lg border border-border hover:bg-secondary/80 transition-colors shrink-0"
                >
                  {sortDirection === "asc" ? "Asc" : "Desc"}
                </button>
              </div>
            </div>
          </div>

          {/* Table Header - hidden on mobile */}
          <div className="hidden md:grid grid-cols-12 gap-4 px-5 py-2.5 border-b border-border bg-secondary/50 text-xs font-medium text-muted-foreground">
            <button
              onClick={() => handleSort("title")}
              className={`${isFacilityAdmin ? "col-span-5" : "col-span-7"} flex items-center gap-1 hover:text-foreground transition-colors text-left`}
            >
              Study
              {sortField === "title" && <ArrowUpDown className="h-3 w-3" />}
            </button>
            <button
              onClick={() => handleSort("status")}
              className="col-span-2 flex items-center gap-1 hover:text-foreground transition-colors text-left"
            >
              Status
              {sortField === "status" && <ArrowUpDown className="h-3 w-3" />}
            </button>
            {isFacilityAdmin && <div className="col-span-2">Researcher</div>}
            <button
              onClick={() => handleSort("samples")}
              className="col-span-1 flex items-center gap-1 hover:text-foreground transition-colors justify-end"
            >
              {sortField === "samples" && <ArrowUpDown className="h-3 w-3" />}
              Samples
            </button>
            <button
              onClick={() => handleSort("created")}
              className="col-span-1 flex items-center gap-1 hover:text-foreground transition-colors text-left"
            >
              Created
              {sortField === "created" && <ArrowUpDown className="h-3 w-3" />}
            </button>
            <div className="col-span-1"></div>
          </div>

          {/* Studies List */}
          <div className="divide-y divide-border">
            {filteredStudies.map((study) => {
              const status = study.submitted ? "published" : "draft";
              const statusConfig = STATUS_CONFIG[status];
              const canDeleteStudy = !study.submitted && (session?.user?.id === study.user.id || isFacilityAdmin);
              const isSelected = selectedStudyIds.has(study.id);

              return (
                <div
                  key={study.id}
                  className={`block px-4 py-3 transition-colors group md:grid md:grid-cols-12 md:gap-4 md:px-5 md:py-4 md:items-center ${
                    bulkEditMode && canDeleteStudy
                      ? `${isSelected ? "bg-primary/10 ring-1 ring-inset ring-primary/30" : "hover:bg-secondary/80"} cursor-pointer`
                      : "hover:bg-secondary/80"
                  }`}
                  onClick={
                    bulkEditMode && canDeleteStudy
                      ? () => toggleStudySelection(study.id, !isSelected)
                      : undefined
                  }
                >
                  {/* Mobile layout */}
                  <div className="md:hidden">
                    <div className="flex items-center justify-between gap-3">
                      {bulkEditMode ? (
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                            {study.title}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {study._count.samples} samples · {formatDate(study.createdAt)}
                          </p>
                          {study.studyAccessionId && (
                            <p className="text-xs text-emerald-600 font-mono mt-0.5">
                              {study.studyAccessionId}
                            </p>
                          )}
                          {isFacilityAdmin && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {study.user.firstName} {study.user.lastName}
                            </p>
                          )}
                        </div>
                      ) : (
                        <Link href={`/studies/${study.id}`} className="min-w-0 flex-1">
                          <p className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                            {study.title}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {study._count.samples} samples · {formatDate(study.createdAt)}
                          </p>
                          {study.studyAccessionId && (
                            <p className="text-xs text-emerald-600 font-mono mt-0.5">
                              {study.studyAccessionId}
                            </p>
                          )}
                          {isFacilityAdmin && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {study.user.firstName} {study.user.lastName}
                            </p>
                          )}
                        </Link>
                      )}
                      <div className="flex items-center gap-1 shrink-0">
                        {bulkEditMode ? (
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${statusConfig.dot}`} />
                            <span className={`text-xs font-medium ${statusConfig.color}`}>
                              {statusConfig.label}
                            </span>
                          </div>
                        ) : (
                          <Link href={`/studies/${study.id}`} className="flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${statusConfig.dot}`} />
                            <span className={`text-xs font-medium ${statusConfig.color}`}>
                              {statusConfig.label}
                            </span>
                            <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
                          </Link>
                        )}
                        {canDeleteStudy && !bulkEditMode && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                aria-label={`Options for ${study.title}`}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => {
                                  setDeletingStudy(study);
                                  setDeleteDialogOpen(true);
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete study
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Desktop layout */}
                  <div className="hidden md:contents">
                    {/* Study Info */}
                    <div className={`${isFacilityAdmin ? "col-span-5" : "col-span-7"} min-w-0`}>
                      {bulkEditMode ? (
                        <>
                          <p className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                            {study.title}
                          </p>
                          {study.studyAccessionId && (
                            <p className="text-xs text-emerald-600 font-mono mt-0.5">
                              {study.studyAccessionId}
                            </p>
                          )}
                        </>
                      ) : (
                        <Link href={`/studies/${study.id}`}>
                          <p className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                            {study.title}
                          </p>
                          {study.studyAccessionId && (
                            <p className="text-xs text-emerald-600 font-mono mt-0.5">
                              {study.studyAccessionId}
                            </p>
                          )}
                        </Link>
                      )}
                    </div>

                    {/* Status */}
                    <div className="col-span-2">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${statusConfig.dot}`} />
                        <span className={`text-xs font-medium ${statusConfig.color}`}>
                          {statusConfig.label}
                        </span>
                      </div>
                    </div>

                    {/* Researcher (Admin only) */}
                    {isFacilityAdmin && (
                      <div className="col-span-2 min-w-0">
                        <p className="text-sm truncate">
                          {study.user.firstName} {study.user.lastName}
                        </p>
                      </div>
                    )}

                    {/* Samples */}
                    <div className="col-span-1 text-right">
                      <span className="text-sm tabular-nums text-muted-foreground">
                        {study._count.samples} {study._count.samples === 1 ? "sample" : "samples"}
                      </span>
                    </div>

                    {/* Date */}
                    <div className="col-span-1">
                      <span className="text-sm text-muted-foreground tabular-nums">
                        {formatDate(study.createdAt)}
                      </span>
                    </div>

                    <div className="col-span-1 flex items-center justify-end">
                      {canDeleteStudy ? (
                        bulkEditMode ? (
                          <div className="h-8 w-8" />
                        ) : (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                aria-label={`Options for ${study.title}`}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => {
                                  setDeletingStudy(study);
                                  setDeleteDialogOpen(true);
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete study
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )
                      ) : (
                        <div>
                          {!bulkEditMode && (
                            <Link href={`/studies/${study.id}`}>
                              <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
                            </Link>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {filteredStudies.length === 0 && hasActiveFilters && (
            <div className="py-12 text-center text-muted-foreground">
              <p className="text-sm">No studies match your filters</p>
              <button
                onClick={clearFilters}
                className="mt-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear all filters
              </button>
            </div>
          )}
        </div>
      )}
      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={(open) => {
        if (!deleting) {
          setDeleteDialogOpen(open);
          if (!open) setDeletingStudy(null);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Study</DialogTitle>
            <DialogDescription>
              {deletingStudy
                ? `Are you sure you want to delete "${deletingStudy.title}"? Samples will be unassigned but not deleted. This action cannot be undone.`
                : `Are you sure you want to delete ${selectedStudies.length} selected studies? Samples will be unassigned but not deleted. This action cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteDialogOpen(false); setDeletingStudy(null); }} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteStudy} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Delete Study
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
