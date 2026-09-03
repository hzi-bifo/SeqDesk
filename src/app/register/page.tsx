"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, Loader2, Shield } from "lucide-react";

type DeploymentProfileId =
  | "sequencing-center"
  | "shared-lab"
  | "research-workbench";
type SystemRole = "MEMBER" | "ADMIN";
type FacilityWorkflowRole = "REQUESTER" | "OPERATOR";

interface InviteGrant {
  systemRole: SystemRole;
  facilityWorkflowRole: FacilityWorkflowRole;
}

interface Department {
  id: string;
  name: string;
}

const RESEARCHER_ROLES = [
  { value: "PI", label: "Principal Investigator (PI)" },
  { value: "POSTDOC", label: "Postdoctoral Researcher" },
  { value: "PHD_STUDENT", label: "PhD Student" },
  { value: "MASTER_STUDENT", label: "Master Student" },
  { value: "TECHNICIAN", label: "Lab Technician" },
  { value: "OTHER", label: "Other" },
];

const PROFILE_COPY: Record<
  DeploymentProfileId,
  { title: string; description: string }
> = {
  "sequencing-center": {
    title: "Researcher account",
    description: "Create an account to submit and manage sequencing requests",
  },
  "shared-lab": {
    title: "Lab member account",
    description: "Join your lab's shared sequencing and analysis workspace",
  },
  "research-workbench": {
    title: "Workbench member account",
    description: "Join this workbench to import data and run analyses",
  },
};

export default function RegisterPage() {
  const router = useRouter();
  const [deploymentProfile, setDeploymentProfile] =
    useState<DeploymentProfileId>("sequencing-center");
  const [inviteOnly, setInviteOnly] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loadingDepartments, setLoadingDepartments] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteGrant, setInviteGrant] = useState<InviteGrant | null>(null);
  const [verifyingInvite, setVerifyingInvite] = useState(false);
  const [inviteNotice, setInviteNotice] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [researcherRole, setResearcherRole] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [institution, setInstitution] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const copy = PROFILE_COPY[deploymentProfile];
  const showRequesterMetadata =
    deploymentProfile === "sequencing-center" &&
    inviteGrant?.facilityWorkflowRole !== "OPERATOR";

  const verifyInviteCode = useCallback(async (rawCode: string) => {
    const code = rawCode.trim().toUpperCase();
    if (!code) {
      setInviteNotice("Enter an invitation code first");
      return;
    }

    setVerifyingInvite(true);
    setInviteNotice("");
    setInviteGrant(null);
    try {
      const response = await fetch("/api/admin/invites/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = (await response.json().catch(() => null)) as
        | { valid?: boolean; error?: string; grant?: InviteGrant }
        | null;
      if (!response.ok || !body?.valid || !body.grant) {
        throw new Error(body?.error || "Invalid invitation code");
      }
      setInviteCode(code);
      setInviteGrant(body.grant);
    } catch (inviteError) {
      setInviteNotice(
        inviteError instanceof Error
          ? inviteError.message
          : "Could not verify this invitation"
      );
    } finally {
      setVerifyingInvite(false);
    }
  }, []);

  useEffect(() => {
    const codeFromUrl = new URLSearchParams(window.location.search).get("code");
    if (codeFromUrl) {
      setInviteCode(codeFromUrl.toUpperCase());
      void verifyInviteCode(codeFromUrl);
    }

    fetch("/api/setup/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => {
        const id = body?.deploymentProfile?.id;
        if (
          id === "sequencing-center" ||
          id === "shared-lab" ||
          id === "research-workbench"
        ) {
          setDeploymentProfile(id);
        }
        setInviteOnly(body?.enrollment?.policy === "invite-only");
      })
      .catch(() => {
        // The registration endpoint remains authoritative.
      });
  }, [verifyInviteCode]);

  useEffect(() => {
    if (!showRequesterMetadata) return;
    setLoadingDepartments(true);
    fetch("/api/departments")
      .then((response) => response.json())
      .then((body) => setDepartments(Array.isArray(body) ? body : []))
      .catch(() => setDepartments([]))
      .finally(() => setLoadingDepartments(false));
  }, [showRequesterMetadata]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");

    if (inviteOnly && !inviteCode.trim()) {
      setError("This installation requires an invitation code");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (new TextEncoder().encode(password).length > 72) {
      setError("Password must be at most 72 bytes");
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          firstName,
          lastName,
          inviteCode: inviteCode.trim() || undefined,
          researcherRole: showRequesterMetadata
            ? researcherRole || undefined
            : undefined,
          departmentId: showRequesterMetadata ? departmentId || undefined : undefined,
          institution: showRequesterMetadata ? institution || undefined : undefined,
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(body?.error || "Registration failed");
      }
      router.push("/login?registered=true");
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setIsLoading(false);
    }
  };

  const inputClass =
    "w-full h-10 px-3 text-sm rounded-xl outline-none transition-all disabled:opacity-50 bg-[#F7F7F4] border border-[#e5e5e0] text-[#171717]";

  return (
    <div className="min-h-screen flex flex-col bg-[#EFEFE9]">
      <header className="py-4 px-6 flex items-center justify-between max-w-[1200px] mx-auto w-full">
        <Link href="/" className="text-lg font-semibold no-underline text-[#171717]">
          SeqDesk
        </Link>
        <Link href="/login" className="px-4 py-2 text-sm no-underline text-[#525252]">
          Sign in
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-[#e5e5e0] bg-white p-8 shadow-sm">
            <div className="text-center mb-7">
              <h1 className="text-2xl font-semibold tracking-tight text-[#171717]">
                {inviteGrant?.systemRole === "ADMIN"
                  ? "Administrator account"
                  : copy.title}
              </h1>
              <p className="mt-2 text-sm text-[#525252]">
                {inviteGrant?.systemRole === "ADMIN"
                  ? "Administrators use the same sign-in and can additionally configure SeqDesk"
                  : copy.description}
              </p>
            </div>

            {error && (
              <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2 text-[#171717]">
                  {inviteOnly ? "Invitation code" : "Invitation code (optional)"}
                </label>
                <div className="flex gap-2">
                  <input
                    value={inviteCode}
                    onChange={(event) => {
                      setInviteCode(event.target.value.toUpperCase());
                      setInviteGrant(null);
                      setInviteNotice("");
                    }}
                    required={inviteOnly}
                    disabled={isLoading || verifyingInvite}
                    className={inputClass}
                    placeholder="Code from your administrator"
                  />
                  <button
                    type="button"
                    onClick={() => void verifyInviteCode(inviteCode)}
                    disabled={!inviteCode.trim() || verifyingInvite || isLoading}
                    className="h-10 px-4 rounded-lg border text-sm font-medium disabled:opacity-50"
                  >
                    {verifyingInvite ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify"}
                  </button>
                </div>
                {inviteNotice && <p className="mt-1 text-xs text-red-600">{inviteNotice}</p>}
                {inviteGrant && (
                  <div className="mt-2 flex items-start gap-2 rounded-lg bg-emerald-50 p-2.5 text-xs text-emerald-800">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>
                      Invitation verified: {inviteGrant.systemRole === "ADMIN" ? "administrator" : "member"}
                      {deploymentProfile === "sequencing-center"
                        ? `, ${inviteGrant.facilityWorkflowRole === "OPERATOR" ? "facility operator" : "requester"}`
                        : ""}
                    </span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">First name</label>
                  <input value={firstName} onChange={(event) => setFirstName(event.target.value)} required disabled={isLoading} className={inputClass} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Last name</label>
                  <input value={lastName} onChange={(event) => setLastName(event.target.value)} required disabled={isLoading} className={inputClass} />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Email</label>
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={isLoading} className={inputClass} />
              </div>

              {showRequesterMetadata && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-2">Research role</label>
                    <select value={researcherRole} onChange={(event) => setResearcherRole(event.target.value)} disabled={isLoading} className={inputClass}>
                      <option value="">Select your role...</option>
                      {RESEARCHER_ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Research department</label>
                    <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} disabled={isLoading || loadingDepartments} className={inputClass}>
                      <option value="">Select department...</option>
                      {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Institution (optional)</label>
                    <input value={institution} onChange={(event) => setInstitution(event.target.value)} disabled={isLoading} className={inputClass} />
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-medium mb-2">Password</label>
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={72} required disabled={isLoading} className={inputClass} />
                <p className="mt-1 text-xs text-[#737373]">8–72 UTF-8 bytes</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Confirm password</label>
                <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required disabled={isLoading} className={inputClass} />
              </div>

              {inviteGrant?.systemRole === "ADMIN" && (
                <div className="flex gap-2 rounded-lg border bg-stone-50 p-3 text-xs text-[#525252]">
                  <Shield className="h-4 w-4 shrink-0" />
                  This invitation grants installation configuration access. It does not create a separate login type.
                </div>
              )}

              <button type="submit" disabled={isLoading} className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#171717] text-sm font-medium text-white disabled:opacity-50">
                {isLoading ? <><Loader2 className="h-4 w-4 animate-spin" />Creating account...</> : <>Create account<ArrowRight className="h-4 w-4" /></>}
              </button>
            </form>
          </div>

          <p className="text-center text-sm mt-6 text-[#737373]">
            Already have an account? <Link href="/login" className="font-medium text-[#171717] no-underline">Sign in</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
