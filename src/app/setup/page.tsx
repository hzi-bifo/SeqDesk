"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Database,
  Loader2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

type DbStatus = {
  exists: boolean;
  configured: boolean;
  error?: string;
};

type PreviewScenario = {
  label: string;
  description: string;
  status: DbStatus | null;
  failed: boolean;
};

const PREVIEW_SCENARIOS: Record<string, PreviewScenario> = {
  loading: {
    label: "Loading",
    description: "Initial check, no status response yet",
    status: null,
    failed: false,
  },
  connecting: {
    label: "Connecting",
    description: "Polling, database not yet reachable",
    status: { exists: false, configured: false },
    failed: false,
  },
  seeding: {
    label: "Seeding",
    description: "Database connected, initial data being created",
    status: { exists: true, configured: false },
    failed: false,
  },
  configured: {
    label: "Configured",
    description: "Both checks pass (would redirect to /login in real flow)",
    status: { exists: true, configured: true },
    failed: false,
  },
  failed: {
    label: "Failed (DB ready)",
    description: "Auto-seed timed out, only db:seed needed",
    status: { exists: true, configured: false },
    failed: true,
  },
  "failed-no-db": {
    label: "Failed (no DB)",
    description: "Auto-seed timed out and database is missing",
    status: { exists: false, configured: false },
    failed: true,
  },
  error: {
    label: "Error",
    description: "Database connection error message displayed",
    status: {
      exists: false,
      configured: false,
      error:
        "DATABASE_URL is not configured. SeqDesk now requires a PostgreSQL connection string.",
    },
    failed: true,
  },
};

const isDev = process.env.NODE_ENV === "development";

export default function SetupPage() {
  const router = useRouter();
  const [status, setStatus] = useState<DbStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  useEffect(() => {
    if (!isDev) return;
    const param = new URLSearchParams(window.location.search).get("preview");
    if (param && param in PREVIEW_SCENARIOS) {
      setPreviewKey(param);
    }
  }, []);

  useEffect(() => {
    if (previewKey) return;

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
  }, [previewKey]);

  const previewScenario = previewKey ? PREVIEW_SCENARIOS[previewKey] : null;
  const displayStatus = previewScenario ? previewScenario.status : status;
  const displayFailed = previewScenario ? previewScenario.failed : failed;
  const dbReady = displayStatus?.exists ?? false;
  const dbConfigured = displayStatus?.configured ?? false;
  const dbChecking = displayStatus === null;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      {previewScenario && (
        <PreviewSwitcher activeKey={previewKey ?? ""} />
      )}
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-xl bg-primary/10 mb-4">
            <Database className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-3xl font-bold mb-2">
            {displayFailed ? "Database Setup Required" : "Setting Up Database"}
          </h1>
          <p className="text-muted-foreground">
            {displayFailed
              ? "Automatic setup could not be completed. Please follow the manual steps below."
              : "Creating initial users, settings, and form configurations. This only takes a moment."}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              {!displayFailed ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Database className="h-5 w-5" />
              )}
              Current Status
            </CardTitle>
          </CardHeader>
          <CardContent
            className="space-y-3"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-3 text-sm">
              <span
                className={cn(
                  "status-dot",
                  dbChecking && "status-dot-inactive",
                  !dbChecking && dbReady && "status-dot-active",
                  !dbChecking && !dbReady && "bg-destructive",
                )}
              />
              <span className="text-muted-foreground">Database connection:</span>
              <span
                className={cn(
                  dbChecking && "text-muted-foreground",
                  !dbChecking && dbReady && "text-emerald-600",
                  !dbChecking && !dbReady && "text-destructive",
                )}
              >
                {dbChecking ? "Checking..." : dbReady ? "Ready" : "Unavailable"}
              </span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span
                className={cn(
                  "status-dot",
                  dbChecking && "status-dot-inactive",
                  !dbChecking && dbConfigured && "status-dot-active",
                  !dbChecking &&
                    !dbConfigured &&
                    displayFailed &&
                    "bg-destructive",
                  !dbChecking &&
                    !dbConfigured &&
                    !displayFailed &&
                    !dbReady &&
                    "status-dot-inactive",
                  !dbChecking &&
                    !dbConfigured &&
                    !displayFailed &&
                    dbReady &&
                    "status-dot-pending animate-pulse",
                )}
              />
              <span className="text-muted-foreground">Initial data:</span>
              <span
                className={cn(
                  dbChecking && "text-muted-foreground",
                  !dbChecking && dbConfigured && "text-emerald-600",
                  !dbChecking &&
                    !dbConfigured &&
                    displayFailed &&
                    "text-destructive",
                  !dbChecking &&
                    !dbConfigured &&
                    !displayFailed &&
                    !dbReady &&
                    "text-muted-foreground",
                  !dbChecking &&
                    !dbConfigured &&
                    !displayFailed &&
                    dbReady &&
                    "text-amber-600",
                )}
              >
                {dbChecking
                  ? "Checking..."
                  : dbConfigured
                    ? "Configured"
                    : displayFailed
                      ? "Not seeded"
                      : !dbReady
                        ? "Waiting for database"
                        : "Setting up..."}
              </span>
            </div>
            {displayStatus?.error && (
              <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {displayStatus.error}
              </div>
            )}
          </CardContent>
        </Card>

        {displayFailed && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Manual Setup</CardTitle>
              <CardDescription>
                Run the following commands in your SeqDesk directory, then
                refresh this page.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {!dbReady && (
                <CommandRow command="npm run db:migrate:deploy" />
              )}
              <CommandRow command="npm run db:seed" />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              Default Login Credentials
            </CardTitle>
            <CardDescription>
              After setup, you can sign in with these accounts.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <CredentialBlock
                role="Admin"
                roleVariant="default"
                email="admin@example.com"
                password="admin"
              />
              <CredentialBlock
                role="Researcher"
                roleVariant="secondary"
                email="user@example.com"
                password="user"
              />
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-amber-200/80 bg-amber-50/35 px-3 py-2 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-700" />
              <span>
                Change these defaults before deploying to production.
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CommandRow({ command }: { command: string }) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      toast.success("Command copied");
    } catch {
      toast.error("Failed to copy");
    }
  };
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted px-3 py-2 font-mono text-sm">
      <code className="truncate">{command}</code>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={handleCopy}
        aria-label="Copy command"
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function CredentialBlock({
  role,
  roleVariant,
  email,
  password,
}: {
  role: string;
  roleVariant: "default" | "secondary";
  email: string;
  password: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-4 space-y-3">
      <Badge variant={roleVariant}>{role}</Badge>
      <div className="space-y-2">
        <CredentialRow label="Email" value={email} />
        <CredentialRow label="Password" value={password} />
      </div>
    </div>
  );
}

function CredentialRow({ label, value }: { label: string; value: string }) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Failed to copy");
    }
  };
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0 flex-1">
        <div className="eyebrow text-[10px] mb-0.5">{label}</div>
        <code className="block truncate text-sm font-mono text-foreground">
          {value}
        </code>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={handleCopy}
        aria-label={`Copy ${label.toLowerCase()}`}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function PreviewSwitcher({ activeKey }: { activeKey: string }) {
  const entries = Object.entries(PREVIEW_SCENARIOS);
  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 rounded-lg border border-border bg-card p-3 shadow-lg">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <Badge variant="warning">Preview</Badge>
          <span className="text-xs text-muted-foreground">dev only</span>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Exit preview"
          asChild
        >
          <a href="/setup">
            <X className="h-3.5 w-3.5" />
          </a>
        </Button>
      </div>
      <div className="space-y-1">
        {entries.map(([key, scenario]) => {
          const isActive = key === activeKey;
          return (
            <a
              key={key}
              href={`/setup?preview=${key}`}
              className={cn(
                "block rounded-md px-2 py-1.5 text-xs transition-colors",
                isActive
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              )}
            >
              <div className="font-medium">{scenario.label}</div>
              <div className="text-[11px] text-muted-foreground">
                {scenario.description}
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
