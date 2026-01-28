"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/PageContainer";
import {
  MessageSquare,
  Plus,
  Loader2,
  AlertCircle,
  ChevronRight,
  Circle,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";

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
  _count: {
    messages: number;
  };
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  OPEN: { label: "Open", color: "text-blue-600 bg-blue-100", icon: Circle },
  IN_PROGRESS: { label: "In Progress", color: "text-amber-600 bg-amber-100", icon: Clock },
  RESOLVED: { label: "Resolved", color: "text-emerald-600 bg-emerald-100", icon: CheckCircle2 },
  CLOSED: { label: "Closed", color: "text-stone-600 bg-stone-100", icon: XCircle },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  LOW: { label: "Low", color: "text-stone-500" },
  NORMAL: { label: "Normal", color: "text-blue-600" },
  HIGH: { label: "High", color: "text-orange-600" },
  URGENT: { label: "Urgent", color: "text-red-600" },
};

export default function MessagesPage() {
  const { data: session } = useSession();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

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
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffHours < 1) {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      return `${diffMins}m ago`;
    } else if (diffHours < 24) {
      return `${Math.floor(diffHours)}h ago`;
    } else if (diffDays < 7) {
      return `${Math.floor(diffDays)}d ago`;
    } else {
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    }
  };

  const filteredTickets = statusFilter === "all"
    ? tickets
    : tickets.filter((t) => t.status === statusFilter);

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
          <Button size="sm" asChild>
            <Link href="/dashboard/messages/new">
              <Plus className="h-4 w-4 mr-1.5" />
              New Message
            </Link>
          </Button>
        )}
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          {error}
        </div>
      )}

      {/* Status Filter */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setStatusFilter("all")}
          className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
            statusFilter === "all"
              ? "bg-primary text-primary-foreground"
              : "bg-stone-100 text-stone-600 hover:bg-stone-200"
          }`}
        >
          All
        </button>
        {Object.entries(STATUS_CONFIG).map(([key, config]) => (
          <button
            key={key}
            onClick={() => setStatusFilter(key)}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              statusFilter === key
                ? "bg-primary text-primary-foreground"
                : "bg-stone-100 text-stone-600 hover:bg-stone-200"
            }`}
          >
            {config.label}
          </button>
        ))}
      </div>

      {tickets.length === 0 ? (
        <div className="bg-white rounded-xl p-12 text-center">
          <MessageSquare className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-30" />
          <h2 className="text-lg font-medium mb-2">No messages yet</h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            {isAdmin
              ? "No support tickets have been submitted yet."
              : "Have a question or need help? Send us a message and we'll get back to you."}
          </p>
          {!isAdmin && (
            <Button size="sm" asChild>
              <Link href="/dashboard/messages/new">
                <Plus className="h-4 w-4 mr-1.5" />
                Send a Message
              </Link>
            </Button>
          )}
        </div>
      ) : filteredTickets.length === 0 ? (
        <div className="bg-white rounded-xl p-12 text-center">
          <MessageSquare className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-30" />
          <p className="text-sm text-muted-foreground">
            No {STATUS_CONFIG[statusFilter]?.label.toLowerCase()} tickets
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl overflow-hidden">
          <div className="divide-y divide-stone-100">
            {filteredTickets.map((ticket) => {
              const status = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.OPEN;
              const priority = PRIORITY_CONFIG[ticket.priority] || PRIORITY_CONFIG.NORMAL;
              const StatusIcon = status.icon;

              return (
                <Link
                  key={ticket.id}
                  href={`/dashboard/messages/${ticket.id}`}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-stone-50/80 transition-colors group"
                >
                  {/* Unread indicator */}
                  <div className="w-2 flex-shrink-0">
                    {ticket.hasUnread && (
                      <span className="block h-2 w-2 rounded-full bg-primary" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className={`font-medium text-sm truncate group-hover:text-primary transition-colors ${ticket.hasUnread ? "font-semibold" : ""}`}>
                        {ticket.subject}
                      </p>
                      {ticket.priority !== "NORMAL" && (
                        <span className={`text-xs ${priority.color}`}>
                          {ticket.priority === "URGENT" && <AlertTriangle className="h-3 w-3 inline mr-0.5" />}
                          {priority.label}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {isAdmin && (
                        <>
                          <span>{ticket.user.firstName} {ticket.user.lastName}</span>
                          <span>·</span>
                        </>
                      )}
                      <span>{ticket._count.messages} {ticket._count.messages === 1 ? "message" : "messages"}</span>
                      <span>·</span>
                      <span>{formatDate(ticket.updatedAt)}</span>
                    </div>
                  </div>

                  {/* Status badge */}
                  <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${status.color}`}>
                    <StatusIcon className="h-3 w-3" />
                    {status.label}
                  </div>

                  <ChevronRight className="h-4 w-4 text-stone-300 group-hover:text-stone-400 transition-colors" />
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </PageContainer>
  );
}
