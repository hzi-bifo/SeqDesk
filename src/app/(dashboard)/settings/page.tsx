"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PageContainer } from "@/components/layout/PageContainer";
import { Loader2, Check, Mail } from "lucide-react";
import { ErrorBanner } from "@/components/ui/error-banner";

interface UserProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  institution: string | null;
  department: { id: string; name: string } | null;
}

export default function SettingsPage() {
  const { data: session, update: updateSession } = useSession();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [notificationsAvailable, setNotificationsAvailable] = useState(false);
  const [notificationPreferences, setNotificationPreferences] = useState({
    orders: true,
    support: true,
  });

  // Form state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [institution, setInstitution] = useState("");

  // Fetch profile on mount
  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await fetch("/api/user/profile");
        if (res.ok) {
          const data: UserProfile = await res.json();
          setFirstName(data.firstName || "");
          setLastName(data.lastName || "");
          setEmail(data.email || "");
          setPhone(data.phone || "");
          setInstitution(data.institution || "");
        }
      } catch {
        setError("Failed to load profile");
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);

  useEffect(() => {
    const fetchNotificationPreferences = async () => {
      try {
        const res = await fetch("/api/user/notification-preferences");
        if (!res.ok) return;
        const data = await res.json();
        setNotificationsAvailable(Boolean(data.available));
        setNotificationPreferences({
          orders: data.preferences?.orders !== false,
          support: data.preferences?.support !== false,
        });
      } catch {
        // Account settings should remain usable when notification preferences cannot load.
      }
    };

    fetchNotificationPreferences();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);

    try {
      const res = await fetch("/api/user/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName,
          lastName,
          phone,
          institution,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to update profile");
        return;
      }

      // Update session to reflect name change
      await updateSession({
        ...session,
        user: {
          ...session?.user,
          name: `${firstName} ${lastName}`,
        },
      });

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  const updateNotificationPreference = async (
    key: "orders" | "support",
    checked: boolean
  ) => {
    const next = { ...notificationPreferences, [key]: checked };
    setNotificationPreferences(next);
    setSavingNotifications(true);
    setError("");

    try {
      const res = await fetch("/api/user/notification-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update email notifications");
      }
    } catch (err) {
      setNotificationPreferences(notificationPreferences);
      setError(err instanceof Error ? err.message : "Failed to update email notifications");
    } finally {
      setSavingNotifications(false);
    }
  };

  if (loading) {
    return (
      <PageContainer className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">Account Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage your profile information
        </p>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}

      <form onSubmit={handleSubmit}>
        <div
          className="p-6 rounded-xl space-y-6"
          style={{ background: '#ffffff', border: '1px solid #e5e5e0' }}
        >
          <h2 className="text-lg font-semibold" style={{ color: '#171717' }}>
            Personal Information
          </h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="John"
                required
                disabled={saving}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name</Label>
              <Input
                id="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Doe"
                required
                disabled={saving}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email Address</Label>
            <Input
              id="email"
              type="email"
              value={email}
              disabled
              className="bg-secondary"
            />
            <p className="text-xs text-muted-foreground">
              Email cannot be changed. Contact support if you need to update it.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Phone Number</Label>
            <Input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 (555) 123-4567"
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="institution">Institution / Organization</Label>
            <Input
              id="institution"
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
              placeholder="University of Example"
              disabled={saving}
            />
          </div>

          <div className="pt-4 flex justify-end">
            <Button type="submit" disabled={saving || saved}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : saved ? (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Saved
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </div>
        </div>
      </form>

      <div
        className="p-6 mt-6 rounded-xl"
        style={{ background: '#ffffff', border: '1px solid #e5e5e0' }}
      >
        <div className="flex items-center gap-2 mb-4">
          <Mail className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold" style={{ color: '#171717' }}>
            Email Notifications
          </h2>
          {savingNotifications && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>
        <div className="space-y-4">
          <NotificationPreferenceRow
            label="Orders"
            description="Order submissions and facility status updates"
            checked={notificationPreferences.orders}
            disabled={!notificationsAvailable || savingNotifications}
            onCheckedChange={(checked) => updateNotificationPreference("orders", checked)}
          />
          <NotificationPreferenceRow
            label="Support"
            description="Support ticket replies"
            checked={notificationPreferences.support}
            disabled={!notificationsAvailable || savingNotifications}
            onCheckedChange={(checked) => updateNotificationPreference("support", checked)}
          />
        </div>
      </div>

      {/* Account Info */}
      <div
        className="p-6 mt-6 rounded-xl"
        style={{ background: '#ffffff', border: '1px solid #e5e5e0' }}
      >
        <h2 className="text-lg font-semibold mb-4" style={{ color: '#171717' }}>
          Account Information
        </h2>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Account Type</span>
            <span className="font-medium font-geist-pixel text-xs text-muted-foreground">
              {session?.user?.role === "FACILITY_ADMIN" ? "Facility Admin" : "Researcher"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Email</span>
            <span className="font-medium font-geist-pixel text-xs text-muted-foreground">{email}</span>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}

function NotificationPreferenceRow({
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="font-medium">{label}</div>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-label={`${label} email notifications`}
      />
    </div>
  );
}
