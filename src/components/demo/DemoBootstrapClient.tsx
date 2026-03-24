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
import type { DemoExperience } from "@/lib/demo/types";

interface DemoBootstrapClientProps {
  embedded?: boolean;
  demoExperience?: DemoExperience;
}

function extractErrorMessage(rawBody: string, fallback: string): string {
  if (!rawBody) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(rawBody) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error.trim();
    }
  } catch {
    // Fall through to a text fallback for non-JSON error pages.
  }

  const stripped = rawBody
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return stripped.slice(0, 240) || fallback;
}

export function DemoBootstrapClient({
  embedded = false,
  demoExperience = "researcher",
}: DemoBootstrapClientProps) {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const bootstrappedRef = useRef(false);
  const [error, setError] = useState("");
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

        const response = await fetch("/api/demo/bootstrap", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            demoExperience,
            workspace: workspace || undefined,
          }),
        });

        if (!response.ok) {
          const responseText = await response.text().catch(() => "");
          throw new Error(
            extractErrorMessage(
              responseText,
              `Failed to start demo (HTTP ${response.status})`
            )
          );
        }
        window.location.replace("/orders");
      } catch (err) {
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
        className="min-h-screen bg-[#F7F7F4]"
        aria-busy="true"
        aria-live="polite"
      >
        <span className="sr-only">{`Opening ${demoLabel}`}</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F7F4] px-6">
      <div className="w-full max-w-lg rounded-3xl border border-[#e5e5e0] bg-white p-8 shadow-sm">
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
          <div className="rounded-2xl border border-border bg-[#F7F7F4] p-5">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  Creating or resuming your private demo data
                </p>
                <p className="text-xs text-muted-foreground">
                  Orders, studies, and changes remain isolated to this demo workspace.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
