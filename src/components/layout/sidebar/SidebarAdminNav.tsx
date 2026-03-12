"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import {
  Users,
  Settings,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useModule } from "@/lib/modules";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface SidebarAdminNavProps {
  collapsed: boolean;
  unreadMessages: number;
}

export function SidebarAdminNav({ collapsed, unreadMessages }: SidebarAdminNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { enabled: sequencingTechEnabled } = useModule("sequencing-tech");

  const isAccountsPage = (path: string) =>
    path.startsWith("/admin/users") ||
    path.startsWith("/admin/departments") ||
    path.startsWith("/messages");

  const isConfigPage = (path: string) =>
    path.startsWith("/admin") &&
    !path.startsWith("/admin/users") &&
    !path.startsWith("/admin/departments");

  const [adminExpanded, setAdminExpanded] = useState(isConfigPage(pathname));
  const [accountsExpanded, setAccountsExpanded] = useState(isAccountsPage(pathname));
  const [infrastructureReadiness, setInfrastructureReadiness] = useState<{
    loading: boolean;
    ready: boolean;
    requiredMissingCount: number;
    recommendedMissingCount: number;
    firstMissingHref: string;
    missingItems: Array<{
      key: string;
      label: string;
      href: string;
      severity: "required" | "recommended";
    }>;
  }>({
    loading: true,
    ready: true,
    requiredMissingCount: 0,
    recommendedMissingCount: 0,
    firstMissingHref: "/admin/data-compute",
    missingItems: [],
  });

  useEffect(() => {
    if (isConfigPage(pathname)) {
      setAdminExpanded(true);
    }
    if (isAccountsPage(pathname)) {
      setAccountsExpanded(true);
    }
  }, [pathname]);

  // Fetch infrastructure readiness
  useEffect(() => {
    let mounted = true;

    const fetchInfrastructureReadiness = async () => {
      try {
        const res = await fetch("/api/admin/infrastructure/readiness");
        if (!res.ok) throw new Error("Failed to load readiness");
        const data = (await res.json()) as {
          ready?: boolean;
          requiredMissing?: string[];
          recommendedMissing?: string[];
          firstMissingHref?: string;
          missingItems?: Array<{
            key: string;
            label: string;
            href: string;
            severity: "required" | "recommended";
          }>;
        };
        if (!mounted) return;
        setInfrastructureReadiness({
          loading: false,
          ready: Boolean(data.ready),
          requiredMissingCount: data.requiredMissing?.length || 0,
          recommendedMissingCount: data.recommendedMissing?.length || 0,
          firstMissingHref: data.firstMissingHref || "/admin/data-compute",
          missingItems: data.missingItems || [],
        });
      } catch {
        if (!mounted) return;
        setInfrastructureReadiness((prev) => ({ ...prev, loading: false }));
      }
    };

    void fetchInfrastructureReadiness();
    const interval = setInterval(fetchInfrastructureReadiness, 120000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const isActive = (path: string) => {
    if (path === "/admin" && pathname === "/admin") return true;
    if (path !== "/admin" && pathname.startsWith(path)) return true;
    return false;
  };

  const navIconClass = collapsed ? "h-5 w-5 shrink-0" : "h-4 w-4 shrink-0";

  const navItemClass = (path: string) =>
    cn(
      "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm",
      collapsed && "justify-center px-0 py-2.5",
      isActive(path)
        ? "bg-secondary text-foreground font-medium"
        : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
    );

  const adminSubItemClass = (path: string, exact = false) =>
    cn(
      "block px-3 py-1.5 rounded-lg transition-colors text-sm",
      collapsed ? "ml-0 text-center" : "ml-7",
      (exact ? pathname === path : isActive(path))
        ? "bg-secondary text-foreground font-medium"
        : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
    );

  const hasRequiredInfrastructureGaps = infrastructureReadiness.requiredMissingCount > 0;
  const hasRecommendedInfrastructureGaps =
    !hasRequiredInfrastructureGaps && infrastructureReadiness.recommendedMissingCount > 0;

  return (
    <>
      {/* Users section */}
      {collapsed ? (
        <Link href="/admin/users" className={navItemClass("/admin/users")} title="Users">
          <Users className={navIconClass} />
        </Link>
      ) : (
        <>
          <button
            onClick={() => setAccountsExpanded(!accountsExpanded)}
            className={cn(
              "flex items-center justify-between w-full px-3 py-2 rounded-lg transition-colors text-sm",
              isAccountsPage(pathname)
                ? "bg-secondary text-foreground font-medium"
                : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
            )}
          >
            <span className="flex items-center gap-3">
              <Users className="h-4 w-4" />
              Users
            </span>
            <ChevronRight
              className={cn(
                "h-4 w-4 transition-transform duration-200",
                accountsExpanded && "rotate-90"
              )}
            />
          </button>

          <div
            className={cn(
              "overflow-hidden transition-all duration-200",
              accountsExpanded ? "max-h-32 opacity-100 mt-1" : "max-h-0 opacity-0"
            )}
          >
            <Link href="/admin/users" className={adminSubItemClass("/admin/users")}>
              Researchers
            </Link>
            <Link href="/admin/departments" className={adminSubItemClass("/admin/departments")}>
              Departments
            </Link>
            <Link
              href="/messages"
              className={cn(
                adminSubItemClass("/messages"),
                "flex items-center justify-between gap-2"
              )}
            >
              <span>Support</span>
              {unreadMessages > 0 && (
                <span className="flex items-center justify-center text-xs font-medium text-white bg-foreground rounded-full h-5 min-w-5 px-1.5">
                  {unreadMessages > 9 ? "9+" : unreadMessages}
                </span>
              )}
            </Link>
          </div>
        </>
      )}

      {/* Settings section */}
      {collapsed ? (
        <Link href="/admin/form-builder" className={navItemClass("/admin/form-builder")} title="Settings">
          <Settings className={navIconClass} />
        </Link>
      ) : (
        <>
          <button
            onClick={() => setAdminExpanded(!adminExpanded)}
            className={cn(
              "flex items-center justify-between w-full px-3 py-2 rounded-lg transition-colors text-sm",
              pathname.startsWith("/admin") &&
                !pathname.startsWith("/admin/users") &&
                !pathname.startsWith("/admin/departments")
                ? "bg-secondary text-foreground font-medium"
                : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
            )}
          >
            <span className="flex items-center gap-3">
              <Settings className="h-4 w-4" />
              Settings
            </span>
            <ChevronRight
              className={cn(
                "h-4 w-4 transition-transform duration-200",
                adminExpanded && "rotate-90"
              )}
            />
          </button>

          <div
            className={cn(
              "overflow-hidden transition-all duration-200",
              adminExpanded ? "max-h-96 opacity-100 mt-1" : "max-h-0 opacity-0"
            )}
          >
            <Link href="/admin/form-builder" className={adminSubItemClass("/admin/form-builder")}>
              Order Form
            </Link>
            <Link href="/admin/study-form-builder" className={adminSubItemClass("/admin/study-form-builder")}>
              Study Forms
            </Link>
            <Link href="/admin/modules" className={adminSubItemClass("/admin/modules")}>
              Modules
            </Link>
            {sequencingTechEnabled && (
              <Link href="/admin/sequencing-tech" className={adminSubItemClass("/admin/sequencing-tech")}>
                Sequencers
              </Link>
            )}
            <Link
              href="/admin/data-compute"
              className={cn(
                adminSubItemClass("/admin/data-compute"),
                "flex items-center justify-between gap-2"
              )}
            >
              <span>Infrastructure</span>
              {!infrastructureReadiness.loading &&
                (hasRequiredInfrastructureGaps || hasRecommendedInfrastructureGaps) && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          router.push(infrastructureReadiness.firstMissingHref);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            event.stopPropagation();
                            router.push(infrastructureReadiness.firstMissingHref);
                          }
                        }}
                        className={cn(
                          "inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full text-[11px] font-semibold",
                          hasRequiredInfrastructureGaps
                            ? "bg-red-100 text-red-700"
                            : "bg-amber-100 text-amber-700"
                        )}
                        aria-label={
                          hasRequiredInfrastructureGaps
                            ? `${infrastructureReadiness.requiredMissingCount} required infrastructure settings missing`
                            : `${infrastructureReadiness.recommendedMissingCount} recommended infrastructure settings pending`
                        }
                      >
                        {hasRequiredInfrastructureGaps ? (
                          "!"
                        ) : (
                          <AlertTriangle className="h-3 w-3" />
                        )}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="right" align="start" sideOffset={8} className="max-w-xs text-left">
                      <div className="space-y-2">
                        <p className="font-medium">
                          {hasRequiredInfrastructureGaps
                            ? `${infrastructureReadiness.requiredMissingCount} required setting${
                                infrastructureReadiness.requiredMissingCount === 1 ? "" : "s"
                              } missing`
                            : `${infrastructureReadiness.recommendedMissingCount} recommended setting${
                                infrastructureReadiness.recommendedMissingCount === 1 ? "" : "s"
                              } pending`}
                        </p>
                        <ul className="space-y-1">
                          {infrastructureReadiness.missingItems.map((item) => (
                            <li key={item.key} className="flex items-center gap-1.5">
                              <span
                                className={cn(
                                  "h-1.5 w-1.5 rounded-full",
                                  item.severity === "required" ? "bg-red-300" : "bg-amber-300"
                                )}
                              />
                              <Link
                                href={item.href}
                                className="underline underline-offset-2 hover:opacity-90"
                              >
                                {item.label}
                              </Link>
                            </li>
                          ))}
                        </ul>
                        <p className="opacity-80">
                          Click the badge to jump to the first missing item.
                        </p>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                )}
            </Link>
            <Link href="/admin/admin-accounts" className={adminSubItemClass("/admin/admin-accounts")}>
              Accounts
            </Link>
            <Link href="/admin/ena" className={adminSubItemClass("/admin/ena")}>
              Data Upload
            </Link>
            <Link href="/admin/settings" className={adminSubItemClass("/admin/settings", true)}>
              Info
            </Link>
            <Link href="/admin/settings/pipelines" className={adminSubItemClass("/admin/settings/pipelines")}>
              Pipelines
            </Link>
          </div>
        </>
      )}
    </>
  );
}
