"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
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

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [researcherRole, setResearcherRole] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [institution, setInstitution] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

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

      router.push("/login?registered=true");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const inputStyle = {
    background: '#F7F7F4',
    border: '1px solid #e5e5e0',
    color: '#171717'
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#EFEFE9' }}>
      {/* Header */}
      <header className="py-4 px-6 flex items-center justify-between max-w-[1200px] mx-auto w-full">
        <Link href="/" className="text-lg font-semibold no-underline" style={{ color: '#171717' }}>
          SeqDesk
        </Link>
        <nav className="flex items-center gap-2">
          <Link
            href="/login"
            className="px-4 py-2 text-sm rounded-lg transition-colors no-underline"
            style={{ color: '#525252' }}
          >
            Sign in
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
            {!selectedRole ? (
              <>
                <div className="text-center mb-8">
                  <h1
                    className="text-2xl font-semibold mb-2"
                    style={{ color: '#171717', letterSpacing: '-0.02em' }}
                  >
                    Create Account
                  </h1>
                  <p style={{ color: '#525252', fontSize: '0.9375rem' }}>
                    Select your account type
                  </p>
                </div>

                <div className="space-y-3">
                  <button
                    onClick={() => setSelectedRole("RESEARCHER")}
                    className="w-full p-5 rounded-xl text-left transition-all"
                    style={{
                      background: '#F7F7F4',
                      border: '1px solid #e5e5e0'
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.borderColor = '#a3a3a3';
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.borderColor = '#e5e5e0';
                    }}
                  >
                    <h3 className="font-semibold text-base mb-1" style={{ color: '#171717' }}>
                      Researcher
                    </h3>
                    <p className="text-sm" style={{ color: '#525252' }}>
                      Submit samples and create sequencing orders
                    </p>
                  </button>

                  <Link
                    href="/register/admin"
                    className="w-full p-5 rounded-xl text-left transition-all block no-underline"
                    style={{
                      background: '#F7F7F4',
                      border: '1px solid #e5e5e0'
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.borderColor = '#a3a3a3';
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.borderColor = '#e5e5e0';
                    }}
                  >
                    <h3 className="font-semibold text-base mb-1" style={{ color: '#171717' }}>
                      Sequencing Facility
                    </h3>
                    <p className="text-sm" style={{ color: '#525252' }}>
                      Manage orders and process samples
                    </p>
                    <p className="text-xs mt-1" style={{ color: '#d97706' }}>
                      Requires invite code
                    </p>
                  </Link>
                </div>
              </>
            ) : (
              <>
                <div className="mb-6">
                  <button
                    onClick={handleBack}
                    className="flex items-center gap-2 text-sm transition-colors"
                    style={{ color: '#525252' }}
                    disabled={isLoading}
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                  </button>
                </div>

                <div className="text-center mb-8">
                  <h2 className="text-xl font-semibold mb-2" style={{ color: '#171717' }}>
                    Researcher Account
                  </h2>
                  <p className="text-sm" style={{ color: '#525252' }}>
                    Create an account to submit sequencing orders
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

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-2" style={{ color: '#171717' }}>
                        First Name
                      </label>
                      <input
                        type="text"
                        placeholder="John"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        required
                        disabled={isLoading}
                        className="w-full h-10 px-3 text-sm rounded-xl outline-none transition-all disabled:opacity-50"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2" style={{ color: '#171717' }}>
                        Last Name
                      </label>
                      <input
                        type="text"
                        placeholder="Doe"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        required
                        disabled={isLoading}
                        className="w-full h-10 px-3 text-sm rounded-xl outline-none transition-all disabled:opacity-50"
                        style={inputStyle}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: '#171717' }}>
                      Email
                    </label>
                    <input
                      type="email"
                      placeholder="name@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      disabled={isLoading}
                      className="w-full h-10 px-3 text-sm rounded-xl outline-none transition-all disabled:opacity-50"
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: '#171717' }}>
                      Role
                    </label>
                    <select
                      value={researcherRole}
                      onChange={(e) => setResearcherRole(e.target.value)}
                      disabled={isLoading}
                      className="w-full h-10 px-3 text-sm rounded-xl outline-none transition-all disabled:opacity-50"
                      style={inputStyle}
                    >
                      <option value="">Select your role...</option>
                      {RESEARCHER_ROLES.map((role) => (
                        <option key={role.value} value={role.value}>
                          {role.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: '#171717' }}>
                      Research Department
                    </label>
                    <select
                      value={departmentId}
                      onChange={(e) => setDepartmentId(e.target.value)}
                      disabled={isLoading || loadingDepartments}
                      className="w-full h-10 px-3 text-sm rounded-xl outline-none transition-all disabled:opacity-50"
                      style={inputStyle}
                    >
                      <option value="">Select department...</option>
                      {departments.map((dept) => (
                        <option key={dept.id} value={dept.id}>
                          {dept.name}
                        </option>
                      ))}
                    </select>
                    {loadingDepartments && (
                      <p className="text-xs mt-1" style={{ color: '#a3a3a3' }}>
                        Loading departments...
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: '#171717' }}>
                      Institution (optional)
                    </label>
                    <input
                      type="text"
                      placeholder="University or Research Institute"
                      value={institution}
                      onChange={(e) => setInstitution(e.target.value)}
                      disabled={isLoading}
                      className="w-full h-10 px-3 text-sm rounded-xl outline-none transition-all disabled:opacity-50"
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: '#171717' }}>
                      Password
                    </label>
                    <input
                      type="password"
                      placeholder="Create a password (min. 8 characters)"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      disabled={isLoading}
                      className="w-full h-10 px-3 text-sm rounded-xl outline-none transition-all disabled:opacity-50"
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: '#171717' }}>
                      Confirm Password
                    </label>
                    <input
                      type="password"
                      placeholder="Confirm your password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      disabled={isLoading}
                      className="w-full h-10 px-3 text-sm rounded-xl outline-none transition-all disabled:opacity-50"
                      style={inputStyle}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full h-11 flex items-center justify-center gap-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 mt-6"
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
                        Creating account...
                      </>
                    ) : (
                      <>
                        Create Account
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </button>
                </form>
              </>
            )}
          </div>

          <p className="text-center text-sm mt-6" style={{ color: '#a3a3a3' }}>
            Already have an account?{" "}
            <Link href="/login" className="font-medium no-underline" style={{ color: '#171717' }}>
              Sign in
            </Link>
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 px-6" style={{ borderTop: '1px solid #e5e5e0' }}>
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
