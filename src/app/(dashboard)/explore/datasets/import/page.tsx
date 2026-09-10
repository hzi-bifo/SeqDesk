"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { ArrowLeft, Loader2, Upload } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { TABLE_KIND_DEFINITIONS } from "@/lib/explore/dataset-kinds";
import { fetcher, formatCell, ROLE_LABELS } from "@/lib/explore/client";
import { filesHref, type LibraryFileSummary } from "@/lib/files/library-types";
import { isValidTargetKey } from "@/lib/explore/target-key";
import { EXPLORE_ROLES, type ExploreRole, type ExploreRowData } from "@/lib/explore/types";

interface PreviewResponse {
  fileName: string;
  columns: string[];
  rows: ExploreRowData[];
  rowCount: number;
  sheets: string[];
  sheet: string | null;
  suggestedRoles: Partial<Record<ExploreRole, string>>;
  warnings: string[];
}

const NONE = "__none__";
const NO_KIND = "__generic__";

export default function ExploreImportPage() {
  return (
    <Suspense fallback={<PageContainer><Skeleton className="h-8 w-48" /></PageContainer>}>
      <ImportForm />
    </Suspense>
  );
}

function ImportForm() {
  const searchParams = useSearchParams();
  const scope = searchParams.get("scope");
  const reportId = searchParams.get("report");
  const fileId = searchParams.get("file");
  return <ImportSourceForm key={`${scope}:${fileId}`} scope={scope} reportId={reportId} fileId={fileId} />;
}

function ImportSourceForm({ scope, reportId, fileId }: { scope: string | null; reportId: string | null; fileId: string | null }) {
  const router = useRouter();
  const { data: fileData, error: fileError } = useSWR<{ file: LibraryFileSummary }>(fileId ? `/api/files/library/${encodeURIComponent(fileId)}` : null, fetcher);
  const file = fileData?.file ?? null;
  const [name, setName] = useState("");
  const [tableKind, setTableKind] = useState<string>(NO_KIND);
  const [useIndivoGrammar, setUseIndivoGrammar] = useState(false);
  const [idColumn, setIdColumn] = useState<string>(NONE);
  const [sampleTypeColumn, setSampleTypeColumn] = useState<string>(NONE);
  const [isolateColumn, setIsolateColumn] = useState<string>(NONE);
  const [sheet, setSheet] = useState<string>(NONE);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewSettings, setPreviewSettings] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [roles, setRoles] = useState<Partial<Record<ExploreRole, string>>>({});
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);

  const validScope = scope && isValidTargetKey(scope) ? scope : null;
  const kindDefinition = tableKind === NO_KIND ? null : TABLE_KIND_DEFINITIONS[tableKind] ?? null;
  const settingsFor = (worksheet: string) => JSON.stringify({ worksheet, grammar: useIndivoGrammar ? { idColumn, sampleTypeColumn, isolateColumn } : null });
  const settingsKey = settingsFor(sheet);
  const previewIsCurrent = preview !== null && previewSettings === settingsKey;

  const buildForm = useCallback(() => {
    if (!file || !validScope) return null;
    const form = new FormData();
    form.set("fileId", file.id);
    form.set("targetKey", validScope);
    if (reportId) form.set("reportId", reportId);
    if (name.trim()) form.set("name", name.trim());
    if (tableKind !== NO_KIND) form.set("tableKind", tableKind);
    if (sheet !== NONE) form.set("sheet", sheet);
    if (useIndivoGrammar && idColumn !== NONE) {
      form.set("idGrammar", "indivo");
      form.set("idColumn", idColumn);
      if (sampleTypeColumn !== NONE) form.set("sampleTypeColumn", sampleTypeColumn);
      if (isolateColumn !== NONE) form.set("isolateColumn", isolateColumn);
    }
    return form;
  }, [file, validScope, reportId, name, tableKind, sheet, useIndivoGrammar, idColumn, sampleTypeColumn, isolateColumn]);

  const runPreview = useCallback(async () => {
    const form = buildForm();
    if (!form) return;
    setBusy("preview");
    setPreviewSettings(null);
    setPreviewError(null);
    try {
      const response = await fetch("/api/explore/datasets/import?preview=1", { method: "POST", body: form });
      const payload = (await response.json()) as PreviewResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Preview failed");
      setPreview(payload);
      setPreviewSettings(JSON.stringify({ worksheet: payload.sheet ?? NONE, grammar: useIndivoGrammar ? { idColumn, sampleTypeColumn, isolateColumn } : null }));
      setRoles((current) => ({ ...payload.suggestedRoles, ...Object.fromEntries(Object.entries(current).filter(([, column]) => column === undefined || payload.columns.includes(column))) }));
      if (payload.sheet && sheet === NONE) setSheet(payload.sheet);
      // Offer the grammar automatically when an INDIVO-style id column is present.
      const idCandidate = payload.columns.find((column) => /^(A-ID|id_mapped)$/i.test(column));
      if (idCandidate && idColumn === NONE) {
        setIdColumn(idCandidate);
        const sampleCandidate = payload.columns.find((column) => column.toLowerCase() === "sample");
        if (sampleCandidate) setSampleTypeColumn(sampleCandidate);
        const isolateCandidate = payload.columns.find((column) => column.toLowerCase() === "isisolate");
        if (isolateCandidate) setIsolateColumn(isolateCandidate);
      }
      for (const warning of payload.warnings) toast.warning(warning);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "Preview failed");
    } finally {
      setBusy(null);
    }
  }, [buildForm, sheet, useIndivoGrammar, idColumn, sampleTypeColumn, isolateColumn]);

  const runImport = useCallback(async () => {
    if (!previewIsCurrent) return;
    const form = buildForm();
    if (!form) return;
    form.set("roles", JSON.stringify(Object.fromEntries(Object.entries(roles).map(([role, column]) => [role, column ?? ""]))));
    setBusy("import");
    try {
      const response = await fetch("/api/explore/datasets/import", { method: "POST", body: form });
      const payload = (await response.json()) as { dataset?: { id: string; name: string }; version?: { rowCount: number }; warnings?: string[]; error?: string };
      if (!response.ok || !payload.dataset) throw new Error(payload.error || "Import failed");
      toast.success(`${payload.dataset.name}: ${payload.version?.rowCount ?? 0} rows imported`);
      for (const warning of payload.warnings ?? []) toast.warning(warning);
      router.push(reportId
        ? `/explore/reports/${encodeURIComponent(reportId)}?scope=${encodeURIComponent(validScope!)}&mode=edit&view=canvas`
        : `/explore/datasets/${payload.dataset.id}?scope=${encodeURIComponent(validScope!)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed");
      setBusy(null);
    }
  }, [buildForm, roles, router, reportId, validScope, previewIsCurrent]);

  const previewColumns = useMemo(() => preview?.columns ?? [], [preview]);
  const missingRoles = kindDefinition ? kindDefinition.requiredRoles.filter((role) => !roles[role]) : [];

  if (!validScope) {
    return (
      <PageContainer>
        <p className="text-sm text-muted-foreground">Choose a study or order in Files before preparing a table.</p>
        <Button asChild variant="link"><Link href="/files">Go to Files</Link></Button>
      </PageContainer>
    );
  }

  if (!file || fileError || !file.canImportTable || file.targetKey !== validScope) {
    return <PageContainer>
      <h1 className="text-xl font-semibold">Prepare a table from Files</h1>
      <p className="mt-2 text-sm text-muted-foreground">{fileError ? fileError.message : fileId && !file ? "Loading the source file…" : "Choose a CSV, TSV or Excel file from this study or order. Other file types can be attached as references or used in custom analyses."}</p>
      <Button asChild className="mt-4"><Link href={filesHref(validScope, reportId)}>Choose from Files</Link></Button>
    </PageContainer>;
  }

  return (
    <PageContainer>
      <Link href={filesHref(validScope, reportId)} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Files
      </Link>
      <h1 className="mt-2 text-xl font-semibold">Prepare a table</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Preview the columns, assign roles, then create a table for analysis. The original upload stays in Files and can be reused in other reports.
        Sample ids written in the INDIVO grammar can be expanded into subject, timepoint and specimen type.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <fieldset disabled={busy !== null} className="min-w-0 space-y-4 rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">Source file</p>
            <p className="mt-1 break-words text-sm">{file.originalName}</p>
            <Link href={filesHref(validScope, reportId)} className="text-xs text-primary underline">Choose another file</Link>
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="explore-import-name">Table name</label>
            <Input id="explore-import-name" className="mt-1" value={name} placeholder={file.originalName.replace(/\.[^.]+$/, "")} onChange={(event) => setName(event.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium">Table kind</label>
            <Select value={tableKind} onValueChange={setTableKind}>
              <SelectTrigger className="mt-1" aria-label="Table kind"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.values(TABLE_KIND_DEFINITIONS).map((definition) => (
                  <SelectItem key={definition.id} value={definition.id}>{definition.label}</SelectItem>
                ))}
                <SelectItem value={NO_KIND}>Generic table</SelectItem>
              </SelectContent>
            </Select>
            {kindDefinition && <p className="mt-1 text-xs text-muted-foreground">{kindDefinition.description}</p>}
          </div>
          {preview && preview.sheets.length > 1 && (
            <div>
              <label className="text-sm font-medium">Worksheet</label>
              <Select value={sheet} onValueChange={(value) => { setSheet(value); setRoles({}); setIdColumn(NONE); setSampleTypeColumn(NONE); setIsolateColumn(NONE); }}>
                <SelectTrigger className="mt-1" aria-label="Worksheet"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {preview.sheets.map((entry) => <SelectItem key={entry} value={entry}>{entry}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="rounded-md border p-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={useIndivoGrammar} onChange={(event) => setUseIndivoGrammar(event.target.checked)} />
              Expand INDIVO sample ids
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              Ids like <span className="font-mono">A001_hd_U_D463</span> become subject A001, day 463, urine, protocol hd.
            </p>
            {useIndivoGrammar && previewColumns.length > 0 && (
              <div className="mt-3 space-y-2">
                {[
                  { label: "Id column", value: idColumn, set: setIdColumn },
                  { label: "Specimen type column", value: sampleTypeColumn, set: setSampleTypeColumn },
                  { label: "Isolate flag column", value: isolateColumn, set: setIsolateColumn },
                ].map((field) => (
                  <div key={field.label} className="flex items-center justify-between gap-2">
                    <span className="text-xs">{field.label}</span>
                    <Select value={field.value} onValueChange={field.set}>
                      <SelectTrigger className="h-8 w-44 text-xs" aria-label={field.label}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>not set</SelectItem>
                        {previewColumns.map((column) => <SelectItem key={column} value={column}>{column}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void runPreview()} disabled={!file || busy !== null}>
              {busy === "preview" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Preview
            </Button>
            <Button onClick={() => void runImport()} disabled={!file || !previewIsCurrent || busy !== null || missingRoles.length > 0 || preview?.rowCount === 0}>
              {busy === "import" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Use as table
            </Button>
          </div>
          {missingRoles.length > 0 && (
            <p className="text-xs text-amber-700">Assign the required roles before importing: {missingRoles.map((role) => ROLE_LABELS[role]).join(", ")}.</p>
          )}
          {previewError && <p role="alert" className="text-sm text-destructive">{previewError}</p>}
          {preview && !previewIsCurrent && <p role="status" className="text-sm text-amber-700">Preview these settings again before using this table.</p>}
          {previewIsCurrent && preview?.rowCount === 0 && <p role="status" className="text-sm text-amber-700">This worksheet or file has no data rows. Choose another source.</p>}
        </fieldset>

        <div className="min-w-0 space-y-4">
          {!preview ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Choose a file and press Preview to see its columns.
            </div>
          ) : (
            <>
              <div className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">Roles</h2>
                  <span className="text-xs text-muted-foreground">{preview.rowCount} rows, {preview.columns.length} columns</span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {EXPLORE_ROLES.map((role) => (
                    <div key={role} className="flex items-center justify-between gap-2">
                      <span className="text-sm">
                        {ROLE_LABELS[role]}
                        {kindDefinition?.requiredRoles.includes(role) && <span className="text-destructive"> *</span>}
                      </span>
                      <Select value={roles[role] ?? NONE} disabled={busy !== null} onValueChange={(value) => setRoles((current) => ({ ...current, [role]: value === NONE ? undefined : value }))}>
                        <SelectTrigger className="h-8 w-48 text-xs" aria-label={`${ROLE_LABELS[role]} column`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>not set</SelectItem>
                          {previewColumns.map((column) => <SelectItem key={column} value={column}>{column}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
              <div className="overflow-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-left uppercase tracking-wide text-muted-foreground">
                    <tr>
                      {preview.columns.map((column) => (
                        <th key={column} className="whitespace-nowrap px-2 py-1.5 font-medium">
                          {column}
                          {(Object.entries(roles) as Array<[ExploreRole, string | undefined]>).find(([, key]) => key === column) && (
                            <Badge variant="outline" className="ml-1">{ROLE_LABELS[(Object.entries(roles) as Array<[ExploreRole, string | undefined]>).find(([, key]) => key === column)![0]]}</Badge>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, index) => (
                      <tr key={index} className="border-t">
                        {preview.columns.map((column) => (
                          <td key={column} className="whitespace-nowrap px-2 py-1">{formatCell(row[column])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
