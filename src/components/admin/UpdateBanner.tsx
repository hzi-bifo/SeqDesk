"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { ArrowUpCircle, X } from "lucide-react";
import Link from "next/link";

interface UpdateInfo {
  currentVersion: string;
  runningVersion?: string;
  installedVersion?: string;
  restartRequired?: boolean;
  updateAvailable: boolean;
  currentDatabaseProvider?: "postgresql" | "sqlite" | "unknown";
  databaseCompatible?: boolean;
  databaseCompatibilityError?: string;
  latest?: {
    version: string;
    releaseNotes?: string;
  };
}

export function UpdateBanner() {
  const { data: session } = useSession();
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Only check for admins
    if (session?.user?.role !== "FACILITY_ADMIN") return;

    // Check if already dismissed this session
    const dismissedVersion = sessionStorage.getItem("update-banner-dismissed");

    async function checkUpdate() {
      try {
        const res = await fetch("/api/admin/updates");
        if (res.ok) {
          const data = await res.json();
          setUpdateInfo(data);

          // If dismissed version matches current latest, stay dismissed
          if (dismissedVersion === data.latest?.version) {
            setDismissed(true);
          }
        }
      } catch {
        // Silently fail - update check is not critical
      }
    }

    checkUpdate();
  }, [session]);

  const handleDismiss = () => {
    if (updateInfo?.latest?.version) {
      sessionStorage.setItem("update-banner-dismissed", updateInfo.latest.version);
    }
    setDismissed(true);
  };

  const restartPending = !!(
    updateInfo?.restartRequired &&
    updateInfo?.installedVersion &&
    updateInfo.latest?.version &&
    updateInfo.installedVersion === updateInfo.latest.version
  );

  // Don't show if not admin, no update, or dismissed
  if (
    session?.user?.role !== "FACILITY_ADMIN" ||
    !updateInfo?.updateAvailable ||
    updateInfo.databaseCompatible === false ||
    dismissed
  ) {
    return null;
  }

  return (
    <div className="bg-background border-b px-4 py-1.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <ArrowUpCircle className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm text-muted-foreground truncate">
            <span className="font-medium text-foreground">
              SeqDesk {updateInfo.latest?.version}
            </span>{" "}
            {restartPending ? "installed. Restart pending." : "is available."}
            {!restartPending && updateInfo.latest?.releaseNotes && (
              <span className="ml-1">{updateInfo.latest.releaseNotes}</span>
            )}
          </span>
          <Link
            href="/admin/settings"
            className="ml-1 text-sm font-medium text-primary hover:underline shrink-0"
          >
            {restartPending ? "View status" : "Update now"}
          </Link>
        </div>
        <button
          onClick={handleDismiss}
          className="p-1 hover:bg-muted rounded text-muted-foreground shrink-0"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
