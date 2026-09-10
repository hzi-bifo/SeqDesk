"use client";

import { useId, useState } from "react";
import { Search, Store, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dataSourceModuleCatalog } from "@/lib/modules/import-catalog";
import { cn } from "@/lib/utils";
import type { ImportCollection } from "@/lib/workbench/import-collection";
import { ImportModuleCard } from "./ImportModuleCard";

const categories = ["All modules", ...new Set(dataSourceModuleCatalog.map(module => module.category))];

export function RawDataSources({ collection, orderId }: { collection?: ImportCollection; orderId?: string } = {}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All modules");
  const storeId = useId();
  const resultsId = `${storeId}-results`;
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const visible = dataSourceModuleCatalog.filter(module => {
    const text = `${module.name} ${module.description} ${module.category} ${module.formats.join(" ")}`.toLowerCase();
    return (category === "All modules" || category === module.category) && terms.every(term => text.includes(term));
  });
  const filtered = terms.length > 0 || category !== "All modules";

  return (
    <section aria-labelledby={storeId} className="@container space-y-5">
      <div className="flex flex-col justify-between gap-4 @3xl:flex-row @3xl:items-center">
        <div className="space-y-1.5">
          <h2 id={storeId} className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Store className="size-5 shrink-0" aria-hidden="true" /> Import module store
          </h2>
          <p className="text-sm text-muted-foreground">Find the right source for your sequencing data.</p>
        </div>
        <div className="relative w-full @3xl:w-72 @3xl:shrink-0">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Search import modules"
            aria-controls={resultsId}
            className="h-10 pr-10 pl-9 [&::-webkit-search-cancel-button]:appearance-none"
            placeholder="Search modules or data types…"
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
          {search && (
            <Button type="button" variant="ghost" size="icon-sm" className="absolute top-1/2 right-1 -translate-y-1/2" aria-label="Clear search" onClick={() => setSearch("")}>
              <X aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div role="group" aria-label="Filter import modules by category" className="flex flex-wrap gap-1.5">
          {categories.map(value => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={category === value ? "secondary" : "ghost"}
              className={cn("rounded-full", category === value && "bg-foreground text-background hover:bg-foreground/90 hover:text-background")}
              aria-pressed={category === value}
              aria-controls={resultsId}
              onClick={() => setCategory(value)}
            >
              {value}
            </Button>
          ))}
        </div>
        <p role="status" className="text-xs tabular-nums text-muted-foreground">
          {visible.length}{filtered && ` of ${dataSourceModuleCatalog.length}`} {visible.length === 1 && !filtered ? "module" : "modules"}
        </p>
      </div>

      <div id={resultsId}>
        {visible.length ? (
          <div className="grid gap-4 @xl:grid-cols-2 @3xl:grid-cols-3">
            {visible.map(module => <ImportModuleCard key={module.id} module={module} collection={collection} orderId={orderId} />)}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-5 py-12 text-center">
            <Search className="mb-1 size-6 text-muted-foreground" aria-hidden="true" />
            <h3 className="font-medium">No modules found</h3>
            <p className="max-w-md break-words text-sm text-muted-foreground">
              {search.trim() ? `No modules match “${search.trim()}”${category !== "All modules" ? ` in ${category}` : ""}.` : `No modules match ${category}.`} Try another search or category.
            </p>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => { setSearch(""); setCategory("All modules"); }}>Clear filters</Button>
          </div>
        )}
      </div>
    </section>
  );
}
