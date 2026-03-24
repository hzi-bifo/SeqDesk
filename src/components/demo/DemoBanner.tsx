"use client";

import { useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
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
  const isFacilityDemo = demoExperience === "facility";

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

  return (
    <div
      className={`border-b border-border bg-gradient-to-r from-[#F7F7F4] via-white to-[#F7F7F4] ${
        embeddedMode ? "px-3 py-2.5" : "px-4 py-3"
      }`}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">
            {isFacilityDemo ? "Facility Demo" : "Researcher Demo"}
          </p>
          <p className="text-xs text-muted-foreground">
            Private to this demo workspace. Reset anytime to restore the seeded data.
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
        </div>
      </div>
    </div>
  );
}
