"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GlassCard } from "@/components/ui/glass-card";
import {
  Shield,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";

function AdminRegisterContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const codeFromUrl = searchParams.get("code") || "";

  const [inviteCode, setInviteCode] = useState(codeFromUrl);
  const [codeVerified, setCodeVerified] = useState(false);
  const [codeError, setCodeError] = useState("");
  const [restrictedEmail, setRestrictedEmail] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Auto-verify if code is in URL
  useEffect(() => {
    if (codeFromUrl) {
      verifyCode(codeFromUrl);
    }
  }, [codeFromUrl]);

  const verifyCode = async (code: string) => {
    if (!code.trim()) {
      setCodeError("Please enter an invite code");
      return;
    }

    setVerifying(true);
    setCodeError("");

    try {
      const res = await fetch("/api/admin/invites/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });

      const data = await res.json();

      if (!data.valid) {
        setCodeError(data.error || "Invalid invite code");
        setCodeVerified(false);
      } else {
        setCodeVerified(true);
        setRestrictedEmail(data.email);
        if (data.email) {
          setEmail(data.email);
        }
      }
    } catch {
      setCodeError("Failed to verify code");
    } finally {
      setVerifying(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!codeVerified) {
      toast.error("Please verify your invite code first");
      return;
    }

    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          firstName,
          lastName,
          role: "FACILITY_ADMIN",
          inviteCode: inviteCode.trim().toUpperCase(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Registration failed");
      }

      toast.success("Account created! Please log in.");
      router.push("/login");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-stone-100 via-stone-50 to-blue-50">
      <div className="w-full max-w-md">
        {/* Back link */}
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Login
        </Link>

        <GlassCard className="p-8">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Shield className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-2xl font-bold">Admin Registration</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Create your administrator account
            </p>
          </div>

          {/* Step 1: Verify Code */}
          {!codeVerified && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code">Invite Code</Label>
                <div className="flex gap-2">
                  <Input
                    id="code"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                    placeholder="Enter your invite code"
                    className="font-mono tracking-wider"
                    disabled={verifying}
                  />
                  <Button
                    onClick={() => verifyCode(inviteCode)}
                    disabled={verifying || !inviteCode.trim()}
                  >
                    {verifying ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Verify"
                    )}
                  </Button>
                </div>
                {codeError && (
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4" />
                    {codeError}
                  </div>
                )}
              </div>

              <p className="text-xs text-muted-foreground text-center">
                You need an invite code from an existing administrator to register.
              </p>
            </div>
          )}

          {/* Step 2: Registration Form */}
          {codeVerified && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Code verified badge */}
              <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 text-emerald-700 text-sm">
                <CheckCircle2 className="h-4 w-4" />
                <span>
                  Invite code <code className="font-mono font-semibold">{inviteCode}</code> verified
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input
                    id="firstName"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                    disabled={submitting}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                    disabled={submitting}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={submitting || !!restrictedEmail}
                />
                {restrictedEmail && (
                  <p className="text-xs text-muted-foreground">
                    This invite is restricted to this email address
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  disabled={submitting}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  disabled={submitting}
                />
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating Account...
                  </>
                ) : (
                  "Create Admin Account"
                )}
              </Button>
            </form>
          )}
        </GlassCard>
      </div>
    </div>
  );
}

export default function AdminRegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <AdminRegisterContent />
    </Suspense>
  );
}
