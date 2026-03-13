"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Send,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  XCircle,
  RefreshCw,
  BookOpen,
  FlaskConical,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Code,
  FileText,
  Database,
  Server,
  Search,
  Trash2,
  Copy,
  X,
} from "lucide-react";
import { DemoFeatureNotice } from "@/components/demo/DemoFeatureNotice";

interface Submission {
  id: string;
  submissionType: string;
  status: string;
  xmlContent: string | null;
  response: string | Record<string, unknown> | null;
  accessionNumbers: Record<string, string> | string | null;
  entityType: string;
  entityId: string;
  createdAt: string;
  updatedAt: string;
  entityDetails: {
    id: string;
    title?: string;
    alias?: string;
    sampleId?: string;
    sampleTitle?: string;
    studyAccessionId?: string;
    sampleAccessionNumber?: string;
    user?: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      email: string;
    };
    study?: {
      id: string;
      title: string;
    };
  } | null;
}

const STATUS_CONFIG: Record<
  string,
  { label: string; dot: string; color: string; icon: React.ReactNode }
> = {
  PENDING: {
    label: "Pending",
    dot: "bg-amber-500",
    color: "text-amber-600",
    icon: <Clock className="h-3 w-3" />,
  },
  SUBMITTED: {
    label: "Submitted",
    dot: "bg-blue-500",
    color: "text-blue-600",
    icon: <Send className="h-3 w-3" />,
  },
  PARTIAL: {
    label: "Partial",
    dot: "bg-amber-500",
    color: "text-amber-600",
    icon: <AlertCircle className="h-3 w-3" />,
  },
  ACCEPTED: {
    label: "Accepted",
    dot: "bg-emerald-500",
    color: "text-emerald-600",
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  REJECTED: {
    label: "Rejected",
    dot: "bg-red-500",
    color: "text-red-600",
    icon: <XCircle className="h-3 w-3" />,
  },
  ERROR: {
    label: "Error",
    dot: "bg-red-500",
    color: "text-red-600",
    icon: <AlertCircle className="h-3 w-3" />,
  },
  CANCELLED: {
    label: "Cancelled",
    dot: "bg-stone-400",
    color: "text-stone-500",
    icon: <XCircle className="h-3 w-3" />,
  },
};

const stepIcons: Record<string, React.ReactNode> = {
  Validation: <Search className="h-4 w-4" />,
  "Generate XML": <Code className="h-4 w-4" />,
  "Send to ENA": <Server className="h-4 w-4" />,
  "Parse Response": <FileText className="h-4 w-4" />,
  "Update Database": <Database className="h-4 w-4" />,
};

interface StepDetails {
  step: number;
  name: string;
  status: string;
  timestamp: string;
  details: Record<string, unknown>;
}

function StepItem({ step }: { step: StepDetails }) {
  const [expanded, setExpanded] = useState(false);
  const icon = stepIcons[step.name] || <CheckCircle2 className="h-4 w-4" />;

  const formatTime = (ts: string) => {
    return new Date(ts).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const renderValue = (value: unknown, depth = 0): React.ReactNode => {
    if (value === null || value === undefined) return <span className="text-muted-foreground">-</span>;
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "string") {
      if (value.startsWith("<?xml") || value.startsWith("<")) {
        return (
          <div className="relative group">
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(value);
              }}
              className="absolute top-1 right-1 text-xs bg-stone-200 text-stone-600 px-2 py-0.5 rounded hover:bg-stone-300 flex items-center gap-1 opacity-60 hover:opacity-100"
            >
              <Copy className="h-3 w-3" /> Copy
            </button>
            <pre className="text-xs font-mono bg-white p-2 rounded border overflow-x-auto max-h-60 whitespace-pre-wrap">
              {value}
            </pre>
          </div>
        );
      }
      return value;
    }
    if (typeof value === "number") return value.toString();
    if (Array.isArray(value)) {
      if (value.length === 0) return <span className="text-muted-foreground">None</span>;
      return (
        <div className="space-y-1">
          {value.map((item, i) => (
            <div key={i} className="text-xs bg-white rounded p-1 border">
              {typeof item === "object" ? (
                <div className="grid grid-cols-2 gap-1">
                  {Object.entries(item as Record<string, unknown>).map(([k, v]) => (
                    <div key={k}>
                      <span className="text-muted-foreground">{k}:</span> {String(v)}
                    </div>
                  ))}
                </div>
              ) : (
                String(item)
              )}
            </div>
          ))}
        </div>
      );
    }
    if (typeof value === "object") {
      return (
        <div className={depth > 0 ? "ml-2 border-l pl-2" : ""}>
          {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
            <div key={k} className="text-xs">
              <span className="text-muted-foreground font-medium">{k}:</span>{" "}
              {renderValue(v, depth + 1)}
            </div>
          ))}
        </div>
      );
    }
    return String(value);
  };

  return (
    <div className="border rounded-lg bg-white overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-stone-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div
            className={`h-8 w-8 rounded-full flex items-center justify-center ${
              step.status === "completed"
                ? "bg-emerald-100 text-emerald-600"
                : step.status === "error"
                ? "bg-red-100 text-red-600"
                : "bg-amber-100 text-amber-600"
            }`}
          >
            {icon}
          </div>
          <div className="text-left">
            <div className="font-medium text-sm">
              Step {step.step}: {step.name}
            </div>
            <div className="text-xs text-muted-foreground">
              {formatTime(step.timestamp)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {step.status === "completed" && (
            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Completed
            </Badge>
          )}
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>
      {expanded && (
        <div className="p-3 pt-0 border-t bg-stone-50">
          <div className="space-y-2 mt-2">
            {Object.entries(step.details).map(([key, value]) => (
              <div key={key} className="text-sm">
                <span className="font-medium text-stone-600">{key}:</span>
                <div className="mt-1">{renderValue(value)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SubmissionsPage() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");

  if (session?.user?.isDemo) {
    return (
      <DemoFeatureNotice
        title="ENA submission is disabled in the public demo"
        description="The researcher demo uses real app screens, but external archive submission is blocked so the hosted environment never creates or simulates ENA records."
      />
    );
  }

  const safeJsonParse = (value: unknown) => {
    if (!value) return null;
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (!session || session.user.role !== "FACILITY_ADMIN") {
      router.push("/orders");
      return;
    }
    fetchSubmissions();
  }, [session, sessionStatus, router]);

  const fetchSubmissions = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch("/api/admin/submissions");
      if (!res.ok) throw new Error("Failed to fetch submissions");
      const data = await res.json();
      setSubmissions(data);
    } catch {
      setError("Failed to load submissions");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (submissionId: string) => {
    if (!confirm("Are you sure you want to delete this submission? For test submissions, this will also clear the accession numbers from the study.")) {
      return;
    }

    setDeletingId(submissionId);
    try {
      const res = await fetch(`/api/admin/submissions/${submissionId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to delete submission");
        return;
      }

      setSubmissions((prev) => prev.filter((s) => s.id !== submissionId));
      setExpandedId(null);
    } catch {
      setError("Failed to delete submission");
    } finally {
      setDeletingId(null);
    }
  };

  const handleRetry = async (submission: Submission, isTest: boolean) => {
    setRetryingId(submission.id);
    setError("");
    try {
      const res = await fetch("/api/admin/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType: submission.entityType,
          entityId: submission.entityId,
          isTest,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || "Failed to retry submission");
        return;
      }

      await fetchSubmissions();
    } catch {
      setError("Failed to retry submission");
    } finally {
      setRetryingId(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const getTestExpirationStatus = (createdAt: string): { expired: boolean; hoursRemaining: number; text: string } => {
    const created = new Date(createdAt);
    const expiresAt = new Date(created.getTime() + 24 * 60 * 60 * 1000);
    const now = new Date();
    const msRemaining = expiresAt.getTime() - now.getTime();
    const hoursRemaining = Math.floor(msRemaining / (60 * 60 * 1000));

    if (msRemaining <= 0) {
      return { expired: true, hoursRemaining: 0, text: "Expired" };
    } else if (hoursRemaining < 1) {
      const minutesRemaining = Math.floor(msRemaining / (60 * 1000));
      return { expired: false, hoursRemaining: 0, text: `Expires in ${minutesRemaining}m` };
    } else {
      return { expired: false, hoursRemaining, text: `Expires in ${hoursRemaining}h` };
    }
  };

  // Filtered submissions
  const filteredSubmissions = useMemo(() => {
    return submissions.filter((s) => {
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const entityName = s.entityType === "study"
          ? s.entityDetails?.title || ""
          : s.entityDetails?.sampleId || "";
        const userName = s.entityDetails?.user
          ? `${s.entityDetails.user.firstName || ""} ${s.entityDetails.user.lastName || ""}`.trim()
          : "";
        const matchesSearch =
          entityName.toLowerCase().includes(query) ||
          userName.toLowerCase().includes(query) ||
          s.submissionType.toLowerCase().includes(query) ||
          s.id.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }
      if (statusFilter && s.status !== statusFilter) return false;
      if (typeFilter && s.entityType !== typeFilter) return false;
      return true;
    });
  }, [submissions, searchQuery, statusFilter, typeFilter]);

  const hasActiveFilters = searchQuery || statusFilter || typeFilter;

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("");
    setTypeFilter("");
  };

  // Stats
  const acceptedCount = submissions.filter((s) => s.status === "ACCEPTED").length;
  const pendingCount = submissions.filter((s) => s.status === "PENDING" || s.status === "SUBMITTED").length;
  const issueCount = submissions.filter((s) => s.status === "REJECTED" || s.status === "ERROR" || s.status === "PARTIAL").length;

  if (sessionStatus === "loading" || loading) {
    return (
      <PageContainer className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </PageContainer>
    );
  }

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return null;
  }

  return (
    <PageContainer>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Archive Queue</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {submissions.length} submission{submissions.length !== 1 ? "s" : ""}
            {acceptedCount > 0 && <span className="text-emerald-600"> · {acceptedCount} accepted</span>}
            {pendingCount > 0 && <span className="text-amber-600"> · {pendingCount} pending</span>}
            {issueCount > 0 && <span className="text-red-600"> · {issueCount} issue{issueCount !== 1 ? "s" : ""}</span>}
          </p>
        </div>
        <Button onClick={fetchSubmissions} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          {error}
        </div>
      )}

      {submissions.length === 0 ? (
        <div className="bg-card rounded-lg p-12 text-center border border-border">
          <h2 className="text-lg font-medium mb-2">No submissions yet</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Archive work is managed per study. When a study or sample is registered with ENA, it will appear here.
          </p>
          <Button size="sm" variant="outline" asChild>
            <Link href="/studies">
              View Studies
            </Link>
          </Button>
        </div>
      ) : (
        <div className="bg-card rounded-lg overflow-hidden border border-border">
          {/* Search & Filters */}
          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search submissions..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm bg-secondary border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="relative">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="appearance-none pl-3 pr-8 py-2 text-sm bg-secondary border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                >
                  <option value="">All Status</option>
                  {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                    <option key={key} value={key}>{config.label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              </div>

              <div className="relative">
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="appearance-none pl-3 pr-8 py-2 text-sm bg-secondary border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                >
                  <option value="">All Types</option>
                  <option value="study">Study</option>
                  <option value="sample">Sample</option>
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              </div>

              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1 px-2 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-3 w-3" />
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Column Headers */}
          <div className="grid grid-cols-12 gap-4 px-5 py-2.5 border-b border-border bg-secondary/50 text-xs font-medium text-muted-foreground">
            <div className="col-span-4">Entity</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2">Accession</div>
            <div className="col-span-2">Date</div>
            <div className="col-span-2"></div>
          </div>

          {/* Submissions List */}
          <div className="divide-y divide-border">
            {filteredSubmissions.map((submission) => {
              const isExpanded = expandedId === submission.id;
              const response = safeJsonParse(submission.response);
              const accessionNumbers = safeJsonParse(submission.accessionNumbers) as Record<string, string> | null;
              const isTestSubmission = response?.isTest !== false;
              const statusCfg = STATUS_CONFIG[submission.status] || STATUS_CONFIG.PENDING;

              return (
                <div key={submission.id}>
                  <div
                    className="grid grid-cols-12 gap-4 px-5 py-4 hover:bg-secondary/80 transition-colors cursor-pointer items-center"
                    onClick={() => setExpandedId(isExpanded ? null : submission.id)}
                  >
                    {/* Entity */}
                    <div className="col-span-4 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className={`h-7 w-7 rounded-md flex items-center justify-center flex-shrink-0 ${
                            submission.entityType === "study"
                              ? "bg-blue-100"
                              : "bg-emerald-100"
                          }`}
                        >
                          {submission.entityType === "study" ? (
                            <BookOpen className="h-3.5 w-3.5 text-blue-600" />
                          ) : (
                            <FlaskConical className="h-3.5 w-3.5 text-emerald-600" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">
                            {submission.entityType === "study"
                              ? submission.entityDetails?.title || "Deleted Study"
                              : submission.entityDetails?.sampleId || "Deleted Sample"}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {submission.submissionType}
                            {response?.isTest && " · Test"}
                            {!submission.entityDetails && " · Entity Deleted"}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Status */}
                    <div className="col-span-2">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${statusCfg.dot}`} />
                        <span className={`text-xs font-medium ${statusCfg.color}`}>
                          {statusCfg.label}
                        </span>
                      </div>
                      {response?.isTest && (() => {
                        const expiration = getTestExpirationStatus(submission.createdAt);
                        return (
                          <span className={`text-[10px] ml-4 ${expiration.expired ? "text-stone-400 line-through" : "text-amber-500"}`}>
                            {expiration.expired ? "Expired" : expiration.text}
                          </span>
                        );
                      })()}
                    </div>

                    {/* Accession */}
                    <div className="col-span-2">
                      {accessionNumbers ? (
                        <span className="font-mono text-xs text-emerald-700">
                          {Object.values(accessionNumbers)[0]}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </div>

                    {/* Date */}
                    <div className="col-span-2">
                      <span className="text-sm text-muted-foreground tabular-nums">
                        {formatDate(submission.createdAt)}
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="col-span-2 flex items-center justify-end gap-1">
                      {submission.entityType === "study" && submission.entityDetails && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          asChild
                          onClick={(e: React.MouseEvent) => e.stopPropagation()}
                        >
                          <Link href={`/studies/${submission.entityId}?tab=ena`}>
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(submission.id);
                        }}
                        disabled={deletingId === submission.id}
                      >
                        {deletingId === submission.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="px-5 pb-4 pt-0 space-y-4">
                      <div className="border-t border-border/50 pt-4 space-y-4">
                        {/* Steps Timeline */}
                        {response?.steps && Array.isArray(response.steps) && (
                          <div className="bg-stone-50 rounded-lg p-4">
                            <h4 className="font-medium mb-4 text-sm">Registration Steps</h4>
                            <div className="space-y-3">
                              {response.steps.map((step: {
                                step: number;
                                name: string;
                                status: string;
                                timestamp: string;
                                details: Record<string, unknown>;
                              }) => (
                                <StepItem key={step.step} step={step} />
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Legacy Response Info */}
                        {response && !response.steps && (
                          <div className="bg-stone-50 rounded-lg p-4">
                            <h4 className="font-medium mb-2 text-sm">Submission Details</h4>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div>
                                <span className="text-muted-foreground">Server:</span>{" "}
                                <span className="font-mono text-xs">{response.server}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Type:</span>{" "}
                                {response.isTest ? "Test" : "Production"}
                              </div>
                              {response.message && (
                                <div className="col-span-2">
                                  <span className="text-muted-foreground">Message:</span>{" "}
                                  {response.message}
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Accession Numbers */}
                        {accessionNumbers && (
                          <div className="bg-emerald-50 rounded-lg p-4">
                            <h4 className="font-medium mb-3 text-sm text-emerald-700 flex items-center gap-2">
                              <CheckCircle2 className="h-4 w-4" />
                              Accession Numbers
                            </h4>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                              {Object.entries(accessionNumbers).map(([key, value]) => (
                                <div key={key} className="bg-white rounded-lg p-2 border border-emerald-200">
                                  <div className="text-xs text-muted-foreground mb-1">
                                    {key === "study" ? "Study" : `Sample: ${key}`}
                                  </div>
                                  <a
                                    href={
                                      response?.isTest
                                        ? `https://wwwdev.ebi.ac.uk/ena/browser/view/${value}`
                                        : `https://www.ebi.ac.uk/ena/browser/view/${value}`
                                    }
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-mono text-sm text-emerald-700 hover:text-emerald-900 hover:underline flex items-center gap-1"
                                  >
                                    {value as string}
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                </div>
                              ))}
                            </div>
                            <p className="text-xs text-muted-foreground mt-3">
                              {response?.isTest
                                ? "Test accessions - these will be deleted after 24 hours"
                                : "Production accessions - permanently registered with ENA"}
                            </p>
                          </div>
                        )}

                        {/* XML Content */}
                        {submission.xmlContent && (
                          <div className="bg-stone-50 rounded-lg p-4">
                            <h4 className="font-medium mb-2 text-sm">Generated XML</h4>
                            <pre className="text-xs font-mono overflow-x-auto max-h-40 p-2 bg-white rounded border">
                              {submission.xmlContent}
                            </pre>
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex gap-2">
                          {(submission.status === "REJECTED" || submission.status === "ERROR") &&
                            submission.entityType === "study" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRetry(submission, isTestSubmission);
                              }}
                              disabled={retryingId === submission.id}
                            >
                              {retryingId === submission.id ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <RefreshCw className="h-4 w-4 mr-2" />
                              )}
                              Retry Submission
                            </Button>
                          )}
                          {submission.status === "PENDING" && (
                            <Button size="sm" variant="outline" disabled>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Processing...
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(submission.id);
                            }}
                            disabled={deletingId === submission.id}
                          >
                            {deletingId === submission.id ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4 mr-2" />
                            )}
                            Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {filteredSubmissions.length === 0 && hasActiveFilters && (
            <div className="py-12 text-center text-muted-foreground">
              <p className="text-sm">No submissions match your filters</p>
              <button
                onClick={clearFilters}
                className="mt-2 text-sm text-primary hover:underline"
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
