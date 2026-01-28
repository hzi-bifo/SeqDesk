"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Building2,
  Users,
  ArrowRight,
  ArrowLeft,
  Loader2,
} from "lucide-react";

type UserRole = "RESEARCHER" | null;

interface Department {
  id: string;
  name: string;
  description: string | null;
}

const RESEARCHER_ROLES = [
  { value: "PI", label: "Principal Investigator (PI)" },
  { value: "POSTDOC", label: "Postdoctoral Researcher" },
  { value: "PHD_STUDENT", label: "PhD Student" },
  { value: "MASTER_STUDENT", label: "Master Student" },
  { value: "TECHNICIAN", label: "Lab Technician" },
  { value: "OTHER", label: "Other" },
];

export default function RegisterPage() {
  const router = useRouter();
  const [selectedRole, setSelectedRole] = useState<UserRole>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loadingDepartments, setLoadingDepartments] = useState(false);

  // Form fields
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [researcherRole, setResearcherRole] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [institution, setInstitution] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Fetch departments when form is shown
  useEffect(() => {
    if (selectedRole) {
      setLoadingDepartments(true);
      fetch("/api/departments")
        .then((res) => res.json())
        .then((data) => {
          setDepartments(data);
          setLoadingDepartments(false);
        })
        .catch(() => {
          setLoadingDepartments(false);
        });
    }
  }, [selectedRole]);

  const handleBack = () => {
    setSelectedRole(null);
    setError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Validation
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          firstName,
          lastName,
          role: selectedRole,
          researcherRole: researcherRole || undefined,
          departmentId: departmentId || undefined,
          institution: institution || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Registration failed");
        return;
      }

      // Redirect to login with success message
      router.push("/login?registered=true");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-8 bg-stone-50">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8 justify-center">
          <Link href="/" className="hover:opacity-90 transition-opacity">
            <span
              className="inline-block px-5 py-2 text-white text-xl border-2 border-blue-900"
              style={{
                fontFamily: 'Signifier, Georgia, serif',
                fontWeight: 500,
                transform: 'skewX(-8deg)',
                borderRadius: '6px',
                backgroundColor: '#1e3a8a',
                boxShadow: '0 4px 12px rgba(30, 58, 138, 0.3)',
              }}
            >
              <span style={{ display: 'inline-block', transform: 'skewX(8deg)' }}>SeqDesk</span>
            </span>
          </Link>
        </div>

        <GlassCard className="p-8 bg-white border border-stone-200 shadow-sm">
          {!selectedRole ? (
            <>
              <div className="text-center mb-8">
                <h2
                  className="text-2xl mb-2"
                  style={{ fontFamily: 'Signifier, Georgia, serif', fontWeight: 400 }}
                >
                  Create Account
                </h2>
                <p className="text-muted-foreground">
                  Select your account type
                </p>
              </div>

              <div className="space-y-4">
                <button
                  onClick={() => setSelectedRole("RESEARCHER")}
                  className="w-full p-5 rounded-2xl border border-border/50 hover:border-primary/40 hover:bg-primary/5 transition-all text-left group shadow-sm hover:shadow-md"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                      <Users className="h-6 w-6 text-primary" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg">Researcher</h3>
                      <p className="text-sm text-muted-foreground">
                        Submit samples and create sequencing orders
                      </p>
                    </div>
                  </div>
                </button>

                <Link
                  href="/register/admin"
                  className="w-full p-5 rounded-2xl border border-border/50 hover:border-primary/40 hover:bg-primary/5 transition-all text-left group shadow-sm hover:shadow-md block"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                      <Building2 className="h-6 w-6 text-primary" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg">Sequencing Facility</h3>
                      <p className="text-sm text-muted-foreground">
                        Manage orders and process samples
                      </p>
                      <p className="text-xs text-amber-600 mt-1">
                        Requires invite code
                      </p>
                    </div>
                  </div>
                </Link>
              </div>
            </>
          ) : (
            <>
              <div className="mb-6">
                <button
                  onClick={handleBack}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  disabled={isLoading}
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </button>
              </div>

              <div className="text-center mb-8">
                <div className="inline-flex h-12 w-12 rounded-lg bg-primary/10 items-center justify-center mb-4">
                  <Users className="h-6 w-6 text-primary" />
                </div>
                <h2 className="text-2xl font-bold mb-2">Researcher Account</h2>
                <p className="text-muted-foreground">
                  Create an account to submit sequencing orders
                </p>
              </div>

              {error && (
                <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">First Name</Label>
                    <Input
                      id="firstName"
                      placeholder="John"
                      className="bg-background/50"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      required
                      disabled={isLoading}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName">Last Name</Label>
                    <Input
                      id="lastName"
                      placeholder="Doe"
                      className="bg-background/50"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      required
                      disabled={isLoading}
                    />
                  </div>
                </div>

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
                  <Label htmlFor="researcherRole">Role</Label>
                  <select
                    id="researcherRole"
                    className="w-full h-10 px-3 rounded-md border border-input bg-background/50 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={researcherRole}
                    onChange={(e) => setResearcherRole(e.target.value)}
                    disabled={isLoading}
                  >
                    <option value="">Select your role...</option>
                    {RESEARCHER_ROLES.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="department">Research Department</Label>
                  <select
                    id="department"
                    className="w-full h-10 px-3 rounded-md border border-input bg-background/50 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={departmentId}
                    onChange={(e) => setDepartmentId(e.target.value)}
                    disabled={isLoading || loadingDepartments}
                  >
                    <option value="">Select department...</option>
                    {departments.map((dept) => (
                      <option key={dept.id} value={dept.id}>
                        {dept.name}
                      </option>
                    ))}
                  </select>
                  {loadingDepartments && (
                    <p className="text-xs text-muted-foreground">Loading departments...</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="institution">Institution (optional)</Label>
                  <Input
                    id="institution"
                    placeholder="University or Research Institute"
                    className="bg-background/50"
                    value={institution}
                    onChange={(e) => setInstitution(e.target.value)}
                    disabled={isLoading}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Create a password (min. 8 characters)"
                    className="bg-background/50"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={isLoading}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm Password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="Confirm your password"
                    className="bg-background/50"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    disabled={isLoading}
                  />
                </div>

                <Button type="submit" className="w-full" size="lg" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating account...
                    </>
                  ) : (
                    <>
                      Create Account
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </form>
            </>
          )}
        </GlassCard>

        <p className="text-center text-sm text-stone-500 mt-6">
          Already have an account?{" "}
          <Link href="/login" className="text-primary hover:underline font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
