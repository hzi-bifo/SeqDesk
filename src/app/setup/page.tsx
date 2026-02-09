"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Database, CheckCircle2, Loader2 } from "lucide-react";

type DbStatus = {
  exists: boolean;
  configured: boolean;
  error?: string;
};

export default function SetupPage() {
  const router = useRouter();
  const [status, setStatus] = useState<DbStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let attempts = 0;
    const maxAttempts = 15;

    const checkStatus = async () => {
      try {
        const res = await fetch("/api/setup/status", { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to check status");
        const data: DbStatus = await res.json();
        setStatus(data);

        if (data.exists && data.configured) {
          router.replace("/login");
          return;
        }

        attempts++;
        if (attempts >= maxAttempts) {
          setFailed(true);
        }
      } catch {
        attempts++;
        if (attempts >= maxAttempts) {
          setFailed(true);
        }
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 2000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-secondary mb-4">
            <Database className="h-8 w-8 text-foreground" />
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-2">
            {failed ? "Database Setup Required" : "Setting Up Database..."}
          </h1>
          <p className="text-muted-foreground">
            {failed
              ? "Automatic setup could not be completed. Please follow the manual steps below."
              : "Creating initial users, settings, and form configurations. This only takes a moment."}
          </p>
        </div>

        {/* Status Card */}
        <div className="bg-card rounded-2xl border border-border p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            {!failed ? (
              <Loader2 className="h-5 w-5 animate-spin text-foreground" />
            ) : (
              <Database className="h-5 w-5 text-foreground" />
            )}
            Current Status
          </h2>
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <div
                className={`h-2 w-2 rounded-full ${status?.exists ? "bg-emerald-500" : "bg-red-500"}`}
              />
              <span className="text-muted-foreground">Database file:</span>
              <span className={status?.exists ? "text-emerald-600" : "text-red-600"}>
                {status === null ? "Checking..." : status.exists ? "Found" : "Not found"}
              </span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <div
                className={`h-2 w-2 rounded-full ${
                  !failed && !status?.configured
                    ? "bg-amber-500 animate-pulse"
                    : status?.configured
                      ? "bg-emerald-500"
                      : "bg-red-500"
                }`}
              />
              <span className="text-muted-foreground">Initial data:</span>
              <span
                className={
                  !failed && !status?.configured
                    ? "text-amber-600"
                    : status?.configured
                      ? "text-emerald-600"
                      : "text-red-600"
                }
              >
                {status === null
                  ? "Checking..."
                  : !failed && !status.configured
                    ? "Setting up..."
                    : status.configured
                      ? "Configured"
                      : "Not seeded"}
              </span>
            </div>
          </div>
        </div>

        {/* Manual steps - only shown if auto-seed failed */}
        {failed && (
          <div className="bg-card rounded-2xl border border-border p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4">Manual Setup</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Run the following commands in your SeqDesk directory:
            </p>
            <div className="space-y-3">
              {!status?.exists && (
                <div className="bg-foreground rounded-lg p-3 font-mono text-sm text-background">
                  <code>npx prisma db push</code>
                </div>
              )}
              <div className="bg-foreground rounded-lg p-3 font-mono text-sm text-background">
                <code>npm run db:seed</code>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mt-4">
              Then refresh this page.
            </p>
          </div>
        )}

        {/* Default Credentials */}
        <div className="bg-card rounded-2xl border border-border p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            Default Login Credentials
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            After setup, you can log in with these accounts:
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg bg-secondary border border-border">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Admin Account
              </div>
              <div className="space-y-1 text-sm">
                <div>
                  <span className="text-muted-foreground">Email:</span>{" "}
                  <code className="text-foreground">admin@example.com</code>
                </div>
                <div>
                  <span className="text-muted-foreground">Password:</span>{" "}
                  <code className="text-foreground">admin</code>
                </div>
              </div>
            </div>
            <div className="p-4 rounded-lg bg-secondary border border-border">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Researcher Account
              </div>
              <div className="space-y-1 text-sm">
                <div>
                  <span className="text-muted-foreground">Email:</span>{" "}
                  <code className="text-foreground">user@example.com</code>
                </div>
                <div>
                  <span className="text-muted-foreground">Password:</span>{" "}
                  <code className="text-foreground">user</code>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
