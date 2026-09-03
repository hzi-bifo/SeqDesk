"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, ClipboardCheck, Loader2 } from "lucide-react";

import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import type { OnboardingStatus } from "@/lib/onboarding";

const PROFILE_COPY = {
  "sequencing-center": {
    label: "Sequencing center",
    destination: "/orders",
    journey: "a test request from intake through delivery",
  },
  "shared-lab": {
    label: "Shared lab",
    destination: "/orders",
    journey: "one shared project with another lab member",
  },
  "research-workbench": {
    label: "Research workbench",
    destination: "/workbench/data",
    journey: "a small import or upload followed by a starter analysis",
  },
} as const;

export default function OnboardingPage() {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loadError, setLoadError] = useState("");
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const response = await fetch("/api/admin/onboarding", { cache: "no-store" });
      const body = (await response.json()) as OnboardingStatus & { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not load setup checklist.");
      setStatus(body);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load setup checklist.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const progress = useMemo(
    () => (status ? Math.round((status.completedCount / status.totalCount) * 100) : 0),
    [status]
  );

  async function setItem(itemId: string, complete: boolean) {
    setUpdatingItemId(itemId);
    setLoadError("");
    try {
      const response = await fetch("/api/admin/onboarding", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId, complete }),
      });
      const body = (await response.json()) as OnboardingStatus & { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not update setup checklist.");
      setStatus(body);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not update setup checklist.");
    } finally {
      setUpdatingItemId(null);
    }
  }

  if (!status && !loadError) {
    return (
      <PageContainer className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading setup checklist…
        </div>
      </PageContainer>
    );
  }

  if (!status) {
    return (
      <PageContainer>
        <Card>
          <CardHeader>
            <CardTitle>Setup checklist unavailable</CardTitle>
            <CardDescription>{loadError}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => void load()}>Try again</Button>
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  const profile = PROFILE_COPY[status.profile];

  return (
    <PageContainer>
      <div className="space-y-6 py-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <ClipboardCheck className="h-4 w-4" /> {profile.label} setup
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Finish setting up SeqDesk</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Confirm the operational choices that cannot be safely guessed by the installer. This
              checklist remains available under Settings after required setup is complete.
            </p>
          </div>
          <div className="min-w-48">
            <div className="mb-2 flex justify-between text-sm">
              <span>{status.completedCount} of {status.totalCount} complete</span>
              <span className="text-muted-foreground">{progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>

        {status.required && (
          <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
            Required readiness: {status.requiredCompletedCount} of{" "}
            {status.requiredTotalCount} complete. Recommended items can be finished later and do
            not block members.
          </div>
        )}

        {!status.required && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            This installation predates required onboarding. The checklist is optional and does not
            block normal use.
          </div>
        )}

        {loadError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {loadError}
          </div>
        )}

        <div className="space-y-3">
          {status.items.map((item) => (
            <Card key={item.id} className={item.complete ? "border-emerald-200 bg-emerald-50/30" : ""}>
              <CardContent className="flex flex-col gap-4 p-0 sm:flex-row sm:items-start">
                <Checkbox
                  id={item.id}
                  checked={item.complete}
                  disabled={updatingItemId !== null}
                  onCheckedChange={(checked) => void setItem(item.id, checked === true)}
                  aria-label={`Mark ${item.label} ${item.complete ? "incomplete" : "complete"}`}
                  className="mt-1"
                />
                <label htmlFor={item.id} className="min-w-0 flex-1 cursor-pointer">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {item.label}
                    <Badge variant={item.requirement === "required" ? "default" : "secondary"}>
                      {item.requirement === "required" ? "Required" : "Recommended"}
                    </Badge>
                  </span>
                  <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                    {item.description}
                  </span>
                  {item.completion && (
                    <span className="mt-2 block text-xs text-muted-foreground">
                      Confirmed {new Date(item.completion.completedAt).toLocaleString()}
                    </span>
                  )}
                </label>
                {item.href && item.actionLabel && (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={item.href}>
                      {item.actionLabel} <ArrowRight className="ml-2 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {status.complete && (
          <Card className="border-emerald-300 bg-emerald-50">
            <CardContent className="flex flex-col gap-4 p-0 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-700" />
                <div>
                  <p className="font-medium text-emerald-950">Required setup is complete</p>
                  <p className="mt-1 text-sm text-emerald-800">
                    {status.recommendationsComplete
                      ? `The recommended first journey is ${profile.journey}.`
                      : "SeqDesk is available to members. You can finish the remaining recommendations later."}
                  </p>
                </div>
              </div>
              <Button asChild>
                <Link href={profile.destination}>Continue to SeqDesk</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </PageContainer>
  );
}
