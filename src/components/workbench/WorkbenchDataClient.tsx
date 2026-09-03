"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Database, Loader2, Upload } from "lucide-react";
import { WorkbenchEmptyPanel, WorkbenchStatusBadge } from "@/components/workbench/WorkbenchPageShell";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

interface WorkbenchDataset {
  id: string;
  providerId: string;
  name: string;
  description: string | null;
  sourceMetadata: unknown;
  sizeBytes: number | null;
  checksumSha256: string | null;
  genomeCount: number | null;
  status: string;
  linkedAt?: string;
}

function formatBytes(value: number | null) {
  if (!value) return "Unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDate(value?: string) {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function WorkbenchDataClient() {
  const [datasets, setDatasets] = useState<WorkbenchDataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadLabel, setUploadLabel] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshDatasets = useCallback(async () => {
    const response = await fetch("/api/workbench/data", { cache: "no-store" });
    if (!response.ok) return;
    const payload = (await response.json()) as { datasets?: WorkbenchDataset[] };
    setDatasets(Array.isArray(payload.datasets) ? payload.datasets : []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (!cancelled) await refreshDatasets();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshDatasets]);

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files.item(index);
        if (!file) continue;
        setUploadLabel(`Uploading ${index + 1} of ${files.length}: ${file.name}`);
        const response = await fetch("/api/workbench/uploads", {
          method: "POST",
          headers: {
            "content-type": file.type || "application/octet-stream",
            "x-seqdesk-filename": encodeURIComponent(file.name),
          },
          body: file,
        });
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        if (!response.ok) {
          throw new Error(payload?.error || `Failed to upload ${file.name}`);
        }
      }
      await refreshDatasets();
      toast.success(`${files.length} file${files.length === 1 ? "" : "s"} uploaded`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
      setUploadLabel("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (!loading && datasets.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            accept=".fastq,.fq,.fastq.gz,.fq.gz,.fasta,.fa,.fna,.fasta.gz,.fa.gz,.fna.gz,.bam,.cram,.vcf,.vcf.gz,.bcf,.csv,.tsv,.txt"
            onChange={(event) => void uploadFiles(event.target.files)}
          />
          <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            {uploading ? uploadLabel : "Upload data"}
          </Button>
        </div>
        <WorkbenchEmptyPanel
          title="No workspace datasets yet"
          description="Upload sequencing files from this computer or use Imports to download public repository data."
          icon={Database}
          columns={["Dataset", "Type", "Size", "Checksum"]}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Upload local sequencing files or add public data through Imports.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept=".fastq,.fq,.fastq.gz,.fq.gz,.fasta,.fa,.fna,.fasta.gz,.fa.gz,.fna.gz,.bam,.cram,.vcf,.vcf.gz,.bcf,.csv,.tsv,.txt"
          onChange={(event) => void uploadFiles(event.target.files)}
        />
        <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
          {uploading ? uploadLabel : "Upload data"}
        </Button>
      </div>
      <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="grid border-b border-border bg-secondary/30 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid-cols-[2fr_1fr_1fr_1fr]">
        <div>Dataset</div>
        <div className="hidden md:block">Provider</div>
        <div className="hidden md:block">Size</div>
        <div className="hidden md:block">Imported</div>
      </div>
      {loading ? (
        <div className="px-6 py-12 text-center text-sm text-muted-foreground">Loading datasets...</div>
      ) : (
        <div className="divide-y divide-border">
          {datasets.map((dataset) => (
            <div
              key={dataset.id}
              className="grid gap-3 px-4 py-4 md:grid-cols-[2fr_1fr_1fr_1fr] md:items-center"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium text-foreground">{dataset.name}</p>
                  <WorkbenchStatusBadge tone={dataset.status === "ready" ? "accent" : "neutral"}>
                    {dataset.status}
                  </WorkbenchStatusBadge>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {dataset.description || "Workbench dataset"}
                </p>
                {dataset.checksumSha256 && (
                  <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                    sha256 {dataset.checksumSha256}
                  </p>
                )}
              </div>
              <div className="text-sm text-muted-foreground">{dataset.providerId}</div>
              <div className="text-sm text-muted-foreground">
                {formatBytes(dataset.sizeBytes)}
                {dataset.genomeCount ? ` · ${dataset.genomeCount} genomes` : ""}
              </div>
              <div className="text-sm text-muted-foreground">{formatDate(dataset.linkedAt)}</div>
            </div>
          ))}
        </div>
      )}
      </section>
    </div>
  );
}
