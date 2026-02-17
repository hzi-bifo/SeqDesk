"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PageContainer } from "@/components/layout/PageContainer";
import { HelpBox } from "@/components/ui/help-box";
import {
  Loader2,
  ChevronRight,
  Search,
  ArrowUpDown,
  ChevronDown,
  X,
} from "lucide-react";
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
  const [allowUserAssemblyDownload, setAllowUserAssemblyDownload] = useState(false);
  const [savingAssemblyDownloadSetting, setSavingAssemblyDownloadSetting] = useState(false);

  const isResearcher = session?.user?.role === "RESEARCHER";
  const isFacilityAdmin = session?.user?.role === "FACILITY_ADMIN";

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

  useEffect(() => {
    if (!isFacilityAdmin) {
      return;
    }

    let mounted = true;

    const fetchAccessSettings = async () => {
      try {
        const res = await fetch("/api/admin/settings/access");
        if (!res.ok) {
          return;
        }
        const data = (await res.json()) as { allowUserAssemblyDownload?: boolean };
        if (mounted) {
          setAllowUserAssemblyDownload(data.allowUserAssemblyDownload === true);
        }
      } catch {
        // Best effort only, keep local default.
      }
    };

    void fetchAccessSettings();

    return () => {
      mounted = false;
    };
  }, [isFacilityAdmin]);

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

  const hasActiveFilters = searchQuery || statusFilter || userFilter;

  const handleAllowUserAssemblyDownloadChange = async (enabled: boolean) => {
    setAllowUserAssemblyDownload(enabled);
    setSavingAssemblyDownloadSetting(true);

    try {
      const res = await fetch("/api/admin/settings/access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowUserAssemblyDownload: enabled }),
      });
      if (!res.ok) {
        throw new Error("Failed to save setting");
      }
    } catch {
      setAllowUserAssemblyDownload(!enabled);
      setError("Failed to update assembly download setting");
    } finally {
      setSavingAssemblyDownloadSetting(false);
    }
  };

  if (loading) {
    return (
      <PageContainer className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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
            <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
              <div className="text-right">
                <p className="text-xs font-medium leading-none">User Assembly Downloads</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Show final assemblies in researcher portal
                </p>
              </div>
              {savingAssemblyDownloadSetting && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
              <Switch
                checked={allowUserAssemblyDownload}
                onCheckedChange={(checked) => {
                  void handleAllowUserAssemblyDownloadChange(checked);
                }}
                disabled={savingAssemblyDownloadSetting}
                aria-label="Toggle user assembly downloads"
              />
            </div>
          )}
          {isResearcher && (
            <Button size="sm" variant="outline" asChild>
              <Link href="/dashboard/studies/new">
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
              : "Studies group samples for ENA submission. Researchers need to first create orders with samples, then create studies to associate those samples with metadata."}
          </p>
          {isResearcher && (
            <div className="flex flex-col items-center gap-3">
              <Button size="sm" variant="outline" asChild>
                <Link href="/dashboard/studies/new">
                  New Study
                </Link>
              </Button>
              <Link href="/dashboard/orders" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                Or create an order first
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-card rounded-xl overflow-hidden border border-border">
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
              className={`${isFacilityAdmin ? "col-span-3" : "col-span-5"} flex items-center gap-1 hover:text-foreground transition-colors text-left`}
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
            <div className={isFacilityAdmin ? "col-span-2" : "col-span-2"}>Environment</div>
            {isFacilityAdmin && <div className="col-span-2">Researcher</div>}
            <button
              onClick={() => handleSort("samples")}
              className={`${isFacilityAdmin ? "col-span-1" : "col-span-1"} flex items-center gap-1 hover:text-foreground transition-colors justify-end`}
            >
              {sortField === "samples" && <ArrowUpDown className="h-3 w-3" />}
              Samples
            </button>
            <button
              onClick={() => handleSort("created")}
              className={`${isFacilityAdmin ? "col-span-1" : "col-span-1"} flex items-center gap-1 hover:text-foreground transition-colors text-left`}
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

              return (
                <Link
                  key={study.id}
                  href={`/dashboard/studies/${study.id}`}
                  className="block px-4 py-3 hover:bg-secondary/80 transition-colors group md:grid md:grid-cols-12 md:gap-4 md:px-5 md:py-4 md:items-center"
                >
                  {/* Mobile layout */}
                  <div className="md:hidden">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                          {study.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {study.checklistType?.replace(/-/g, " ") || "No type"} · {study._count.samples} samples · {formatDate(study.createdAt)}
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
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`h-2 w-2 rounded-full ${statusConfig.dot}`} />
                        <span className={`text-xs font-medium ${statusConfig.color}`}>
                          {statusConfig.label}
                        </span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
                      </div>
                    </div>
                  </div>

                  {/* Desktop layout */}
                  <div className="hidden md:contents">
                    {/* Study Info */}
                    <div className={`${isFacilityAdmin ? "col-span-3" : "col-span-5"} min-w-0`}>
                      <p className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                        {study.title}
                      </p>
                      {study.studyAccessionId && (
                        <p className="text-xs text-emerald-600 font-mono mt-0.5">
                          {study.studyAccessionId}
                        </p>
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

                    {/* Environment Type */}
                    <div className="col-span-2 min-w-0">
                      <p className="text-sm text-muted-foreground truncate capitalize">
                        {study.checklistType?.replace(/-/g, " ") || "Not set"}
                      </p>
                    </div>

                    {/* Researcher (Admin only) */}
                    {isFacilityAdmin && (
                      <div className="col-span-2 min-w-0">
                        <p className="text-sm truncate">
                          {study.user.firstName} {study.user.lastName}
                        </p>
                      </div>
                    )}

                    {/* Samples / Reads */}
                    <div className={`${isFacilityAdmin ? "col-span-1" : "col-span-1"} text-right`}>
                      <span className="text-sm tabular-nums text-muted-foreground">
                        {study._count.samples}
                      </span>
                    </div>

                    {/* Date */}
                    <div className={isFacilityAdmin ? "col-span-1" : "col-span-1"}>
                      <span className="text-sm text-muted-foreground tabular-nums">
                        {formatDate(study.createdAt)}
                      </span>
                    </div>

                    {/* Arrow */}
                    <div className="col-span-1 flex justify-end">
                      <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
                    </div>
                  </div>
                </Link>
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
    </PageContainer>
  );
}
