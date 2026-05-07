"use client";

import { useEffect, useState } from "react";
import { Check, CheckCircle2, Loader2, Mail, Send, XCircle } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { GlassCard } from "@/components/ui/glass-card";
import { Label } from "@/components/ui/label";
import { ErrorBanner } from "@/components/ui/error-banner";

type NotificationSettings = {
  enabled: boolean;
  provider: "seqdesk-relay";
  relayUrl: string;
  hasRelayToken: boolean;
  events: {
    order: {
      submitted: boolean;
      statusChanged: boolean;
      samplesSent: boolean;
    };
    ticket: {
      created: boolean;
      reply: boolean;
    };
  };
  userDefaults: {
    orders: boolean;
    support: boolean;
  };
};

const EVENT_ROWS = [
  {
    key: "order.submitted",
    label: "Order submitted",
    description: "Confirm submissions to users and alert admins about new submitted orders.",
  },
  {
    key: "order.statusChanged",
    label: "Order status changed",
    description: "Notify users when a facility admin changes an order status.",
  },
  {
    key: "order.samplesSent",
    label: "Samples marked sent",
    description: "Notify admins when a researcher marks samples as sent.",
  },
  {
    key: "ticket.created",
    label: "Support ticket created",
    description: "Notify admins when a researcher opens a support request.",
  },
  {
    key: "ticket.reply",
    label: "Support ticket reply",
    description: "Notify the other side when a ticket receives a reply.",
  },
] as const;

export default function AdminNotificationSettingsPage() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testSent, setTestSent] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/settings/notifications");
      if (!response.ok) throw new Error("Failed to load notification settings");
      setSettings(await response.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notification settings");
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings() {
    if (!settings) return;
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const response = await fetch("/api/admin/settings/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: settings.enabled,
          events: settings.events,
          userDefaults: settings.userDefaults,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to save notification settings");
      setSettings(payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save notification settings");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setTestSent(false);
    setError("");
    try {
      const response = await fetch("/api/admin/settings/notifications/test", {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to send test notification");
      setTestSent(true);
      setTimeout(() => setTestSent(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send test notification");
    } finally {
      setTesting(false);
    }
  }

  function setEvent(path: (typeof EVENT_ROWS)[number]["key"], checked: boolean) {
    const [section, key] = path.split(".") as ["order" | "ticket", string];
    setSettings((current) =>
      current
        ? {
            ...current,
            events: {
              ...current.events,
              [section]: {
                ...current.events[section],
                [key]: checked,
              },
            },
          }
        : current
    );
  }

  if (loading) {
    return (
      <PageContainer>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading…</span>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="mb-6 flex items-start gap-3">
        <Mail className="h-6 w-6 text-primary mt-1" />
        <div>
          <h1 className="text-2xl font-semibold">Email Notifications</h1>
          <p className="text-sm text-muted-foreground">
            Configure the hosted SeqDesk notification relay and which events trigger emails.
          </p>
        </div>
      </div>

      <div className="mb-6 rounded-lg border border-border bg-secondary/40 p-4 text-sm text-muted-foreground space-y-2">
        <p>
          <strong className="text-foreground">How it works.</strong> SeqDesk sends notification events to the
          hosted relay, which then delivers branded emails to the right recipients (researchers, facility admins).
          The relay token is provisioned per installation; if it&apos;s missing, contact your SeqDesk administrator.
        </p>
        <p>
          <strong className="text-foreground">Per-user preferences.</strong> Each user can opt in or out of
          categories from their profile. The defaults below decide what happens for users who never visit that page.
        </p>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError("")} className="mb-6" />}

      {settings && (
        <div className="space-y-6">
          {/* Relay status */}
          <GlassCard className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">Relay status</h2>
                  {settings.hasRelayToken ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 border border-emerald-200">
                      <CheckCircle2 className="h-3 w-3" />
                      Token configured
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 border border-amber-200">
                      <XCircle className="h-3 w-3" />
                      Token missing
                    </span>
                  )}
                </div>
                <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Provider</dt>
                    <dd className="font-mono">{settings.provider}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">Relay URL</dt>
                    <dd className="font-mono break-all text-xs">{settings.relayUrl}</dd>
                  </div>
                </dl>
              </div>
              <div className="shrink-0 flex flex-col items-end gap-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="enabled-switch" className="text-sm cursor-pointer">
                    Enabled
                  </Label>
                  <Switch
                    id="enabled-switch"
                    checked={settings.enabled}
                    onCheckedChange={(checked) =>
                      setSettings((current) => (current ? { ...current, enabled: checked } : current))
                    }
                    aria-label="Enable email notifications"
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={sendTest}
                  disabled={!settings.enabled || testing}
                >
                  {testing ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {testSent ? "Test sent" : "Send test"}
                </Button>
              </div>
            </div>
          </GlassCard>

          {/* Event switches */}
          <GlassCard className="p-6">
            <h2 className="text-lg font-semibold">Event triggers</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose which events emit notifications. Disabled events are silently dropped at the relay.
            </p>
            <div className="mt-5 divide-y divide-border/60">
              {EVENT_ROWS.map((row) => (
                <div
                  key={row.key}
                  className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
                >
                  <div>
                    <div className="font-medium">{row.label}</div>
                    <p className="mt-1 text-sm text-muted-foreground">{row.description}</p>
                  </div>
                  <Switch
                    checked={
                      row.key.startsWith("order.")
                        ? settings.events.order[
                            row.key.split(".")[1] as keyof NotificationSettings["events"]["order"]
                          ]
                        : settings.events.ticket[
                            row.key.split(".")[1] as keyof NotificationSettings["events"]["ticket"]
                          ]
                    }
                    onCheckedChange={(checked) => setEvent(row.key, checked)}
                    aria-label={row.label}
                  />
                </div>
              ))}
            </div>
          </GlassCard>

          {/* User defaults */}
          <GlassCard className="p-6">
            <h2 className="text-lg font-semibold">User defaults</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Initial preferences for newly created users. Existing users keep their own choices.
            </p>
            <div className="mt-5 divide-y divide-border/60">
              <PreferenceRow
                label="Order notifications"
                description="Default opt-in for order submission and order status messages."
                checked={settings.userDefaults.orders}
                onCheckedChange={(checked) =>
                  setSettings((current) =>
                    current
                      ? {
                          ...current,
                          userDefaults: { ...current.userDefaults, orders: checked },
                        }
                      : current
                  )
                }
              />
              <PreferenceRow
                label="Support notifications"
                description="Default opt-in for support ticket messages."
                checked={settings.userDefaults.support}
                onCheckedChange={(checked) =>
                  setSettings((current) =>
                    current
                      ? {
                          ...current,
                          userDefaults: { ...current.userDefaults, support: checked },
                        }
                      : current
                  )
                }
              />
            </div>
          </GlassCard>

          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border/40">
            <Button onClick={saveSettings} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : saved ? (
                <Check className="mr-2 h-4 w-4" />
              ) : null}
              {saved ? "Saved" : "Save changes"}
            </Button>
            <span className="text-xs text-muted-foreground">
              Changes take effect immediately on save — no restart needed.
            </span>
          </div>
        </div>
      )}
    </PageContainer>
  );
}

function PreferenceRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
      <div>
        <div className="font-medium">{label}</div>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </div>
  );
}
