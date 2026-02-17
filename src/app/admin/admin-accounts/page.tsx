"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/glass-card";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Shield,
  Mail,
  Calendar,
  Plus,
  Copy,
  Trash2,
  Loader2,
  Link as LinkIcon,
  Clock,
  CheckCircle2,
  AlertCircle,
  Users,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

interface Admin {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  createdAt: string;
}

interface Invite {
  id: string;
  code: string;
  email: string | null;
  expiresAt: string;
  createdAt: string;
  usedAt: string | null;
  createdBy: { firstName: string; lastName: string };
  usedBy: { firstName: string; lastName: string; email: string } | null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AdminAccountsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [admins, setAdmins] = useState<Admin[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [departmentSharing, setDepartmentSharing] = useState(false);
  const [allowUserAssemblyDownload, setAllowUserAssemblyDownload] = useState(false);
  const [savingAccess, setSavingAccess] = useState(false);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteExpires, setInviteExpires] = useState("7");
  const [creating, setCreating] = useState(false);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [inviteToDelete, setInviteToDelete] = useState<Invite | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isExpired = useCallback((date: string) => new Date() > new Date(date), []);

  const pendingInvites = useMemo(
    () => invites.filter((invite) => !invite.usedAt && !isExpired(invite.expiresAt)),
    [invites, isExpired]
  );

  const usedOrExpiredInvites = useMemo(
    () => invites.filter((invite) => invite.usedAt || isExpired(invite.expiresAt)),
    [invites, isExpired]
  );

  const fetchData = useCallback(async (showFullLoading = false) => {
    if (showFullLoading) {
      setLoading(true);
    }
    setRefreshing(true);

    try {
      const [adminsRes, invitesRes, accessRes] = await Promise.all([
        fetch("/api/admin/users?role=FACILITY_ADMIN"),
        fetch("/api/admin/invites"),
        fetch("/api/admin/settings/access"),
      ]);

      let hasPartialError = false;

      if (adminsRes.ok) {
        const adminsData = (await adminsRes.json()) as Admin[];
        setAdmins(adminsData);
      } else {
        hasPartialError = true;
      }

      if (invitesRes.ok) {
        const invitesData = (await invitesRes.json()) as Invite[];
        setInvites(invitesData);
      } else {
        hasPartialError = true;
      }

      if (accessRes.ok) {
        const accessData = (await accessRes.json()) as {
          departmentSharing?: boolean;
          allowUserAssemblyDownload?: boolean;
        };
        setDepartmentSharing(accessData.departmentSharing ?? false);
        setAllowUserAssemblyDownload(accessData.allowUserAssemblyDownload ?? false);
      } else {
        hasPartialError = true;
      }

      if (hasPartialError) {
        toast.error("Some account data could not be loaded");
      }
    } catch {
      toast.error("Failed to load account data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    if (!session || session.user.role !== "FACILITY_ADMIN") {
      router.push("/dashboard");
      return;
    }
    void fetchData(true);
  }, [session, status, router, fetchData]);

  const formatDate = (date: string) =>
    new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const formatDateTime = (date: string) =>
    new Date(date).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const handleCreateInvite = async () => {
    const trimmedEmail = inviteEmail.trim().toLowerCase();
    if (trimmedEmail && !EMAIL_PATTERN.test(trimmedEmail)) {
      toast.error("Please enter a valid email address");
      return;
    }

    const expiresInDays = Number.parseInt(inviteExpires, 10);
    if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 30) {
      toast.error("Please select a valid expiration period");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmedEmail || null,
          expiresInDays,
        }),
      });

      const payload = (await res.json().catch(() => null)) as
        | Invite
        | { error?: string }
        | null;

      if (!res.ok) {
        throw new Error(
          payload && "error" in payload && payload.error
            ? payload.error
            : "Failed to create invite"
        );
      }

      setInvites((prev) => [payload as Invite, ...prev]);
      setCreateDialogOpen(false);
      setInviteEmail("");
      setInviteExpires("7");
      toast.success("Invite created successfully");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create invite"
      );
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteInvite = async () => {
    if (!inviteToDelete) return;
    setDeleting(true);

    try {
      const res = await fetch(`/api/admin/invites/${inviteToDelete.id}`, {
        method: "DELETE",
      });

      const payload = (await res.json().catch(() => null)) as
        | { success?: boolean; error?: string }
        | null;

      if (!res.ok) {
        throw new Error(payload?.error || "Failed to revoke invite");
      }

      setInvites((prev) => prev.filter((invite) => invite.id !== inviteToDelete.id));
      setDeleteDialogOpen(false);
      setInviteToDelete(null);
      toast.success("Invite revoked");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to revoke invite");
    } finally {
      setDeleting(false);
    }
  };

  const copyInviteLink = async (code: string) => {
    try {
      const link = `${window.location.origin}/register/admin?code=${code}`;
      await navigator.clipboard.writeText(link);
      toast.success("Invite link copied");
    } catch {
      toast.error("Failed to copy invite link");
    }
  };

  const copyInviteCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Invite code copied");
    } catch {
      toast.error("Failed to copy invite code");
    }
  };

  const handleDepartmentSharingChange = async (enabled: boolean) => {
    setSavingAccess(true);
    setDepartmentSharing(enabled);

    try {
      const res = await fetch("/api/admin/settings/access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departmentSharing: enabled }),
      });

      if (!res.ok) {
        throw new Error("Failed to save setting");
      }
    } catch (error) {
      console.error("Failed to save setting:", error);
      setDepartmentSharing(!enabled);
      toast.error("Failed to save setting");
    } finally {
      setSavingAccess(false);
    }
  };

  const handleAllowUserAssemblyDownloadChange = async (enabled: boolean) => {
    setSavingAccess(true);
    setAllowUserAssemblyDownload(enabled);

    try {
      const res = await fetch("/api/admin/settings/access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowUserAssemblyDownload: enabled }),
      });

      if (!res.ok) {
        throw new Error("Failed to save setting");
      }
    } catch (error) {
      console.error("Failed to save setting:", error);
      setAllowUserAssemblyDownload(!enabled);
      toast.error("Failed to save setting");
    } finally {
      setSavingAccess(false);
    }
  };

  if (loading) {
    return (
      <PageContainer className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </PageContainer>
    );
  }

  if (status !== "loading" && (!session || session.user.role !== "FACILITY_ADMIN")) {
    return null;
  }

  return (
    <PageContainer>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Admin Accounts</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage facility administrators and invitation access
        </p>
      </div>

      <div className="sticky top-16 z-30 mb-6">
        <div className="rounded-lg border border-border bg-background/95 backdrop-blur px-3 py-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {refreshing ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" />
                Refreshing account data...
              </span>
            ) : (
              `${admins.length} admins • ${pendingInvites.length} pending invites • ${usedOrExpiredInvites.length} past invites`
            )}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="bg-white"
              onClick={() => void fetchData(false)}
              disabled={refreshing}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              Create Invite
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <GlassCard className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
              <Users className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Access & Sharing</h2>
              <p className="text-sm text-muted-foreground">
                Control department-level order visibility for researchers
              </p>
            </div>
          </div>

          <div className="border-t pt-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <Label htmlFor="department-sharing" className="text-sm font-medium">
                  Department Sharing
                </Label>
                <p className="text-sm text-muted-foreground">
                  Allow users in the same department to view and edit each other&apos;s orders.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {savingAccess && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
                <Switch
                  id="department-sharing"
                  checked={departmentSharing}
                  onCheckedChange={handleDepartmentSharingChange}
                  disabled={savingAccess}
                />
              </div>
            </div>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mt-6 pt-6 border-t">
              <div className="space-y-1">
                <Label htmlFor="assembly-download-sharing" className="text-sm font-medium">
                  User Assembly Downloads
                </Label>
                <p className="text-sm text-muted-foreground">
                  Allow users to download final assemblies generated for their studies.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {savingAccess && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
                <Switch
                  id="assembly-download-sharing"
                  checked={allowUserAssemblyDownload}
                  onCheckedChange={handleAllowUserAssemblyDownloadChange}
                  disabled={savingAccess}
                />
              </div>
            </div>
          </div>
        </GlassCard>

        <GlassCard className="p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-base font-semibold">Current Administrators</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Accounts with full facility administration permissions
              </p>
            </div>
            <Badge variant="secondary">{admins.length}</Badge>
          </div>

          {admins.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-8 text-center text-muted-foreground text-sm">
              No administrator accounts found
            </div>
          ) : (
            <div className="space-y-3">
              {admins.map((admin) => (
                <div
                  key={admin.id}
                  className="rounded-lg border border-border bg-background p-4 flex items-start gap-3"
                >
                  <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center text-sm font-medium shrink-0">
                    {admin.firstName.charAt(0)}
                    {admin.lastName.charAt(0)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">
                        {admin.firstName} {admin.lastName}
                      </p>
                      <Badge className="text-[10px]">
                        <Shield className="h-3 w-3 mr-1" />
                        Admin
                      </Badge>
                      {admin.id === session?.user?.id && (
                        <span className="text-xs text-muted-foreground">(You)</span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-col gap-1 text-sm text-muted-foreground sm:flex-row sm:items-center sm:gap-4">
                      <span className="inline-flex items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5" />
                        {admin.email}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5" />
                        Joined {formatDate(admin.createdAt)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>

        <GlassCard className="p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-base font-semibold">Pending Invites</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Invite codes that are active and can still be used
              </p>
            </div>
            <Badge variant="secondary">{pendingInvites.length}</Badge>
          </div>

          {pendingInvites.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-8 text-center">
              <LinkIcon className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-60" />
              <p className="text-sm font-medium">No pending invites</p>
              <p className="text-sm text-muted-foreground mt-1">
                Use &quot;Create Invite&quot; to add another administrator.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {pendingInvites.map((invite) => (
                <div key={invite.id} className="rounded-lg border border-border bg-background p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="text-xs font-mono font-semibold bg-secondary px-2 py-1 rounded">
                          {invite.code}
                        </code>
                        {invite.email ? (
                          <span className="text-xs text-muted-foreground">
                            restricted to {invite.email}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            unrestricted
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:gap-4">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Expires {formatDateTime(invite.expiresAt)}
                        </span>
                        <span>
                          Created by {invite.createdBy.firstName} {invite.createdBy.lastName}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="bg-white"
                        onClick={() => void copyInviteCode(invite.code)}
                      >
                        <Copy className="h-3.5 w-3.5 mr-1.5" />
                        Code
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="bg-white"
                        onClick={() => void copyInviteLink(invite.code)}
                      >
                        <LinkIcon className="h-3.5 w-3.5 mr-1.5" />
                        Link
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          setInviteToDelete(invite);
                          setDeleteDialogOpen(true);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>

        <GlassCard className="p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-base font-semibold">Past Invites</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Used or expired invite history
              </p>
            </div>
            <Badge variant="outline">{usedOrExpiredInvites.length}</Badge>
          </div>

          {usedOrExpiredInvites.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
              No past invites yet
            </div>
          ) : (
            <div className="space-y-2">
              {usedOrExpiredInvites.map((invite) => (
                <div
                  key={invite.id}
                  className="rounded-lg border border-border bg-background px-3 py-2 flex items-center justify-between gap-3 text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {invite.usedAt ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <div className="min-w-0">
                      <code className="font-mono text-xs text-muted-foreground">
                        {invite.code}
                      </code>
                      {invite.usedBy ? (
                        <p className="text-xs text-muted-foreground">
                          Used by {invite.usedBy.firstName} {invite.usedBy.lastName}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Expired unused</p>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {invite.usedAt ? formatDate(invite.usedAt) : formatDate(invite.expiresAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>

      <Dialog
        open={createDialogOpen}
        onOpenChange={(open) => {
          setCreateDialogOpen(open);
          if (!open) {
            setInviteEmail("");
            setInviteExpires("7");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Admin Invite</DialogTitle>
            <DialogDescription>
              Generate an invite code for a new administrator
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email (optional)</Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="Leave empty for any email"
              />
              <p className="text-xs text-muted-foreground">
                If specified, only this email can redeem the invite.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="invite-expires">Expires in</Label>
              <Select value={inviteExpires} onValueChange={setInviteExpires}>
                <SelectTrigger id="invite-expires" className="bg-white">
                  <SelectValue placeholder="Select duration" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 day</SelectItem>
                  <SelectItem value="3">3 days</SelectItem>
                  <SelectItem value="7">7 days</SelectItem>
                  <SelectItem value="14">14 days</SelectItem>
                  <SelectItem value="30">30 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateInvite} disabled={creating}>
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Invite
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke Invite</DialogTitle>
            <DialogDescription>
              Revoke invite code{" "}
              <code className="font-mono bg-secondary px-1 rounded">
                {inviteToDelete?.code}
              </code>
              ? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteInvite} disabled={deleting}>
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Revoking...
                </>
              ) : (
                "Revoke Invite"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
