"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/PageContainer";
import {
  AlertCircle,
  ArrowLeft,
  Loader2,
  Pencil,
  Shield,
} from "lucide-react";
import type { FormFieldDefinition } from "@/types/form-config";
import {
  buildStudyFacilityFieldSections,
  getStudyFacilityFieldSubsectionAnchorId,
  isStudyFacilityFieldSubsectionId,
} from "@/lib/studies/facility-sections";

interface StudyFormSchemaResponse {
  fields?: FormFieldDefinition[];
  studyFields?: FormFieldDefinition[];
  perSampleFields?: FormFieldDefinition[];
}

interface StudySample {
  id: string;
  sampleId: string;
  checklistData: string | null;
}

interface Study {
  id: string;
  title: string;
  description: string | null;
  alias: string | null;
  checklistType: string | null;
  studyMetadata: string | null;
  readyForSubmission: boolean;
  submitted: boolean;
  studyAccessionId: string | null;
  samples: StudySample[];
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return {};

  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore malformed JSON and fall back to an empty object.
  }

  return {};
}

function hasDisplayValue(value: unknown): boolean {
  return !(
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function formatSchemaFieldValue(field: FormFieldDefinition, value: unknown): string {
  if (!hasDisplayValue(value)) return "Not specified";

  if (field.type === "select" && field.options) {
    const option = field.options.find((entry) => entry.value === value);
    return option?.label || String(value);
  }

  if (field.type === "multiselect" && Array.isArray(value) && field.options) {
    return value
      .map((entry) => field.options?.find((option) => option.value === entry)?.label || String(entry))
      .join(", ");
  }

  if (field.type === "checkbox") {
    return value === true ? "Yes" : "No";
  }

  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }

  return String(value);
}

export default function StudyFacilityFieldsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [study, setStudy] = useState<Study | null>(null);
  const [studyFormFields, setStudyFormFields] = useState<FormFieldDefinition[]>([]);
  const [studyPerSampleFields, setStudyPerSampleFields] = useState<FormFieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [schemaLoading, setSchemaLoading] = useState(true);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);

  const isAdmin = session?.user?.role === "FACILITY_ADMIN";
  const apiStudyId = study?.id ?? resolvedParams.id;
  const requestedSubsection = searchParams.get("subsection");
  const activeFacilitySubsection = isStudyFacilityFieldSubsectionId(requestedSubsection)
    ? requestedSubsection
    : null;

  const fetchStudy = useCallback(async () => {
    setLoading(true);
    setError("");
    setNotFound(false);
    try {
      const res = await fetch(`/api/studies/${resolvedParams.id}`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 404) {
          setNotFound(true);
          setStudy(null);
          return;
        }
        if (res.status === 403) {
          setError(typeof data.error === "string" ? data.error : "You don't have permission to view this study");
          setStudy(null);
          return;
        }
        throw new Error(typeof data.error === "string" ? data.error : "Failed to fetch study");
      }

      setStudy(data);
      if (typeof data?.id === "string" && data.id !== resolvedParams.id) {
        router.replace(`/studies/${data.id}/facility`);
      }
    } catch (fetchError) {
      setStudy(null);
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load study");
    } finally {
      setLoading(false);
    }
  }, [resolvedParams.id, router]);

  useEffect(() => {
    void fetchStudy();
  }, [fetchStudy]);

  useEffect(() => {
    fetch("/api/study-form-schema")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: StudyFormSchemaResponse | null) => {
        const schemaStudyFields = (data?.studyFields ?? data?.fields ?? [])
          .filter((field) => !field.perSample && field.name !== "_sample_association" && field.visible !== false);
        const schemaPerSampleFields = (data?.perSampleFields ?? data?.fields ?? [])
          .filter((field) => field.perSample && field.visible !== false);
        setStudyFormFields(schemaStudyFields);
        setStudyPerSampleFields(schemaPerSampleFields);
        setSchemaLoading(false);
      })
      .catch(() => {
        setStudyFormFields([]);
        setStudyPerSampleFields([]);
        setSchemaLoading(false);
      });
  }, []);

  const visibleFacilityStudyFields = useMemo(
    () =>
      isAdmin
        ? studyFormFields
            .filter((field) => field.adminOnly)
            .slice()
            .sort((a, b) => a.order - b.order)
        : [],
    [isAdmin, studyFormFields]
  );

  const visibleFacilitySampleFields = useMemo(
    () =>
      isAdmin
        ? studyPerSampleFields
            .filter((field) => field.adminOnly)
            .slice()
            .sort((a, b) => a.order - b.order)
        : [],
    [isAdmin, studyPerSampleFields]
  );

  const parsedStudyMetadata = useMemo(
    () => parseJsonObject(study?.studyMetadata),
    [study?.studyMetadata]
  );

  const parsedChecklistDataBySampleId = useMemo(() => {
    if (!study) return {} as Record<string, Record<string, unknown>>;
    return Object.fromEntries(
      study.samples.map((sample) => [sample.id, parseJsonObject(sample.checklistData)])
    ) as Record<string, Record<string, unknown>>;
  }, [study]);

  const facilitySections = useMemo(
    () =>
      buildStudyFacilityFieldSections({
        fields: [...studyFormFields, ...studyPerSampleFields],
        study: study
          ? {
              studyMetadata: study.studyMetadata,
              samples: study.samples.map((sample) => ({
                id: sample.id,
                checklistData: sample.checklistData,
              })),
            }
          : null,
        includeFacilityFields: isAdmin,
      }),
    [isAdmin, study, studyFormFields, studyPerSampleFields]
  );

  useEffect(() => {
    if (sessionStatus === "loading" || loading || schemaLoading) return;
    if (!isAdmin) {
      router.replace(`/studies/${apiStudyId}`);
      return;
    }
    if (facilitySections.length === 0) {
      router.replace(`/studies/${apiStudyId}`);
    }
  }, [apiStudyId, facilitySections.length, isAdmin, loading, router, schemaLoading, sessionStatus]);

  useEffect(() => {
    if (!study || !activeFacilitySubsection) return;

    const anchorId = getStudyFacilityFieldSubsectionAnchorId(activeFacilitySubsection);
    const element = document.getElementById(anchorId);
    if (!element) return;

    const rafId = window.requestAnimationFrame(() => {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [activeFacilitySubsection, study]);

  if (sessionStatus === "loading" || loading || schemaLoading) {
    return (
      <PageContainer className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </PageContainer>
    );
  }

  if (!isAdmin) {
    return null;
  }

  if (!study) {
    const title = notFound ? "Study Not Found" : "Error";
    const message = notFound
      ? "The requested study could not be found."
      : (error || "Failed to load study");

    return (
      <PageContainer>
        <div className="py-12 text-center">
          <AlertCircle className="mx-auto mb-4 h-12 w-12 text-destructive" />
          <h2 className="mb-2 text-xl font-semibold">{title}</h2>
          <p className="mb-4 text-sm text-muted-foreground">{message}</p>
          <Button asChild variant="outline">
            <Link href="/studies">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Studies
            </Link>
          </Button>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Link href={`/studies/${apiStudyId}`} className="hover:text-foreground">
              Study Overview
            </Link>
            <span>/</span>
            <span>Facility Fields</span>
          </div>
          <h1 className="truncate text-lg font-semibold">{study.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Internal study and sample annotations kept separate from the user-submitted overview.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={`/studies/${apiStudyId}`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Overview
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`/studies/${apiStudyId}/edit`}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit Study
            </Link>
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-md bg-slate-200 p-2 text-slate-700">
            <Shield className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Facility Workspace</h2>
            <p className="mt-1 text-sm text-slate-600">
              These fields are hidden from researchers and managed only by facility admins.
            </p>
          </div>
        </div>
      </div>

      {facilitySections.some((section) => section.id === "study-fields") && (
        <div
          id={getStudyFacilityFieldSubsectionAnchorId("study-fields")}
          className="mb-4 overflow-hidden rounded-lg border border-slate-200 bg-card scroll-mt-20"
        >
          <div className="flex items-start justify-between gap-3 border-b bg-slate-50/30 px-5 py-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-700">Study Fields</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Internal study-level metadata maintained by the facility team.
              </p>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href={`/studies/${apiStudyId}/edit`}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                Edit Fields
              </Link>
            </Button>
          </div>
          {visibleFacilityStudyFields.length > 0 ? (
            <div className="divide-y divide-border">
              {visibleFacilityStudyFields.map((field) => (
                <div key={field.id} className="flex items-start justify-between px-5 py-3 text-sm">
                  <span className="text-muted-foreground">{field.label}</span>
                  <span className="max-w-[60%] break-words text-right font-medium">
                    {formatSchemaFieldValue(field, parsedStudyMetadata[field.name])}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-5 py-6 text-sm text-muted-foreground">
              No internal study-level fields are configured yet.
            </div>
          )}
        </div>
      )}

      {facilitySections.some((section) => section.id === "sample-fields") && (
        <div
          id={getStudyFacilityFieldSubsectionAnchorId("sample-fields")}
          className="overflow-hidden rounded-lg border border-slate-200 bg-card scroll-mt-20"
        >
          <div className="flex items-start justify-between gap-3 border-b bg-slate-50/30 px-5 py-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-700">Sample Fields</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Internal sample-level annotations tracked separately from the user metadata view.
              </p>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href={`/studies/${apiStudyId}/edit`}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                Edit Samples
              </Link>
            </Button>
          </div>
          {study.samples.length === 0 ? (
            <div className="px-5 py-6 text-sm text-muted-foreground">
              No samples have been linked to this study yet.
            </div>
          ) : visibleFacilitySampleFields.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">#</th>
                    <th className="px-3 py-2 text-left font-medium">Sample ID</th>
                    {visibleFacilitySampleFields.map((field) => (
                      <th key={field.id} className="px-3 py-2 text-left font-medium">
                        {field.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {study.samples.map((sample, index) => (
                    <tr key={sample.id}>
                      <td className="px-3 py-2 text-muted-foreground">{index + 1}</td>
                      <td className="px-3 py-2">
                        <code className="rounded bg-muted px-2 py-1 font-mono text-xs">
                          {sample.sampleId}
                        </code>
                      </td>
                      {visibleFacilitySampleFields.map((field) => (
                        <td key={field.id} className="px-3 py-2 align-top">
                          {formatSchemaFieldValue(
                            field,
                            parsedChecklistDataBySampleId[sample.id]?.[field.name]
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-5 py-6 text-sm text-muted-foreground">
              No internal per-sample fields are configured yet.
            </div>
          )}
        </div>
      )}
    </PageContainer>
  );
}
