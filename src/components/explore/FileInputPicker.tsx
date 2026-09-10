"use client";

import Link from "next/link";
import useSWR from "swr";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetcher } from "@/lib/explore/client";
import { filesHref, type AnalysisFileBinding, type LibraryResponse } from "@/lib/files/library-types";

export function FileInputPicker({ scope, reportId, value, onChange, disabled = false }: {
  scope: string; reportId?: string | null; value: AnalysisFileBinding[];
  onChange: (bindings: AnalysisFileBinding[]) => void; disabled?: boolean;
}) {
  const { data, error } = useSWR<LibraryResponse>(`/api/files/library?targetKey=${encodeURIComponent(scope)}`, fetcher);
  const files = data?.files ?? [];
  const add = () => {
    const next = files.find((file) => !value.some((binding) => binding.fileId === file.id));
    if (!next) return;
    let alias = "file";
    for (let index = 2; value.some((binding) => binding.alias === alias); index++) alias = `file_${index}`;
    onChange([...value, { alias, fileId: next.id }]);
  };
  return <div className="space-y-3">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Original file inputs</h3><Link href={filesHref(scope, reportId)} className="text-xs text-primary hover:underline">Browse Files</Link></div>
    <p className="text-xs text-muted-foreground">Choose files for your script to read. Each run gets its own copy; use <code>file_path(&quot;alias&quot;)</code> in Python. Analysis templates still need the tables listed above.</p>
    {error && <p role="alert" className="text-xs text-destructive">{error.message}</p>}
    {value.map((binding, index) => <div key={index} className="flex items-center gap-2">
      <Input aria-label={`File input ${index + 1} alias`} className="w-28 shrink-0 font-mono text-xs" value={binding.alias} maxLength={40} disabled={disabled} onChange={(event) => onChange(value.map((entry, i) => i === index ? { ...entry, alias: event.target.value } : entry))} />
      <select aria-label={`File input ${index + 1}`} className="min-w-0 flex-1 rounded-md border bg-background px-2 py-2 text-sm" value={binding.fileId} disabled={disabled} onChange={(event) => onChange(value.map((entry, i) => i === index ? { ...entry, fileId: event.target.value } : entry))}>
        {!files.some((file) => file.id === binding.fileId) && <option value={binding.fileId}>File unavailable</option>}
        {files.map((file) => <option key={file.id} value={file.id}>{file.originalName}</option>)}
      </select>
      <Button type="button" size="icon" variant="ghost" disabled={disabled} aria-label={`Remove file input ${index + 1}`} onClick={() => onChange(value.filter((_, i) => i !== index))}><X className="h-4 w-4" /></Button>
    </div>)}
    <Button type="button" size="sm" variant="outline" onClick={add} disabled={disabled || !files.some((file) => !value.some((binding) => binding.fileId === file.id)) || value.length >= 50}><Plus className="mr-1 h-3.5 w-3.5" />Add file input</Button>
  </div>;
}
