"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/glass-card";
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

export default function AdminAccountsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [admins, setAdmins] = useState<Admin[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);

  // Create invite dialog
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteExpires, setInviteExpires] = useState("7");
  const [creating, setCreating] = useState(false);

  // Delete invite dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [inviteToDelete, setInviteToDelete] = useState<Invite | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (status === "loading") return;
    if (!session || session.user.role !== "FACILITY_ADMIN") {
      router.push("/dashboard");
      return;
    }

    const fetchData = async () => {
      try {
        const [adminsRes, invitesRes] = await Promise.all([
          fetch("/api/admin/users?role=FACILITY_ADMIN"),
          fetch("/api/admin/invites"),
        ]);

        if (adminsRes.ok) {
          const adminsData = await adminsRes.json();
          setAdmins(adminsData);
        }

        if (invitesRes.ok) {
          const invitesData = await invitesRes.json();
          setInvites(invitesData);
        }
      } catch {
        toast.error("Failed to load data");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [session, status, router]);

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const handleCreateInvite = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail || null,
          expiresInDays: parseInt(inviteExpires),
        }),
      });

      if (!res.ok) throw new Error("Failed to create invite");

      const invite = await res.json();
      setInvites([invite, ...invites]);
      setCreateDialogOpen(false);
      setInviteEmail("");
      toast.success("Invite created successfully");
    } catch {
      toast.error("Failed to create invite");
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

      if (!res.ok) throw new Error("Failed to delete invite");

      setInvites(invites.filter((i) => i.id !== inviteToDelete.id));
      setDeleteDialogOpen(false);
      setInviteToDelete(null);
      toast.success("Invite revoked");
    } catch {
      toast.error("Failed to revoke invite");
    } finally {
      setDeleting(false);
    }
  };

  const copyInviteLink = (code: string) => {
    const link = `${window.location.origin}/register/admin?code=${code}`;
    navigator.clipboard.writeText(link);
    toast.success("Invite link copied to clipboard");
  };

  const copyInviteCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success("Invite code copied to clipboard");
  };

  const isExpired = (date: string) => new Date() > new Date(date);

  const pendingInvites = invites.filter((i) => !i.usedAt && !isExpired(i.expiresAt));
  const usedOrExpiredInvites = invites.filter((i) => i.usedAt || isExpired(i.expiresAt));

  if (loading) {
    return (
      <PageContainer className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Admin Accounts</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Facility administrators with full system access
        </p>
      </div>

      {/* Current Admins */}
      <div className="space-y-3 mb-8">
        {admins.map((admin) => (
          <div
            key={admin.id}
            className="bg-white rounded-xl p-5 flex items-center gap-4"
          >
            <div
              className="h-12 w-12 rounded-full flex items-center justify-center text-sm font-medium text-white shrink-0"
              style={{ backgroundColor: "#1e3a8a" }}
            >
              {admin.firstName.charAt(0)}
              {admin.lastName.charAt(0)}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
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
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" />
                  {admin.email}
                </span>
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  Joined {formatDate(admin.createdAt)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Invite Section */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Invite New Admin</h2>
            <p className="text-sm text-muted-foreground">
              Generate invite links for new administrators
            </p>
          </div>
          <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Create Invite
          </Button>
        </div>

        {/* Pending Invites */}
        {pendingInvites.length > 0 && (
          <div className="space-y-3">
            {pendingInvites.map((invite) => (
              <GlassCard key={invite.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <LinkIcon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <code className="text-sm font-mono font-semibold bg-stone-100 px-2 py-0.5 rounded">
                          {invite.code}
                        </code>
                        {invite.email && (
                          <span className="text-xs text-muted-foreground">
                            for {invite.email}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Expires {formatDate(invite.expiresAt)}
                        </span>
                        <span>
                          Created by {invite.createdBy.firstName} {invite.createdBy.lastName}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyInviteCode(invite.code)}
                    >
                      <Copy className="h-3.5 w-3.5 mr-1.5" />
                      Code
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyInviteLink(invite.code)}
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
              </GlassCard>
            ))}
          </div>
        )}

        {pendingInvites.length === 0 && (
          <div className="bg-stone-50 rounded-xl p-8 text-center">
            <LinkIcon className="h-10 w-10 mx-auto mb-3 text-muted-foreground opacity-30" />
            <p className="text-muted-foreground mb-1">No pending invites</p>
            <p className="text-sm text-muted-foreground">
              Create an invite to add new administrators
            </p>
          </div>
        )}
      </div>

      {/* Used/Expired Invites */}
      {usedOrExpiredInvites.length > 0 && (
        <div className="mt-8">
          <h3 className="text-sm font-medium text-muted-foreground mb-3">
            Past Invites
          </h3>
          <div className="space-y-2">
            {usedOrExpiredInvites.map((invite) => (
              <div
                key={invite.id}
                className="bg-stone-50 rounded-lg p-3 flex items-center justify-between text-sm"
              >
                <div className="flex items-center gap-3">
                  {invite.usedAt ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-stone-400" />
                  )}
                  <div>
                    <code className="font-mono text-xs text-muted-foreground">
                      {invite.code}
                    </code>
                    {invite.usedBy && (
                      <span className="text-xs text-muted-foreground ml-2">
                        Used by {invite.usedBy.firstName} {invite.usedBy.lastName}
                      </span>
                    )}
                    {!invite.usedAt && isExpired(invite.expiresAt) && (
                      <span className="text-xs text-muted-foreground ml-2">
                        Expired
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">
                  {invite.usedAt
                    ? formatDate(invite.usedAt)
                    : formatDate(invite.expiresAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create Invite Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Admin Invite</DialogTitle>
            <DialogDescription>
              Generate an invite code for a new administrator
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email (optional)</Label>
              <Input
                id="email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="Leave empty for any email"
              />
              <p className="text-xs text-muted-foreground">
                If specified, only this email can use the invite
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="expires">Expires in</Label>
              <select
                id="expires"
                value={inviteExpires}
                onChange={(e) => setInviteExpires(e.target.value)}
                className="w-full h-10 rounded-md border border-input bg-background px-3"
              >
                <option value="1">1 day</option>
                <option value="3">3 days</option>
                <option value="7">7 days</option>
                <option value="14">14 days</option>
                <option value="30">30 days</option>
              </select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateDialogOpen(false)}
            >
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

      {/* Delete Invite Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke Invite</DialogTitle>
            <DialogDescription>
              Are you sure you want to revoke invite code{" "}
              <code className="font-mono bg-stone-100 px-1 rounded">
                {inviteToDelete?.code}
              </code>
              ? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteInvite}
              disabled={deleting}
            >
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
