"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { ExternalLink, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DEMO_ERROR_MESSAGE,
  DEMO_LOADING_MESSAGE,
  getDemoEntryPath,
  postDemoFrameMessage,
} from "@/lib/demo/client";
import {
  DEMO_DATABASE_WAKING_CODE,
  DEMO_DATABASE_WAKING_MESSAGE,
} from "@/lib/demo/bootstrap-errors";
import type { DemoExperience } from "@/lib/demo/types";

interface DemoBootstrapClientProps {
  embedded?: boolean;
  demoExperience?: DemoExperience;
}

type DemoBootstrapFailure = {
  code?: string;
  message: string;
  retryable: boolean;
};

// Each delay stays below the landing page's 10-second stale-load timeout. The
// loading frame message sent before each wait restarts that timeout.
const DATABASE_RETRY_DELAYS_MS = [2_000, 3_000, 5_000, 7_000, 8_000, 8_000];

function extractBootstrapFailure(
  rawBody: string,
  fallback: string
): DemoBootstrapFailure {
  if (!rawBody) {
    return { message: fallback, retryable: false };
  }

  try {
    const parsed = JSON.parse(rawBody) as {
      code?: unknown;
      error?: unknown;
      retryable?: unknown;
    };
    const code = typeof parsed.code === "string" ? parsed.code : undefined;
    const message =
      typeof parsed.error === "string" && parsed.error.trim()
        ? parsed.error.trim()
        : fallback;
    return {
      ...(code ? { code } : {}),
      message,
      retryable: parsed.retryable === true,
    };
  } catch {
    // Fall through to a text fallback for non-JSON error pages.
  }

  const stripped = rawBody
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    message: stripped.slice(0, 240) || fallback,
    retryable: false,
  };
}

function readRetryAfterMs(response: Response): number {
  const rawValue = response.headers.get("Retry-After")?.trim();
  if (!rawValue) {
    return 0;
  }

  const seconds = Number(rawValue);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : 0;
}

export function DemoBootstrapClient({
  embedded = false,
  demoExperience = "researcher",
}: DemoBootstrapClientProps) {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const bootstrappedRef = useRef(false);
  const [error, setError] = useState("");
  const [databaseWaking, setDatabaseWaking] = useState(false);
  const workspace = searchParams.get("workspace")?.trim() || "";
  const demoLabel =
    demoExperience === "facility" ? "facility workspace" : "researcher workspace";
  const fullDemoPath = getDemoEntryPath(demoExperience, false);
  const fullDemoHref = workspace
    ? `${fullDemoPath}?workspace=${encodeURIComponent(workspace)}`
    : fullDemoPath;

  useEffect(() => {
    if (!embedded) {
      return;
    }

    postDemoFrameMessage(DEMO_LOADING_MESSAGE);
  }, [embedded]);

  useEffect(() => {
    if (bootstrappedRef.current || status === "loading") {
      return;
    }

    bootstrappedRef.current = true;
    const abortController = new AbortController();
    let cancelled = false;
    let retryTimeoutId: number | undefined;
    let finishRetryWait: (() => void) | undefined;

    const waitForRetry = (delayMs: number) =>
      new Promise<void>((resolve) => {
        finishRetryWait = resolve;
        retryTimeoutId = window.setTimeout(resolve, delayMs);
      });

    const bootstrap = async () => {
      try {
        // In non-embedded mode without a workspace key, skip bootstrap if
        // already authenticated with the correct experience.
        // In embedded mode we always re-bootstrap because the other iframe
        // may have overwritten the shared session cookie.
        if (
          !embedded &&
          !workspace &&
          status === "authenticated" &&
          session?.user?.isDemo &&
          session.user.demoExperience === demoExperience
        ) {
          window.location.replace("/orders");
          return;
        }

        for (let attempt = 0; ; attempt += 1) {
          const response = await fetch("/api/demo/bootstrap", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              demoExperience,
              workspace: workspace || undefined,
            }),
            signal: abortController.signal,
          });

          if (response.ok) {
            window.location.replace("/orders");
            return;
          }

          const responseText = await response.text().catch(() => "");
          const failure = extractBootstrapFailure(
            responseText,
            `Failed to start demo (HTTP ${response.status})`
          );
          const shouldRetry =
            response.status === 503 &&
            failure.retryable &&
            failure.code === DEMO_DATABASE_WAKING_CODE &&
            attempt < DATABASE_RETRY_DELAYS_MS.length;

          if (!shouldRetry) {
            throw new Error(
              failure.code === DEMO_DATABASE_WAKING_CODE
                ? "The demo database is taking longer than expected. Please try again."
                : failure.message
            );
          }

          setDatabaseWaking(true);
          if (embedded) {
            postDemoFrameMessage(DEMO_LOADING_MESSAGE, {
              demoExperience,
              message: DEMO_DATABASE_WAKING_MESSAGE,
              phase: "database",
            });
          }

          const delayMs = Math.max(
            DATABASE_RETRY_DELAYS_MS[attempt],
            readRetryAfterMs(response)
          );
          await waitForRetry(delayMs);
          finishRetryWait = undefined;
          retryTimeoutId = undefined;
          if (cancelled) {
            return;
          }
        }
      } catch (err) {
        if (cancelled || (err instanceof Error && err.name === "AbortError")) {
          return;
        }
        const message =
          err instanceof Error ? err.message : "Failed to start demo";
        setError(message);
        if (embedded) {
          postDemoFrameMessage(DEMO_ERROR_MESSAGE, {
            demoExperience,
            message,
          });
        }
        bootstrappedRef.current = false;
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
      abortController.abort();
      if (retryTimeoutId !== undefined) {
        window.clearTimeout(retryTimeoutId);
      }
      finishRetryWait?.();
    };
  }, [
    demoExperience,
    embedded,
    session?.user?.demoExperience,
    session?.user?.isDemo,
    status,
    workspace,
  ]);

  if (embedded && !error) {
    return (
      <div
        className="min-h-screen bg-background"
        aria-busy="true"
        aria-live="polite"
      >
        <span className="sr-only">{`Opening ${demoLabel}`}</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-8 shadow-sm">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            SeqDesk Demo
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
            {`Opening a disposable ${demoLabel}`}
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {embedded
              ? `Preparing the live ${demoExperience} view for the landing-page embed.`
              : `Preparing the full-screen live ${demoExperience} demo.`}
          </p>
        </div>

        {error ? (
          <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4">
            <p className="text-sm font-medium text-destructive">
              Unable to start the demo
            </p>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => window.location.reload()}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Try Again
              </Button>
              {embedded ? (
                <Button variant="outline" asChild>
                  <Link href={fullDemoHref} target="_blank" rel="noopener noreferrer">
                    Open Full Demo
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <div
            className="rounded-2xl border border-border bg-background p-5"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {databaseWaking
                    ? "Waking the demo database"
                    : "Creating or resuming your private demo data"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {databaseWaking
                    ? "The demo pauses when idle to conserve resources. This can take a few seconds."
                    : "Orders, studies, and changes remain isolated to this demo workspace."}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
