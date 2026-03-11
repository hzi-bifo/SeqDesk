"use client";

import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import {
  LogOut,
  Inbox,
  Settings,
  ChevronUp,
  ChevronRight,
  ArrowLeft,
  PanelLeftClose,
  HelpCircle,
  Lightbulb,
  X,
  MessageSquare,
  BookOpen,
  Shield,
  Users,
  Building2,
  UserCog,
  FileEdit,
  FlaskConical,
  Cpu,
  Database,
  HardDrive,
  Play,
  Send,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect, useRef } from "react";
import { signOut } from "next-auth/react";
import { useSidebar } from "./SidebarContext";
import { useFieldHelp } from "@/lib/contexts/FieldHelpContext";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StudySelector } from "./StudySelector";
import { OrderSelector } from "./OrderSelector";

interface SidebarProps {
  user: {
    name?: string | null;
    email?: string | null;
    role?: string;
    isDemo?: boolean;
    demoExperience?: "researcher" | "facility";
  };
  version?: string;
}

interface CurrentStudySidebarSummary {
  id: string;
  title: string;
  submitted: boolean;
  readyForSubmission: boolean;
}

interface CurrentOrderSidebarSummary {
  id: string;
  name: string;
  status: string;
}

type SidebarStudySection =
  | "overview"
  | "samples"
  | "reads"
  | "analysis"
  | "archive"
  | "notes";

const SIDEBAR_STUDY_SECTION_ALIASES: Record<string, SidebarStudySection> = {
  pipelines: "analysis",
  ena: "archive",
};

function normalizeSidebarStudySection(value: string | null): SidebarStudySection {
  if (!value) return "overview";
  if (value in SIDEBAR_STUDY_SECTION_ALIASES) {
    return SIDEBAR_STUDY_SECTION_ALIASES[value];
  }

  switch (value) {
    case "samples":
    case "reads":
    case "analysis":
    case "archive":
    case "notes":
      return value;
    default:
      return "overview";
  }
}

type SidebarTab = "studies" | "orders";

export function Sidebar({ user, version }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { collapsed, toggle, mobileOpen, setMobileOpen } = useSidebar();
  const { focusedField, setFocusedField, validationError } = useFieldHelp();
  const isFacilityAdmin = user.role === "FACILITY_ADMIN";
  const isDemoUser = user.isDemo === true;
  const isFacilityDemoUser = user.demoExperience === "facility";
  const showAdminControls = isFacilityAdmin && !isFacilityDemoUser;
  const userRoleLabel = isFacilityDemoUser
    ? "Facility Demo"
    : isFacilityAdmin
      ? "Facility Admin"
      : isDemoUser
        ? "Researcher Demo"
        : "Researcher";

  // Derive active tab from URL
  const activeTab: SidebarTab = pathname.startsWith("/orders") ? "orders" : "studies";

  // Study context from URL
  const studyDetailMatch = pathname.match(/^\/studies\/([^/]+)$/);
  const currentStudyId = studyDetailMatch?.[1] ?? null;
  const currentStudySection = normalizeSidebarStudySection(searchParams.get("section"));

  // Order context from URL
  const orderDetailMatch = pathname.match(/^\/orders\/([^/]+)(?:\/(files|studies))?$/);
  const rawOrderId = orderDetailMatch?.[1] ?? null;
  const currentOrderId = rawOrderId && rawOrderId !== "new" ? rawOrderId : null;
  const currentOrderSubview = orderDetailMatch?.[2] ?? null;
  const currentOrderSection = searchParams.get("section") === "reads" ? "reads" : "overview";

  // Study section items (no Overview - the StudySelector itself serves as the overview entry point)
  const studySectionItems: Array<{
    key: SidebarStudySection;
    label: string;
    show: boolean;
  }> = [
    { key: "samples", label: "Samples", show: true },
    { key: "reads", label: "Read Files", show: !isDemoUser },
    { key: "analysis", label: "Analysis", show: isFacilityAdmin && !isDemoUser },
    { key: "archive", label: "Archive", show: !isDemoUser },
    { key: "notes", label: "Notes", show: true },
  ];

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
  const [currentStudySummary, setCurrentStudySummary] = useState<CurrentStudySidebarSummary | null>(null);
  const [currentOrderSummary, setCurrentOrderSummary] = useState<CurrentOrderSidebarSummary | null>(null);

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
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, []);

  // Fetch current study summary
  useEffect(() => {
    if (!currentStudyId) {
      setCurrentStudySummary(null);
      return;
    }

    let mounted = true;
    const fetchCurrentStudySummary = async () => {
      try {
        const res = await fetch(`/api/studies/${currentStudyId}`);
        if (!res.ok) throw new Error("Failed to load current study");
        const data = await res.json();
        if (!mounted) return;
        setCurrentStudySummary({
          id: data.id,
          title: data.title,
          submitted: Boolean(data.submitted),
          readyForSubmission: Boolean(data.readyForSubmission),
        });
      } catch {
        if (!mounted) return;
        setCurrentStudySummary(null);
      }
    };

    void fetchCurrentStudySummary();
    return () => { mounted = false; };
  }, [currentStudyId]);

  // Fetch current order summary
  useEffect(() => {
    if (!currentOrderId) {
      setCurrentOrderSummary(null);
      return;
    }

    let mounted = true;
    const fetchCurrentOrderSummary = async () => {
      try {
        const res = await fetch(`/api/orders/${currentOrderId}`);
        if (!res.ok) throw new Error("Failed to load current order");
        const data = await res.json();
        if (!mounted) return;
        setCurrentOrderSummary({
          id: data.id,
          name: data.name,
          status: data.status,
        });
      } catch {
        if (!mounted) return;
        setCurrentOrderSummary(null);
      }
    };

    void fetchCurrentOrderSummary();
    return () => { mounted = false; };
  }, [currentOrderId]);

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
    const interval = setInterval(fetchCounts, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleSignOut = async () => {
    await signOut({ redirect: false });
    window.location.href = "/login";
  };

  // Close mobile sidebar on navigation
  useEffect(() => {
    setMobileOpen((isOpen) => (isOpen ? false : isOpen));
  }, [pathname, setMobileOpen]);

  const navIconClass = collapsed ? "h-5 w-5 shrink-0" : "h-4 w-4 shrink-0";

  // Admin sidebar mode
  const isAdminPage = pathname.startsWith("/admin") || pathname.startsWith("/messages");
  const showAdminSidebar = isAdminPage && showAdminControls;

  const adminNavItems: Array<{
    label: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
    groupHeader?: string;
  }> = [
    { label: "Researchers", href: "/admin/users", icon: Users, groupHeader: "People" },
    { label: "Departments", href: "/admin/departments", icon: Building2 },
    { label: "Admin Accounts", href: "/admin/admin-accounts", icon: UserCog },
    { label: "Order Form", href: "/admin/form-builder", icon: FileEdit, groupHeader: "Forms" },
    { label: "Study Form", href: "/admin/study-form-builder", icon: FlaskConical },
    { label: "Sequencing Tech", href: "/admin/sequencing-tech", icon: Cpu, groupHeader: "Infrastructure" },
    { label: "Modules", href: "/admin/modules", icon: Wrench },
    { label: "Data & Compute", href: "/admin/data-compute", icon: Database },
    { label: "Data Storage", href: "/admin/data-storage", icon: HardDrive },
    { label: "Pipeline Runtime", href: "/admin/pipeline-runtime", icon: Play },
    { label: "ENA Settings", href: "/admin/ena", icon: Send, groupHeader: "Settings" },
    { label: "Site Settings", href: "/admin/settings", icon: Settings },
    { label: "Support", href: "/messages", icon: MessageSquare, groupHeader: "Communication" },
  ];

  const studySectionHref = (section: SidebarStudySection) => {
    if (!currentStudyId) return "/studies";
    return section === "overview"
      ? `/studies/${currentStudyId}`
      : `/studies/${currentStudyId}?section=${section}`;
  };

  const handleTabClick = (tab: SidebarTab) => {
    if (tab === activeTab) return;
    router.push(tab === "studies" ? "/studies" : "/orders");
  };

  return (
    <aside
      className={cn(
        "fixed top-0 left-0 bottom-0 bg-card border-r border-border flex flex-col z-40 transition-all duration-300",
        collapsed ? "w-16" : "w-64",
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
              <Link href="/studies" className="flex items-center gap-2.5">
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

      {/* ── Admin Sidebar Mode ── */}
      {showAdminSidebar ? (
        <>
          {/* Back to App button */}
          <div className={cn("px-3 pb-2", collapsed && "px-2")}>
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href="/orders"
                    className="flex items-center justify-center p-1.5 rounded-md text-muted-foreground hover:bg-secondary/50 hover:text-foreground transition-colors"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>Back to App</TooltipContent>
              </Tooltip>
            ) : (
              <Link
                href="/orders"
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:bg-secondary/50 hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to App
              </Link>
            )}
          </div>

          {/* Admin nav */}
          <nav className={cn("flex-1 p-3 space-y-0.5 overflow-y-auto", collapsed && "px-2")}>
            {adminNavItems.map((item) => {
              const isActive = pathname === item.href || (item.href !== "/messages" && pathname.startsWith(item.href + "/"));

              return (
                <div key={item.href}>
                  {item.groupHeader && !collapsed && (
                    <div className="mt-3 mb-1 px-3 first:mt-0">
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        {item.groupHeader}
                      </p>
                    </div>
                  )}
                  {item.groupHeader && collapsed && (
                    <div className="mx-1 my-1.5">
                      <div className="h-px bg-border" />
                    </div>
                  )}
                  {collapsed ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Link
                          href={item.href}
                          className={cn(
                            "flex items-center justify-center py-2 rounded-lg transition-colors text-sm",
                            isActive
                              ? "bg-secondary text-foreground font-medium"
                              : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                          )}
                        >
                          <item.icon className={navIconClass} />
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={8}>
                        {item.label}
                        {item.label === "Support" && unreadMessages > 0 && ` (${unreadMessages})`}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 px-3 py-1.5 rounded-lg transition-colors text-sm",
                        isActive
                          ? "bg-secondary text-foreground font-medium"
                          : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                      )}
                    >
                      <item.icon className={navIconClass} />
                      <span className="flex-1">{item.label}</span>
                      {item.label === "Support" && unreadMessages > 0 && (
                        <span className="flex items-center justify-center text-xs font-medium text-white bg-foreground rounded-full h-5 min-w-5 px-1.5">
                          {unreadMessages > 9 ? "9+" : unreadMessages}
                        </span>
                      )}
                    </Link>
                  )}
                </div>
              );
            })}
          </nav>
        </>
      ) : (
        <>
          {/* Tab Switcher */}
          {collapsed ? (
            <div className="flex gap-1 px-2 pb-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => handleTabClick("orders")}
                    className={cn(
                      "flex-1 flex items-center justify-center p-1.5 rounded-md transition-colors",
                      activeTab === "orders"
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                    )}
                  >
                    <Inbox className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>Orders</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => handleTabClick("studies")}
                    className={cn(
                      "flex-1 flex items-center justify-center p-1.5 rounded-md transition-colors",
                      activeTab === "studies"
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                    )}
                  >
                    <BookOpen className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>Studies</TooltipContent>
              </Tooltip>
            </div>
          ) : (
            <div className="px-3 pb-2">
              <div className="flex bg-secondary/50 rounded-lg p-0.5">
                <button
                  onClick={() => handleTabClick("orders")}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                    activeTab === "orders"
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Inbox className="h-3.5 w-3.5" />
                  Orders
                  {counts.orders > 0 && (
                    <span className="flex items-center justify-center text-[10px] font-medium text-muted-foreground bg-secondary rounded-full h-4 min-w-4 px-1">
                      {counts.orders > 99 ? "99+" : counts.orders}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => handleTabClick("studies")}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                    activeTab === "studies"
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  Studies
                </button>
              </div>
            </div>
          )}

          {/* ── Studies Tab ── */}
          {activeTab === "studies" && (
            <>
              <StudySelector
                currentStudyId={currentStudyId}
                currentStudyTitle={currentStudySummary?.title}
                variant="sidebar"
                collapsed={collapsed}
              />

              <nav className={cn("flex-1 p-3 space-y-1 overflow-y-auto", collapsed && "px-2")}>
                {studySectionItems
                  .filter((item) => item.show)
                  .map((item) => {
                    const sectionHref = currentStudyId
                      ? studySectionHref(item.key)
                      : undefined;
                    const isActiveSection = currentStudyId && currentStudySection === item.key;
                    const isDisabled = !currentStudyId;

                    if (isDisabled) {
                      const disabledItem = (
                        <span
                          key={item.key}
                          className={cn(
                            "flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm text-muted-foreground/40 cursor-default",
                            collapsed && "justify-center px-0 py-2"
                          )}
                          title={collapsed ? item.label : undefined}
                        >
                          {!collapsed && <span className="flex-1">{item.label}</span>}
                        </span>
                      );

                      if (collapsed) {
                        return (
                          <Tooltip key={item.key}>
                            <TooltipTrigger asChild>{disabledItem}</TooltipTrigger>
                            <TooltipContent side="right" sideOffset={8}>
                              {item.label}
                            </TooltipContent>
                          </Tooltip>
                        );
                      }

                      return disabledItem;
                    }

                    const link = (
                      <Link
                        key={item.key}
                        href={sectionHref || "/studies"}
                        className={cn(
                          "flex items-center gap-3 px-3 py-1.5 rounded-lg transition-colors text-sm",
                          collapsed && "justify-center px-0 py-2",
                          isActiveSection
                            ? "bg-secondary text-foreground font-medium"
                            : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                        )}
                        title={collapsed ? item.label : undefined}
                      >
                        {!collapsed && <span className="flex-1">{item.label}</span>}
                      </Link>
                    );

                    if (collapsed) {
                      return (
                        <Tooltip key={item.key}>
                          <TooltipTrigger asChild>{link}</TooltipTrigger>
                          <TooltipContent side="right" sideOffset={8}>
                            {item.label}
                          </TooltipContent>
                        </Tooltip>
                      );
                    }

                    return link;
                  })}

                {/* Field Help Panel */}
                {focusedField && !collapsed && <FieldHelpPanel focusedField={focusedField} setFocusedField={setFocusedField} validationError={validationError} />}
              </nav>
            </>
          )}

          {/* ── Orders Tab ── */}
          {activeTab === "orders" && (
            <>
              <OrderSelector
                currentOrderId={currentOrderId}
                currentOrderName={currentOrderSummary?.name}
                collapsed={collapsed}
              />

              <nav className={cn("flex-1 p-3 space-y-1 overflow-y-auto", collapsed && "px-2")}>
                {/* Order section navigation - always visible, disabled when no order selected */}
                {(() => {
                  const orderSectionItems = [
                    { label: "Order Details", href: currentOrderId ? `/orders/${currentOrderId}` : undefined, active: !!currentOrderId && !currentOrderSubview && currentOrderSection === "overview", show: true },
                    { label: "Read Files", href: currentOrderId ? `/orders/${currentOrderId}?section=reads` : undefined, active: !!currentOrderId && !currentOrderSubview && currentOrderSection === "reads", show: !isDemoUser },
                    { label: "Manage Files", href: currentOrderId ? `/orders/${currentOrderId}/files` : undefined, active: !!currentOrderId && currentOrderSubview === "files", show: showAdminControls && !isDemoUser },
                  ];

                  return orderSectionItems.filter(s => s.show).map((section) => {
                    const isDisabled = !currentOrderId;

                    if (isDisabled) {
                      const disabledItem = (
                        <span
                          key={section.label}
                          className={cn(
                            "flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm text-muted-foreground/40 cursor-default",
                            collapsed && "justify-center px-0 py-2"
                          )}
                          title={collapsed ? section.label : undefined}
                        >
                          {!collapsed && <span className="flex-1">{section.label}</span>}
                        </span>
                      );

                      if (collapsed) {
                        return (
                          <Tooltip key={section.label}>
                            <TooltipTrigger asChild>{disabledItem}</TooltipTrigger>
                            <TooltipContent side="right" sideOffset={8}>
                              {section.label}
                            </TooltipContent>
                          </Tooltip>
                        );
                      }

                      return disabledItem;
                    }

                    const link = (
                      <Link
                        key={section.label}
                        href={section.href || "/orders"}
                        className={cn(
                          "flex items-center gap-3 px-3 py-1.5 rounded-lg transition-colors text-sm",
                          collapsed && "justify-center px-0 py-2",
                          section.active
                            ? "bg-secondary text-foreground font-medium"
                            : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                        )}
                        title={collapsed ? section.label : undefined}
                      >
                        {!collapsed && <span className="flex-1">{section.label}</span>}
                      </Link>
                    );

                    if (collapsed) {
                      return (
                        <Tooltip key={section.label}>
                          <TooltipTrigger asChild>{link}</TooltipTrigger>
                          <TooltipContent side="right" sideOffset={8}>
                            {section.label}
                          </TooltipContent>
                        </Tooltip>
                      );
                    }

                    return link;
                  });
                })()}

                {/* Field Help Panel */}
                {focusedField && !collapsed && <FieldHelpPanel focusedField={focusedField} setFocusedField={setFocusedField} validationError={validationError} />}
              </nav>
            </>
          )}

          {/* Support section at bottom - Researchers only */}
          {!isFacilityAdmin && !isDemoUser && (
            <div className={cn("px-3 pb-2", collapsed && "px-2")}>
              <div className={cn("mb-2", collapsed ? "mx-1" : "mx-3")}>
                <div className="h-px bg-border" />
              </div>
              {!collapsed && (
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2 px-3">
                  Support
                </p>
              )}
              <div className="space-y-1">
                <Link
                  href="/help"
                  className={cn(
                    "flex items-center gap-3 px-3 py-1.5 rounded-lg transition-colors text-sm",
                    collapsed && "justify-center px-0 py-2",
                    pathname.startsWith("/help")
                      ? "bg-secondary text-foreground font-medium"
                      : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                  )}
                  title="Help"
                >
                  <HelpCircle className={navIconClass} />
                  {!collapsed && "Help & Guide"}
                </Link>
                <Link
                  href="/messages"
                  className={cn(
                    "flex items-center gap-3 px-3 py-1.5 rounded-lg transition-colors text-sm",
                    collapsed && "justify-center px-0 py-2",
                    pathname.startsWith("/messages")
                      ? "bg-secondary text-foreground font-medium"
                      : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                  )}
                  title="Support"
                >
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

          {/* Administration button - Facility admins only */}
          {showAdminControls && (
            <div className={cn("px-3 pb-2", collapsed && "px-2")}>
              <div className={cn("mb-2", collapsed ? "mx-1" : "mx-3")}>
                <div className="h-px bg-border" />
              </div>
              {collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href="/admin/users"
                      className="flex items-center justify-center py-2 rounded-lg text-sm text-muted-foreground hover:bg-secondary/50 hover:text-foreground transition-colors"
                    >
                      <Shield className={navIconClass} />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>Administration</TooltipContent>
                </Tooltip>
              ) : (
                <Link
                  href="/admin/users"
                  className="flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:bg-secondary/50 hover:text-foreground transition-colors"
                >
                  <Shield className={navIconClass} />
                  <span className="flex-1">Administration</span>
                  <ChevronRight className="h-4 w-4" />
                </Link>
              )}
            </div>
          )}
        </>
      )}

      {/* User Menu */}
      <div className={cn("p-4 border-t border-border relative", collapsed && "p-2")} ref={userMenuRef}>
        {/* User menu dropdown - expanded */}
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
            {showAdminControls && !showAdminSidebar && (
              <Link
                href="/admin/users"
                onClick={() => setUserMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-secondary transition-colors"
              >
                <Shield className="h-4 w-4" />
                Administration
              </Link>
            )}
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
                {userRoleLabel}
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
            {showAdminControls && !showAdminSidebar && (
              <Link
                href="/admin/users"
                onClick={() => setUserMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-secondary transition-colors"
              >
                <Shield className="h-4 w-4" />
                Administration
              </Link>
            )}
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
                  {userRoleLabel}
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

/* ─── Field Help Panel (extracted to keep main component readable) ─── */

interface FieldHelpPanelProps {
  focusedField: ReturnType<typeof useFieldHelp>["focusedField"];
  setFocusedField: ReturnType<typeof useFieldHelp>["setFocusedField"];
  validationError: ReturnType<typeof useFieldHelp>["validationError"];
}

function FieldHelpPanel({ focusedField, setFocusedField, validationError }: FieldHelpPanelProps) {
  if (!focusedField) return null;

  return (
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
          {focusedField.units && Array.isArray(focusedField.units) && focusedField.units.length > 0 && (
            <p className="text-xs text-muted-foreground/70 mt-1">
              Unit: {focusedField.units.map((u: { label: string }) => u.label).join(', ')}
            </p>
          )}
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
              const hasMinMax = v.minLength || v.maxLength || v.minValue !== undefined || v.maxValue !== undefined;
              const isPatternMessageUseful = v.patternMessage &&
                !v.patternMessage.startsWith('Must match pattern:') &&
                !v.patternMessage.includes('^[') &&
                !v.patternMessage.includes('\\d') &&
                !v.patternMessage.includes('\\w');
              const hasPattern = !!v.pattern;

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

              if (!hasMinMax && !isPatternMessageUseful && !patternDescription) {
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
  );
}
