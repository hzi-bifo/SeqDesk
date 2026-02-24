"use client";

import { useState, useEffect, useRef, use } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/ui/glass-card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Send,
  Loader2,
  MessageSquare,
  Circle,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  User,
  Shield,
} from "lucide-react";
import { toast } from "sonner";

interface Message {
  id: string;
  content: string;
  createdAt: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    role: string;
  };
}

interface Ticket {
  id: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  messages: Message[];
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string; icon: React.ElementType }> = {
  OPEN: { label: "Open", color: "text-blue-600", bgColor: "bg-blue-100", icon: Circle },
  IN_PROGRESS: { label: "In Progress", color: "text-amber-600", bgColor: "bg-amber-100", icon: Clock },
  RESOLVED: { label: "Resolved", color: "text-emerald-600", bgColor: "bg-emerald-100", icon: CheckCircle2 },
  CLOSED: { label: "Closed", color: "text-stone-600", bgColor: "bg-stone-100", icon: XCircle },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  LOW: { label: "Low", color: "text-stone-500" },
  NORMAL: { label: "Normal", color: "text-blue-600" },
  HIGH: { label: "High", color: "text-orange-600" },
  URGENT: { label: "Urgent", color: "text-red-600" },
};

export default function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: session } = useSession();
  const router = useRouter();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState("");
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const isAdmin = session?.user?.role === "FACILITY_ADMIN";

  useEffect(() => {
    const fetchTicket = async () => {
      try {
        const res = await fetch(`/api/tickets/${id}`);
        if (!res.ok) {
          if (res.status === 404) {
            toast.error("Ticket not found");
            router.push("/messages");
            return;
          }
          throw new Error("Failed to fetch ticket");
        }
        const data = await res.json();
        setTicket(data);
      } catch {
        toast.error("Failed to load ticket");
      } finally {
        setLoading(false);
      }
    };

    fetchTicket();
  }, [id, router]);

  useEffect(() => {
    // Scroll to bottom when messages change
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [ticket?.messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newMessage.trim() || !ticket) return;

    setSending(true);

    try {
      const res = await fetch(`/api/tickets/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newMessage }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to send message");
      }

      const message = await res.json();
      setTicket({
        ...ticket,
        messages: [...ticket.messages, message],
        status: isAdmin && ticket.status === "OPEN" ? "IN_PROGRESS" : ticket.status,
      });
      setNewMessage("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const handleStatusChange = async () => {
    if (!selectedStatus || !ticket) return;

    setUpdatingStatus(true);

    try {
      const res = await fetch(`/api/tickets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: selectedStatus }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update status");
      }

      const updatedTicket = await res.json();
      setTicket({ ...ticket, ...updatedTicket });
      setStatusDialogOpen(false);
      toast.success(`Ticket marked as ${STATUS_CONFIG[selectedStatus]?.label}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update status");
    } finally {
      setUpdatingStatus(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <PageContainer className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </PageContainer>
    );
  }

  if (!ticket) {
    return null;
  }

  const status = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.OPEN;
  const priority = PRIORITY_CONFIG[ticket.priority] || PRIORITY_CONFIG.NORMAL;
  const StatusIcon = status.icon;
  const isClosed = ticket.status === "CLOSED";

  return (
    <PageContainer>
      {/* Back link */}
      <Link
        href="/messages"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Messages
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <MessageSquare className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{ticket.subject}</h1>
            <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
              {isAdmin && (
                <>
                  <span>From {ticket.user.firstName} {ticket.user.lastName}</span>
                  <span>·</span>
                </>
              )}
              <span>{formatDate(ticket.createdAt)}</span>
              {ticket.priority !== "NORMAL" && (
                <>
                  <span>·</span>
                  <span className={priority.color}>
                    {ticket.priority === "URGENT" && <AlertTriangle className="h-3 w-3 inline mr-0.5" />}
                    {priority.label} Priority
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Status badge and actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setSelectedStatus(ticket.status);
              setStatusDialogOpen(true);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${status.bgColor} ${status.color} hover:opacity-80 transition-opacity`}
          >
            <StatusIcon className="h-3.5 w-3.5" />
            {status.label}
          </button>
        </div>
      </div>

      {/* Messages */}
      <GlassCard className="mb-4 overflow-hidden">
        <div className="max-h-[500px] overflow-y-auto p-4 space-y-4">
          {ticket.messages.map((message) => {
            const isFromAdmin = message.user.role === "FACILITY_ADMIN";
            const isFromCurrentUser = message.user.id === session?.user?.id;

            return (
              <div
                key={message.id}
                className={`flex gap-3 ${isFromCurrentUser ? "flex-row-reverse" : ""}`}
              >
                {/* Avatar */}
                <div
                  className={`h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    isFromAdmin ? "bg-primary/10" : "bg-stone-100"
                  }`}
                >
                  {isFromAdmin ? (
                    <Shield className="h-4 w-4 text-primary" />
                  ) : (
                    <User className="h-4 w-4 text-stone-500" />
                  )}
                </div>

                {/* Message bubble */}
                <div className={`max-w-[75%] ${isFromCurrentUser ? "text-right" : ""}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-medium ${isFromAdmin ? "text-primary" : "text-stone-600"}`}>
                      {isFromCurrentUser ? "You" : `${message.user.firstName} ${message.user.lastName}`}
                      {isFromAdmin && !isFromCurrentUser && " (Staff)"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(message.createdAt)}
                    </span>
                  </div>
                  <div
                    className={`inline-block px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap ${
                      isFromCurrentUser
                        ? "bg-primary text-primary-foreground rounded-tr-sm"
                        : "bg-stone-100 text-foreground rounded-tl-sm"
                    }`}
                  >
                    {message.content}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      </GlassCard>

      {/* Reply form */}
      {isClosed ? (
        <div className="bg-stone-100 rounded-xl p-4 text-center text-sm text-muted-foreground">
          This conversation is closed. You cannot send new messages.
        </div>
      ) : (
        <form onSubmit={handleSendMessage} className="flex gap-3">
          <Textarea
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type your message..."
            rows={2}
            disabled={sending}
            className="flex-1 resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage(e);
              }
            }}
          />
          <Button type="submit" disabled={sending || !newMessage.trim()} className="self-end">
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </form>
      )}

      {/* Status change dialog */}
      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Status</DialogTitle>
            <DialogDescription>
              Update the status of this conversation
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-2 py-4">
            {Object.entries(STATUS_CONFIG).map(([key, config]) => {
              const Icon = config.icon;
              // Users can only close, admins can do anything
              const canSelect = isAdmin || key === "CLOSED";
              return (
                <button
                  key={key}
                  onClick={() => canSelect && setSelectedStatus(key)}
                  disabled={!canSelect}
                  className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-colors ${
                    selectedStatus === key
                      ? "border-primary bg-primary/5"
                      : canSelect
                      ? "border-transparent bg-stone-50 hover:bg-stone-100"
                      : "border-transparent bg-stone-50 opacity-50 cursor-not-allowed"
                  }`}
                >
                  <Icon className={`h-4 w-4 ${config.color}`} />
                  <span className="text-sm font-medium">{config.label}</span>
                </button>
              );
            })}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleStatusChange}
              disabled={updatingStatus || selectedStatus === ticket.status}
            >
              {updatingStatus ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                "Update Status"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
