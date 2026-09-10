"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ExploreDatasetSummary, ExploreRoleMap, ExploreRowData } from "@/lib/explore/types";

interface Preview {
  columns: string[]; rows: ExploreRowData[]; rowCount: number;
  sheets: string[]; sheet: string | null; suggestedRoles: ExploreRoleMap; warnings: string[];
}

/** Reuses the existing import API; no parallel file parser or report-generation flow. */
export function TableFileImportDialog({ scope, onClose, onImported }: {
  scope: string; onClose: () => void; onImported: (dataset: ExploreDatasetSummary) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [sheet, setSheet] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [roles, setRoles] = useState<ExploreRoleMap>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [created, setCreated] = useState<ExploreDatasetSummary | null>(null);
  const inFlight = useRef(false);

  const submit = async (importing: boolean) => {
    if (!file || inFlight.current || (importing && !preview)) return;
    inFlight.current = true; setBusy(true); setProblem(null);
    let acknowledged = false;
    try {
      if (created) { await onImported(created); onClose(); return; }
      const form = new FormData(); form.set("file", file); form.set("targetKey", scope);
      if (name.trim()) form.set("name", name.trim());
      if (sheet) form.set("sheet", sheet);
      if (importing) form.set("roles", JSON.stringify(roles));
      const response = await fetch(`/api/explore/datasets/import${importing ? "" : "?preview=1"}`, { method: "POST", body: form });
      const payload = await response.json();
      acknowledged = true;
      if (!response.ok) throw new Error(payload.error ?? "Could not import this file.");
      if (importing) {
        if (!payload.dataset?.id) { acknowledged = false; throw new Error("The import response was incomplete."); }
        setCreated(payload.dataset);
        await onImported(payload.dataset); onClose();
      } else {
        setPreview(payload as Preview); setSheet(payload.sheet ?? ""); setRoles(payload.suggestedRoles ?? {});
      }
    } catch (error) {
      if (importing && !acknowledged && !created) setUncertain(true);
      setProblem(error instanceof Error ? error.message : "The import request failed.");
    } finally { inFlight.current = false; setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="max-h-[85vh] overflow-auto sm:max-w-3xl"><DialogHeader className="pr-5"><DialogTitle>Import a table</DialogTitle><DialogDescription>Preview a CSV, TSV or Excel table. It will appear under Your files, ready to add to the page or use for a chart.</DialogDescription></DialogHeader>
    <label className="space-y-1 text-sm font-medium">File<Input aria-label="Table file" type="file" accept=".csv,.tsv,.txt,.tab,.xlsx,.xlsm" disabled={busy || Boolean(created) || uncertain} onChange={event => { setFile(event.target.files?.[0] ?? null); setPreview(null); setRoles({}); setSheet(""); setProblem(null); }} /></label>
    <label className="space-y-1 text-sm font-medium">Table name<Input aria-label="Table name" value={name} placeholder={file?.name.replace(/\.[^.]+$/, "")} disabled={busy || Boolean(created) || uncertain} onChange={event => setName(event.target.value)} /></label>
    {preview && preview.sheets.length > 1 && <label className="text-sm">Worksheet<select aria-label="Worksheet" className="mt-1 w-full rounded border bg-background p-2" value={sheet} disabled={busy || Boolean(created) || uncertain} onChange={event => { setSheet(event.target.value); setPreview(null); }}>
      {preview.sheets.map(entry => <option key={entry}>{entry}</option>)}
    </select></label>}
    {preview && <><p className="text-xs text-muted-foreground">{preview.rowCount.toLocaleString()} rows · {preview.columns.length} columns. Preview shows up to 10 rows and 10 columns.</p><div className="max-h-56 overflow-auto rounded border"><table className="w-full text-left text-xs"><thead><tr>{preview.columns.slice(0, 10).map(column => <th key={column} className="p-2">{column}</th>)}</tr></thead><tbody>{preview.rows.slice(0, 10).map((row, i) => <tr key={i} className="border-t">{preview.columns.slice(0, 10).map(column => <td key={column} className="max-w-52 break-words p-2">{String(row[column] ?? "—")}</td>)}</tr>)}</tbody></table></div>
      <div className="grid gap-3 sm:grid-cols-2">{([ ["sample", "Sample column"], ["group", "Group column"] ] as const).map(([role, label]) => <label key={role} className="text-xs font-medium">{label} (optional)<select aria-label={label} className="mt-1 w-full rounded border bg-background p-2" disabled={busy || Boolean(created) || uncertain} value={roles[role] ?? ""} onChange={event => setRoles(current => ({ ...current, [role]: event.target.value || undefined }))}><option value="">Not mapped</option>{preview.columns.map(column => <option key={column}>{column}</option>)}</select></label>)}</div>
      {preview.warnings.map(warning => <p key={warning} className="text-xs text-amber-700">{warning}</p>)}
    </>}
    {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
    {uncertain && <p className="text-sm">The import may have succeeded. Close this dialog and check Your files before trying again; the request will not be repeated automatically.</p>}
    {created && <p className="text-sm">The table was imported. Retry refreshing the picker; this will not upload it again.</p>}
    <div className="flex flex-wrap justify-end gap-2 border-t pt-3"><Button variant="outline" disabled={busy} onClick={onClose}>Close</Button><Button disabled={!file || busy || uncertain || Boolean(preview && !preview.rowCount)} onClick={() => void submit(Boolean(preview))}>{busy ? "Please wait…" : created ? "Refresh imported table" : preview ? "Import table" : "Preview file"}</Button></div>
  </DialogContent></Dialog>;
}
