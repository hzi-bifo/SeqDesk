"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Activity, ArrowLeft, Grid3x3, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { DataGrid, type DataGridColumn, type DataGridRow } from "@/components/explore/DataGrid";
import { DATASET_KIND_DEFINITIONS, TABLE_KIND_DEFINITIONS, missingRequiredRoles } from "@/lib/explore/dataset-kinds";
import { fetcher, formatDateTime, postJson, ROLE_LABELS } from "@/lib/explore/client";
import { EXPLORE_ROLES, type ExploreDatasetDetail, type ExploreRole, type ExploreRowRecord } from "@/lib/explore/types";

interface EditRecord {
  id: string;
  kind: string;
  target: { rowKey?: string; column?: string };
  value: unknown;
  reason: string | null;
  createdAt: string;
  revokedAt: string | null;
}

const NONE = "__none__";

export default function ExploreDatasetPage() {
  return (
    <Suspense fallback={<PageContainer><Skeleton className="h-8 w-48" /></PageContainer>}>
      <ExploreDatasetPageContent />
    </Suspense>
  );
}

function ExploreDatasetPageContent() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const initialTab = requestedTab && ["table", "columns", "provenance", "edits"].includes(requestedTab) ? requestedTab : "table";
  const router = useRouter();
  const id = params.id;
  const [hiddenColumns, setHiddenColumnsState] = useState<string[]>(() => readStored(`seqdesk:explore:dataset:${id}:hidden`, []));
  const [density, setDensityState] = useState<"comfortable" | "compact">(() => readStored(`seqdesk:explore:dataset:${id}:density`, "comfortable"));
  const [pageSize, setPageSize] = useState(500);
  const [busy, setBusy] = useState<string | null>(null);
  const setHiddenColumns = useCallback(
    (keys: string[]) => {
      setHiddenColumnsState(keys);
      writeStored(`seqdesk:explore:dataset:${id}:hidden`, keys);
    },
    [id]
  );
  const setDensity = useCallback(
    (value: "comfortable" | "compact") => {
      setDensityState(value);
      writeStored(`seqdesk:explore:dataset:${id}:density`, value);
    },
    [id]
  );

  const detailKey = `/api/explore/datasets/${id}`;
  const rowsKey = `/api/explore/datasets/${id}/rows?limit=${pageSize}&includeExcluded=1`;
  const editsKey = `/api/explore/datasets/${id}/edits`;
  const { data: detailData, error: detailError, mutate: mutateDetail } = useSWR<{ dataset: ExploreDatasetDetail }>(detailKey, fetcher);
  const { data: rowsData, mutate: mutateRows, isLoading: rowsLoading } = useSWR<{ rows: ExploreRowRecord[]; total: number; nextCursor: string | null; cacheToken: string }>(
    rowsKey,
    fetcher
  );
  const { data: editsData, mutate: mutateEdits } = useSWR<{ edits: EditRecord[] }>(editsKey, fetcher);

  const dataset = detailData?.dataset ?? null;
  const rows = useMemo(() => rowsData?.rows ?? [], [rowsData]);
  const edits = editsData?.edits ?? [];
  const tableKind = dataset?.tableKind ? TABLE_KIND_DEFINITIONS[dataset.tableKind] ?? null : null;
  const missingRoles = dataset ? missingRequiredRoles(dataset.roles, dataset.tableKind) : [];
  const canRebuild = Boolean(dataset?.sourceConfig && typeof dataset.sourceConfig.builder === "string" && dataset.sourceConfig.builder !== "import" && dataset.sourceConfig.builder !== "analysis-run");
  const subjectTimelineReady = Boolean(dataset && ["sample", "subject", "timepoint", "taxon", "count"].every((role) => dataset.roles[role as ExploreRole]));

  const gridColumns: DataGridColumn[] = useMemo(
    () =>
      (dataset?.schema.columns ?? []).map((column) => ({
        key: column.key,
        label: column.label,
        type: column.type,
        role: column.role,
        group: column.group,
        editable: column.role !== "sample" && column.group !== "identity",
      })),
    [dataset]
  );
  const gridRows: DataGridRow[] = useMemo(
    () =>
      rows.map((row) => ({
        rowKey: row.rowKey ?? `i:${row.rowIndex}`,
        data: row.data,
        flags: row.flags,
        excluded: row.excluded,
        edited: row.edited,
      })),
    [rows]
  );

  const submitEdit = useCallback(
    async (body: Record<string, unknown>, successMessage: string) => {
      try {
        await postJson(editsKey, body);
        await Promise.all([mutateRows(), mutateEdits(), mutateDetail()]);
        toast.success(successMessage);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Edit failed");
        throw error;
      }
    },
    [editsKey, mutateRows, mutateEdits, mutateDetail]
  );

  const handleCellEdit = useCallback(
    (rowKey: string, columnKey: string, value: string | number | boolean | null) =>
      submitEdit({ kind: "cell", target: { rowKey, column: columnKey }, value: { value } }, "Cell updated"),
    [submitEdit]
  );

  const handleRowAction = useCallback(
    (rowKey: string, action: "flag" | "exclude" | "restore") => {
      if (action === "exclude") {
        void submitEdit({ kind: "row-exclude", target: { rowKey } }, "Row excluded").catch(() => {});
        return;
      }
      if (action === "flag") {
        const flag = window.prompt("Flag text for this row (for example: contaminant)");
        if (flag && flag.trim()) void submitEdit({ kind: "row-flag", target: { rowKey }, value: flag.trim() }, "Row flagged").catch(() => {});
        return;
      }
      const exclusion = edits.find((edit) => edit.kind === "row-exclude" && edit.target.rowKey === rowKey && !edit.revokedAt);
      if (exclusion) void revoke(exclusion.id);
    },
    [submitEdit, edits] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const revoke = useCallback(
    async (editId: string) => {
      try {
        await postJson(`${editsKey}/${editId}`, undefined, "DELETE");
        await Promise.all([mutateRows(), mutateEdits(), mutateDetail()]);
        toast.success("Edit revoked");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not revoke the edit");
      }
    },
    [editsKey, mutateRows, mutateEdits, mutateDetail]
  );

  const setRole = useCallback(
    async (role: ExploreRole, column: string) => {
      if (!dataset) return;
      const roles = { ...dataset.roles };
      if (column === NONE) delete roles[role];
      else roles[role] = column;
      try {
        await postJson(detailKey, { roles }, "PATCH");
        await mutateDetail();
        toast.success(`${ROLE_LABELS[role]} role updated`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not update roles");
      }
    },
    [dataset, detailKey, mutateDetail]
  );

  const rebuild = useCallback(async () => {
    setBusy("rebuild");
    try {
      const result = await postJson<{ version: { number: number; rowCount: number; unchanged: boolean }; warnings: string[] }>(
        `/api/explore/datasets/${id}/rebuild`
      );
      await Promise.all([mutateDetail(), mutateRows()]);
      toast.success(result.version.unchanged ? "Already up to date" : `Version ${result.version.number} with ${result.version.rowCount} rows`);
      for (const warning of result.warnings) toast.warning(warning);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Rebuild failed");
    } finally {
      setBusy(null);
    }
  }, [id, mutateDetail, mutateRows]);

  const remove = useCallback(async () => {
    if (!dataset) return;
    if (!window.confirm(`Delete the table "${dataset.name}" with all its versions and edits?`)) return;
    setBusy("delete");
    try {
      await postJson(detailKey, undefined, "DELETE");
      toast.success("Table deleted");
      router.push(`/explore?scope=${encodeURIComponent(dataset.targetKey)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed");
      setBusy(null);
    }
  }, [dataset, detailKey, router]);

  if (detailError) {
    return (
      <PageContainer>
        <p className="text-sm text-destructive">Could not load the table: {String(detailError.message)}</p>
      </PageContainer>
    );
  }
  if (!dataset) {
    return (
      <PageContainer>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-4 h-40 w-full" />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <Link href={`/explore?scope=${encodeURIComponent(dataset.targetKey)}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Explore
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{dataset.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="secondary">{DATASET_KIND_DEFINITIONS[dataset.kind]?.label ?? dataset.kind}</Badge>
            {tableKind && <Badge variant="outline">{tableKind.label}</Badge>}
            <Badge variant="outline">{dataset.sensitivity}</Badge>
            {dataset.currentVersion && (
              <span className="text-muted-foreground">
                v{dataset.currentVersion.number}, {dataset.currentVersion.rowCount} rows, built {formatDateTime(dataset.currentVersion.createdAt)}
              </span>
            )}
          </div>
          {dataset.description && <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{dataset.description}</p>}
          {missingRoles.length > 0 && (
            <p className="mt-2 text-sm text-amber-700">
              Missing roles for this table kind: {missingRoles.map((role) => ROLE_LABELS[role]).join(", ")}. Set them under Columns and roles.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {subjectTimelineReady && (
            <>
              <Button asChild size="sm">
                <Link href={`/explore/datasets/${dataset.id}/subject-timeline?scope=${encodeURIComponent(dataset.targetKey)}`}>
                  <Activity className="mr-2 h-4 w-4" />
                  Subject timeline
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href={`/explore/datasets/${dataset.id}/heatmap?scope=${encodeURIComponent(dataset.targetKey)}`}>
                  <Grid3x3 className="mr-2 h-4 w-4" />
                  Heatmap
                </Link>
              </Button>
            </>
          )}
          <Button asChild variant="outline" size="sm">
            <Link href={`/explore/curation?scope=${encodeURIComponent(dataset.targetKey)}`}>Curated lists</Link>
          </Button>
          {canRebuild && (
            <Button variant="outline" size="sm" onClick={() => void rebuild()} disabled={busy !== null}>
              {busy === "rebuild" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Rebuild
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void remove()} disabled={busy !== null}>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      <Tabs defaultValue={initialTab} className="mt-6">
        <TabsList>
          <TabsTrigger value="table">Table</TabsTrigger>
          <TabsTrigger value="columns">Columns and roles</TabsTrigger>
          <TabsTrigger value="provenance">Provenance and versions</TabsTrigger>
          <TabsTrigger value="edits">Edits {edits.filter((edit) => !edit.revokedAt).length > 0 && `(${edits.filter((edit) => !edit.revokedAt).length})`}</TabsTrigger>
        </TabsList>

        <TabsContent value="table" className="mt-4">
          <DataGrid
            columns={gridColumns}
            rows={gridRows}
            hiddenColumns={hiddenColumns}
            onHiddenColumnsChange={setHiddenColumns}
            onCellEdit={handleCellEdit}
            onRowAction={handleRowAction}
            loading={rowsLoading}
            total={rowsData?.total}
            hasMore={Boolean(rowsData?.nextCursor)}
            onLoadMore={() => setPageSize((current) => Math.min(current + 500, 2000))}
            density={density}
            onDensityChange={setDensity}
            exportFileName={`${dataset.name.replace(/[^A-Za-z0-9_-]+/g, "_")}.csv`}
            emptyText="This table has no rows."
          />
          {rowsData?.nextCursor && (
            <p className="mt-2 text-xs text-muted-foreground">Views and analyses always use every row, whatever is shown here.</p>
          )}
        </TabsContent>

        <TabsContent value="columns" className="mt-4">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Column</th>
                    <th className="px-3 py-2 font-medium">Label</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Group</th>
                    <th className="px-3 py-2 font-medium">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {dataset.schema.columns.map((column) => {
                    const role = (Object.entries(dataset.roles) as Array<[ExploreRole, string]>).find(([, key]) => key === column.key)?.[0];
                    return (
                      <tr key={column.key} className="border-t">
                        <td className="px-3 py-1.5 font-mono text-xs">{column.key}</td>
                        <td className="px-3 py-1.5">{column.label}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{column.type}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{column.group ?? ""}</td>
                        <td className="px-3 py-1.5">{role ? <Badge variant="outline">{ROLE_LABELS[role]}</Badge> : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="rounded-lg border p-4">
              <h3 className="text-sm font-semibold">Roles</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Roles tell views and analysis templates which column is the sample, the subject, the taxon and so on.
                {tableKind && ` Required for ${tableKind.label}: ${tableKind.requiredRoles.map((role) => ROLE_LABELS[role]).join(", ")}.`}
              </p>
              <div className="mt-3 space-y-2">
                {EXPLORE_ROLES.map((role) => (
                  <div key={role} className="flex items-center justify-between gap-2">
                    <span className="text-sm">
                      {ROLE_LABELS[role]}
                      {tableKind?.requiredRoles.includes(role) && <span className="text-destructive"> *</span>}
                    </span>
                    <Select value={dataset.roles[role] ?? NONE} onValueChange={(value) => void setRole(role, value)}>
                      <SelectTrigger className="h-8 w-48 text-xs" aria-label={`${ROLE_LABELS[role]} column`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>not set</SelectItem>
                        {dataset.schema.columns.map((column) => (
                          <SelectItem key={column.key} value={column.key}>
                            {column.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="provenance" className="mt-4">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-lg border p-4 text-sm">
              <h3 className="font-semibold">Provenance</h3>
              {dataset.provenance ? (
                <dl className="mt-2 space-y-1">
                  <div className="flex gap-2"><dt className="w-24 text-muted-foreground">Builder</dt><dd className="font-mono text-xs">{dataset.provenance.builder}</dd></div>
                  <div className="flex gap-2"><dt className="w-24 text-muted-foreground">Built</dt><dd>{formatDateTime(dataset.provenance.builtAt)}</dd></div>
                  <div className="flex gap-2"><dt className="w-24 text-muted-foreground">Sources</dt><dd>{dataset.provenance.sources.length}</dd></div>
                  {dataset.provenance.notes?.map((note) => (
                    <div key={note} className="flex gap-2"><dt className="w-24 text-muted-foreground">Note</dt><dd>{note}</dd></div>
                  ))}
                </dl>
              ) : (
                <p className="mt-2 text-muted-foreground">No version yet.</p>
              )}
              {dataset.provenance && dataset.provenance.sources.length > 0 && (
                <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto text-xs">
                  {dataset.provenance.sources.map((source) => (
                    <li key={`${source.type}:${source.id}`} className="flex gap-2">
                      <Badge variant="outline">{source.type}</Badge>
                      <span className="truncate">{source.label ?? source.id}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-lg border p-4 text-sm">
              <h3 className="font-semibold">Versions</h3>
              <table className="mt-2 w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-1 font-medium">Version</th>
                    <th className="py-1 text-right font-medium">Rows</th>
                    <th className="py-1 font-medium">Source</th>
                    <th className="py-1 font-medium">Created</th>
                    <th className="py-1 font-medium">Hash</th>
                  </tr>
                </thead>
                <tbody>
                  {dataset.versions.map((version) => (
                    <tr key={version.id} className="border-t">
                      <td className="py-1">v{version.number}{version.id === dataset.currentVersion?.id && <span className="ml-1 text-xs text-muted-foreground">current</span>}</td>
                      <td className="py-1 text-right tabular-nums">{version.rowCount}</td>
                      <td className="py-1 text-muted-foreground">{version.buildSource}</td>
                      <td className="py-1 text-muted-foreground">{formatDateTime(version.createdAt)}</td>
                      <td className="py-1 font-mono text-xs text-muted-foreground">{version.contentHash.slice(0, 12)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="edits" className="mt-4">
          {edits.length === 0 ? (
            <p className="text-sm text-muted-foreground">No edits yet. Edit a cell, flag or exclude a row in the table; every change is recorded here and never changes the stored version.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">Kind</th>
                    <th className="px-3 py-2 font-medium">Target</th>
                    <th className="px-3 py-2 font-medium">Value</th>
                    <th className="px-3 py-2 font-medium">Reason</th>
                    <th className="px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {edits.map((edit) => (
                    <tr key={edit.id} className={`border-t ${edit.revokedAt ? "text-muted-foreground line-through" : ""}`}>
                      <td className="px-3 py-1.5 whitespace-nowrap">{formatDateTime(edit.createdAt)}</td>
                      <td className="px-3 py-1.5">{edit.kind}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{[edit.target.rowKey, edit.target.column].filter(Boolean).join(" / ")}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{edit.value === null || edit.value === undefined ? "" : JSON.stringify(edit.value)}</td>
                      <td className="px-3 py-1.5">{edit.reason ?? ""}</td>
                      <td className="px-3 py-1.5 text-right">
                        {!edit.revokedAt && (
                          <Button variant="ghost" size="sm" onClick={() => void revoke(edit.id)}>
                            Revoke
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}

function readStored<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable; the view still works without persistence.
  }
}
