"use client";

import type { ReactNode } from "react";
import { Dna, Globe2 } from "lucide-react";
import type { DataSourceModule } from "@/lib/modules/import-catalog";
import { cn } from "@/lib/utils";

// Shared by the storefront and the import screens so a module keeps its identity.
// These are presentation tokens only; provider enablement stays in the module registry.
export const importModuleTheme = {
  cami: {
    Icon: Dna, label: "CAMI", category: "Benchmarks",
    surface: "bg-teal-50 text-teal-700 dark:bg-teal-950/30 dark:text-teal-300",
    text: "text-teal-700 dark:text-teal-300",
    border: "border-teal-200 dark:border-teal-800",
    action: "bg-teal-700 text-white hover:bg-teal-800",
    progress: "bg-teal-600 dark:bg-teal-400",
  },
  sra: {
    Icon: Globe2, label: "SRA / ENA", category: "Public repositories",
    surface: "bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300",
    text: "text-sky-700 dark:text-sky-300",
    border: "border-sky-200 dark:border-sky-800",
    action: "bg-sky-700 text-white hover:bg-sky-800",
    progress: "bg-sky-600 dark:bg-sky-400",
  },
} satisfies Record<DataSourceModule["source"], object>;

export function ImportModuleHeader({ source, title, description, titleId, children }: {
  source: DataSourceModule["source"];
  title: string;
  description: string;
  titleId?: string;
  children?: ReactNode;
}) {
  const { Icon, surface, category } = importModuleTheme[source];
  return <header className={cn("relative isolate overflow-hidden border-b p-5 sm:p-6", surface)}>
    <Icon className="pointer-events-none absolute -right-5 -bottom-10 -z-10 size-44 opacity-[0.06]" strokeWidth={1} aria-hidden="true" />
    <div className="flex items-start gap-4">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-card/80 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
        <Icon className="size-6" aria-hidden="true" />
      </span>
      <div className="min-w-0 space-y-2">
        <p className="text-xs font-medium">{category} <span aria-hidden="true">·</span> Import module</p>
        <h2 id={titleId} className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
        {children && <div className="flex flex-wrap gap-2 pt-1">{children}</div>}
      </div>
    </div>
  </header>;
}

export function ImportStepHeading({ source, step, title }: {
  source: "cami" | "sra";
  step: number;
  title: string;
}) {
  return <h3 className="flex items-center gap-2.5 text-sm font-semibold">
    <span aria-hidden="true" className={cn("flex size-6 shrink-0 items-center justify-center rounded-lg text-xs tabular-nums", importModuleTheme[source].surface)}>{step}</span>
    {title}
  </h3>;
}
