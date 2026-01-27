"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowRight,
  Loader2,
} from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [checkingDb, setCheckingDb] = useState(true);

  // Check database status on mount
  useEffect(() => {
    const checkDatabase = async () => {
      try {
        const res = await fetch("/api/setup/status");
        const status = await res.json();
        if (!status.exists || !status.configured) {
          router.replace("/setup");
          return;
        }
      } catch {
        // If check fails, still allow login attempt (error will show on submit)
      }
      setCheckingDb(false);
    };
    checkDatabase();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("Invalid email or password");
      } else if (result?.ok) {
        router.push("/dashboard");
        router.refresh();
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // Show loading while checking database
  if (checkingDb) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8 bg-stone-50">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-8 bg-stone-50">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8 justify-center">
          <Link href="/" className="hover:opacity-90 transition-opacity">
            <span
              className="inline-flex items-center px-4 py-2 text-white text-lg border-2 border-blue-900"
              style={{
                fontFamily: 'Signifier, Georgia, serif',
                fontWeight: 500,
                backgroundColor: '#1e3a8a',
                transform: 'skewX(-8deg)',
                borderRadius: '4px',
                boxShadow: '0 2px 8px rgba(30, 58, 138, 0.3)',
              }}
            >
              <span style={{ display: 'inline-block', transform: 'skewX(8deg)' }}>SeqDesk</span>
            </span>
          </Link>
        </div>

        <GlassCard className="p-8 bg-white border border-stone-200 shadow-sm">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-semibold mb-2">
              Welcome back
            </h2>
            <p className="text-muted-foreground">
              Sign in to access your sequencing orders
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="name@example.com"
                className="bg-background/50"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  href="/forgot-password"
                  className="text-sm text-primary hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                className="bg-background/50"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>

            <Button type="submit" className="w-full" size="lg" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  Sign In
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </form>
        </GlassCard>

        <p className="text-center text-sm text-stone-500 mt-6">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="text-primary hover:underline font-medium">
            Create account
          </Link>
        </p>
      </div>
    </div>
  );
}
