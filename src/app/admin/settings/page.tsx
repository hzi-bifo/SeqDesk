"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { ArrowRight, CheckCircle2, ClipboardCheck, Search, Settings2, X } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useModules } from "@/lib/modules";
import { useDeploymentProfile } from "@/components/deployment-profile/DeploymentProfileProvider";
import { getSettingsSections, filterSettingsSections } from "@/lib/settings/catalog";
import type { OnboardingStatus } from "@/lib/onboarding/types";
import { cn } from "@/lib/utils";

async function loadSetup(url: string): Promise<OnboardingStatus> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load the setup checklist.");
  return response.json();
}

export default function SettingsOverviewPage() {
  const [query, setQuery] = useState("");
  const profile = useDeploymentProfile();
  const { isModuleEnabled, availableModules, loading, error: modulesError, refresh, globalDisabled } = useModules();
  const { data: setup, error: setupError, isLoading: setupLoading, mutate } = useSWR("/api/admin/onboarding", loadSetup);
  const sections = getSettingsSections({ dynamicStudiesEnabled: isModuleEnabled("dynamic-studies"), centerAccounts: profile.id === "sequencing-center" });
  const visible = filterSettingsSections(sections, query);
  const enabledCount = availableModules.filter(module => isModuleEnabled(module.id)).length;
  const nextRequired = setup?.items.find(item => item.requirement === "required" && !item.complete);
  const nextRequiredHref = nextRequired?.completionMode === "automatic"
    ? "/admin/onboarding"
    : nextRequired?.href || "/admin/onboarding";
  const nextRequiredPrefix = nextRequired?.completionMode !== "automatic" ? "Next"
    : nextRequired.automaticCheck?.status === "needs-attention" ? "Needs attention" : "Not checked yet";

  return <PageContainer className="min-w-0 space-y-7">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-2xl space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><Settings2 className="size-4" aria-hidden /> Administration</div>
        <h1 className="text-2xl font-semibold tracking-tight">Application settings</h1>
        <p className="text-sm leading-6 text-muted-foreground">Set up SeqDesk for your team. These settings apply to the whole installation; your personal preferences stay in Account Settings.</p>
      </div>
      <Button variant="outline" asChild><Link href="/settings">My account</Link></Button>
    </header>

    <section aria-label="Setup status" className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b bg-teal-50/60 p-4 dark:bg-teal-950/20 md:px-5">
        <div className="flex items-center gap-3"><ClipboardCheck className="size-5 shrink-0 text-teal-700 dark:text-teal-300" aria-hidden /><div><h2 className="font-semibold">Your installation</h2><p className="text-sm text-muted-foreground">One application. Enable the modules you need, then check their setup.</p></div></div>
        <Button variant="outline" className="bg-background" asChild><Link href="/admin/onboarding">Setup checklist <ArrowRight className="size-4" aria-hidden /></Link></Button>
      </div>
      <div className="grid gap-5 p-4 md:grid-cols-2 md:px-5">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Modules</p>
          {loading ? <Skeleton className="h-5 w-40" aria-label="Loading modules" /> : modulesError ? <p role="alert" className="text-sm">Could not load modules. <button type="button" className="underline underline-offset-2" onClick={() => void refresh()}>Retry modules</button></p> : <><p className="text-sm font-medium">{globalDisabled ? "Optional modules are paused" : `${enabledCount} of ${availableModules.length} modules enabled`}</p><Link href="/admin/modules" className="mt-1 inline-block text-sm text-muted-foreground underline underline-offset-2">Choose available features</Link></>}
        </div>
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Setup checklist</p>
          {setupLoading ? <Skeleton className="h-5 w-56" aria-label="Loading setup status" /> : setupError ? <p role="alert" className="text-sm">Setup status unavailable. <button type="button" className="underline underline-offset-2" onClick={() => void mutate()}>Retry setup status</button></p> : setup ? <>
            <p className="flex items-center gap-1.5 text-sm font-medium">{!nextRequired && <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />}{setup.completedCount} of {setup.totalCount} items complete</p>
            {nextRequired ? <Link href={nextRequiredHref} className="mt-1 inline-block text-sm text-amber-800 underline underline-offset-2 dark:text-amber-300">{nextRequiredPrefix}: {nextRequired.label}</Link> : <p className="mt-1 text-sm text-muted-foreground">Required checks are complete. Review recommended items in the checklist.</p>}
          </> : <p className="text-sm text-muted-foreground">Open the checklist to review your setup.</p>}
        </div>
      </div>
    </section>

    <div className="relative w-full">
      <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden />
      <Input value={query} onChange={event => setQuery(event.target.value)} aria-label="Find a setting" placeholder="Find a setting… e.g. storage, databases, invitations" className="h-10 pl-9 pr-10" />
      {query && <button type="button" aria-label="Clear settings search" onClick={() => setQuery("")} className="absolute right-1 top-1 rounded p-2 text-muted-foreground hover:bg-muted"><X className="size-4" /></button>}
    </div>
    {visible.length === 0 && <div role="status" className="rounded-xl border border-dashed p-8 text-center"><p className="font-medium">No matching settings</p><p className="mt-1 text-sm text-muted-foreground">Try a different term, or clear the search to browse all settings.</p></div>}
    <div className="grid items-start gap-5 xl:grid-cols-2">
      {visible.map(section => {
        const moduleKnown = !loading && !modulesError;
        const disabled = Boolean(section.moduleId && moduleKnown && !isModuleEnabled(section.moduleId));
        return <section key={section.id} aria-labelledby={`settings-${section.id}`} className="min-w-0 overflow-hidden rounded-xl border bg-card">
          <div className="flex items-start gap-3 border-b p-5">
            <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", section.color)}><section.icon className="size-5" aria-hidden /></div>
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 id={`settings-${section.id}`} className="font-semibold">{section.title}</h2>{disabled && <Badge variant="secondary">Module disabled</Badge>}</div><p className="mt-1 text-sm leading-5 text-muted-foreground">{section.description}</p></div>
          </div>
          {disabled ? <div className="space-y-3 p-5"><p className="text-sm text-muted-foreground">Enable sequencing management to configure facility instruments and runs. Imported data and studies remain available.</p><Button variant="outline" asChild><Link href="/admin/modules?category=data-sources">Configure data source modules <ArrowRight className="size-4" aria-hidden /></Link></Button></div> : <ul className="divide-y">
            {section.links.map(link => <li key={link.href}><Link href={link.href} className="group flex items-center gap-3 px-5 py-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"><div className="min-w-0 flex-1"><span className="text-sm font-medium">{link.label}</span><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{link.description}</p>{link.moduleId && moduleKnown && !isModuleEnabled(link.moduleId) && <p className="mt-1 text-xs text-muted-foreground">Module disabled · enable it in Modules to configure analyses</p>}</div><ArrowRight className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden /></Link></li>)}
          </ul>}
        </section>;
      })}
    </div>
    <p className="text-xs leading-5 text-muted-foreground">Opening a settings page does not install pipelines or download databases. Some paths and services may be managed by your server operator; the relevant page explains when they cannot be changed here.</p>
  </PageContainer>;
}
