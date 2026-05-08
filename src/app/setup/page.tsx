"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Database,
  KeyRound,
  Loader2,
  RefreshCw,
  Server,
  ShieldCheck,
  XCircle,
} from "lucide-react";
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

type SetupPhase =
  | "ready"
  | "database-config"
  | "database-unreachable"
  | "schema-missing"
  | "seeding"
  | "seed-failed"
  | "unknown-error";

type SetupStep = {
  id: string;
  label: string;
  status: "complete" | "active" | "pending" | "error";
  description: string;
  command?: string;
};

type SetupStatus = {
  exists: boolean;
  configured: boolean;
  error?: string;
  phase: SetupPhase;
  steps: SetupStep[];
  nextAction: {
    label: string;
    description: string;
    href?: string;
    command?: string;
  } | null;
  database: {
    engine: "postgresql" | "sqlite" | "unknown";
    hosting: "neon" | "self-hosted-postgres" | "unknown";
    usesPooler: boolean;
    directUrlConfigured: boolean;
  };
  install: {
    mode: "managed" | "self-hosted";
    usesDefaultBootstrapCredentials: boolean;
    profile?: {
      id?: string;
      name?: string;
      version?: string;
      appliedAt?: string;
      source: "database" | "config";
    };
  };
};

const PHASE_COPY: Record<
  SetupPhase,
  { title: string; description: string; tone: "success" | "warning" | "error" | "info" }
> = {
  ready: {
    title: "SeqDesk is ready",
    description: "Database, schema, initial data, and admin access are available.",
    tone: "success",
  },
  "database-config": {
    title: "Database configuration needs attention",
    description: "SeqDesk cannot continue until the database settings are complete.",
    tone: "error",
  },
  "database-unreachable": {
    title: "Database is not reachable",
    description: "The configured database exists in settings, but SeqDesk cannot connect.",
    tone: "error",
  },
  "schema-missing": {
    title: "Database schema is missing",
    description: "Run migrations before SeqDesk can create initial setup data.",
    tone: "warning",
  },
  seeding: {
    title: "Creating initial data",
    description: "SeqDesk is preparing users, site settings, and default forms.",
    tone: "info",
  },
  "seed-failed": {
    title: "Initial data setup failed",
    description: "Automatic seeding did not finish. Run the seed command manually.",
    tone: "error",
  },
  "unknown-error": {
    title: "Setup needs review",
    description: "SeqDesk hit a setup issue that needs manual inspection.",
    tone: "error",
  },
};

const STEP_STYLES: Record<
  SetupStep["status"],
  { icon: typeof CheckCircle2; className: string; label: string }
> = {
  complete: {
    icon: CheckCircle2,
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    label: "Done",
  },
  active: {
    icon: Loader2,
    className: "border-blue-200 bg-blue-50 text-blue-700",
    label: "In progress",
  },
  pending: {
    icon: Server,
    className: "border-border bg-secondary text-muted-foreground",
    label: "Pending",
  },
  error: {
    icon: XCircle,
    className: "border-red-200 bg-red-50 text-red-700",
    label: "Needs fix",
  },
};

function getDatabaseHostingLabel(status: SetupStatus) {
  if (status.database.hosting === "neon") return "Neon";
  if (status.database.hosting === "self-hosted-postgres") return "Self-hosted PostgreSQL";
  return "Unknown";
}

function getDatabaseConnectionLabel(status: SetupStatus) {
  if (status.database.usesPooler) return "Pooled runtime URL";
  if (status.database.engine === "postgresql") return "Direct PostgreSQL URL";
  if (status.database.engine === "sqlite") return "Legacy SQLite URL";
  return "Not configured";
}

function getInstallLabel(status: SetupStatus) {
  if (status.install.mode === "managed") {
    return status.install.profile?.name || status.install.profile?.id || "Managed install";
  }
  return "Self-hosted install";
}

function StatusIcon({ phase }: { phase: SetupPhase }) {
  const tone = PHASE_COPY[phase].tone;
  if (tone === "success") return <CheckCircle2 className="h-5 w-5" />;
  if (tone === "error") return <AlertTriangle className="h-5 w-5" />;
  if (phase === "seeding") return <Loader2 className="h-5 w-5 animate-spin" />;
  return <Database className="h-5 w-5" />;
}

function StepItem({ step }: { step: SetupStep }) {
  const style = STEP_STYLES[step.status];
  const Icon = style.icon;

  return (
    <div className="flex gap-3 rounded-lg border border-border bg-card p-4">
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
          style.className
        )}
      >
        <Icon className={cn("h-4 w-4", step.status === "active" && "animate-spin")} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{step.label}</h3>
          <Badge variant="outline" className={cn("text-[11px]", style.className)}>
            {style.label}
          </Badge>
        </div>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          {step.description}
        </p>
        {step.command ? (
          <code className="mt-3 block rounded-md bg-foreground px-3 py-2 font-mono text-xs text-background">
            {step.command}
          </code>
        ) : null}
      </div>
    </div>
  );
}

function ActionPanel({ status }: { status: SetupStatus }) {
  const action = status.nextAction;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" />
          Current Blocker
        </CardTitle>
        <CardDescription>
          {action?.description || "SeqDesk is checking setup status."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {action?.command ? (
          <div className="rounded-lg border border-border bg-secondary/50 p-3">
            <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
              Run in the SeqDesk directory
            </p>
            <code className="block rounded-md bg-foreground px-3 py-2 font-mono text-sm text-background">
              {action.command}
            </code>
          </div>
        ) : null}

        {action?.href ? (
          <Button asChild className="w-full">
            <Link href={action.href}>
              {action.label}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        ) : (
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            {action?.label || "Checking setup status"}
          </div>
        )}

        {status.error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-red-700">
            {status.error}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CredentialPanel({ status }: { status: SetupStatus }) {
  if (status.install.mode === "managed") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" />
            Admin Access
          </CardTitle>
          <CardDescription>
            Login credentials are managed by the hosted profile from SeqDesk admin.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!status.install.usesDefaultBootstrapCredentials) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" />
            Admin Access
          </CardTitle>
          <CardDescription>
            Use the bootstrap account configured during installation.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" />
          Default Login Credentials
        </CardTitle>
        <CardDescription>
          These are shown only for plain installs using the default bootstrap users.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-secondary/50 p-3">
            <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
              Admin Account
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">Email:</span>{" "}
              <code>admin@example.com</code>
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">Password:</span>{" "}
              <code>admin</code>
            </p>
          </div>
          <div className="rounded-lg border border-border bg-secondary/50 p-3">
            <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
              Researcher Account
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">Email:</span>{" "}
              <code>user@example.com</code>
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">Password:</span>{" "}
              <code>user</code>
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SetupPage() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadStatus = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/setup/status", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load setup status");
      const data = (await res.json()) as SetupStatus;
      setStatus(data);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load setup status");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    const interval = setInterval(() => void loadStatus(), 2500);
    return () => clearInterval(interval);
  }, [loadStatus]);

  const phaseCopy = status ? PHASE_COPY[status.phase] : PHASE_COPY.seeding;
  const statusBadge = useMemo(() => {
    if (!status) return <Badge variant="secondary">Checking</Badge>;
    if (phaseCopy.tone === "success") return <Badge variant="success">Ready</Badge>;
    if (phaseCopy.tone === "error") return <Badge variant="destructive">Needs action</Badge>;
    if (phaseCopy.tone === "warning") return <Badge variant="warning">Review</Badge>;
    return <Badge variant="info">Working</Badge>;
  }, [phaseCopy.tone, status]);

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground md:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={status?.install.mode === "managed" ? "info" : "outline"}>
                {status ? getInstallLabel(status) : "Checking install"}
              </Badge>
              {status?.install.profile?.version ? (
                <Badge variant="outline">Profile {status.install.profile.version}</Badge>
              ) : null}
              {statusBadge}
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                Setup
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                SeqDesk checks database access, migrations, initial data, and managed
                profile configuration before admins log in.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void loadStatus()}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </Button>
        </header>

        <section
          className={cn(
            "rounded-lg border p-5",
            phaseCopy.tone === "success" && "border-emerald-200 bg-emerald-50/70",
            phaseCopy.tone === "error" && "border-red-200 bg-red-50/70",
            phaseCopy.tone === "warning" && "border-amber-200 bg-amber-50/70",
            phaseCopy.tone === "info" && "border-blue-200 bg-blue-50/60"
          )}
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/80">
              <StatusIcon phase={status?.phase || "seeding"} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold">{phaseCopy.title}</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {phaseCopy.description}
              </p>
              {loadError && !status ? (
                <p className="mt-2 text-sm text-red-700">{loadError}</p>
              ) : null}
            </div>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="space-y-3">
            {status ? (
              status.steps.map((step) => <StepItem key={step.id} step={step} />)
            ) : (
              <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                Checking setup status...
              </div>
            )}
          </section>

          <aside className="space-y-4">
            {status ? <ActionPanel status={status} /> : null}
            {status ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Database className="h-4 w-4" />
                    Database
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Hosting</span>
                    <span className="text-right font-medium">{getDatabaseHostingLabel(status)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Connection</span>
                    <span className="text-right font-medium">
                      {getDatabaseConnectionLabel(status)}
                    </span>
                  </div>
                  {status.database.usesPooler ? (
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">DIRECT_URL</span>
                      <span
                        className={cn(
                          "text-right font-medium",
                          status.database.directUrlConfigured
                            ? "text-emerald-700"
                            : "text-red-700"
                        )}
                      >
                        {status.database.directUrlConfigured ? "Configured" : "Missing"}
                      </span>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}
            {status ? <CredentialPanel status={status} /> : null}
          </aside>
        </div>
      </div>
    </main>
  );
}
