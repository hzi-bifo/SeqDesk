"use client";

import { useEffect, useState } from "react";
import { Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DEMO_LOADING_MESSAGE,
  DEMO_RESET_MESSAGE,
  getDemoEntryPath,
  postDemoFrameMessage,
} from "@/lib/demo/client";
import type { DemoExperience } from "@/lib/demo/types";

interface DemoBannerProps {
  embeddedMode: boolean;
  demoExperience: DemoExperience;
}

export function DemoBanner({
  embeddedMode,
  demoExperience,
}: DemoBannerProps) {
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const isFacilityDemo = demoExperience === "facility";
  const dismissKey = `seqdesk-demo-banner-dismissed:${demoExperience}`;

  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(dismissKey) === "1") {
        setDismissed(true);
      }
    } catch {
      // storage unavailable; keep the banner visible
    }
  }, [dismissKey]);

  const handleDismiss = () => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(dismissKey, "1");
    } catch {
      // ignore storage errors
    }
  };

  const handleReset = async () => {
    setResetting(true);
    setError("");

    try {
      const response = await fetch("/api/demo/reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          demoExperience,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to reset demo");
      }

      await response.json().catch(() => ({}));
      if (embeddedMode) {
        postDemoFrameMessage(DEMO_RESET_MESSAGE, {
          demoExperience,
        });
        postDemoFrameMessage(DEMO_LOADING_MESSAGE);
      }
      window.location.assign(getDemoEntryPath(demoExperience, embeddedMode));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset demo");
      setResetting(false);
    }
  };

  if (dismissed) {
    return null;
  }

  return (
    <div
      className={`border-b border-border bg-gradient-to-r from-background via-card to-background transition-[padding-right] duration-300 ${
        embeddedMode ? "px-3 py-2.5" : "px-4 py-3"
      }`}
      style={{
        paddingRight: `calc(${embeddedMode ? "0.75rem" : "1rem"} + var(--entity-notes-sidebar-offset, 0px))`,
      }}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">
            {isFacilityDemo ? "Facility Demo" : "Researcher Demo"}
          </p>
          <p className="text-xs text-muted-foreground">
            Demo mode with sample data —{" "}
            <span className="font-medium text-foreground">
              don&apos;t enter confidential or real data
            </span>
            . Private to this demo workspace; reset anytime to restore the seeded data.
            {!isFacilityDemo && (
              <span className="block mt-0.5 text-muted-foreground/80">
                Tip: Try editing the draft order and submitting it to experience the full workflow.
              </span>
            )}
          </p>
          {error ? (
            <p className="mt-1 text-xs text-destructive">{error}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleReset}
            disabled={resetting}
            data-testid="demo-reset-button"
            className={embeddedMode ? "h-7 gap-1.5 rounded-full px-3 text-[11px]" : ""}
          >
            {resetting ? (
              <Loader2 className={`${embeddedMode ? "mr-1 h-3 w-3" : "mr-2 h-3.5 w-3.5"} animate-spin`} />
            ) : (
              <RotateCcw className={embeddedMode ? "mr-1 h-3 w-3" : "mr-2 h-3.5 w-3.5"} />
            )}
            Reset Demo
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDismiss}
            aria-label="Hide demo notice"
            title="Hide demo notice"
            data-testid="demo-banner-dismiss"
            className={embeddedMode ? "h-7 w-7 rounded-full" : "h-8 w-8"}
          >
            <X className={embeddedMode ? "h-3.5 w-3.5" : "h-4 w-4"} />
          </Button>
        </div>
      </div>
    </div>
  );
}
