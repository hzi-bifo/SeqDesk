"use client";

import { useState, useEffect, useContext } from "react";
import { useHelpText } from "@/lib/useHelpText";
import { SidebarContext } from "./SidebarContext";

export function Footer() {
  const [currentTime, setCurrentTime] = useState<Date | null>(null);
  const { showHelpText, isLoaded, toggleHelpText } = useHelpText();
  const sidebarContext = useContext(SidebarContext);
  const collapsed = sidebarContext?.collapsed ?? false;

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
    <footer
      className="fixed bottom-0 right-0 border-t border-border bg-background px-4 py-1.5 z-30 transition-all duration-300"
      style={{ left: collapsed ? '64px' : '256px' }}
    >
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <div className="flex items-center gap-4">
          {isLoaded && (
            <button
              onClick={toggleHelpText}
              className={`flex items-center gap-1.5 hover:text-foreground transition-colors ${
                showHelpText ? "text-foreground" : ""
              }`}
              title={showHelpText ? "Hide help text" : "Show help text"}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${showHelpText ? "bg-foreground" : "bg-muted-foreground"}`} />
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
