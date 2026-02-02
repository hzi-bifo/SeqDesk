"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  Loader2,
} from "lucide-react";

export default function HomePage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [checkingDb, setCheckingDb] = useState(true);

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

  if (checkingDb) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: '#F7F7F4' }}>
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: '#171717' }} />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* Left Side - App Info */}
      <div
        className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12"
        style={{ background: '#EFEFE9' }}
      >
        <div>
          <div className="mb-12 flex items-center gap-3">
            <span className="text-lg font-semibold" style={{ color: '#171717' }}>
              SeqDesk
            </span>
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full"
              style={{ background: '#171717', color: '#ffffff' }}
            >
              v0.1.8
            </span>
          </div>

          <div className="max-w-lg">
            <h1
              className="text-3xl font-semibold mb-4"
              style={{ color: '#171717', letterSpacing: '-0.02em' }}
            >
              Sequencing Order Management
            </h1>
            <p className="text-base mb-10" style={{ color: '#525252', lineHeight: '1.6' }}>
              A platform for managing sequencing orders, tracking samples, and submitting to the European Nucleotide Archive.
            </p>

            <div className="mb-8">
              <h2
                className="text-xs font-medium uppercase mb-4"
                style={{ color: '#a3a3a3', letterSpacing: '0.1em' }}
              >
                For Researchers
              </h2>
              <ul className="space-y-2">
                {[
                  "Create sequencing orders with sample metadata",
                  "Track order status from submission to delivery",
                  "Download results and ENA accession numbers",
                ].map((item, i) => (
                  <li key={i} className="text-sm" style={{ color: '#525252' }}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="mb-10">
              <h2
                className="text-xs font-medium uppercase mb-4"
                style={{ color: '#a3a3a3', letterSpacing: '0.1em' }}
              >
                For Sequencing Facilities
              </h2>
              <ul className="space-y-2">
                {[
                  "Receive and manage incoming orders",
                  "Update order status throughout the workflow",
                  "Submit metadata to ENA and run pipelines",
                ].map((item, i) => (
                  <li key={i} className="text-sm" style={{ color: '#525252' }}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid grid-cols-2 gap-x-8 gap-y-4">
              {[
                { title: "MIxS Standards", subtitle: "17 environmental checklists" },
                { title: "ENA Submission", subtitle: "Direct archive upload" },
                { title: "Spreadsheet Entry", subtitle: "Excel-like bulk editing" },
                { title: "Order Tracking", subtitle: "Real-time status updates" },
              ].map((feature, i) => (
                <div key={i}>
                  <h3 className="font-medium text-sm" style={{ color: '#171717' }}>
                    {feature.title}
                  </h3>
                  <p className="text-xs" style={{ color: '#a3a3a3' }}>
                    {feature.subtitle}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-xs" style={{ color: '#a3a3a3' }}>
          SeqDesk v0.1.8 — Install flow improvements
        </div>
      </div>

      {/* Right Side - Login */}
      <div
        className="flex-1 flex items-center justify-center p-8"
        style={{ background: '#F7F7F4' }}
      >
        <div className="w-full max-w-md">
          {/* Mobile Logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            <span className="text-xl font-semibold" style={{ color: '#171717' }}>
              SeqDesk
            </span>
          </div>

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
              <h2
                className="text-xl font-semibold mb-2"
                style={{ color: '#171717' }}
              >
                Sign In
              </h2>
              <p className="text-sm" style={{ color: '#525252' }}>
                Access your sequencing orders
              </p>
            </div>

            {error && (
              <div
                className="mb-5 p-3 rounded-xl text-sm"
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
                <div className="flex items-center justify-between mb-2">
                  <label
                    htmlFor="password"
                    className="block text-sm font-medium"
                    style={{ color: '#171717' }}
                  >
                    Password
                  </label>
                  <Link
                    href="/forgot-password"
                    className="text-sm no-underline"
                    style={{ color: '#525252' }}
                  >
                    Forgot password?
                  </Link>
                </div>
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

          <p
            className="text-center text-sm mt-6"
            style={{ color: '#a3a3a3' }}
          >
            Don&apos;t have an account?{" "}
            <Link
              href="/register"
              className="font-medium no-underline"
              style={{ color: '#171717' }}
            >
              Create account
            </Link>
          </p>

          {/* Mobile App Info */}
          <div className="lg:hidden mt-8 text-center text-sm" style={{ color: '#a3a3a3' }}>
            <p>Microbiome sequencing order management for researchers and facilities</p>
          </div>
        </div>
      </div>
    </div>
  );
}
