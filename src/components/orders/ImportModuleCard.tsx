"use client";

import { useId } from "react";
import Link from "next/link";
import { ArrowRight, Check, LockKeyhole, Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { importModuleTheme } from "@/components/workbench/ImportModuleUI";
import { useModuleEnabled } from "@/lib/modules";
import type { DataSourceModule } from "@/lib/modules/import-catalog";
import type { ImportCollection } from "@/lib/workbench/import-collection";
import { cn } from "@/lib/utils";

function sourceHref(source: DataSourceModule["source"], collection?: ImportCollection, orderId?: string) {
  const query = new URLSearchParams({ source });
  if (orderId) query.set("orderId", orderId);
  if (collection) {
    query.set("name", collection.name);
    query.set("collection", collection.key);
  }
  return `/orders/import?${query}`;
}

/** One module card for both the full store and collection-level source choices. */
export function ImportModuleCard({ module: sourceModule, collection, orderId, compact = false }: {
  module: DataSourceModule;
  collection?: ImportCollection;
  orderId?: string;
  compact?: boolean;
}) {
  const enabled = useModuleEnabled(sourceModule.id);
  const titleId = useId();
  const { Icon, label, surface, action } = importModuleTheme[sourceModule.source];

  return (
    <article
      aria-labelledby={titleId}
      className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border bg-card transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-sm motion-reduce:transition-none"
    >
      <div className={cn("relative flex shrink-0 items-center gap-3 overflow-hidden border-b", compact ? "h-16 px-4" : "h-24 px-5", surface, !enabled && "saturate-0")}>
        <div className={cn("relative z-10 flex shrink-0 items-center justify-center rounded-xl bg-card/80 shadow-sm ring-1 ring-black/5 dark:ring-white/10", compact ? "size-9" : "size-11")}>
          <Icon className={compact ? "size-5" : "size-6"} aria-hidden="true" />
        </div>
        <span className={cn("relative z-10 font-semibold tracking-tight", !compact && "text-lg")}>{label}</span>
        <Icon className="absolute -right-4 -bottom-5 size-28 opacity-[0.07]" strokeWidth={1} aria-hidden="true" />
      </div>

      <div className={cn("flex flex-1 flex-col", compact ? "gap-3 p-4" : "gap-4 p-5")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">{compact ? "Import module" : sourceModule.category}</p>
          <Badge variant={enabled ? "success" : "secondary"} className="gap-1 font-normal">
            {enabled ? <Check aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}
            {enabled ? "Enabled" : "Disabled"}
          </Badge>
        </div>
        <div className="space-y-2">
          <h3 id={titleId} className="font-semibold tracking-tight">{sourceModule.name}</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">{compact ? sourceModule.summary : sourceModule.description}</p>
        </div>
        {!compact && <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
          {sourceModule.formats.map(format => (
            <span key={format} className="rounded-md bg-muted/70 px-2 py-1 text-xs text-muted-foreground">{format}</span>
          ))}
        </div>}
      </div>

      <div className={cn("space-y-3 border-t py-4", compact ? "px-4" : "px-5")}>
        {!compact && <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Package className="size-3.5" aria-hidden="true" /> Included with SeqDesk
        </p>}
        {enabled ? (
          <Button className={cn("h-auto min-h-9 w-full justify-between whitespace-normal text-left", compact && action)} asChild>
            <Link href={sourceHref(sourceModule.source, collection, orderId)} aria-label={`Open module: ${sourceModule.name}`}>
              Open module <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        ) : (
          <Button className="h-auto min-h-9 w-full whitespace-normal" variant="outline" disabled>
            Disabled by administrator
          </Button>
        )}
      </div>
    </article>
  );
}
