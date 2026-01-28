"use client";

import { useState, useEffect } from "react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PageContainer } from "@/components/layout/PageContainer";
import { toast } from "sonner";
import {
  Globe,
  Loader2,
  AlertTriangle,
  Check,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  ExternalLink,
  History,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface Submission {
  id: string;
  submissionType: string;
  status: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  response: string | null;
  xmlContent: string | null;
  accessionNumbers: string | null;
  entityDetails?: {
    title?: string;
    alias?: string;
  };
}

export default function ENASettingsPage() {
  const [saving, setSaving] = useState(false);

  // ENA settings
  const [enaUsername, setEnaUsername] = useState("");
  const [enaPassword, setEnaPassword] = useState("");
  const [enaHasPassword, setEnaHasPassword] = useState(false);
  const [enaTestMode, setEnaTestMode] = useState(true);
  const [enaConfigured, setEnaConfigured] = useState(false);
  const [enaSaved, setEnaSaved] = useState(false);
  const [showEnaPassword, setShowEnaPassword] = useState(false);
  const [testingEna, setTestingEna] = useState(false);
  const [enaTestResult, setEnaTestResult] = useState<{
    success: boolean;
    message?: string;
    error?: string;
    server?: string;
  } | null>(null);

  // Submissions history
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [expandedSubmission, setExpandedSubmission] = useState<string | null>(null);

  useEffect(() => {
    fetchEnaSettings();
    fetchSubmissions();
  }, []);

  const fetchSubmissions = async () => {
    setLoadingSubmissions(true);
    try {
      const res = await fetch("/api/admin/submissions");
      if (res.ok) {
        const data = await res.json();
        setSubmissions(data);
      }
    } catch (error) {
      console.error("Failed to load submissions:", error);
    } finally {
      setLoadingSubmissions(false);
    }
  };

  const fetchEnaSettings = async () => {
    try {
      const res = await fetch("/api/admin/settings/ena");
      const data = await res.json();
      setEnaUsername(data.enaUsername || "");
      setEnaHasPassword(data.hasPassword || false);
      setEnaTestMode(data.enaTestMode ?? true);
      setEnaConfigured(data.configured || false);
    } catch (error) {
      console.error("Failed to load ENA settings:", error);
    }
  };

  const handleSaveEnaSettings = async () => {
    setSaving(true);
    setEnaSaved(false);
    setEnaTestResult(null);

    try {
      const updateData: Record<string, unknown> = {
        enaUsername,
        enaTestMode,
      };

      // Only send password if user entered a new one
      if (enaPassword) {
        updateData.enaPassword = enaPassword;
      }

      await fetch("/api/admin/settings/ena", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      });

      setEnaSaved(true);
      setEnaPassword(""); // Clear password field after save
      setEnaHasPassword(Boolean(enaUsername && (enaPassword || enaHasPassword)));
      setEnaConfigured(Boolean(enaUsername && (enaPassword || enaHasPassword)));
      setTimeout(() => setEnaSaved(false), 3000);
    } catch (error) {
      console.error("Failed to save ENA settings:", error);
      toast.error("Failed to save ENA settings");
    } finally {
      setSaving(false);
    }
  };

  const handleTestEnaConnection = async () => {
    setTestingEna(true);
    setEnaTestResult(null);

    try {
      // Send credentials in request body so we can test before saving
      const requestBody: Record<string, unknown> = {
        enaUsername,
        enaTestMode,
      };

      if (enaPassword) {
        // User entered a new password - use it
        requestBody.enaPassword = enaPassword;
      } else if (enaHasPassword) {
        // No new password entered but saved password exists - use saved
        requestBody.useSavedPassword = true;
      }

      const res = await fetch("/api/admin/settings/ena/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const result = await res.json();
      setEnaTestResult(result);
    } catch (error) {
      console.error("Failed to test ENA connection:", error);
      setEnaTestResult({ success: false, error: "Connection test failed" });
    } finally {
      setTestingEna(false);
    }
  };

  const handleClearEnaCredentials = async () => {
    setSaving(true);
    try {
      await fetch("/api/admin/settings/ena", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enaUsername: "",
          enaPassword: "",
        }),
      });
      setEnaUsername("");
      setEnaPassword("");
      setEnaHasPassword(false);
      setEnaConfigured(false);
      setEnaTestResult(null);
      toast.success("ENA credentials cleared");
    } catch (error) {
      console.error("Failed to clear ENA credentials:", error);
      toast.error("Failed to clear credentials");
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageContainer maxWidth="medium">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">ENA Settings</h1>
        <p className="text-muted-foreground mt-1">
          Configure connection to the European Nucleotide Archive for study and sample registration
        </p>
      </div>

      <GlassCard className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
            <Globe className="h-5 w-5 text-blue-600" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold">ENA Connection</h2>
            <p className="text-sm text-muted-foreground">
              Webin account credentials for submitting to ENA
            </p>
          </div>
          {enaConfigured && (
            <span className="text-sm text-green-600 bg-green-50 px-2 py-1 rounded-full flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Configured
            </span>
          )}
        </div>

        <div className="border-t pt-4 space-y-6">
          {/* What is ENA */}
          <div className="p-4 rounded-lg bg-blue-50 border border-blue-100">
            <p className="text-sm text-blue-800">
              <strong>What is ENA?</strong> The European Nucleotide Archive (ENA) is a public database for nucleotide sequences.
              Submitting your studies and samples to ENA is required for publication and provides permanent accession numbers
              (e.g., PRJEB12345 for studies, SAMEA12345 for samples).
            </p>
          </div>

          {/* Submission Mode */}
          <div className="space-y-3">
            <Label className="text-base font-medium">Submission Server</Label>
            <div className="space-y-2">
              <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-stone-50 transition-colors">
                <input
                  type="radio"
                  name="enaMode"
                  checked={enaTestMode}
                  onChange={() => {
                    setEnaTestMode(true);
                    setEnaTestResult(null);
                  }}
                  className="mt-0.5"
                  disabled={saving}
                />
                <div className="flex-1">
                  <p className="font-medium">Test Server</p>
                  <p className="text-sm text-muted-foreground">
                    wwwdev.ebi.ac.uk - Use this for testing. Data is automatically deleted after 24 hours.
                    Accession numbers are real but temporary.
                  </p>
                </div>
              </label>
              <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-stone-50 transition-colors">
                <input
                  type="radio"
                  name="enaMode"
                  checked={!enaTestMode}
                  onChange={() => {
                    setEnaTestMode(false);
                    setEnaTestResult(null);
                  }}
                  className="mt-0.5"
                  disabled={saving}
                />
                <div className="flex-1">
                  <p className="font-medium">Production Server</p>
                  <p className="text-sm text-muted-foreground">
                    www.ebi.ac.uk - For final submissions. Data becomes permanent and publicly accessible.
                  </p>
                </div>
              </label>
            </div>
            {!enaTestMode && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                <span>Production submissions are permanent and cannot be deleted. Test thoroughly first!</span>
              </div>
            )}
          </div>

          {/* Credentials */}
          <div className="space-y-3">
            <Label className="text-base font-medium">Webin Account Credentials</Label>
            <div className="p-4 rounded-lg bg-stone-50 border border-stone-200 text-sm text-muted-foreground space-y-2">
              <p>
                You need a Webin account to submit data to ENA. If you don&apos;t have one:
              </p>
              <ol className="list-decimal list-inside space-y-1 ml-2">
                <li>
                  Go to{" "}
                  <a
                    href="https://www.ebi.ac.uk/ena/submit/webin/accountInfo"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline inline-flex items-center gap-1"
                  >
                    ENA Webin Account Registration
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>Register with your institution email</li>
                <li>Your username will be in the format <span className="font-mono bg-stone-200 px-1 rounded">Webin-XXXXX</span></li>
              </ol>
            </div>

            <div className="grid gap-4 pt-2">
              <div className="space-y-1.5">
                <Label htmlFor="ena-username">Webin Username</Label>
                <Input
                  id="ena-username"
                  value={enaUsername}
                  onChange={(e) => {
                    setEnaUsername(e.target.value);
                    setEnaTestResult(null);
                  }}
                  placeholder="Webin-12345"
                  disabled={saving}
                />
                <p className="text-xs text-muted-foreground">
                  Your Webin submission account ID (e.g., Webin-12345)
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ena-password">Password</Label>
                <div className="relative">
                  <Input
                    id="ena-password"
                    type={showEnaPassword ? "text" : "password"}
                    value={enaPassword}
                    onChange={(e) => {
                      setEnaPassword(e.target.value);
                      setEnaTestResult(null);
                    }}
                    placeholder={enaHasPassword ? "••••••••••••" : "Enter your Webin password"}
                    disabled={saving}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowEnaPassword(!showEnaPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showEnaPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                {enaHasPassword && !enaPassword && (
                  <p className="text-xs text-green-600">
                    Password is saved. Enter a new password to change it.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Test Connection Result */}
          {enaTestResult && (
            <div
              className={`p-3 rounded-lg text-sm flex items-start gap-2 ${
                enaTestResult.success
                  ? "bg-green-50 text-green-800"
                  : "bg-red-50 text-red-800"
              }`}
            >
              {enaTestResult.success ? (
                <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              )}
              <div>
                <p className="font-medium">
                  {enaTestResult.success ? "Connection successful!" : "Connection failed"}
                </p>
                <p className="text-xs mt-0.5 opacity-80">
                  {enaTestResult.message || enaTestResult.error}
                </p>
                {enaTestResult.server && (
                  <p className="text-xs mt-0.5 opacity-60">
                    Server: {enaTestResult.server}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2">
            <Button
              variant="outline"
              onClick={handleTestEnaConnection}
              disabled={saving || testingEna || !enaUsername || (!enaPassword && !enaHasPassword)}
            >
              {testingEna ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Test Connection
            </Button>
            <Button
              onClick={handleSaveEnaSettings}
              disabled={saving || !enaUsername || !enaTestResult?.success}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : enaSaved ? (
                <Check className="h-4 w-4 mr-2 text-green-500" />
              ) : null}
              {enaSaved ? "Saved!" : "Save Credentials"}
            </Button>
            {enaConfigured && (
              <Button
                variant="outline"
                onClick={handleClearEnaCredentials}
                disabled={saving}
                className="text-red-600 hover:text-red-700"
              >
                Clear Credentials
              </Button>
            )}
          </div>

          {/* Help text for the flow */}
          {!enaTestResult?.success && enaUsername && (enaPassword || enaHasPassword) && (
            <p className="text-sm text-muted-foreground">
              Test your credentials first. You can only save after the connection test passes.
            </p>
          )}

          {/* Info Box */}
          {!enaConfigured && (
            <div className="p-4 rounded-lg bg-amber-50 border border-amber-200">
              <p className="text-sm text-amber-800">
                <strong>Required:</strong> ENA credentials must be configured before you can register studies and samples.
                Without credentials, the &quot;Register with ENA&quot; buttons will show an error message.
              </p>
            </div>
          )}
        </div>
      </GlassCard>

      {/* Submission History */}
      <GlassCard className="p-6 mt-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-lg bg-stone-100 flex items-center justify-center">
            <History className="h-5 w-5 text-stone-600" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold">Submission History</h2>
            <p className="text-sm text-muted-foreground">
              Recent ENA submissions and their responses
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchSubmissions} disabled={loadingSubmissions}>
            {loadingSubmissions ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
          </Button>
        </div>

        {loadingSubmissions ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : submissions.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No submissions yet
          </div>
        ) : (
          <div className="space-y-3">
            {submissions.slice(0, 10).map((submission) => {
              const response = submission.response
                ? (typeof submission.response === 'string' ? JSON.parse(submission.response) : submission.response)
                : null;
              const accessions = submission.accessionNumbers
                ? (typeof submission.accessionNumbers === 'string' ? JSON.parse(submission.accessionNumbers) : submission.accessionNumbers)
                : null;
              const isExpanded = expandedSubmission === submission.id;
              const isTest = response?.isTest ?? true;

              return (
                <div
                  key={submission.id}
                  className="border rounded-lg overflow-hidden"
                >
                  <div
                    className="p-3 flex items-center gap-3 cursor-pointer hover:bg-stone-50"
                    onClick={() => setExpandedSubmission(isExpanded ? null : submission.id)}
                  >
                    <Badge
                      variant={
                        submission.status === "ACCEPTED"
                          ? "default"
                          : submission.status === "PARTIAL"
                          ? "secondary"
                          : "destructive"
                      }
                      className={
                        submission.status === "ACCEPTED"
                          ? "bg-green-100 text-green-700"
                          : submission.status === "PARTIAL"
                          ? "bg-amber-100 text-amber-700"
                          : ""
                      }
                    >
                      {submission.status}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {submission.entityDetails?.title || submission.entityId}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(submission.createdAt).toLocaleString()} · {isTest ? "Test Server" : "Production"}
                      </p>
                    </div>
                    {accessions?.study && (
                      <span className="text-xs font-mono text-muted-foreground">
                        {accessions.study}
                      </span>
                    )}
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>

                  {isExpanded && (
                    <div className="border-t bg-stone-50 p-3 space-y-3">
                      {/* Accession and Portal Link */}
                      {accessions?.study && (
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">Study Accession</p>
                            <p className="text-sm font-mono">{accessions.study}</p>
                          </div>
                          <a
                            href={`https://${isTest ? "wwwdev.ebi.ac.uk" : "www.ebi.ac.uk"}/ena/submit/webin/report/studies`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                          >
                            View in Webin Portal
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      )}

                      {/* Message */}
                      {response?.message && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Message</p>
                          <p className="text-sm">{response.message}</p>
                        </div>
                      )}

                      {/* Samples Error */}
                      {response?.samplesError && (
                        <div>
                          <p className="text-xs font-medium text-red-600 mb-1">Sample Errors</p>
                          <div className="text-xs text-red-700 bg-red-50 rounded p-2 max-h-24 overflow-y-auto">
                            {response.samplesError.split(';').filter((e: string) => e.trim()).map((err: string, i: number) => (
                              <p key={i} className="mb-1">- {err.trim()}</p>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Raw Response */}
                      <details>
                        <summary className="text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground">
                          Raw Response (click to expand)
                        </summary>
                        <div className="mt-2 max-h-60 overflow-y-auto bg-stone-100 rounded p-2 border">
                          <pre className="text-xs whitespace-pre-wrap break-words font-mono">
                            {JSON.stringify(response, null, 2)}
                          </pre>
                        </div>
                      </details>

                      {/* XML Content */}
                      {submission.xmlContent && (
                        <details>
                          <summary className="text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground">
                            Submitted XML (click to expand)
                          </summary>
                          <div className="mt-2 max-h-60 overflow-y-auto bg-stone-100 rounded p-2 border">
                            <pre className="text-xs whitespace-pre-wrap break-words font-mono">
                              {submission.xmlContent}
                            </pre>
                          </div>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      {/* Links */}
      <GlassCard className="p-6 mt-6">
        <h2 className="text-lg font-semibold mb-4">Useful Links</h2>
        <div className="space-y-2">
          <a
            href="https://www.ebi.ac.uk/ena/submit/webin/login"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
          >
            <ExternalLink className="h-4 w-4" />
            ENA Webin Portal (login)
          </a>
          <a
            href="https://www.ebi.ac.uk/ena/submit/webin/accountInfo"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
          >
            <ExternalLink className="h-4 w-4" />
            Register for a Webin Account
          </a>
          <a
            href="https://ena-docs.readthedocs.io/en/latest/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
          >
            <ExternalLink className="h-4 w-4" />
            ENA Documentation
          </a>
          <a
            href="https://wwwdev.ebi.ac.uk/ena/browser/home"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-blue-600 hover:underline"
          >
            <ExternalLink className="h-4 w-4" />
            ENA Test Server Browser
          </a>
        </div>
      </GlassCard>
    </PageContainer>
  );
}
