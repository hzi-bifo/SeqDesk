"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Bell, Check, CheckCircle2, Loader2, Mail, Send, XCircle } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { GlassCard } from "@/components/ui/glass-card";
import { Label } from "@/components/ui/label";
import { ErrorBanner } from "@/components/ui/error-banner";
import { HelpBox } from "@/components/ui/help-box";
import { toast } from "@/components/ui/toast";
import { PageLoader } from "@/components/ui/page-loader";

type EmailNotificationSettings = {
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

type NotificationSettings = {
  inApp: {
    enabled: boolean;
  };
  email: EmailNotificationSettings;
};

const EVENT_ROWS = [
  {
    key: "order.submitted",
    label: "Sequencing Order submitted",
    description: "Confirm submissions to users and alert admins about new submitted sequencing orders.",
  },
  {
    key: "order.statusChanged",
    label: "Sequencing Order status changed",
    description: "Notify users when a facility admin changes a sequencing order status.",
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
          inApp: {
            enabled: settings.inApp.enabled,
          },
          email: {
            enabled: settings.email.enabled,
            events: settings.email.events,
            userDefaults: settings.email.userDefaults,
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to save notification settings");
      setSettings(payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      toast.success("Notification settings saved");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save notification settings";
      setError(message);
      toast.error(message);
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
      toast.success("Test notification sent");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send test notification";
      setError(message);
      toast.error(message);
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
            email: {
              ...current.email,
              events: {
                ...current.email.events,
                [section]: {
                  ...current.email.events[section],
                  [key]: checked,
                },
              },
            },
          }
        : current
    );
  }

  function setInAppEnabled(enabled: boolean) {
    setSettings((current) =>
      current
        ? {
            ...current,
            inApp: {
              ...current.inApp,
              enabled,
            },
          }
        : current
    );
  }

  function setEmailEnabled(enabled: boolean) {
    setSettings((current) =>
      current
        ? {
            ...current,
            email: {
              ...current.email,
              enabled,
            },
          }
        : current
    );
  }

  function setEmailDefault(key: keyof EmailNotificationSettings["userDefaults"], checked: boolean) {
    setSettings((current) =>
      current
        ? {
            ...current,
            email: {
              ...current.email,
              userDefaults: { ...current.email.userDefaults, [key]: checked },
            },
          }
        : current
    );
  }

  function getEventChecked(row: (typeof EVENT_ROWS)[number]) {
    if (!settings) return false;
    return row.key.startsWith("order.")
      ? settings.email.events.order[
          row.key.split(".")[1] as keyof EmailNotificationSettings["events"]["order"]
        ]
      : settings.email.events.ticket[
          row.key.split(".")[1] as keyof EmailNotificationSettings["events"]["ticket"]
        ];
  }

  if (loading) {
    return <PageLoader />;
  }

  return (
    <>
      <div className="sticky top-0 z-30 bg-card border-b border-border">
        <div className="relative flex h-[52px] items-center justify-center px-6 lg:px-8">
          <span className="text-sm font-medium">Notification Settings</span>
        </div>
        <div className="flex min-h-12 flex-col gap-2 border-t border-border/60 px-4 py-2 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <div className="flex flex-wrap items-center gap-2">
            <HeaderStatusChip tone={settings?.email.hasRelayToken ? "success" : "warning"}>
              {settings?.email.hasRelayToken ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <XCircle className="h-3.5 w-3.5" />
              )}
              Relay token
              <span className="font-semibold">
                {settings?.email.hasRelayToken ? "Configured" : "Missing"}
              </span>
            </HeaderStatusChip>
            {settings ? (
              <>
                <HeaderStatusChip tone={settings.inApp.enabled ? "success" : "muted"}>
                  {settings.inApp.enabled ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5" />
                  )}
                  In-app
                  <span className="font-semibold">
                    {settings.inApp.enabled ? "Enabled" : "Disabled"}
                  </span>
                </HeaderStatusChip>
                <HeaderStatusChip tone={settings.email.enabled ? "success" : "muted"}>
                  {settings.email.enabled ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5" />
                  )}
                  Email
                  <span className="font-semibold">
                    {settings.email.enabled ? "Enabled" : "Disabled"}
                  </span>
                </HeaderStatusChip>
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Button
              variant="outline"
              size="sm"
              className="bg-white"
              onClick={saveSettings}
              disabled={saving || !settings}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : saved ? (
                <Check className="h-4 w-4 mr-2 text-green-600" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              {saved ? "Saved" : "Save changes"}
            </Button>
          </div>
        </div>
      </div>

      <PageContainer>
        <div className="mb-4 mt-6">
          <h1 className="text-xl font-semibold">Notification Settings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure in-app notifications and hosted email delivery separately
          </p>
        </div>

        <HelpBox title="How it works">
          In-app notifications appear in the bottom-right notification panel. Email notifications are sent
          through the hosted SeqDesk relay, use each user&apos;s email preferences, and require a relay token.
        </HelpBox>

        {error && <ErrorBanner message={error} onDismiss={() => setError("")} className="mb-6" />}

        {settings && (
          <div className="space-y-6">
            <GlassCard className="p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Bell className="h-5 w-5 text-muted-foreground" />
                    <h2 className="text-lg font-semibold">In-app notifications</h2>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border ${
                        settings.inApp.enabled
                          ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                          : "bg-muted text-muted-foreground border-border"
                      }`}
                    >
                      {settings.inApp.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Controls the bottom-right notification panel and creation of in-app notification rows.
                  </p>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <Label htmlFor="in-app-enabled-switch" className="text-sm cursor-pointer">
                    Enabled
                  </Label>
                  <Switch
                    id="in-app-enabled-switch"
                    checked={settings.inApp.enabled}
                    onCheckedChange={setInAppEnabled}
                    aria-label="Enable in-app notifications"
                  />
                </div>
              </div>
            </GlassCard>

            <GlassCard className="p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Mail className="h-5 w-5 text-muted-foreground" />
                    <h2 className="text-lg font-semibold">Email notifications</h2>
                    {settings.email.hasRelayToken ? (
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
                      <dd className="font-mono">{settings.email.provider}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">Relay URL</dt>
                      <dd className="font-mono break-all text-xs">{settings.email.relayUrl}</dd>
                    </div>
                  </dl>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="email-enabled-switch" className="text-sm cursor-pointer">
                      Enabled
                    </Label>
                    <Switch
                      id="email-enabled-switch"
                      checked={settings.email.enabled}
                      onCheckedChange={setEmailEnabled}
                      aria-label="Enable email notifications"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={sendTest}
                    disabled={!settings.email.enabled || testing}
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

            <GlassCard className="p-6">
              <h2 className="text-lg font-semibold">Email event triggers</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose which events emit emails. Disabled events are not sent to the relay.
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
                      checked={getEventChecked(row)}
                      onCheckedChange={(checked) => setEvent(row.key, checked)}
                      aria-label={`${row.label} email`}
                    />
                  </div>
                ))}
              </div>
            </GlassCard>

            <GlassCard className="p-6">
              <h2 className="text-lg font-semibold">Email user defaults</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Initial email preferences for newly created users. Existing users keep their own choices.
              </p>
              <div className="mt-5 divide-y divide-border/60">
                <PreferenceRow
                  label="Sequencing Order email notifications"
                  description="Default opt-in for sequencing order submission and sequencing order status emails."
                  checked={settings.email.userDefaults.orders}
                  onCheckedChange={(checked) => setEmailDefault("orders", checked)}
                />
                <PreferenceRow
                  label="Support email notifications"
                  description="Default opt-in for support ticket emails."
                  checked={settings.email.userDefaults.support}
                  onCheckedChange={(checked) => setEmailDefault("support", checked)}
                />
              </div>
            </GlassCard>

            <p className="text-xs text-muted-foreground pt-2 border-t border-border/40">
              Changes take effect immediately on save. Use the Save changes button at the top of the page.
            </p>
          </div>
        )}
      </PageContainer>
    </>
  );
}

function HeaderStatusChip({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "success" | "warning" | "muted";
}) {
  const toneClass = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
    muted: "border-border bg-muted/30 text-muted-foreground",
  }[tone];

  return (
    <span
      className={`inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs ${toneClass}`}
    >
      {children}
    </span>
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
