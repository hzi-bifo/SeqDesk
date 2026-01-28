"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { PageContainer } from "@/components/layout/PageContainer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BookOpen,
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Pencil,
  FlaskConical,
  ArrowRight,
  ClipboardList,
  Trash2,
  Send,
  RotateCcw,
  Clock,
  ExternalLink,
  Copy,
  FileCode,
} from "lucide-react";
import { RunPipelineSection } from "@/components/pipelines/RunPipelineSection";

interface Sample {
  id: string;
  sampleId: string;
  sampleAlias: string | null;
  sampleTitle: string | null;
  sampleAccessionNumber: string | null;
  taxId: string | null;
  scientificName: string | null;
  checklistData: string | null;
  customFields: string | null;
  order: {
    id: string;
    orderNumber: string;
    name: string | null;
    status: string;
  };
  reads: { id: string; file1: string | null; file2: string | null }[];
}

interface Study {
  id: string;
  title: string;
  alias: string | null;
  description: string | null;
  checklistType: string | null;
  studyMetadata: string | null;
  readyForSubmission: boolean;
  readyAt: string | null;
  submitted: boolean;
  submittedAt: string | null;
  testRegisteredAt: string | null;
  studyAccessionId: string | null;
  createdAt: string;
  samples: Sample[];
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
  };
}

// Helper to check if sample has metadata
function sampleHasMetadata(sample: Sample): boolean {
  if (!sample.taxId || sample.taxId.trim() === "") {
    return false;
  }

  // Check core sample fields (from order form's per-sample fields)
  const hasCoreSampleData =
    (sample.taxId && sample.taxId.trim() !== "") ||
    (sample.scientificName && sample.scientificName.trim() !== "") ||
    (sample.sampleTitle && sample.sampleTitle.trim() !== "") ||
    (sample.sampleAlias && sample.sampleAlias.trim() !== "");

  if (hasCoreSampleData) return true;

  // Check customFields (per-sample custom fields from order form)
  if (sample.customFields) {
    try {
      const customData = typeof sample.customFields === "string"
        ? JSON.parse(sample.customFields)
        : sample.customFields;
      const hasCustomData = Object.values(customData).some(
        v => v !== null && v !== "" && v !== undefined
      );
      if (hasCustomData) return true;
    } catch {
      // ignore parse errors
    }
  }

  // Check MIxS checklistData
  if (sample.checklistData) {
    try {
      const data = typeof sample.checklistData === "string"
        ? JSON.parse(sample.checklistData)
        : sample.checklistData;
      return Object.values(data).some(v => v !== null && v !== "" && v !== undefined);
    } catch {
      return false;
    }
  }

  return false;
}

// Calculate expiration status for test submissions (24h expiry)
function getTestExpirationStatus(registeredAt: string | null): { expired: boolean; text: string } | null {
  if (!registeredAt) return null;

  const registered = new Date(registeredAt);
  const expiresAt = new Date(registered.getTime() + 24 * 60 * 60 * 1000);
  const now = new Date();
  const msRemaining = expiresAt.getTime() - now.getTime();
  const hoursRemaining = Math.floor(msRemaining / (60 * 60 * 1000));

  if (msRemaining <= 0) {
    return { expired: true, text: "Expired" };
  } else if (hoursRemaining < 1) {
    const minutesRemaining = Math.floor(msRemaining / (60 * 1000));
    return { expired: false, text: `expires in ${minutesRemaining}m` };
  } else {
    return { expired: false, text: `expires in ${hoursRemaining}h` };
  }
}

export default function StudyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data: session } = useSession();
  const [study, setStudy] = useState<Study | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [markingReady, setMarkingReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState("");

  // Dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [markReadyDialogOpen, setMarkReadyDialogOpen] = useState(false);
  const [unmarkReadyDialogOpen, setUnmarkReadyDialogOpen] = useState(false);
  const [registerDialogOpen, setRegisterDialogOpen] = useState(false);
  const [registerSteps, setRegisterSteps] = useState<Array<{
    step: number;
    name: string;
    status: "pending" | "running" | "completed" | "error";
    details?: string;
  }>>([]);
  const [registerResult, setRegisterResult] = useState<{
    success: boolean;
    accession?: string | null;
    error?: string;
    isTest?: boolean;
    isPartial?: boolean;
    samplesError?: string;
    rawResponse?: unknown;
  } | null>(null);
  const [generatedXml, setGeneratedXml] = useState<{
    studyXml?: string;
    sampleXml?: string;
    submissionXml?: string;
  } | null>(null);

  // Simulate reads states
  const [simulateReadsDialogOpen, setSimulateReadsDialogOpen] = useState(false);
  const [simulatingReads, setSimulatingReads] = useState(false);
  const [simulateReadsResult, setSimulateReadsResult] = useState<{
    success: boolean;
    error?: string;
    createdPath?: string;
    filesCreated?: number;
    samplesProcessed?: number;
  } | null>(null);

  // Check if current user is the owner of this study
  const isOwner = session?.user?.id === study?.user?.id;
  const isAdmin = session?.user?.role === "FACILITY_ADMIN";

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
    fetchStudy();
  }, [id]);

  const fetchStudy = async () => {
    try {
      const res = await fetch(`/api/studies/${id}`);
      if (!res.ok) throw new Error("Failed to fetch study");
      const data = await res.json();
      setStudy(data);
    } catch {
      setError("Failed to load study");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteStudy = async () => {
    if (!study) return;
    if (study.submitted) {
      setError("Cannot delete a submitted study");
      return;
    }

    setDeleting(true);
    setDeleteDialogOpen(false);
    try {
      const res = await fetch(`/api/studies/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to delete study");
        return;
      }

      router.push("/dashboard/studies");
    } catch {
      setError("Failed to delete study");
    } finally {
      setDeleting(false);
    }
  };

  const handleMarkAsReady = async () => {
    if (!study) return;

    setMarkingReady(true);
    setMarkReadyDialogOpen(false);
    setError("");
    try {
      const res = await fetch(`/api/studies/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ readyForSubmission: true }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to update study");
        return;
      }

      // Refresh study data
      const updated = await res.json();
      setStudy(updated);
    } catch {
      setError("Failed to update study");
    } finally {
      setMarkingReady(false);
    }
  };

  const handleUnmarkReady = async () => {
    if (!study) return;

    setMarkingReady(true);
    setUnmarkReadyDialogOpen(false);
    setError("");
    try {
      const res = await fetch(`/api/studies/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ readyForSubmission: false }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to update study");
        return;
      }

      const updated = await res.json();
      setStudy(updated);
    } catch {
      setError("Failed to update study");
    } finally {
      setMarkingReady(false);
    }
  };

  const handleRegisterWithENA = async (isTest: boolean) => {
    if (!study) return;

    setRegisterSteps([
      { step: 1, name: "Submitting to ENA", status: "running" as const },
    ]);
    setRegisterResult(null);
    setGeneratedXml(null);
    setRegisterDialogOpen(true);
    setSubmitting(true);
    setError("");
    setSubmitSuccess("");

    try {
      const res = await fetch("/api/admin/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType: "study",
          entityId: study.id,
          isTest,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!data) {
        const message = "Failed to read ENA submission response";
        setRegisterSteps([
          { step: 1, name: "Submission failed", status: "error", details: message },
        ]);
        setRegisterResult({ success: false, error: message, isTest });
        return;
      }

      if (!res.ok) {
        const message = data?.error || "Failed to create submission";
        setRegisterSteps([
          { step: 1, name: "Submission failed", status: "error", details: message },
        ]);
        setRegisterResult({ success: false, error: message, isTest });
        return;
      }

      const response = safeJsonParse(data?.submission?.response);
      const accessions = safeJsonParse(data?.submission?.accessionNumbers);
      const submissionStatus = data?.submission?.status;

      if (response?.steps && Array.isArray(response.steps)) {
        const mappedSteps = response.steps.map((step: {
          step?: number;
          name?: string;
          status?: string;
        }, index: number) => ({
          step: step.step ?? index + 1,
          name: step.name || `Step ${index + 1}`,
          status: step.status === "error"
            ? "error"
            : step.status === "completed"
              ? "completed"
              : "pending",
        }));
        setRegisterSteps(mappedSteps);
      } else {
        setRegisterSteps([{ step: 1, name: "Submission complete", status: "completed" }]);
      }

      // Extract generated XML from the steps for debugging
      const step2 = response?.steps?.find((s: { step: number }) => s.step === 2);
      if (step2?.details) {
        setGeneratedXml({
          studyXml: step2.details.studyXml,
          sampleXml: step2.details.sampleXml,
          submissionXml: step2.details.submissionXml,
        });
      }

      // Get study accession (filter out null/empty)
      const studyAccession = accessions?.study || response?.receipt?.studyAccession || null;

      // Determine if this is a full success or partial
      const isFullSuccess = submissionStatus === "ACCEPTED";
      const isPartialSuccess = submissionStatus === "PARTIAL";
      const samplesError = response?.samplesError;

      // Set result
      setRegisterResult({
        success: isFullSuccess,
        accession: studyAccession,
        isTest,
        isPartial: isPartialSuccess,
        samplesError: samplesError,
        rawResponse: response,
      });

      if (isFullSuccess) {
        setSubmitSuccess(response?.message || data.message || "Registration successful!");
      } else {
        setSubmitSuccess("");
      }

      // Refresh study data after a short delay
      setTimeout(fetchStudy, 500);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create submission";
      setRegisterSteps([
        { step: 1, name: "Submission failed", status: "error", details: message },
      ]);
      setRegisterResult({ success: false, error: message, isTest });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSimulateReads = async () => {
    if (!study) return;

    setSimulatingReads(true);
    setSimulateReadsResult(null);
    setSimulateReadsDialogOpen(true);
    setError("");

    try {
      const res = await fetch(`/api/studies/${id}/simulate-reads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pairedEnd: true,
          createRecords: true,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setSimulateReadsResult({
          success: false,
          error: data.error || "Failed to create simulated read files",
        });
        return;
      }

      setSimulateReadsResult({
        success: true,
        createdPath: data.createdPath,
        filesCreated: data.filesCreated,
        samplesProcessed: data.samplesProcessed,
      });

      // Refresh study data to show new reads
      setTimeout(fetchStudy, 500);
    } catch (err) {
      setSimulateReadsResult({
        success: false,
        error: err instanceof Error ? err.message : "Failed to create simulated reads",
      });
    } finally {
      setSimulatingReads(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  if (loading) {
    return (
      <PageContainer className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </PageContainer>
    );
  }

  if (!study) {
    return (
      <PageContainer>
        <div className="text-center py-12">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
          <h2 className="text-xl font-semibold mb-2">Study Not Found</h2>
          <Button asChild variant="outline">
            <Link href="/dashboard/studies">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Studies
            </Link>
          </Button>
        </div>
      </PageContainer>
    );
  }

  // Calculate metadata completion
  const samplesWithMetadata = study.samples.filter(sampleHasMetadata).length;
  const totalSamples = study.samples.length;
  const allMetadataComplete = totalSamples > 0 && samplesWithMetadata === totalSamples;

  return (
    <PageContainer>
      {/* Header */}
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="mb-4">
          <Link href="/dashboard/studies">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Studies
          </Link>
        </Button>

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-lg bg-primary/10 flex items-center justify-center">
              <BookOpen className="h-7 w-7 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">{study.title}</h1>
              <div className="flex items-center gap-3 mt-1">
                {study.submitted ? (
                  <Badge className="bg-green-500 hover:bg-green-600">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Submitted
                  </Badge>
                ) : study.testRegisteredAt ? (
                  <Badge className="bg-amber-500 hover:bg-amber-600">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    Test Registered
                  </Badge>
                ) : study.studyAccessionId ? (
                  <Badge className="bg-amber-500 hover:bg-amber-600">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    Study Registered
                  </Badge>
                ) : study.readyForSubmission ? (
                  <Badge className="bg-blue-500 hover:bg-blue-600">
                    <Send className="h-3 w-3 mr-1" />
                    Ready for Submission
                  </Badge>
                ) : (
                  <Badge variant="outline">Draft</Badge>
                )}
                {study.studyAccessionId && (
                  <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">
                    {study.studyAccessionId}
                  </span>
                )}
                <span className="text-muted-foreground text-sm">
                  Created {formatDate(study.createdAt)}
                </span>
              </div>
            </div>
          </div>
          {/* Action buttons - visible to owner and admin */}
          {(isOwner || isAdmin) && (
            <div className="flex items-center gap-2">
              {/* Edit button - always available for admin, only for drafts for owner */}
              {(isAdmin || (!study.submitted && !study.readyForSubmission)) && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/dashboard/studies/${id}/edit`}>
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit
                  </Link>
                </Button>
              )}
              {!study.submitted && !study.readyForSubmission && isOwner && (
                <>
                  {allMetadataComplete && (
                    <Button
                      size="sm"
                      onClick={() => setMarkReadyDialogOpen(true)}
                      disabled={markingReady}
                    >
                      {markingReady ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4 mr-2" />
                      )}
                      Mark as Ready
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteDialogOpen(true)}
                    disabled={deleting}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </Button>
                </>
              )}
              {!study.submitted && study.readyForSubmission && (isOwner || isAdmin) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setUnmarkReadyDialogOpen(true)}
                  disabled={markingReady}
                >
                  {markingReady ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RotateCcw className="h-4 w-4 mr-2" />
                  )}
                  Back to Draft
                </Button>
              )}
            </div>
          )}
        </div>

        {study.description && (
          <p className="text-muted-foreground mt-4 max-w-3xl">{study.description}</p>
        )}
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          {error}
        </div>
      )}

      {submitSuccess && (
        <div className="mb-6 p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5" />
          {submitSuccess}
        </div>
      )}

      {/* Workflow Progress */}
      {!study.submitted && (
        <div className="mb-6 rounded-lg border bg-muted/30 p-5">
          <h3 className="font-semibold text-stone-700 mb-4 flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Study Progress
          </h3>
          <div className="grid grid-cols-4 gap-3">
            {/* Step 1: Create Study */}
            <div className="p-3 rounded-lg bg-white border">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium">Create Study</span>
              </div>
              <p className="text-xs text-muted-foreground">Done</p>
            </div>

            {/* Step 2: Associate Samples */}
            <div className="p-3 rounded-lg bg-white border">
              <div className="flex items-center gap-2 mb-1">
                {totalSamples > 0 ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <div className="h-4 w-4 rounded-full bg-stone-300 flex items-center justify-center">
                    <span className="text-[10px] text-white font-bold">2</span>
                  </div>
                )}
                <span className="text-sm font-medium">Add Samples</span>
              </div>
              {totalSamples > 0 ? (
                <p className="text-xs text-muted-foreground">{totalSamples} sample{totalSamples !== 1 ? 's' : ''}</p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">No samples yet</p>
                  {isOwner && (
                    <Link
                      href={`/dashboard/studies/${id}/edit`}
                      className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      Add Samples <ArrowRight className="h-3 w-3" />
                    </Link>
                  )}
                </>
              )}
            </div>

            {/* Step 3: Enter Metadata */}
            <div className="p-3 rounded-lg bg-white border">
              <div className="flex items-center gap-2 mb-1">
                {allMetadataComplete ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <div className="h-4 w-4 rounded-full bg-stone-300 flex items-center justify-center">
                    <span className="text-[10px] text-white font-bold">3</span>
                  </div>
                )}
                <span className="text-sm font-medium">Metadata</span>
              </div>
              {allMetadataComplete ? (
                <p className="text-xs text-muted-foreground">Complete</p>
              ) : totalSamples > 0 ? (
                <>
                  <p className="text-xs text-muted-foreground">{samplesWithMetadata}/{totalSamples} complete</p>
                  {isOwner && (
                    <Link
                      href={`/dashboard/studies/${id}/edit`}
                      className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      Edit <ArrowRight className="h-3 w-3" />
                    </Link>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Add samples first</p>
              )}
            </div>

            {/* Step 4: Submit to ENA */}
            <div className="p-3 rounded-lg bg-white border">
              <div className="flex items-center gap-2 mb-1">
                {study.submitted ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : study.testRegisteredAt || study.studyAccessionId ? (
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                ) : study.readyForSubmission ? (
                  <Clock className="h-4 w-4 text-blue-500" />
                ) : (
                  <div className="h-4 w-4 rounded-full bg-stone-300 flex items-center justify-center">
                    <span className="text-[10px] text-white font-bold">4</span>
                  </div>
                )}
                <span className="text-sm font-medium">Submit to ENA</span>
              </div>
              {study.submitted ? (
                <p className="text-xs text-muted-foreground">Submitted</p>
              ) : study.testRegisteredAt ? (
                <p className="text-xs text-muted-foreground">Test registered</p>
              ) : study.studyAccessionId ? (
                <p className="text-xs text-muted-foreground">Study registered (samples pending)</p>
              ) : study.readyForSubmission ? (
                <p className="text-xs text-muted-foreground">Awaiting facility</p>
              ) : allMetadataComplete ? (
                <p className="text-xs text-muted-foreground">Mark as ready</p>
              ) : (
                <p className="text-xs text-muted-foreground">Complete metadata</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Submitted Study Status */}
      {study.submitted && (
        <div className="mb-6 rounded-lg border p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <div>
              <p className="font-medium">Registered with ENA</p>
              <p className="text-sm text-muted-foreground">
                {study.studyAccessionId && <span className="font-mono">{study.studyAccessionId}</span>}
                {study.submittedAt && <span className="ml-2">{formatDate(study.submittedAt)}</span>}
              </p>
            </div>
          </div>
          {study.studyAccessionId && (
            <a
              href="https://www.ebi.ac.uk/ena/submit/webin/report/studies"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline flex items-center gap-1"
            >
              View in Webin Portal
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}

      {/* ENA Submission Readiness - Admin View */}
      {isAdmin && !study.submitted && (() => {
        const requiredChecks = {
          hasTitle: Boolean(study.title && study.title.trim()),
          hasDescription: Boolean(study.description && study.description.trim()),
          hasSamples: totalSamples > 0,
          allSamplesHaveOrganism: study.samples.every(s =>
            s.taxId && s.taxId.trim()
          ),
          allSamplesHaveMetadata: allMetadataComplete,
        };
        const passedChecks = Object.values(requiredChecks).filter(Boolean).length;
        const totalChecks = Object.keys(requiredChecks).length;
        const allPassed = passedChecks === totalChecks;
        const hasTestRegistration = Boolean(study.testRegisteredAt);

        return (
          <div className="mb-6 rounded-lg border p-5 bg-muted/30">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="font-semibold flex items-center gap-2">
                  ENA Registration
                  <span className="text-sm font-normal text-muted-foreground">
                    ({passedChecks}/{totalChecks} checks)
                  </span>
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {study.readyForSubmission ? "User marked ready" : "User has not marked as ready"}
                </p>
              </div>
              {allPassed && (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRegisterWithENA(true)}
                    disabled={submitting}
                  >
                    {submitting ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4 mr-2" />
                    )}
                    Test Server
                  </Button>
                  {study.readyForSubmission && (
                    <Button
                      size="sm"
                      onClick={() => handleRegisterWithENA(false)}
                      disabled={submitting}
                    >
                      {submitting ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4 mr-2" />
                      )}
                      Production
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Test Registration Status */}
            {hasTestRegistration && (() => {
              const expiration = getTestExpirationStatus(study.testRegisteredAt);
              const isExpired = expiration?.expired ?? false;
              return (
                <div className={`mb-4 p-3 rounded border flex items-center justify-between ${
                  isExpired
                    ? "border-stone-300 bg-stone-100"
                    : "border-amber-200 bg-amber-50"
                }`}>
                  <div className="flex items-center gap-2 text-sm">
                    <AlertCircle className={`h-4 w-4 ${isExpired ? "text-stone-500" : "text-amber-600"}`} />
                    <span className={isExpired ? "text-stone-600" : "text-amber-800"}>
                      Test: <span className={`font-mono ${isExpired ? "line-through" : ""}`}>{study.studyAccessionId}</span>
                      <span className={`ml-2 ${isExpired ? "text-stone-500" : "text-amber-600"}`}>
                        ({expiration?.text ?? "expires 24h"})
                      </span>
                    </span>
                  </div>
                  {!isExpired && (
                    <a
                      href="https://wwwdev.ebi.ac.uk/ena/submit/webin/report/studies"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-amber-700 hover:underline flex items-center gap-1"
                    >
                      View <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              );
            })()}

            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
              <div className="flex items-center gap-2">
                {requiredChecks.hasTitle ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
                <span>Title</span>
              </div>
              <div className="flex items-center gap-2">
                {requiredChecks.hasDescription ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
                <span>Description</span>
              </div>
              <div className="flex items-center gap-2">
                {requiredChecks.hasSamples ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
                <span>Samples ({totalSamples})</span>
              </div>
              <div className="flex items-center gap-2">
                {requiredChecks.allSamplesHaveOrganism ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
                <span>Taxonomy ID</span>
              </div>
              <div className="flex items-center gap-2">
                {requiredChecks.allSamplesHaveMetadata ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
                <span>Metadata</span>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t text-sm text-muted-foreground">
              Created by: {study.user.firstName && study.user.lastName
                ? `${study.user.firstName} ${study.user.lastName}`
                : study.user.email}
            </div>
          </div>
        );
      })()}

      {/* Admin Tools - only for admins with samples */}
      {isAdmin && totalSamples > 0 && (
        <div className="mb-6 rounded-lg border p-5 bg-muted/30">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold flex items-center gap-2">
                <FileCode className="h-5 w-5" />
                Admin Tools
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Development and testing utilities
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleSimulateReads}
                disabled={simulatingReads}
              >
                {simulatingReads ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FileCode className="h-4 w-4 mr-2" />
                )}
                Simulate Reads
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Run Analysis - only for admins with samples */}
      {isAdmin && totalSamples > 0 && (
        <RunPipelineSection studyId={study.id} samples={study.samples} />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Study Details */}
        <GlassCard className="p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Study Details
          </h2>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Environment Type</span>
              <span className="font-medium capitalize">
                {study.checklistType?.replace(/-/g, " ") || "Not specified"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <span className="font-medium">
                {study.submitted
                  ? "Submitted to ENA"
                  : study.testRegisteredAt
                    ? "Test registered"
                    : study.studyAccessionId
                      ? "Study registered (samples pending)"
                      : study.readyForSubmission
                        ? "Ready for Submission"
                        : "Draft"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Samples</span>
              <span className="font-medium">{totalSamples}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Metadata Complete</span>
              <span className="font-medium">{samplesWithMetadata} of {totalSamples}</span>
            </div>
          </div>
        </GlassCard>

        {/* Samples */}
        <GlassCard className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <FlaskConical className="h-5 w-5" />
              Samples ({study.samples.length})
            </h2>
            {!study.submitted && isOwner && (
              <Button size="sm" variant="outline" asChild>
                <Link href={`/dashboard/studies/${id}/edit`}>
                  Manage Samples
                </Link>
              </Button>
            )}
          </div>

          {study.samples.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FlaskConical className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p>No samples in this study yet</p>
              {!study.submitted && isOwner && (
                <Button className="mt-4" size="sm" asChild>
                  <Link href={`/dashboard/studies/${id}/edit`}>
                    Add Samples
                  </Link>
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {study.samples.map((sample) => {
                const hasMetadata = sampleHasMetadata(sample);
                return (
                  <div
                    key={sample.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/30"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                        hasMetadata ? "bg-green-500/10" : "bg-muted"
                      }`}>
                        <FlaskConical className={`h-4 w-4 ${
                          hasMetadata ? "text-green-600" : "text-muted-foreground"
                        }`} />
                      </div>
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {sample.sampleId}
                          {hasMetadata && (
                            <CheckCircle2 className="h-3 w-3 text-green-500" />
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <Link
                            href={`/dashboard/orders/${sample.order.id}`}
                            className="hover:text-primary"
                          >
                            {sample.order.orderNumber}
                          </Link>
                          {sample.order.name && (
                            <span> - {sample.order.name}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </GlassCard>
      </div>

      {/* Status History */}
      <GlassCard className="p-6 mt-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Status History
        </h2>
        <div className="space-y-3">
          {/* Created */}
          <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <BookOpen className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="font-medium">Study Created</p>
              <p className="text-sm text-muted-foreground">
                {formatDate(study.createdAt)}
              </p>
            </div>
          </div>

          {/* Marked as Ready */}
          {study.readyAt && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
              <div className="h-8 w-8 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                <Send className="h-4 w-4 text-blue-500" />
              </div>
              <div>
                <p className="font-medium">Marked as Ready for Submission</p>
                <p className="text-sm text-muted-foreground">
                  {formatDate(study.readyAt)}
                </p>
              </div>
            </div>
          )}

          {/* Submitted to ENA */}
          {study.submittedAt && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
              <div className="h-8 w-8 rounded-full bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              </div>
              <div>
                <p className="font-medium">Submitted to ENA</p>
                <p className="text-sm text-muted-foreground">
                  {formatDate(study.submittedAt)}
                  {study.studyAccessionId && (
                    <span className="ml-2 font-mono text-xs bg-muted px-2 py-0.5 rounded">
                      {study.studyAccessionId}
                    </span>
                  )}
                </p>
              </div>
            </div>
          )}
        </div>
      </GlassCard>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Study</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this study? Samples will be unassigned but not deleted. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteStudy} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Delete Study
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark as Ready Confirmation Dialog */}
      <Dialog open={markReadyDialogOpen} onOpenChange={setMarkReadyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Study as Ready</DialogTitle>
            <DialogDescription>
              Mark this study as ready for ENA submission? The sequencing facility will be notified and can proceed with the submission process.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkReadyDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleMarkAsReady} disabled={markingReady}>
              {markingReady ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Mark as Ready
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Back to Draft Confirmation Dialog */}
      <Dialog open={unmarkReadyDialogOpen} onOpenChange={setUnmarkReadyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Return to Draft</DialogTitle>
            <DialogDescription>
              Mark this study back as a draft? You can continue editing it and mark it as ready again when complete.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnmarkReadyDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUnmarkReady} disabled={markingReady}>
              {markingReady ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-2" />}
              Back to Draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ENA Registration Progress Dialog */}
      <Dialog open={registerDialogOpen} onOpenChange={(open) => {
        if (!submitting) setRegisterDialogOpen(open);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              ENA Registration
            </DialogTitle>
            <DialogDescription>
              {registerResult
                ? registerResult.success
                  ? "Registration completed successfully!"
                  : "Registration failed"
                : "Registering study with ENA..."}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="space-y-2">
              {registerSteps.map((step) => (
                <div
                  key={step.step}
                  className="flex items-center gap-3 p-2 rounded border bg-muted/30"
                >
                  <div className="flex-shrink-0">
                    {step.status === "completed" ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : step.status === "running" ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    ) : step.status === "error" ? (
                      <XCircle className="h-4 w-4 text-red-500" />
                    ) : (
                      <div className="h-4 w-4 rounded-full bg-stone-300 flex items-center justify-center">
                        <span className="text-[10px] text-white font-bold">{step.step}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{step.name}</p>
                    {step.details && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {step.details}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Generated XML - for debugging */}
            {generatedXml && (
              <div className="mt-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Generated XML:</p>

                {generatedXml.sampleXml && (
                  <div className="border rounded p-2 bg-muted/50">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium">Sample XML</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(generatedXml.sampleXml || "");
                        }}
                        className="text-xs bg-stone-200 text-stone-600 px-2 py-0.5 rounded hover:bg-stone-300 flex items-center gap-1"
                      >
                        <Copy className="h-3 w-3" /> Copy
                      </button>
                    </div>
                    <div className="max-h-32 overflow-y-auto bg-white rounded p-2 border text-xs font-mono whitespace-pre-wrap break-all">
                      {generatedXml.sampleXml}
                    </div>
                  </div>
                )}

                {generatedXml.studyXml && (
                  <div className="border rounded p-2 bg-muted/50">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium">Study XML</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(generatedXml.studyXml || "");
                        }}
                        className="text-xs bg-stone-200 text-stone-600 px-2 py-0.5 rounded hover:bg-stone-300 flex items-center gap-1"
                      >
                        <Copy className="h-3 w-3" /> Copy
                      </button>
                    </div>
                    <div className="max-h-24 overflow-y-auto bg-white rounded p-2 border text-xs font-mono whitespace-pre-wrap break-all">
                      {generatedXml.studyXml}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Result */}
            {registerResult && (
              <div className={`mt-4 p-4 rounded-lg border ${
                registerResult.success
                  ? "bg-green-50 border-green-200"
                  : registerResult.isPartial
                    ? "bg-amber-50 border-amber-200"
                    : "bg-red-50 border-red-200"
              }`}>
                <div className="text-center">
                  {registerResult.success ? (
                    <>
                      <CheckCircle2 className="h-6 w-6 text-green-600 mx-auto mb-2" />
                      <p className="font-medium">Registration Successful</p>
                      {registerResult.accession && (
                        <p className="text-sm text-muted-foreground mt-1 font-mono">
                          {registerResult.accession}
                        </p>
                      )}
                      {registerResult.isTest && (
                        <p className="text-xs text-amber-600 mt-2">Test server - expires in 24h</p>
                      )}
                    </>
                  ) : registerResult.isPartial ? (
                    <>
                      <AlertCircle className="h-6 w-6 text-amber-600 mx-auto mb-2" />
                      <p className="font-medium text-amber-800">Partial Registration</p>
                      <p className="text-sm text-amber-700 mt-1">Study OK, samples had errors</p>
                      {registerResult.accession && (
                        <p className="text-sm text-muted-foreground mt-1 font-mono">
                          {registerResult.accession}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <XCircle className="h-6 w-6 text-red-600 mx-auto mb-2" />
                      <p className="font-medium text-red-800">Registration Failed</p>
                      <p className="text-sm text-red-600 mt-1">
                        {registerResult.error && registerResult.error.length > 100
                          ? registerResult.error.substring(0, 100) + "..."
                          : registerResult.error}
                      </p>
                    </>
                  )}
                  <p className="text-xs text-muted-foreground mt-3">
                    <Link href="/dashboard/submissions" className="text-primary hover:underline">
                      View details in ENA Submissions
                    </Link>
                  </p>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            {registerResult ? (
              <Button onClick={() => setRegisterDialogOpen(false)}>
                Close
              </Button>
            ) : (
              <Button variant="outline" disabled>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Processing...
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Simulate Reads Dialog */}
      <Dialog open={simulateReadsDialogOpen} onOpenChange={(open) => {
        if (!simulatingReads) setSimulateReadsDialogOpen(open);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCode className="h-5 w-5" />
              Simulate Reads
            </DialogTitle>
            <DialogDescription>
              {simulateReadsResult
                ? simulateReadsResult.success
                  ? "Simulated read files created successfully"
                  : "Failed to create simulated reads"
                : "Creating simulated FASTQ files..."}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            {simulatingReads && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            )}

            {simulateReadsResult && (
              <div className={`p-4 rounded-lg border ${
                simulateReadsResult.success
                  ? "bg-green-50 border-green-200"
                  : "bg-red-50 border-red-200"
              }`}>
                <div className="text-center">
                  {simulateReadsResult.success ? (
                    <>
                      <CheckCircle2 className="h-6 w-6 text-green-600 mx-auto mb-2" />
                      <p className="font-medium">Files Created Successfully</p>
                      <div className="mt-3 text-sm text-muted-foreground space-y-1">
                        <p>
                          <span className="font-medium">{simulateReadsResult.filesCreated}</span> files created
                        </p>
                        <p>
                          <span className="font-medium">{simulateReadsResult.samplesProcessed}</span> samples processed
                        </p>
                        {simulateReadsResult.createdPath && (
                          <p className="mt-2 text-xs font-mono bg-muted p-2 rounded break-all">
                            {simulateReadsResult.createdPath}
                          </p>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-6 w-6 text-red-600 mx-auto mb-2" />
                      <p className="font-medium text-red-800">Failed</p>
                      <p className="text-sm text-red-600 mt-1">
                        {simulateReadsResult.error}
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            {simulateReadsResult ? (
              <Button onClick={() => setSimulateReadsDialogOpen(false)}>
                Close
              </Button>
            ) : (
              <Button variant="outline" disabled>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating files...
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
