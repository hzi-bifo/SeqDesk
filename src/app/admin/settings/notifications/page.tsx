"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Mail, Send } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
      <PageContainer className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </PageContainer>
    );
  }

  return (
    <PageContainer maxWidth="medium">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Email Notifications</h1>
          <p className="mt-1 text-muted-foreground">
            Configure hosted SeqDesk notification relay events.
          </p>
        </div>
        <Button onClick={sendTest} disabled={!settings?.enabled || testing}>
          {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          {testSent ? "Sent" : "Send Test"}
        </Button>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError("")} className="mb-6" />}

      {settings && (
        <div className="space-y-6">
          <section className="rounded-lg border bg-white p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Mail className="h-5 w-5 text-muted-foreground" />
                  <h2 className="text-lg font-semibold">Relay Status</h2>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Provider: {settings.provider}. Relay token is{" "}
                  {settings.hasRelayToken ? "configured" : "missing"}.
                </p>
                <p className="mt-1 break-all text-xs text-muted-foreground">{settings.relayUrl}</p>
              </div>
              <Switch
                checked={settings.enabled}
                onCheckedChange={(checked) =>
                  setSettings((current) => (current ? { ...current, enabled: checked } : current))
                }
                aria-label="Enable email notifications"
              />
            </div>
          </section>

          <section className="rounded-lg border bg-white p-6">
            <h2 className="text-lg font-semibold">Event Switches</h2>
            <div className="mt-5 divide-y">
              {EVENT_ROWS.map((row) => (
                <div key={row.key} className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
                  <div>
                    <div className="font-medium">{row.label}</div>
                    <p className="mt-1 text-sm text-muted-foreground">{row.description}</p>
                  </div>
                  <Switch
                    checked={
                      row.key.startsWith("order.")
                        ? settings.events.order[row.key.split(".")[1] as keyof NotificationSettings["events"]["order"]]
                        : settings.events.ticket[row.key.split(".")[1] as keyof NotificationSettings["events"]["ticket"]]
                    }
                    onCheckedChange={(checked) => setEvent(row.key, checked)}
                    aria-label={row.label}
                  />
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border bg-white p-6">
            <h2 className="text-lg font-semibold">User Defaults</h2>
            <div className="mt-5 space-y-4">
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
          </section>

          <div className="flex justify-end">
            <Button onClick={saveSettings} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : saved ? (
                <Check className="mr-2 h-4 w-4" />
              ) : null}
              {saved ? "Saved" : "Save Changes"}
            </Button>
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
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="font-medium">{label}</div>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </div>
  );
}
