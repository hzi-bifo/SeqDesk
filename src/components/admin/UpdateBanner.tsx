"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { ArrowUpCircle, X } from "lucide-react";
import Link from "next/link";

interface UpdateInfo {
  currentVersion: string;
  updateAvailable: boolean;
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

  // Don't show if not admin, no update, or dismissed
  if (
    session?.user?.role !== "FACILITY_ADMIN" ||
    !updateInfo?.updateAvailable ||
    dismissed
  ) {
    return null;
  }

  return (
    <div className="bg-blue-600 text-white px-4 py-2">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ArrowUpCircle className="h-5 w-5" />
          <span className="text-sm">
            <strong>SeqDesk {updateInfo.latest?.version}</strong> is available.
            {updateInfo.latest?.releaseNotes && (
              <span className="ml-1 opacity-90">
                {updateInfo.latest.releaseNotes}
              </span>
            )}
          </span>
          <Link
            href="/admin/settings"
            className="ml-2 text-sm font-medium underline hover:no-underline"
          >
            Update now
          </Link>
        </div>
        <button
          onClick={handleDismiss}
          className="p-1 hover:bg-blue-700 rounded"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
