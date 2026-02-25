"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LogOut,
  FileText,
  BookOpen,
  Settings,
  Users,
  ChevronDown,
  ChevronUp,
  PanelLeftClose,
  Plus,
  HelpCircle,
  Lightbulb,
  X,
  MessageSquare,
  HardDrive,
  Send,
  FlaskConical,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect, useRef } from "react";
import { useModule } from "@/lib/modules";
import { signOut } from "next-auth/react";
import { useSidebar } from "./SidebarContext";
import { useFieldHelp } from "@/lib/contexts/FieldHelpContext";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface SidebarProps {
  user: {
    name?: string | null;
    email?: string | null;
    role?: string;
  };
  version?: string;
}

export function Sidebar({ user, version }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { collapsed, toggle, mobileOpen, setMobileOpen } = useSidebar();
  const { focusedField, setFocusedField, validationError } = useFieldHelp();
  const isFacilityAdmin = user.role === "FACILITY_ADMIN";
  const { enabled: sequencingTechEnabled } = useModule("sequencing-tech");
  const isAccountsPage = (path: string) =>
    path.startsWith("/admin/users") ||
    path.startsWith("/admin/departments") ||
    path.startsWith("/messages");

  // Helper to check if on a Configuration page (not users/departments which are top-level)
  const isConfigPage = (path: string) =>
    path.startsWith("/admin") &&
    !path.startsWith("/admin/users") &&
    !path.startsWith("/admin/departments");
  // Expand Configuration section if we're on a config page
  const [adminExpanded, setAdminExpanded] = useState(isConfigPage(pathname));
  const [accountsExpanded, setAccountsExpanded] = useState(isAccountsPage(pathname));
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [counts, setCounts] = useState<{
    orders: number;
    studies: number;
    files: number;
    submissions: number;
    analysis: number;
  }>({ orders: 0, studies: 0, files: 0, submissions: 0, analysis: 0 });
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

  // Close user menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fetch unread message count
  useEffect(() => {
    const fetchUnreadCount = async () => {
      try {
        const res = await fetch("/api/tickets/unread");
        if (res.ok) {
          const data = await res.json();
          setUnreadMessages(data.count);
        }
      } catch {
        // Silently fail - not critical
      }
    };

    fetchUnreadCount();
    // Poll every 30 seconds for new messages
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, []);

  // Fetch sidebar counts
  useEffect(() => {
    const fetchCounts = async () => {
      try {
        const res = await fetch("/api/sidebar/counts");
        if (res.ok) {
          const data = await res.json();
          setCounts(data);
        }
      } catch {
        // Silently fail - not critical
      }
    };

    fetchCounts();
    // Refresh counts every 60 seconds
    const interval = setInterval(fetchCounts, 60000);
    return () => clearInterval(interval);
  }, []);

  // Fetch infrastructure readiness for sidebar guidance
  useEffect(() => {
    if (!isFacilityAdmin) return;

    let mounted = true;

    const fetchInfrastructureReadiness = async () => {
      try {
        const res = await fetch("/api/admin/infrastructure/readiness");
        if (!res.ok) {
          throw new Error("Failed to load readiness");
        }
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
        setInfrastructureReadiness((prev) => ({
          ...prev,
          loading: false,
        }));
      }
    };

    void fetchInfrastructureReadiness();
    const interval = setInterval(fetchInfrastructureReadiness, 120000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [isFacilityAdmin]);

  const handleSignOut = async () => {
    await signOut({ redirect: false });
    window.location.href = "/login";
  };

  // Update expansion state when pathname changes
  useEffect(() => {
    if (isConfigPage(pathname)) {
      setAdminExpanded(true);
    }
    if (isAccountsPage(pathname)) {
      setAccountsExpanded(true);
    }
    // Close mobile sidebar on navigation, but avoid no-op updates.
    setMobileOpen((isOpen) => (isOpen ? false : isOpen));
  }, [pathname, setMobileOpen]);

  const isActive = (path: string) => {
    if (path === "/admin" && pathname === "/admin") return true;
    if (path !== "/admin" && pathname.startsWith(path)) return true;
    return false;
  };

  const navItemClass = (path: string) =>
    cn(
      "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm",
      collapsed && "justify-center px-0 py-2.5",
      isActive(path)
        ? "bg-secondary text-foreground font-medium"
        : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
    );

  // Larger icons when collapsed to fill the wider space
  const navIconClass = collapsed ? "h-5 w-5 shrink-0" : "h-4 w-4 shrink-0";

  const adminSubItemClass = (path: string, exact = false) =>
    cn(
      "block px-3 py-1.5 rounded-lg transition-colors text-sm",
      collapsed ? "ml-0 text-center" : "ml-7",
      (exact ? pathname === path : isActive(path))
        ? "bg-secondary text-foreground font-medium"
        : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
    );
  const hasRequiredInfrastructureGaps =
    infrastructureReadiness.requiredMissingCount > 0;
  const hasRecommendedInfrastructureGaps =
    !hasRequiredInfrastructureGaps &&
    infrastructureReadiness.recommendedMissingCount > 0;

  return (
    <aside
      className={cn(
        "fixed top-0 left-0 bottom-0 bg-card border-r border-border flex flex-col z-40 transition-all duration-300",
        collapsed ? "w-16" : "w-64",
        // Mobile: hidden by default, shown as overlay when mobileOpen
        mobileOpen ? "translate-x-0" : "-translate-x-full",
        "md:translate-x-0"
      )}
    >
      {/* Header */}
      <div className={cn("p-3", collapsed && "px-2")}>
        <div className="flex items-center justify-between">
          {collapsed ? (
            <button
              onClick={toggle}
              className="flex items-center justify-center w-full py-0.5"
              title="Expand sidebar"
            >
              <span className="inline-flex items-center justify-center h-8 w-8 bg-foreground text-background text-sm font-semibold rounded-md">
                S
              </span>
            </button>
          ) : (
            <>
              <Link href="/orders" className="flex items-center gap-2.5">
                <span className="inline-flex items-center px-2.5 py-1 bg-foreground text-background text-sm font-semibold rounded-md">
                  SeqDesk
                </span>
                {version && (
                  <span className="text-[10px] leading-none text-muted-foreground font-geist-pixel">
                    v{version}
                  </span>
                )}
              </Link>
              <button
                onClick={toggle}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                title="Collapse sidebar"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>

      <nav className={cn("flex-1 p-3 space-y-1 overflow-y-auto", collapsed && "px-2")}>
        {/* Core workflow items */}
        <Link href="/orders" className={navItemClass("/orders")} title="Orders">
          <FileText className={navIconClass} />
          {!collapsed && "Orders"}
          {!collapsed && counts.orders > 0 && (
            <span className="flex items-center justify-center text-xs font-medium text-muted-foreground bg-secondary rounded-full ml-auto h-5 min-w-5 px-1.5">
              {counts.orders > 99 ? "99+" : counts.orders}
            </span>
          )}
        </Link>
        <Link href="/studies" className={navItemClass("/studies")} title="Studies">
          <BookOpen className={navIconClass} />
          {!collapsed && "Studies"}
          {!collapsed && counts.studies > 0 && (
            <span className="flex items-center justify-center text-xs font-medium text-muted-foreground bg-secondary rounded-full ml-auto h-5 min-w-5 px-1.5">
              {counts.studies > 99 ? "99+" : counts.studies}
            </span>
          )}
        </Link>
        {/* Sequencing Files - Admin only */}
        {isFacilityAdmin && (
          <Link href="/files" className={navItemClass("/files")} title="Sequencing Files">
            <HardDrive className={navIconClass} />
            {!collapsed && "Files"}
            {!collapsed && counts.files > 0 && (
              <span className="flex items-center justify-center text-xs font-medium text-muted-foreground bg-secondary rounded-full ml-auto h-5 min-w-5 px-1.5">
                {counts.files > 99 ? "99+" : counts.files}
              </span>
            )}
          </Link>
        )}

        {/* ENA Submissions - Admin only */}
        {isFacilityAdmin && (
          <Link href="/submissions" className={navItemClass("/submissions")} title="ENA Submissions">
            <Send className={navIconClass} />
            {!collapsed && "ENA Submissions"}
            {!collapsed && counts.submissions > 0 && (
              <span className="flex items-center justify-center text-xs font-medium text-muted-foreground bg-secondary rounded-full ml-auto h-5 min-w-5 px-1.5">
                {counts.submissions > 99 ? "99+" : counts.submissions}
              </span>
            )}
          </Link>
        )}

        {/* Analysis */}
        <Link href="/analysis" className={navItemClass("/analysis")} title="Analysis">
          <FlaskConical className={navIconClass} />
          {!collapsed && "Analysis"}
          {!collapsed && counts.analysis > 0 && (
            <span
              className="flex items-center justify-center text-xs font-medium text-muted-foreground bg-secondary rounded-full ml-auto h-5 min-w-5 px-1.5"
            >
              {counts.analysis > 99 ? "99+" : counts.analysis}
            </span>
          )}
        </Link>
        {/* Field Help Panel - show when a field is focused */}
        {focusedField && !collapsed && (
          <div className="mt-6 mb-6">
            <div className="relative p-3 rounded-lg overflow-hidden" style={{
              background: 'linear-gradient(135deg, rgba(247, 247, 244, 0.9) 0%, rgba(239, 239, 233, 0.95) 50%, rgba(247, 247, 244, 0.9) 100%)',
              border: '1px solid #e5e5e0'
            }}>
              <div className="relative z-10">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-5 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #171717 0%, #525252 100%)' }}>
                      <Lightbulb className="h-3 w-3 text-white" />
                    </div>
                    <span className="text-xs font-semibold text-foreground tracking-wide">
                      Field Help
                    </span>
                  </div>
                  <button
                    onClick={() => setFocusedField(null)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              <p className="text-sm font-medium text-foreground mb-1">
                {focusedField.label}
                {focusedField.required && <span className="text-red-500 ml-1">*</span>}
              </p>
              {validationError && (
                <div className="mb-2 p-2 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                  <p className="text-xs font-medium text-red-600 dark:text-red-400">
                    {validationError}
                  </p>
                </div>
              )}
              {focusedField.helpText && (
                <p className="text-xs text-muted-foreground mb-2">
                  {focusedField.helpText}
                </p>
              )}
              {(focusedField.placeholder || focusedField.example) && (
                <p className="text-xs text-muted-foreground/70">
                  Example: {focusedField.placeholder || focusedField.example}
                </p>
              )}
              {/* Units for MIxS fields */}
              {focusedField.units && Array.isArray(focusedField.units) && focusedField.units.length > 0 && (
                <p className="text-xs text-muted-foreground/70 mt-1">
                  Unit: {focusedField.units.map((u: { label: string }) => u.label).join(', ')}
                </p>
              )}
              {/* Options for select fields */}
              {focusedField.type === 'select' && focusedField.options && focusedField.options.length > 0 && focusedField.options.length <= 10 && (
                <div className="mt-2">
                  <p className="text-xs text-muted-foreground font-medium mb-1">Options:</p>
                  <ul className="text-xs text-muted-foreground/70 space-y-0.5">
                    {focusedField.options.map((opt: { value: string; label: string }) => (
                      <li key={opt.value}>{opt.label}</li>
                    ))}
                  </ul>
                </div>
              )}
              {focusedField.type === 'select' && focusedField.options && focusedField.options.length > 10 && (
                <p className="text-xs text-muted-foreground/70 mt-1">
                  {focusedField.options.length} options available
                </p>
              )}
              {focusedField.simpleValidation && (
                (() => {
                  const v = focusedField.simpleValidation;
                  // Check if we have any meaningful validation info to show
                  const hasMinMax = v.minLength || v.maxLength || v.minValue !== undefined || v.maxValue !== undefined;
                  // Check if patternMessage is just "Must match pattern:" followed by regex (not helpful)
                  const isPatternMessageUseful = v.patternMessage &&
                    !v.patternMessage.startsWith('Must match pattern:') &&
                    !v.patternMessage.includes('^[') &&
                    !v.patternMessage.includes('\\d') &&
                    !v.patternMessage.includes('\\w');
                  const hasPattern = !!v.pattern;

                  // Try to detect pattern type and provide friendly description
                  let patternDescription = '';
                  if (hasPattern && v.pattern) {
                    if (v.pattern.includes('ISO8601') || v.pattern.includes('[12][0-9]{3}')) {
                      patternDescription = 'ISO 8601 date format (e.g., 2024-01-15 or 2024-01)';
                    } else if (v.pattern.includes('@') || v.pattern.includes('email')) {
                      patternDescription = 'Email address format';
                    } else if (v.pattern.includes('http') || v.pattern.includes('url')) {
                      patternDescription = 'URL format (http:// or https://)';
                    } else if (v.pattern.includes('not collected') || v.pattern.includes('not provided')) {
                      patternDescription = 'Accepts standard missing value terms';
                    } else if (v.pattern.match(/^\^?\[0-9\]/) || v.pattern.includes('[Ee][+-]')) {
                      patternDescription = 'Numeric value (decimal allowed)';
                    }
                  }

                  // Only show Format section if there's something useful
                  if (!hasMinMax && !isPatternMessageUseful && !patternDescription) {
                    // Still show that validation exists
                    if (hasPattern) {
                      return (
                        <div className="mt-2 pt-2 border-t border-border">
                          <p className="text-xs text-muted-foreground font-medium mb-1">Validation:</p>
                          <p className="text-xs text-muted-foreground/70">
                            Input will be validated on entry
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }

                  return (
                    <div className="mt-2 pt-2 border-t border-border">
                      <p className="text-[10px] text-muted-foreground font-medium mb-1 font-geist-pixel">Format:</p>
                      <ul className="text-[10px] text-muted-foreground/70 space-y-0.5 font-geist-pixel">
                        {v.minLength && (
                          <li>Min length: {v.minLength} characters</li>
                        )}
                        {v.maxLength && (
                          <li>Max length: {v.maxLength} characters</li>
                        )}
                        {v.minValue !== undefined && (
                          <li>Min value: {v.minValue}</li>
                        )}
                        {v.maxValue !== undefined && (
                          <li>Max value: {v.maxValue}</li>
                        )}
                        {isPatternMessageUseful && (
                          <li>{v.patternMessage}</li>
                        )}
                        {patternDescription && (
                          <li>{patternDescription}</li>
                        )}
                      </ul>
                    </div>
                  );
                })()
              )}
              {focusedField.perSample && (
                <div className="mt-2 pt-2 border-t border-border">
                  <span className="text-xs bg-secondary text-muted-foreground px-1.5 py-0.5 rounded">
                    Per-Sample Field
                  </span>
                </div>
              )}
              </div>
            </div>
          </div>
        )}

        {/* Users and support - Admin only */}
        {isFacilityAdmin && (
          <>
            {/* Section separator */}
            <div className={cn("my-2", collapsed ? "mx-1" : "mx-3")}>
              <div className="h-px bg-border" />
            </div>
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
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform duration-200",
                      accountsExpanded && "rotate-180"
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

            {/* Settings menu - below Users */}
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
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform duration-200",
                      adminExpanded && "rotate-180"
                    )}
                  />
                </button>

                {/* Settings sub-items */}
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
                      (hasRequiredInfrastructureGaps ||
                        hasRecommendedInfrastructureGaps) && (
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
                          <TooltipContent
                            side="right"
                            align="start"
                            sideOffset={8}
                            className="max-w-xs text-left"
                          >
                            <div className="space-y-2">
                              <p className="font-medium">
                                {hasRequiredInfrastructureGaps
                                  ? `${infrastructureReadiness.requiredMissingCount} required setting${
                                      infrastructureReadiness.requiredMissingCount ===
                                      1
                                        ? ""
                                        : "s"
                                    } missing`
                                  : `${infrastructureReadiness.recommendedMissingCount} recommended setting${
                                      infrastructureReadiness.recommendedMissingCount ===
                                      1
                                        ? ""
                                        : "s"
                                    } pending`}
                              </p>
                              <ul className="space-y-1">
                                {infrastructureReadiness.missingItems.map((item) => (
                                  <li key={item.key} className="flex items-center gap-1.5">
                                    <span
                                      className={cn(
                                        "h-1.5 w-1.5 rounded-full",
                                        item.severity === "required"
                                          ? "bg-red-300"
                                          : "bg-amber-300"
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
        )}
      </nav>

      {/* Support section at bottom - Researchers only */}
      {!isFacilityAdmin && (
        <div className={cn("px-3 pb-2", collapsed && "px-2")}>
          {/* Section separator */}
          <div className={cn("mb-2", collapsed ? "mx-1" : "mx-3")}>
            <div className="h-px bg-border" />
          </div>
          {!collapsed && (
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2 px-3">
              Support
            </p>
          )}
          <div className="space-y-1">
            <Link href="/help" className={navItemClass("/help")} title="Help">
              <HelpCircle className={navIconClass} />
              {!collapsed && "Help & Guide"}
            </Link>
            <Link href="/messages" className={navItemClass("/messages")} title="Support">
              <MessageSquare className={navIconClass} />
              {!collapsed && "Support"}
              {!collapsed && unreadMessages > 0 && (
                <span className="flex items-center justify-center text-xs font-medium text-white bg-foreground rounded-full ml-auto h-5 min-w-5 px-1.5">
                  {unreadMessages > 9 ? "9+" : unreadMessages}
                </span>
              )}
            </Link>
          </div>
        </div>
      )}

      {/* New Order Button - hide on admin config pages */}
      {!isConfigPage(pathname) && (
        <div className={cn("px-3 pb-3", collapsed && "px-2")}>
          <Link
            href="/orders/new"
            className={cn(
              "flex items-center justify-center gap-2 w-full py-2.5 rounded-lg font-medium text-sm transition-colors",
              "border border-border text-foreground hover:bg-secondary"
            )}
            title="Create new order"
          >
            <Plus className={navIconClass} />
            {!collapsed && "New Order"}
          </Link>
        </div>
      )}

      {/* User Menu */}
      <div className={cn("p-4 border-t border-border relative", collapsed && "p-2")} ref={userMenuRef}>
        {/* User menu dropdown */}
        {userMenuOpen && !collapsed && (
          <div className="absolute bottom-full left-4 right-4 mb-2 bg-card border border-border rounded-xl shadow-lg overflow-hidden">
            <Link
              href="/settings"
              onClick={() => setUserMenuOpen(false)}
              className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-secondary transition-colors"
            >
              <Settings className="h-4 w-4" />
              Account Settings
            </Link>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors w-full text-left text-red-600"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        )}

        {/* User menu dropdown - collapsed */}
        {collapsed && userMenuOpen && (
          <div className="absolute bottom-full left-2 right-2 mb-2 bg-card border border-border rounded-xl shadow-lg overflow-hidden w-48">
            <div className="px-4 py-2 border-b border-border">
              <p className="text-sm font-medium truncate">{user.name}</p>
              <p className="text-xs text-muted-foreground">
                {isFacilityAdmin ? "Facility Admin" : "Researcher"}
              </p>
            </div>
            <Link
              href="/settings"
              onClick={() => setUserMenuOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-secondary transition-colors"
            >
              <Settings className="h-4 w-4" />
              Account Settings
            </Link>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors w-full text-left text-red-600"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        )}

        <button
          onClick={() => setUserMenuOpen(!userMenuOpen)}
          className={cn(
            "flex items-center gap-3 w-full rounded-xl p-2 hover:bg-secondary transition-colors",
            collapsed && "justify-center p-1.5"
          )}
          title={collapsed ? (user.name || "User") : undefined}
        >
          <div className={cn(
            "rounded-full flex items-center justify-center text-sm font-medium bg-foreground text-background shrink-0",
            collapsed ? "h-8 w-8" : "h-9 w-9"
          )}>
            {user.name?.charAt(0) || "U"}
          </div>
          {!collapsed && (
            <>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-sm font-medium truncate">{user.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {isFacilityAdmin ? "Facility Admin" : "Researcher"}
                </p>
              </div>
              <ChevronUp
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform shrink-0",
                  userMenuOpen && "rotate-180"
                )}
              />
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
