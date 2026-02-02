"use client";

import { X } from "lucide-react";
import { useHelpText } from "@/lib/useHelpText";

interface HelpBoxProps {
  title?: string;
  children: React.ReactNode;
}

export function HelpBox({ title, children }: HelpBoxProps) {
  const { showHelpText, isLoaded, hideHelpText } = useHelpText();

  // Don't render until we've loaded the preference
  if (!isLoaded || !showHelpText) {
    return null;
  }

  return (
    <div className="mb-6 p-4 rounded-xl bg-secondary border border-border relative">
      <button
        onClick={hideHelpText}
        className="absolute top-2 right-2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
        aria-label="Dismiss help text"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="pr-8">
        {title && (
          <p className="text-sm text-muted-foreground">
            <strong>{title}</strong>{" "}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {children}
        </p>
      </div>
    </div>
  );
}
