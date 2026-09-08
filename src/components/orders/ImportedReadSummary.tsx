"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ImportFileDetails, type ImportFileInfo } from "@/components/workbench/ImportFileDetails";
import { processingLabels, processingStateSchema } from "@/lib/workbench/import-processing";
function fileInfo(value: unknown): ImportFileInfo | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const str = (key: string) => typeof v[key] === "string" ? v[key] as string : undefined;
  const filename = str("filename") ?? str("storedFilename");
  return filename ? { filename, url: str("url") ?? str("sourceUrl"), bytes: typeof v.bytes === "number" ? v.bytes : undefined, sourceMd5: str("sourceMd5"), etag: str("etag"), localSha256: str("localSha256") ?? str("sha256"), verifiedMd5: str("verifiedMd5") } : null;
}
function ReadImportEvidence({ metadata }: { metadata: Record<string, unknown> }) {
  const processing = metadata.processing as { effectiveState?: unknown; source?: { details?: string }; userDeclaration?: { details?: string; recordedAt?: string } } | undefined;
  const state = processingStateSchema.safeParse(processing?.effectiveState);
  const files = (Array.isArray(metadata.sourceFiles) ? metadata.sourceFiles : Array.isArray(metadata.files) ? metadata.files : []).map(fileInfo).filter((file): file is ImportFileInfo => Boolean(file));
  const archive = fileInfo(metadata.sourceArchive);
  return <div className="space-y-2">
    <p className="font-medium">{state.success ? processingLabels[state.data] : "Processing unknown (not recorded)"}{metadata.synthetic === true ? " · Synthetic benchmark" : ""}{processing?.userDeclaration ? " · User-declared" : ""}</p>
    {processing && <details><summary>Processing evidence</summary><p>{typeof processing.source?.details === "string" ? processing.source.details : "Source processing not established"}</p>{processing.userDeclaration && <p>User declaration: {typeof processing.userDeclaration.details === "string" ? processing.userDeclaration.details : "Details unavailable"} · {typeof processing.userDeclaration.recordedAt === "string" ? processing.userDeclaration.recordedAt : ""}</p>}</details>}
    {archive && <ImportFileDetails file={archive} />}
    {files.map((file, index) => <ImportFileDetails key={index} file={file} />)}
  </div>;
}
type Read = { id: string; file1: string | null; file2: string | null; dataClass: string; pipelineSources: string | null; runAccessionNumber: string | null; readCount1?: number | null };
type Sample = { id: string; sampleId: string; sampleTitle: string | null; reads: Read[]; study?: { id: string; title: string } | null };
function readMetadata(read: Read): Record<string, unknown> {
  try { const value: unknown = JSON.parse(read.pipelineSources || "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; } catch { return {}; }
}
export function ImportedReadSummary({ orderId }: { orderId: string }) {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { let active = true;
    fetch(`/api/orders/${orderId}`).then(async r => { if (!r.ok) throw new Error("Could not load imported reads"); const data = await r.json(); if (active) setSamples(data.samples); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [orderId]);
  return <section className="mb-6 space-y-4 rounded-lg border bg-card p-5"><div><h2 className="text-sm font-semibold">Imported sequencing reads</h2><p className="text-xs text-muted-foreground">Processing labels and evidence are stored per read set. Facility intake is not required. Pipeline integration is not enabled yet.</p></div>
    {error && <p role="alert">{error}</p>}{samples.map(s => <div className="space-y-2 border-t pt-3" key={s.id}><h3 className="text-sm font-medium">{s.sampleTitle || s.sampleId}</h3><p className="text-xs text-muted-foreground">{s.sampleId}{s.study && <> · <Link className="underline" href={`/studies/${s.study.id}`}>{s.study.title}</Link></>}</p>{s.reads.map(r => {
      const metadata = readMetadata(r);
      // Preserve source processing evidence independently of local labels.
      return <div className="space-y-2 text-xs" key={r.id}><ReadImportEvidence metadata={metadata} /><p>{metadata.technology === "long" ? "Long reads" : r.file2 ? "Paired-end" : "Single-end"} · Sequencing reads {r.runAccessionNumber}{typeof metadata.platform === "string" ? ` · ${metadata.platform}` : ""}{r.readCount1 != null ? ` · ${r.readCount1.toLocaleString()} reads` : ""}</p><p className="break-all font-mono">{r.file1}<br />{r.file2}</p><details><summary>Original metadata, provenance and validation</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(metadata, null, 2)}</pre></details></div>;
    })}</div>)}
  </section>;
}
