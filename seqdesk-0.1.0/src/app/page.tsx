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
  Users,
  ArrowRight,
  Database,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  Loader2,
} from "lucide-react";

// SeqDesk Logo Component - CSS-based skewed text
function SeqDeskLogo({ size = "default" }: { size?: "small" | "default" | "large" }) {
  const sizeClasses = {
    small: "px-2 py-1 text-sm",
    default: "px-3 py-1.5 text-base",
    large: "px-5 py-2 text-xl",
  };

  return (
    <span
      className={`inline-block text-white border-2 border-blue-900 ${sizeClasses[size]}`}
      style={{
        fontFamily: 'Signifier, Georgia, serif',
        fontWeight: 500,
        transform: 'skewX(-8deg)',
        borderRadius: '4px',
        backgroundColor: '#1e3a8a',
        boxShadow: '0 2px 8px rgba(30, 58, 138, 0.3)',
      }}
    >
      <span style={{ display: 'inline-block', transform: 'skewX(8deg)' }}>SeqDesk</span>
    </span>
  );
}

export default function HomePage() {
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
        // If check fails, still allow login attempt
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
      <div className="flex min-h-screen items-center justify-center bg-stone-50">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* Left Side - App Info */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 bg-stone-50">
        <div>
          <div className="flex items-center gap-3 mb-12">
            <SeqDeskLogo size="default" />
          </div>

          <div className="max-w-lg">
            <h1 className="text-2xl font-semibold text-stone-900 tracking-tight mb-3">
              Sequencing Order Management
            </h1>
            <p className="text-stone-500 text-base mb-8">
              A platform for managing sequencing orders, tracking samples, and submitting to the European Nucleotide Archive.
            </p>

            <div className="mb-6">
              <h2 className="text-xs font-medium uppercase text-stone-400 mb-3 tracking-wide">
                For Researchers
              </h2>
              <ul className="space-y-2">
                {[
                  "Create sequencing orders with sample metadata",
                  "Track order status from submission to delivery",
                  "Download results and ENA accession numbers",
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm text-stone-600">
                    <CheckCircle2 className="h-4 w-4 text-stone-400 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mb-8">
              <h2 className="text-xs font-medium uppercase text-stone-400 mb-3 tracking-wide">
                For Sequencing Facilities
              </h2>
              <ul className="space-y-2">
                {[
                  "Receive and manage incoming orders",
                  "Update order status throughout the workflow",
                  "Submit metadata to ENA and run pipelines",
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm text-stone-600">
                    <CheckCircle2 className="h-4 w-4 text-stone-400 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-md bg-stone-100 flex items-center justify-center shrink-0 mt-0.5">
                  <Database className="h-4 w-4 text-stone-500" />
                </div>
                <div>
                  <h3 className="font-medium text-sm text-stone-700">MIxS Standards</h3>
                  <p className="text-xs text-stone-400">
                    17 environmental checklists
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-md bg-stone-100 flex items-center justify-center shrink-0 mt-0.5">
                  <Upload className="h-4 w-4 text-stone-500" />
                </div>
                <div>
                  <h3 className="font-medium text-sm text-stone-700">ENA Submission</h3>
                  <p className="text-xs text-stone-400">
                    Direct archive upload
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-md bg-stone-100 flex items-center justify-center shrink-0 mt-0.5">
                  <FileSpreadsheet className="h-4 w-4 text-stone-500" />
                </div>
                <div>
                  <h3 className="font-medium text-sm text-stone-700">Spreadsheet Entry</h3>
                  <p className="text-xs text-stone-400">
                    Excel-like bulk editing
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-md bg-stone-100 flex items-center justify-center shrink-0 mt-0.5">
                  <Users className="h-4 w-4 text-stone-500" />
                </div>
                <div>
                  <h3 className="font-medium text-sm text-stone-700">Order Tracking</h3>
                  <p className="text-xs text-stone-400">
                    Real-time status updates
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side - Login */}
      <div className="flex-1 flex items-center justify-center p-8 bg-white">
        <div className="w-full max-w-md">
          {/* Mobile Logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            <SeqDeskLogo size="large" />
          </div>

          <div className="p-8">
            <div className="text-center mb-8">
              <h2 className="text-xl font-semibold text-stone-900 mb-1">
                Sign In
              </h2>
              <p className="text-stone-500 text-sm">
                Access your sequencing orders
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
          </div>

          <p className="text-center text-sm text-muted-foreground mt-6">
            Don&apos;t have an account?{" "}
            <Link href="/register" className="text-primary hover:underline font-medium">
              Create account
            </Link>
          </p>

          {/* Mobile App Info */}
          <div className="lg:hidden mt-8 text-center text-sm text-muted-foreground">
            <p>Microbiome sequencing order management for researchers and facilities</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export { SeqDeskLogo };
