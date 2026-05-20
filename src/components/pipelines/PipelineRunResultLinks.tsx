"use client";

import { ExternalLink, FileText, Files } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PipelineRunResultFile } from "@/lib/pipelines/result-files";

type PipelineRunResultLinksProps = {
  status: string;
  resultFiles?: PipelineRunResultFile[] | null;
  primaryResultFile?: PipelineRunResultFile | null;
  omittedCount?: number;
  omittedSampleFileCount?: number;
  hasOutputErrors?: boolean;
};

function fileHref(file: PipelineRunResultFile): string {
  return `/api/files/preview?path=${encodeURIComponent(file.path)}`;
}

function fileKindLabel(file: PipelineRunResultFile): string {
  if (file.source === "technical") return "Technical";
  if (file.outputId) return file.outputId.replace(/[_-]+/g, " ");
  return file.type;
}

function formatSize(size: number | null): string | null {
  if (size == null || !Number.isFinite(size)) return null;
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  for (const unit of units) {
    if (value < 1024 || unit === "TB") {
      return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
    }
    value /= 1024;
  }
  return null;
}

export function PipelineRunResultLinks({
  status,
  resultFiles,
  primaryResultFile,
  omittedCount = 0,
  omittedSampleFileCount = 0,
  hasOutputErrors,
}: PipelineRunResultLinksProps) {
  const files = resultFiles ?? [];
  const primary = primaryResultFile ?? files.find((file) => file.previewable) ?? files[0] ?? null;
  const secondary = files.filter((file) => file.id !== primary?.id);
  const hasOmittedFiles = omittedCount > 0 || omittedSampleFileCount > 0;

  if (status === "completed" && !primary && hasOutputErrors) {
    return <span className="text-xs text-destructive">Output error</span>;
  }

  if (status === "completed" && !primary && omittedSampleFileCount > 0) {
    return <span className="text-xs text-muted-foreground">Per-sample outputs</span>;
  }

  if (status !== "completed" || !primary) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }

  return (
    <div className="flex max-w-[260px] flex-wrap items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
      {primary.previewable ? (
        <a
          href={fileHref(primary)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-w-0 items-center gap-1 text-xs text-primary hover:underline"
          title={primary.path}
        >
          <FileText className="h-3 w-3 shrink-0" />
          <span className="truncate">{primary.name}</span>
          <ExternalLink className="h-3 w-3 shrink-0" />
        </a>
      ) : (
        <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground" title={primary.path}>
          <FileText className="h-3 w-3 shrink-0" />
          <span className="truncate">{primary.name}</span>
        </span>
      )}

      {(secondary.length > 0 || hasOmittedFiles) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              aria-label={`Open ${secondary.length} additional result files`}
            >
              <Files className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            {secondary.map((file) => {
              const size = formatSize(file.size);
              const detail = [fileKindLabel(file), size].filter(Boolean).join(" · ");
              return file.previewable ? (
                <DropdownMenuItem key={file.id} asChild>
                  <a
                    href={fileHref(file)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={file.path}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <FileText className="h-4 w-4" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{file.name}</span>
                      {detail && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {detail}
                        </span>
                      )}
                    </span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem key={file.id} disabled title={file.path}>
                  <FileText className="h-4 w-4" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{file.name}</span>
                    {detail && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {detail}
                      </span>
                    )}
                  </span>
                </DropdownMenuItem>
              );
            })}
            {hasOmittedFiles && (
              <>
                {secondary.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem disabled>
                  <Files className="h-4 w-4" />
                  <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                    {omittedCount > 0 && `${omittedCount} additional run file${omittedCount === 1 ? "" : "s"} omitted`}
                    {omittedCount > 0 && omittedSampleFileCount > 0 ? "; " : ""}
                    {omittedSampleFileCount > 0 &&
                      `${omittedSampleFileCount} per-sample file${omittedSampleFileCount === 1 ? "" : "s"} kept in sample previews`}
                  </span>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
