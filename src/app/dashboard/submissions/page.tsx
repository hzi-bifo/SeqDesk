"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/ui/glass-card";
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
} from "lucide-react";

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

const statusConfig: Record<
  string,
  { label: string; color: string; icon: React.ReactNode }
> = {
  PENDING: {
    label: "Pending",
    color: "bg-amber-100 text-amber-700 border-amber-200",
    icon: <Clock className="h-3 w-3" />,
  },
  SUBMITTED: {
    label: "Submitted",
    color: "bg-blue-100 text-blue-700 border-blue-200",
    icon: <Send className="h-3 w-3" />,
  },
  PARTIAL: {
    label: "Partial",
    color: "bg-amber-100 text-amber-700 border-amber-200",
    icon: <AlertCircle className="h-3 w-3" />,
  },
  ACCEPTED: {
    label: "Accepted",
    color: "bg-emerald-100 text-emerald-700 border-emerald-200",
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  REJECTED: {
    label: "Rejected",
    color: "bg-red-100 text-red-700 border-red-200",
    icon: <XCircle className="h-3 w-3" />,
  },
  ERROR: {
    label: "Error",
    color: "bg-red-100 text-red-700 border-red-200",
    icon: <AlertCircle className="h-3 w-3" />,
  },
  CANCELLED: {
    label: "Cancelled",
    color: "bg-stone-100 text-stone-600 border-stone-200",
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

  const renderValue = (value: unknown, depth = 0, key?: string): React.ReactNode => {
    if (value === null || value === undefined) return <span className="text-muted-foreground">-</span>;
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "string") {
      // Check if it looks like XML
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
      router.push("/dashboard");
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

      // Remove from local state
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
    return new Date(dateString).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Calculate expiration status for test submissions (24h expiry)
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

  const getStatusBadge = (status: string) => {
    const config = statusConfig[status] || statusConfig.PENDING;
    return (
      <Badge
        variant="outline"
        className={`${config.color} flex items-center gap-1`}
      >
        {config.icon}
        {config.label}
      </Badge>
    );
  };

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

  // Group submissions by status
  const pendingSubmissions = submissions.filter((s) =>
    s.status === "PENDING" || s.status === "SUBMITTED"
  );
  const completedSubmissions = submissions.filter(
    (s) => s.status === "ACCEPTED"
  );
  const issueSubmissions = submissions.filter(
    (s) => s.status === "REJECTED" || s.status === "ERROR" || s.status === "PARTIAL"
  );

  return (
    <PageContainer>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-lg bg-primary/10 flex items-center justify-center">
              <Send className="h-7 w-7 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">ENA Submissions</h1>
              <p className="text-muted-foreground mt-1">
                Track study and sample registrations with the European Nucleotide Archive
              </p>
            </div>
          </div>
          <Button onClick={fetchSubmissions} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          {error}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <GlassCard className="p-4">
          <div className="text-2xl font-bold">{submissions.length}</div>
          <div className="text-sm text-muted-foreground">Total Submissions</div>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="text-2xl font-bold text-amber-600">
            {pendingSubmissions.length}
          </div>
          <div className="text-sm text-muted-foreground">Pending</div>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="text-2xl font-bold text-emerald-600">
            {completedSubmissions.length}
          </div>
          <div className="text-sm text-muted-foreground">Accepted</div>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="text-2xl font-bold text-red-600">
            {issueSubmissions.length}
          </div>
          <div className="text-sm text-muted-foreground">Issues</div>
        </GlassCard>
      </div>

      {/* Submissions List */}
      {submissions.length === 0 ? (
        <GlassCard className="p-12 text-center">
          <Send className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
          <h2 className="text-xl font-semibold mb-2">No Submissions Yet</h2>
          <p className="text-muted-foreground mb-4">
            When you register studies or samples with ENA, they will appear here.
          </p>
          <Button asChild>
            <Link href="/dashboard/studies">
              <BookOpen className="h-4 w-4 mr-2" />
              View Studies
            </Link>
          </Button>
        </GlassCard>
      ) : (
        <GlassCard className="divide-y divide-border">
          {submissions.map((submission) => {
            const isExpanded = expandedId === submission.id;
            const response = safeJsonParse(submission.response);
            const accessionNumbers = safeJsonParse(submission.accessionNumbers) as Record<string, string> | null;
            const isTestSubmission = response?.isTest !== false;

            return (
              <div key={submission.id} className="p-4">
                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() =>
                    setExpandedId(isExpanded ? null : submission.id)
                  }
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={`h-10 w-10 rounded-lg flex items-center justify-center ${
                        submission.entityType === "study"
                          ? "bg-blue-100"
                          : "bg-emerald-100"
                      }`}
                    >
                      {submission.entityType === "study" ? (
                        <BookOpen
                          className={`h-5 w-5 ${
                            submission.entityType === "study"
                              ? "text-blue-600"
                              : "text-emerald-600"
                          }`}
                        />
                      ) : (
                        <FlaskConical className="h-5 w-5 text-emerald-600" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {submission.entityType === "study"
                            ? submission.entityDetails?.title || "Deleted Study"
                            : submission.entityDetails?.sampleId ||
                              "Deleted Sample"}
                        </span>
                        {getStatusBadge(submission.status)}
                        {!submission.entityDetails && (
                          <Badge variant="outline" className="text-stone-500 border-stone-300">
                            Entity Deleted
                          </Badge>
                        )}
                        {response?.isTest && (() => {
                          const expiration = getTestExpirationStatus(submission.createdAt);
                          return (
                            <Badge
                              variant="outline"
                              className={expiration.expired
                                ? "text-stone-500 border-stone-300 line-through"
                                : "text-amber-600 border-amber-300"
                              }
                            >
                              {expiration.expired ? "Test - Expired" : `Test - ${expiration.text}`}
                            </Badge>
                          );
                        })()}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {submission.submissionType} | {formatDate(submission.createdAt)}
                        {submission.entityDetails?.user && (
                          <span className="ml-2">
                            | by{" "}
                            {submission.entityDetails.user.firstName
                              ? `${submission.entityDetails.user.firstName} ${submission.entityDetails.user.lastName}`
                              : submission.entityDetails.user.email}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {accessionNumbers && (
                      <span className="font-mono text-sm bg-emerald-50 text-emerald-700 px-2 py-1 rounded">
                        {Object.values(accessionNumbers || {})[0]}
                      </span>
                    )}
                    {submission.entityType === "study" &&
                      submission.entityDetails && (
                        <Button variant="ghost" size="sm" asChild>
                          <Link
                            href={`/dashboard/studies/${submission.entityId}`}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Link>
                        </Button>
                      )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(submission.id);
                      }}
                      disabled={deletingId === submission.id}
                    >
                      {deletingId === submission.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                    {isExpanded ? (
                      <ChevronUp className="h-5 w-5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-border/50 space-y-4">
                    {/* Steps Timeline */}
                    {response?.steps && Array.isArray(response.steps) && (
                      <div className="bg-stone-50 rounded-lg p-4">
                        <h4 className="font-medium mb-4">Registration Steps</h4>
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

                    {/* Legacy Response Info (for old submissions without steps) */}
                    {response && !response.steps && (
                      <div className="bg-stone-50 rounded-lg p-4">
                        <h4 className="font-medium mb-2">Submission Details</h4>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">Server:</span>{" "}
                            <span className="font-mono text-xs">
                              {response.server}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Type:</span>{" "}
                            {response.isTest ? "Test" : "Production"}
                          </div>
                          {response.message && (
                            <div className="col-span-2">
                              <span className="text-muted-foreground">
                                Message:
                              </span>{" "}
                              {response.message}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Accession Numbers */}
                    {accessionNumbers && (
                      <div className="bg-emerald-50 rounded-lg p-4">
                        <h4 className="font-medium mb-3 text-emerald-700 flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4" />
                          Accession Numbers
                        </h4>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                          {Object.entries(accessionNumbers).map(
                            ([key, value]) => (
                              <div
                                key={key}
                                className="bg-white rounded-lg p-2 border border-emerald-200"
                              >
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
                            )
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-3">
                          {response?.isTest
                            ? "Test accessions - these will be deleted after 24 hours"
                            : "Production accessions - permanently registered with ENA"}
                        </p>
                      </div>
                    )}

                    {/* XML Content (collapsible) */}
                    {submission.xmlContent && (
                      <div className="bg-stone-50 rounded-lg p-4">
                        <h4 className="font-medium mb-2">Generated XML</h4>
                        <pre className="text-xs font-mono overflow-x-auto max-h-40 p-2 bg-white rounded border">
                          {submission.xmlContent}
                        </pre>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2">
                      {(submission.status === "REJECTED" ||
                        submission.status === "ERROR") &&
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
                      {/* Delete button - always available */}
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
                )}
              </div>
            );
          })}
        </GlassCard>
      )}
    </PageContainer>
  );
}
