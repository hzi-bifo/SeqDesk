"use client";

import { useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, UserRoundCheck, UserRoundX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

export function AccountLifecycleControl({
  userId,
  email,
  isActive,
  isFinalAdministrator,
}: {
  userId: string;
  email: string;
  isActive: boolean;
  isFinalAdministrator: boolean;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const changeStatus = async () => {
    const nextIsActive = !isActive;
    const action = nextIsActive ? "reactivate" : "deactivate";
    const explanation = nextIsActive
      ? "The user will be able to sign in again."
      : "The user will be signed out and unable to sign in. Their scientific records will be kept.";
    if (!window.confirm(`Are you sure you want to ${action} this account?\n\n${explanation}`)) {
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/admin/users/${userId}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: nextIsActive }),
      });
      const body = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(body?.error || `Failed to ${action} account`);
      }

      toast.success(`Account ${nextIsActive ? "reactivated" : "deactivated"}`);
      if (!nextIsActive && session?.user?.id === userId) {
        await signOut({ callbackUrl: "/login" });
        return;
      }
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : `Failed to ${action} account`
      );
    } finally {
      setSaving(false);
    }
  };

  const permanentlyDelete = async () => {
    const confirmationEmail = window.prompt(
      `Permanent deletion cannot be undone. Type ${email} to continue.`
    );
    if (confirmationEmail === null) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmationEmail }),
      });
      const body = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(body?.error || "Failed to permanently delete account");
      }

      toast.success("Account permanently deleted");
      router.push("/admin/users");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to permanently delete account"
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="rounded-lg border bg-white p-5">
      <h2 className="text-sm font-medium">Account status</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {isActive
          ? "This account can sign in. Deactivation revokes access while keeping scientific records and provenance."
          : "This account is deactivated and cannot sign in. Reactivation restores access without recreating the account."}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant={isActive ? "outline" : "default"}
          onClick={() => void changeStatus()}
          disabled={saving || (isActive && isFinalAdministrator)}
        >
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : isActive ? (
            <UserRoundX className="mr-2 h-4 w-4" />
          ) : (
            <UserRoundCheck className="mr-2 h-4 w-4" />
          )}
          {isActive ? "Deactivate account" : "Reactivate account"}
        </Button>
        {isActive && isFinalAdministrator && (
          <span className="text-xs text-muted-foreground">
            Add another active administrator before deactivating this account.
          </span>
        )}
      </div>

      {!isActive && (
        <div className="mt-5 border-t pt-5">
          <h3 className="text-sm font-medium text-destructive">Permanent deletion</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            This separate action is available only when the account has no scientific,
            workspace, or provenance records. Otherwise, keep the account deactivated.
          </p>
          <Button
            type="button"
            variant="destructive"
            className="mt-3"
            onClick={() => void permanentlyDelete()}
            disabled={deleting}
          >
            {deleting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            Permanently delete empty account
          </Button>
        </div>
      )}
    </div>
  );
}
