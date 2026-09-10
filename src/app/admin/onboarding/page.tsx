"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  RotateCw,
} from "lucide-react";

import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ONBOARDING_SECTIONS, type OnboardingStatus } from "@/lib/onboarding";

export default function OnboardingPage() {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loadError, setLoadError] = useState("");
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

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

  const verifyAutomaticItems = useCallback(async () => {
    setVerifying(true);
    setLoadError("");
    try {
      const response = await fetch("/api/admin/onboarding", {
        method: "POST",
        cache: "no-store",
      });
      const body = (await response.json()) as OnboardingStatus & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error || "Could not verify operational readiness.");
      }
      setStatus(body);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Could not verify operational readiness."
      );
    } finally {
      setVerifying(false);
    }
  }, []);

  const progress = useMemo(
    () => (status?.totalCount ? Math.round((status.completedCount / status.totalCount) * 100) : 0),
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
      <PageContainer>
        <div role="status" aria-label="Loading setup checklist" className="space-y-6 py-6">
          <span className="sr-only">Loading setup checklist…</span>
          <Skeleton className="h-8 w-64" /><Skeleton className="h-4 w-full max-w-xl" />
          {[0, 1, 2].map(index => <Skeleton key={index} className="h-32 w-full" />)}
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

  return (
    <PageContainer>
      <div className="space-y-6 py-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <ClipboardCheck className="h-4 w-4" /> Application settings
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Setup checklist</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              A checklist for your enabled modules, all in the same SeqDesk application.
              Required checks confirm operational readiness; recommendations help your team get started.
            </p>
          </div>
          <div className="min-w-48 space-y-3">
            <div className="mb-2 flex justify-between text-sm">
              <span>{status.completedCount} of {status.totalCount} complete</span>
              <span className="text-muted-foreground">{progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-all motion-reduce:transition-none"
                style={{ width: `${progress}%` }}
              />
            </div>
            {status.items.some(
              (item) => item.completionMode === "automatic"
            ) && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => void verifyAutomaticItems()}
                disabled={verifying || updatingItemId !== null}
              >
                {verifying ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RotateCw className="mr-2 h-4 w-4" />
                )}
                {verifying ? "Checking…" : "Check readiness"}
              </Button>
            )}
            <p className="text-xs text-muted-foreground">Checks do not install software or download data.</p>
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
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {loadError}
          </div>
        )}

        <div className="space-y-8">
          {Object.entries(ONBOARDING_SECTIONS).map(([sectionId, section]) => {
            const sectionItems = status.items.filter(item => (item.section ?? "essentials") === sectionId);
            if (!sectionItems.length) return null;
            return <section key={sectionId} aria-labelledby={`setup-${sectionId}`} className="space-y-3">
              <div>
                <h2 id={`setup-${sectionId}`} className="text-lg font-semibold">{section.label}</h2>
                <p className="text-sm text-muted-foreground">{section.description}</p>
              </div>
          {sectionItems.map((item) => {
            const automatic = item.completionMode === "automatic";
            return (
              <Card
                key={item.id}
                id={item.id}
                className={
                  item.complete ? "border-emerald-200 bg-emerald-50/30" : ""
                }
              >
                <CardContent className="flex flex-col gap-4 p-0 sm:flex-row sm:items-start">
                  {automatic ? (
                    item.complete ? (
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                    ) : (
                      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                    )
                  ) : (
                    <Checkbox
                      id={item.id}
                      checked={item.complete}
                      disabled={updatingItemId !== null || verifying}
                      onCheckedChange={(checked) =>
                        void setItem(item.id, checked === true)
                      }
                      aria-label={`Mark ${item.label} ${item.complete ? "incomplete" : "complete"}`}
                      className="mt-1"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {item.label}
                    <Badge variant={item.requirement === "required" ? "default" : "secondary"}>
                      {item.requirement === "required" ? "Required" : "Recommended"}
                    </Badge>
                    {automatic && <Badge variant="outline">Automatically checked</Badge>}
                  </span>
                  <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                    {item.description}
                  </span>
                  {!automatic && item.completion && (
                    <span className="mt-2 block text-xs text-muted-foreground">
                      Confirmed {new Date(item.completion.completedAt).toLocaleString()}
                    </span>
                  )}
                    {automatic && item.automaticCheck && (
                      <div className="mt-3 space-y-2 text-sm">
                        <p
                          className={
                            item.complete
                              ? "text-emerald-800"
                              : "text-amber-800"
                          }
                        >
                          {item.automaticCheck.summary}
                        </p>
                        {item.automaticCheck.checks &&
                          item.automaticCheck.checks.length > 0 && (
                            <ul className="space-y-1 text-xs text-muted-foreground">
                              {item.automaticCheck.checks.map((check) => (
                                <li key={check.id}>
                                  <span className="font-medium">{check.label}:</span>{" "}
                                  {check.message}
                                </li>
                              ))}
                            </ul>
                          )}
                        {item.automaticCheck.checkedAt && (
                          <p className="text-xs text-muted-foreground">
                            Checked{" "}
                            {new Date(
                              item.automaticCheck.checkedAt
                            ).toLocaleString()}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  {item.href && item.actionLabel && (
                    <Button variant="outline" size="sm" asChild>
                      <Link href={item.href}>
                        {item.actionLabel}{" "}
                        <ArrowRight className="ml-2 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
            </section>;
          })}
        </div>

        {status.complete && (
          <Card className="border-emerald-300 bg-emerald-50">
            <CardContent className="flex flex-col gap-4 p-0 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-700" />
                <div>
                  <p className="font-medium text-emerald-950">{status.required ? "Required setup is complete" : "SeqDesk is available"}</p>
                  <p className="mt-1 text-sm text-emerald-800">
                    {status.recommendationsComplete
                      ? "Your checklist is complete. Add sequencing data, organize studies and use the modules you have enabled."
                      : "SeqDesk is available to members. You can finish the remaining checklist items later."}
                  </p>
                </div>
              </div>
              <Button asChild>
                <Link href="/orders">Continue to SeqDesk</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </PageContainer>
  );
}
