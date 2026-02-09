"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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

  useEffect(() => {
    const checkDatabase = async () => {
      try {
        const res = await fetch("/api/setup/status", { cache: "no-store" });
        if (!res.ok) {
          throw new Error("Failed to load setup status");
        }
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

  if (checkingDb) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#EFEFE9' }}>
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: '#171717' }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#EFEFE9' }}>
      {/* Header */}
      <header className="py-4 px-6 flex items-center justify-between max-w-[1200px] mx-auto w-full">
        <Link
          href="/"
          className="text-lg font-semibold no-underline"
          style={{ color: '#171717' }}
        >
          SeqDesk
        </Link>
        <nav className="flex items-center gap-2">
          <Link
            href="/register"
            className="px-4 py-2 text-sm rounded-lg transition-colors no-underline"
            style={{ color: '#525252' }}
          >
            Create account
          </Link>
        </nav>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          {/* Card */}
          <div
            className="rounded-2xl p-8"
            style={{
              background: '#ffffff',
              border: '1px solid #e5e5e0',
              boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
            }}
          >
            <div className="text-center mb-8">
              <h1
                className="text-2xl font-semibold mb-2"
                style={{ color: '#171717', letterSpacing: '-0.02em' }}
              >
                Welcome back
              </h1>
              <p style={{ color: '#525252', fontSize: '0.9375rem' }}>
                Sign in to access your sequencing orders
              </p>
            </div>

            {error && (
              <div
                className="mb-6 p-3 rounded-xl text-sm"
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#dc2626'
                }}
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium mb-2"
                  style={{ color: '#171717' }}
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={isLoading}
                  className="w-full h-11 px-4 text-sm rounded-xl outline-none transition-all disabled:opacity-50"
                  style={{
                    background: '#F7F7F4',
                    border: '1px solid #e5e5e0',
                    color: '#171717'
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#a3a3a3';
                    e.target.style.boxShadow = '0 0 0 3px rgba(163, 163, 163, 0.1)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = '#e5e5e0';
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium mb-2"
                  style={{ color: '#171717' }}
                >
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={isLoading}
                  className="w-full h-11 px-4 text-sm rounded-xl outline-none transition-all disabled:opacity-50"
                  style={{
                    background: '#F7F7F4',
                    border: '1px solid #e5e5e0',
                    color: '#171717'
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#a3a3a3';
                    e.target.style.boxShadow = '0 0 0 3px rgba(163, 163, 163, 0.1)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = '#e5e5e0';
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-11 flex items-center justify-center gap-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                style={{
                  background: '#171717',
                  color: '#ffffff'
                }}
                onMouseOver={(e) => !isLoading && (e.currentTarget.style.background = '#404040')}
                onMouseOut={(e) => (e.currentTarget.style.background = '#171717')}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    Sign In
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>
          </div>

          <div className="text-center text-sm mt-6 space-y-2">
            <p style={{ color: '#a3a3a3' }}>
              Don&apos;t have an account?{" "}
              <Link
                href="/register"
                className="font-medium no-underline transition-colors"
                style={{ color: '#171717' }}
              >
                Create account
              </Link>
            </p>
            <p>
              <Link
                href="/forgot-password"
                className="no-underline transition-colors"
                style={{ color: '#a3a3a3' }}
              >
                Forgot password?
              </Link>
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer
        className="py-6 px-6"
        style={{ borderTop: '1px solid #e5e5e0' }}
      >
        <div className="max-w-[1200px] mx-auto flex justify-between items-center">
          <span className="text-sm font-semibold" style={{ color: '#a3a3a3' }}>
            SeqDesk
          </span>
          <div className="flex gap-6">
            <Link href="/impressum" className="text-sm no-underline" style={{ color: '#a3a3a3' }}>
              Impressum
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
