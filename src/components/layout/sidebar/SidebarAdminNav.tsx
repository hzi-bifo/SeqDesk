"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertTriangle, ChevronRight, ClipboardCheck, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { startVisiblePolling } from "@/lib/polling";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useModuleEnabled } from "@/lib/modules";
import { useDeploymentProfile } from "@/components/deployment-profile/DeploymentProfileProvider";
import { getSettingsSections, isSettingsLinkActive, type SettingsSection } from "@/lib/settings/catalog";

interface SidebarAdminNavProps { collapsed: boolean; unreadMessages: number; isDemoUser?: boolean }
interface InfrastructureReadiness {
  requiredMissing: string[];
  recommendedMissing: string[];
  firstMissingHref: string;
  missingItems: Array<{ key: string; label: string; href: string; severity: "required" | "recommended" }>;
}

const linkClass = (active: boolean) => cn("flex min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors motion-reduce:transition-none", active ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground");

function SettingsNavGroup({ section, pathname, collapsed, unreadMessages, readiness }: {
  section: SettingsSection; pathname: string; collapsed: boolean; unreadMessages: number; readiness?: InfrastructureReadiness | null;
}) {
  const links = section.links.filter(link => !link.overviewOnly);
  const active = links.some(link => isSettingsLinkActive(pathname, link.href));
  // A new destination opens its section; a deliberate collapse applies only on that page.
  const [override, setOverride] = useState<{ pathname: string; open: boolean } | null>(null);
  const open = override?.pathname === pathname ? override.open : active;
  const required = readiness?.requiredMissing.length ?? 0;
  const recommended = readiness?.recommendedMissing.length ?? 0;
  const hasReadinessWarning = Boolean((required || recommended) && readiness);
  const gapLabel = (required || recommended) + " " + (required ? "required infrastructure settings missing" : "recommended infrastructure settings pending");

  if (collapsed || links.length === 1) return <Link href={links[0].href} title={collapsed ? section.title : undefined} aria-label={section.title} aria-current={active ? "page" : undefined} className={cn(linkClass(active), collapsed && "justify-center px-0 py-2.5")}><section.icon className={collapsed ? "size-5 shrink-0" : "size-4 shrink-0"} aria-hidden />{!collapsed && section.title}</Link>;

  return <div>
    <div className="relative">
      <button type="button" aria-expanded={open} aria-controls={"settings-nav-" + section.id} onClick={() => setOverride({ pathname, open: !open })} className={cn(linkClass(active), "w-full text-left")}>
        <section.icon className="size-4 shrink-0" aria-hidden /><span className={cn("min-w-0 flex-1", hasReadinessWarning && "pr-8")}>{section.title}</span><ChevronRight className={cn("size-3.5 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-90")} aria-hidden />
      </button>
      {hasReadinessWarning && readiness && <Tooltip><TooltipTrigger asChild>
        <Link href={readiness.firstMissingHref} aria-label={gapLabel} className={cn("absolute right-9 top-1/2 -translate-y-1/2 inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold", required ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700")}><AlertTriangle className="size-3.5" aria-hidden /></Link>
      </TooltipTrigger><TooltipContent side="right" className="max-w-xs"><p className="font-medium">{gapLabel}</p><ul className="mt-1 space-y-1">{readiness.missingItems.map(item => <li key={item.key}>{item.label}</li>)}</ul></TooltipContent></Tooltip>}
    </div>
    {open && <ul id={"settings-nav-" + section.id} className="ml-5 mt-1 space-y-0.5 border-l pl-2">
      {links.map(link => <li key={link.href}><Link href={link.href} aria-current={isSettingsLinkActive(pathname, link.href) ? "page" : undefined} className={linkClass(isSettingsLinkActive(pathname, link.href))}>
        <span className="min-w-0 flex-1">{link.label}</span>{link.href === "/messages" && unreadMessages > 0 && <span className="rounded-full bg-foreground px-1.5 text-xs text-background">{unreadMessages > 9 ? "9+" : unreadMessages}</span>}
      </Link></li>)}
    </ul>}
  </div>;
}

export function SidebarAdminNav({ collapsed, unreadMessages, isDemoUser = false }: SidebarAdminNavProps) {
  const pathname = usePathname();
  const profile = useDeploymentProfile();
  const dynamicStudiesEnabled = useModuleEnabled("dynamic-studies");
  const facilityEnabled = useModuleEnabled("sequencing-management");
  const sections = getSettingsSections({ dynamicStudiesEnabled, centerAccounts: profile.id === "sequencing-center" });
  const [readiness, setReadiness] = useState<InfrastructureReadiness | null>(null);

  useEffect(() => {
    if (isDemoUser) return;
    let mounted = true;
    const load = async () => {
      try {
        const response = await fetch("/api/admin/infrastructure/readiness");
        if (!response.ok) throw new Error("Could not check infrastructure");
        const data = await response.json();
        if (mounted) setReadiness({ requiredMissing: data.requiredMissing ?? [], recommendedMissing: data.recommendedMissing ?? [], firstMissingHref: data.firstMissingHref || "/admin/data-compute", missingItems: data.missingItems ?? [] });
      } catch {
        if (mounted) setReadiness(null);
      }
    };
    void load();
    const stop = startVisiblePolling(() => void load(), 120000);
    return () => { mounted = false; stop(); };
  }, [isDemoUser]);

  return <nav aria-label="Application settings" className="space-y-1">
    {!collapsed && <p className="px-3 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Application settings</p>}
    <Link href="/admin/settings" aria-label="Settings overview" aria-current={pathname === "/admin/settings" ? "page" : undefined} title={collapsed ? "Settings overview" : undefined} className={cn(linkClass(pathname === "/admin/settings"), collapsed && "justify-center px-0 py-2.5")}><Settings className={collapsed ? "size-5" : "size-4"} aria-hidden />{!collapsed && "Overview"}</Link>
    <Link href="/admin/onboarding" aria-label="Setup checklist" aria-current={pathname === "/admin/onboarding" ? "page" : undefined} title={collapsed ? "Setup checklist" : undefined} className={cn(linkClass(pathname === "/admin/onboarding"), collapsed && "justify-center px-0 py-2.5")}><ClipboardCheck className={collapsed ? "size-5" : "size-4"} aria-hidden />{!collapsed && "Setup checklist"}</Link>
    <div className="my-3 border-t" />
    {sections.filter(section => !section.moduleId || facilityEnabled || section.links.some(link => isSettingsLinkActive(pathname, link.href))).map(section => <SettingsNavGroup key={section.id} section={section} pathname={pathname} collapsed={collapsed} unreadMessages={unreadMessages} readiness={section.id === "storage" && !isDemoUser ? readiness : null} />)}
  </nav>;
}
