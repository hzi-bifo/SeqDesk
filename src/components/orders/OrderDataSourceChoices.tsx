"use client";

import { useId } from "react";
import Link from "next/link";
import { ArrowRight, FolderOpen, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dataSourceModuleCatalog } from "@/lib/modules/import-catalog";
import type { ImportCollection } from "@/lib/workbench/import-collection";
import { ImportModuleCard } from "./ImportModuleCard";

export function OrderDataSourceChoices({ collection, orderId, storageConfigured, onAddFiles }: {
  collection: ImportCollection;
  orderId: string;
  storageConfigured: boolean;
  onAddFiles: (mode: "storage" | "upload") => void;
}) {
  const titleId = useId();
  const filesTitleId = useId();
  const storageHintId = useId();
  const storeHref = `/orders/import?${new URLSearchParams({ orderId, name: collection.name, collection: collection.key })}`;

  return <section aria-labelledby={titleId} className="@container space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="space-y-1">
        <h2 id={titleId} className="font-semibold">Add data</h2>
        <p className="text-sm text-muted-foreground">Choose an import module or add your own files.</p>
      </div>
      <Button size="sm" variant="ghost" className="h-auto min-h-8 whitespace-normal" asChild>
        <Link href={storeHref}>Browse import module store <ArrowRight aria-hidden="true" /></Link>
      </Button>
    </div>
    <div className="grid auto-rows-fr gap-4 @xl:grid-cols-2 @2xl:grid-cols-3">
      {dataSourceModuleCatalog.map(sourceModule => <ImportModuleCard key={sourceModule.id} module={sourceModule} collection={collection} orderId={orderId} compact />)}
      <article aria-labelledby={filesTitleId} className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border bg-card">
        <div className="relative flex h-16 shrink-0 items-center gap-3 overflow-hidden border-b bg-violet-50 px-4 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300">
          <span className="relative z-10 flex size-9 shrink-0 items-center justify-center rounded-xl bg-card/80 shadow-sm ring-1 ring-black/5 dark:ring-white/10"><FolderOpen className="size-5" aria-hidden="true" /></span>
          <span className="relative z-10 font-semibold tracking-tight">Your files</span>
          <FolderOpen className="absolute -right-4 -bottom-5 size-28 opacity-[0.07]" strokeWidth={1} aria-hidden="true" />
        </div>
        <div className="flex-1 space-y-3 p-4">
          <p className="text-xs font-medium text-muted-foreground">Upload or link files</p>
          <div className="space-y-2">
            <h3 id={filesTitleId} className="font-semibold tracking-tight">Other ways to add data</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">Use files already on the SeqDesk server, or upload files from your computer.</p>
          </div>
        </div>
        <div className="space-y-2 border-t p-4">
          {!storageConfigured && <p id={storageHintId} className="text-xs text-muted-foreground">Server storage is not configured. Ask an administrator to set it up.</p>}
          <Button type="button" variant="outline" className="h-auto min-h-9 w-full justify-start whitespace-normal text-left" disabled={!storageConfigured} aria-describedby={!storageConfigured ? storageHintId : undefined} onClick={() => onAddFiles("storage")}><FolderOpen aria-hidden="true" />Use existing files</Button>
          <Button type="button" variant="outline" className="h-auto min-h-9 w-full justify-start whitespace-normal text-left" onClick={() => onAddFiles("upload")}><Upload aria-hidden="true" />Upload files</Button>
        </div>
      </article>
    </div>
  </section>;
}
