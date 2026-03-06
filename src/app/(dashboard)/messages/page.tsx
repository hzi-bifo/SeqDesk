"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/PageContainer";
import { HelpBox } from "@/components/ui/help-box";
import {
  MessageSquare,
  Plus,
  Loader2,
  ChevronRight,
  Search,
  ArrowUpDown,
  ChevronDown,
  X,
} from "lucide-react";
import { ErrorBanner } from "@/components/ui/error-banner";

interface Ticket {
  id: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  hasUnread: boolean;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  order: {
    id: string;
    orderNumber: string;
    name: string | null;
  } | null;
  study: {
    id: string;
    title: string;
  } | null;
  _count: {
    messages: number;
  };
}

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  OPEN: { label: "Open", color: "text-blue-600", dot: "bg-blue-500" },
  IN_PROGRESS: { label: "In Progress", color: "text-amber-600", dot: "bg-amber-500" },
  RESOLVED: { label: "Resolved", color: "text-emerald-600", dot: "bg-emerald-500" },
  CLOSED: { label: "Closed", color: "text-stone-600", dot: "bg-stone-400" },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  LOW: { label: "Low", color: "text-stone-500" },
  NORMAL: { label: "Normal", color: "text-blue-600" },
  HIGH: { label: "High", color: "text-orange-600" },
  URGENT: { label: "Urgent", color: "text-red-600" },
};

const STATUS_ORDER = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];

type SortField = "updated" | "subject" | "status" | "messages" | "priority";
type SortDirection = "asc" | "desc";

const PRIORITY_ORDER = ["LOW", "NORMAL", "HIGH", "URGENT"];

export default function MessagesPage() {
  const { data: session } = useSession();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [sortField, setSortField] = useState<SortField>("updated");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const isAdmin = session?.user?.role === "FACILITY_ADMIN";

  useEffect(() => {
    const fetchTickets = async () => {
      try {
        const res = await fetch("/api/tickets");
        if (!res.ok) throw new Error("Failed to fetch tickets");
        const data = await res.json();
        setTickets(data);
      } catch {
        setError("Failed to load messages");
      } finally {
        setLoading(false);
      }
    };

    fetchTickets();
  }, []);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatTimeAgo = (dateString: string) => {
    const now = new Date();
    const date = new Date(dateString);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    const diffWeeks = Math.floor(diffDays / 7);
    const diffMonths = Math.floor(diffDays / 30);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffWeeks < 5) return `${diffWeeks}w ago`;
    return `${diffMonths}mo ago`;
  };

  const filteredTickets = useMemo(() => {
    const result = tickets.filter((ticket) => {
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          ticket.subject.toLowerCase().includes(query) ||
          ticket.order?.orderNumber.toLowerCase().includes(query) ||
          ticket.order?.name?.toLowerCase().includes(query) ||
          ticket.study?.title.toLowerCase().includes(query) ||
          ticket.user.firstName.toLowerCase().includes(query) ||
          ticket.user.lastName.toLowerCase().includes(query) ||
          ticket.user.email.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }

      if (statusFilter && ticket.status !== statusFilter) return false;

      return true;
    });

    result.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "updated":
          comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
          break;
        case "subject":
          comparison = a.subject.localeCompare(b.subject);
          break;
        case "status":
          comparison = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
          break;
        case "messages":
          comparison = a._count.messages - b._count.messages;
          break;
        case "priority":
          comparison = PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
          break;
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });

    return result;
  }, [tickets, searchQuery, statusFilter, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("");
  };

  const hasActiveFilters = searchQuery || statusFilter;

  const unreadCount = tickets.filter((t) => t.hasUnread).length;

  if (loading) {
    return (
      <PageContainer className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">
            {isAdmin ? "Support Tickets" : "Messages"}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {tickets.length} {tickets.length === 1 ? "conversation" : "conversations"}
            {unreadCount > 0 && (
              <span className="text-primary font-medium"> · {unreadCount} unread</span>
            )}
          </p>
        </div>
        {!isAdmin && (
          <Button size="sm" variant="outline" asChild>
            <Link href="/messages/new">
              <Plus className="h-4 w-4 mr-1.5" />
              New Message
            </Link>
          </Button>
        )}
      </div>

      <HelpBox title="What are messages?">
        Use messages to contact the sequencing center with questions or requests.
        Your messages will be sent to the sequencing center, and their answers will appear here in the conversation.
      </HelpBox>

      {error && <ErrorBanner message={error} />}

      {tickets.length === 0 ? (
        <div className="bg-card rounded-xl p-12 text-center border border-border">
          <MessageSquare className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-30" />
          <h2 className="text-lg font-medium mb-2">No messages yet</h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            {isAdmin
              ? "No support tickets have been submitted yet."
              : "Have a question or need help? Send us a message and we'll get back to you."}
          </p>
          {!isAdmin && (
            <Button size="sm" variant="outline" asChild>
              <Link href="/messages/new">
                <Plus className="h-4 w-4 mr-1.5" />
                Send a Message
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="bg-card rounded-xl overflow-hidden border border-border">
          {/* Search & Filters */}
          <div className="px-4 py-3 border-b border-border">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              {/* Search */}
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search messages..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm bg-secondary border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="flex items-center gap-2 sm:gap-3">
                {/* Status Filter */}
                <div className="relative flex-1 sm:flex-none">
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="w-full sm:w-auto appearance-none pl-3 pr-8 py-2 text-sm bg-secondary border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                  >
                    <option value="">All Status</option>
                    {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                      <option key={key} value={key}>{config.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>

                {/* Clear Filters */}
                {hasActiveFilters && (
                  <button
                    onClick={clearFilters}
                    className="flex items-center gap-1 px-2 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  >
                    <X className="h-3 w-3" />
                    Clear
                  </button>
                )}
              </div>

              {/* Mobile sort controls */}
              <div className="flex items-center gap-2 md:hidden">
                <select
                  value={sortField}
                  onChange={(e) => setSortField(e.target.value as SortField)}
                  className="flex-1 appearance-none pl-3 pr-8 py-2 text-sm bg-secondary border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                >
                  <option value="updated">Sort: Updated</option>
                  <option value="subject">Sort: Subject</option>
                  <option value="status">Sort: Status</option>
                  <option value="messages">Sort: Messages</option>
                  <option value="priority">Sort: Priority</option>
                </select>
                <button
                  onClick={() => setSortDirection(sortDirection === "asc" ? "desc" : "asc")}
                  className="px-3 py-2 text-xs bg-secondary rounded-lg border border-border hover:bg-secondary/80 transition-colors shrink-0"
                >
                  {sortDirection === "asc" ? "Asc" : "Desc"}
                </button>
              </div>
            </div>
          </div>

          {/* Table Header - hidden on mobile */}
          <div className={`hidden md:grid ${isAdmin ? "grid-cols-12" : "grid-cols-12"} gap-4 px-5 py-2.5 border-b border-border bg-secondary/50 text-xs font-medium text-muted-foreground`}>
            <button
              onClick={() => handleSort("subject")}
              className={`${isAdmin ? "col-span-4" : "col-span-5"} flex items-center gap-1 hover:text-foreground transition-colors text-left`}
            >
              Subject
              {sortField === "subject" && (
                <ArrowUpDown className="h-3 w-3" />
              )}
            </button>
            <button
              onClick={() => handleSort("status")}
              className="col-span-2 flex items-center gap-1 hover:text-foreground transition-colors text-left"
            >
              Status
              {sortField === "status" && (
                <ArrowUpDown className="h-3 w-3" />
              )}
            </button>
            {isAdmin && <div className="col-span-2">User</div>}
            <button
              onClick={() => handleSort("messages")}
              className="col-span-1 flex items-center gap-1 hover:text-foreground transition-colors justify-end"
            >
              {sortField === "messages" && (
                <ArrowUpDown className="h-3 w-3" />
              )}
              Msgs
            </button>
            <button
              onClick={() => handleSort("priority")}
              className={`${isAdmin ? "col-span-1" : "col-span-1"} flex items-center gap-1 hover:text-foreground transition-colors text-left`}
            >
              Priority
              {sortField === "priority" && (
                <ArrowUpDown className="h-3 w-3" />
              )}
            </button>
            <button
              onClick={() => handleSort("updated")}
              className={`${isAdmin ? "col-span-1" : "col-span-2"} flex items-center gap-1 hover:text-foreground transition-colors text-left`}
            >
              Updated
              {sortField === "updated" && (
                <ArrowUpDown className="h-3 w-3" />
              )}
            </button>
            <div className="col-span-1"></div>
          </div>

          {/* Tickets List */}
          <div className="divide-y divide-border">
            {filteredTickets.map((ticket) => {
              const statusConfig = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.OPEN;
              const priorityConfig = PRIORITY_CONFIG[ticket.priority] || PRIORITY_CONFIG.NORMAL;

              return (
                <Link
                  key={ticket.id}
                  href={`/messages/${ticket.id}`}
                  className="block px-4 py-3 hover:bg-secondary/80 transition-colors group md:grid md:grid-cols-12 md:gap-4 md:px-5 md:py-4 md:items-center"
                >
                  {/* Mobile layout */}
                  <div className="md:hidden">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {ticket.hasUnread && (
                            <span className="block h-2 w-2 rounded-full bg-primary shrink-0" />
                          )}
                          <p className={`font-medium text-sm truncate group-hover:text-primary transition-colors ${ticket.hasUnread ? "font-semibold" : ""}`}>
                            {ticket.subject}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {ticket._count.messages} {ticket._count.messages === 1 ? "message" : "messages"} · {formatDate(ticket.updatedAt)}
                          {isAdmin && ` · ${ticket.user.firstName} ${ticket.user.lastName}`}
                        </p>
                        {(ticket.order || ticket.study) && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {ticket.order && `Order: ${ticket.order.orderNumber}`}
                            {ticket.order && ticket.study && " · "}
                            {ticket.study && `Study: ${ticket.study.title}`}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`h-2 w-2 rounded-full ${statusConfig.dot}`} />
                        <div className="text-right">
                          <span className={`text-xs font-medium ${statusConfig.color}`}>
                            {statusConfig.label}
                          </span>
                          <p className="text-[10px] text-muted-foreground">
                            {formatTimeAgo(ticket.updatedAt)}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
                      </div>
                    </div>
                  </div>

                  {/* Desktop layout */}
                  <div className="hidden md:contents">
                    {/* Subject */}
                    <div className={`${isAdmin ? "col-span-4" : "col-span-5"} min-w-0 flex items-center gap-2`}>
                      <div className="w-2 shrink-0">
                        {ticket.hasUnread && (
                          <span className="block h-2 w-2 rounded-full bg-primary" />
                        )}
                      </div>
                      <p className={`font-medium text-sm truncate group-hover:text-primary transition-colors ${ticket.hasUnread ? "font-semibold" : ""}`}>
                        {ticket.subject}
                      </p>
                    </div>

                    {/* Status */}
                    <div className="col-span-2">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${statusConfig.dot}`} />
                        <span className={`text-xs font-medium ${statusConfig.color}`}>
                          {statusConfig.label}
                        </span>
                      </div>
                    </div>

                    {/* User (Admin only) */}
                    {isAdmin && (
                      <div className="col-span-2 min-w-0">
                        <p className="text-sm truncate">
                          {ticket.user.firstName} {ticket.user.lastName}
                        </p>
                      </div>
                    )}

                    {/* Messages count */}
                    <div className="col-span-1 text-right">
                      <span className="text-sm text-muted-foreground tabular-nums">
                        {ticket._count.messages}
                      </span>
                    </div>

                    {/* Priority */}
                    <div className={`${isAdmin ? "col-span-1" : "col-span-1"}`}>
                      <span className={`text-xs font-medium ${priorityConfig.color}`}>
                        {priorityConfig.label}
                      </span>
                    </div>

                    {/* Updated */}
                    <div className={isAdmin ? "col-span-1" : "col-span-2"}>
                      <span className="text-sm text-muted-foreground tabular-nums">
                        {formatTimeAgo(ticket.updatedAt)}
                      </span>
                    </div>

                    {/* Arrow */}
                    <div className="col-span-1 flex justify-end">
                      <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          {filteredTickets.length === 0 && hasActiveFilters && (
            <div className="py-12 text-center text-muted-foreground">
              <p className="text-sm">No messages match your filters</p>
              <button
                onClick={clearFilters}
                className="mt-2 text-sm text-primary hover:underline"
              >
                Clear all filters
              </button>
            </div>
          )}
        </div>
      )}
    </PageContainer>
  );
}
