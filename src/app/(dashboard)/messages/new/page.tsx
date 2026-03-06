"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/ui/glass-card";
import {
  ArrowLeft,
  Send,
  Loader2,
  MessageSquare,
} from "lucide-react";
import { toast } from "sonner";

interface OrderOption {
  id: string;
  orderNumber: string;
  name: string | null;
}

interface StudyOption {
  id: string;
  title: string;
}

type ReferenceValue = "none" | `order:${string}` | `study:${string}`;

interface ReferenceOptionsResponse {
  enabled: boolean;
  orders: OrderOption[];
  studies: StudyOption[];
}

export default function NewMessagePage() {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [studies, setStudies] = useState<StudyOption[]>([]);
  const [reference, setReference] = useState<ReferenceValue>("none");
  const [referencesEnabled, setReferencesEnabled] = useState(false);
  const [loadingReferences, setLoadingReferences] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const fetchReferences = async () => {
      try {
        const res = await fetch("/api/tickets/reference-options");
        if (!res.ok) {
          throw new Error("Failed to fetch references");
        }

        const data = (await res.json()) as ReferenceOptionsResponse;
        setReferencesEnabled(data.enabled);
        setOrders(data.orders || []);
        setStudies(data.studies || []);
      } catch {
        toast.error("Failed to load related orders and studies");
      } finally {
        setLoadingReferences(false);
      }
    };

    fetchReferences();
  }, []);

  const referenceOptions = useMemo(
    () => [
      { value: "none" as const, label: "No reference" },
      ...orders.map((order) => ({
        value: `order:${order.id}` as const,
        label: `Order: ${order.orderNumber}${order.name ? ` · ${order.name}` : ""}`,
      })),
      ...studies.map((study) => ({
        value: `study:${study.id}` as const,
        label: `Study: ${study.title}`,
      })),
    ],
    [orders, studies]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!subject.trim() || !message.trim()) {
      toast.error("Please fill in all fields");
      return;
    }

    setSubmitting(true);

    try {
      const orderId = reference.startsWith("order:") ? reference.slice("order:".length) : undefined;
      const studyId = reference.startsWith("study:") ? reference.slice("study:".length) : undefined;

      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, message, priority, orderId, studyId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to send message");
      }

      const ticket = await res.json();
      toast.success("Message sent successfully");
      router.push(`/messages/${ticket.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send message");
    } finally {
      setSubmitting(false);
    }
  };

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
      <div className="flex items-center gap-3 mb-6">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <MessageSquare className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">New Message</h1>
          <p className="text-sm text-muted-foreground">
            Send a message to the sequencing facility
          </p>
        </div>
      </div>

      <GlassCard className="p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Subject */}
          <div className="space-y-2">
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief summary of your question or issue"
              disabled={submitting}
            />
          </div>

          {/* Priority */}
          <div className="space-y-2">
            <Label>Priority</Label>
            <div className="flex items-center gap-2">
              {[
                { value: "LOW", label: "Low" },
                { value: "NORMAL", label: "Normal" },
                { value: "HIGH", label: "High" },
                { value: "URGENT", label: "Urgent" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setPriority(opt.value)}
                  disabled={submitting}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    priority === opt.value
                      ? opt.value === "URGENT"
                        ? "bg-red-100 text-red-700"
                        : opt.value === "HIGH"
                        ? "bg-orange-100 text-orange-700"
                        : "bg-primary text-primary-foreground"
                      : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Use High or Urgent only for time-sensitive issues
            </p>
          </div>

          {referencesEnabled && (
            <div className="space-y-2">
              <Label htmlFor="reference">Related order or study</Label>
              <Select
                value={reference}
                onValueChange={(value) => setReference(value as ReferenceValue)}
                disabled={submitting || loadingReferences}
              >
                <SelectTrigger id="reference">
                  <SelectValue placeholder="Select an order or study (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {referenceOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Optional. Link this conversation to a specific order or study.
              </p>
            </div>
          )}

          {/* Message */}
          <div className="space-y-2">
            <Label htmlFor="message">Message</Label>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe your question, issue, or request in detail..."
              rows={8}
              disabled={submitting}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push("/messages")}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !subject.trim() || !message.trim()}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send Message
                </>
              )}
            </Button>
          </div>
        </form>
      </GlassCard>
    </PageContainer>
  );
}
