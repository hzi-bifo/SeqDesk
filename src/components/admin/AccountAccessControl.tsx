"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck, ShieldMinus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

export function AccountAccessControl({
  userId,
  systemRole,
  isFinalAdministrator,
}: {
  userId: string;
  systemRole: string;
  isFinalAdministrator: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const isAdministrator = systemRole === "ADMIN";
  const targetSystemRole = isAdministrator ? "MEMBER" : "ADMIN";

  const changeAccess = async () => {
    const action = isAdministrator ? "remove administrator access" : "make this user an administrator";
    if (!window.confirm(`Are you sure you want to ${action}?`)) return;

    setSaving(true);
    try {
      const response = await fetch(`/api/admin/users/${userId}/role`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ systemRole: targetSystemRole }),
      });
      const body = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(body?.error || "Failed to change account access");
      }
      toast.success(
        isAdministrator
          ? "Administrator access removed"
          : "Administrator access granted"
      );
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to change account access"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border bg-white p-5">
      <h2 className="text-sm font-medium">Account access</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {isAdministrator
          ? "Administrators can manage users, credentials, pipelines, infrastructure, and updates in addition to scientific work."
          : "Members can perform profile-approved scientific work but cannot change protected system configuration."}
      </p>
      <div className="mt-4 flex items-center gap-3">
        <Button
          type="button"
          variant={isAdministrator ? "outline" : "default"}
          onClick={() => void changeAccess()}
          disabled={saving || (isAdministrator && isFinalAdministrator)}
        >
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : isAdministrator ? (
            <ShieldMinus className="mr-2 h-4 w-4" />
          ) : (
            <ShieldCheck className="mr-2 h-4 w-4" />
          )}
          {isAdministrator ? "Remove administrator access" : "Make administrator"}
        </Button>
        {isAdministrator && isFinalAdministrator && (
          <span className="text-xs text-muted-foreground">
            Add another administrator before changing this account.
          </span>
        )}
      </div>
    </div>
  );
}
