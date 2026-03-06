"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ExternalLink, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DEMO_LOADING_MESSAGE, postDemoFrameMessage } from "@/lib/demo/client";

interface DemoBootstrapClientProps {
  embedded?: boolean;
}

export function DemoBootstrapClient({
  embedded = false,
}: DemoBootstrapClientProps) {
  const { data: session, status } = useSession();
  const bootstrappedRef = useRef(false);
  const [error, setError] = useState("");

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
        if (status === "authenticated" && session?.user?.isDemo) {
          window.location.replace("/orders");
          return;
        }

        const response = await fetch("/api/demo/bootstrap", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || "Failed to start demo");
        }
        await response.json().catch(() => ({}));
        window.location.replace("/orders");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start demo");
        bootstrappedRef.current = false;
      }
    };

    void bootstrap();
  }, [session?.user?.isDemo, status]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F7F4] px-6">
      <div className="w-full max-w-lg rounded-3xl border border-[#e5e5e0] bg-white p-8 shadow-sm">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            SeqDesk Demo
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
            Opening a disposable researcher workspace
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {embedded
              ? "Preparing the live researcher view for the landing-page embed."
              : "Preparing the full-screen live researcher demo."}
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
                  <Link href="/demo" target="_blank" rel="noopener noreferrer">
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
                  Orders, studies, and changes remain isolated to this browser session.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
