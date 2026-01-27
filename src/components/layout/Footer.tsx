"use client";

import { useState, useEffect } from "react";
import { HelpCircle } from "lucide-react";
import { useHelpText } from "@/lib/useHelpText";

export function Footer() {
  const [currentTime, setCurrentTime] = useState<Date | null>(null);
  const { showHelpText, isLoaded, toggleHelpText } = useHelpText();

  useEffect(() => {
    setCurrentTime(new Date());
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <footer className="fixed bottom-0 left-64 right-0 border-t border-stone-200/60 bg-stone-50 px-6 py-1.5 z-30">
      <div className="flex items-center justify-between text-[11px] text-stone-400">
        <div className="flex items-center gap-4">
          {isLoaded && (
            <button
              onClick={toggleHelpText}
              className={`flex items-center gap-1.5 hover:text-stone-600 transition-colors ${
                showHelpText ? "text-primary" : ""
              }`}
              title={showHelpText ? "Hide help text" : "Show help text"}
            >
              <HelpCircle className="h-3 w-3" />
              <span>Help tips {showHelpText ? "on" : "off"}</span>
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {currentTime && (
            <>
              <span>{formatDate(currentTime)}</span>
              <span className="font-mono">{formatTime(currentTime)}</span>
            </>
          )}
        </div>
      </div>
    </footer>
  );
}
