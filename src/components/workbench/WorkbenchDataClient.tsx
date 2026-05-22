"use client";

import { useEffect, useState } from "react";
import { Database } from "lucide-react";
import { WorkbenchEmptyPanel, WorkbenchStatusBadge } from "@/components/workbench/WorkbenchPageShell";

interface WorkbenchDataset {
  id: string;
  providerId: string;
  name: string;
  description: string | null;
  sourceMetadata: unknown;
  storagePath: string | null;
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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/workbench/data", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { datasets?: WorkbenchDataset[] };
        if (!cancelled) setDatasets(Array.isArray(payload.datasets) ? payload.datasets : []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loading && datasets.length === 0) {
    return (
      <WorkbenchEmptyPanel
        title="No workspace datasets yet"
        description="Imported reference genomes, archives, and derived output datasets will appear here after Workbench imports complete."
        icon={Database}
        columns={["Dataset", "Type", "Size", "Checksum"]}
      />
    );
  }

  return (
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
                  {dataset.description || dataset.storagePath || "Workbench dataset"}
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
  );
}
