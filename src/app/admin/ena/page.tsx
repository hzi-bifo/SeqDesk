"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { HelpBox } from "@/components/ui/help-box";
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
  RefreshCw,
  ShieldCheck,
  Server,
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

interface EnaTestResult {
  success: boolean;
  message?: string;
  error?: string;
  server?: string;
}

function parseJsonSafe<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export default function ENASettingsPage() {
  const [saving, setSaving] = useState(false);
  const [refreshingPage, setRefreshingPage] = useState(false);

  const [enaUsername, setEnaUsername] = useState("");
  const [enaPassword, setEnaPassword] = useState("");
  const [enaHasPassword, setEnaHasPassword] = useState(false);
  const [enaTestMode, setEnaTestMode] = useState(true);
  const [enaConfigured, setEnaConfigured] = useState(false);
  const [enaSaved, setEnaSaved] = useState(false);
  const [showEnaPassword, setShowEnaPassword] = useState(false);
  const [testingEna, setTestingEna] = useState(false);
  const [enaTestResult, setEnaTestResult] = useState<EnaTestResult | null>(null);
  const [loadedEnaUsername, setLoadedEnaUsername] = useState("");
  const [loadedEnaTestMode, setLoadedEnaTestMode] = useState(true);
  const [enaBrokerAccount, setEnaBrokerAccount] = useState(false);
  const [loadedEnaBrokerAccount, setLoadedEnaBrokerAccount] = useState(false);
  const [enaCenterName, setEnaCenterName] = useState("");
  const [loadedEnaCenterName, setLoadedEnaCenterName] = useState("");

  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [expandedSubmission, setExpandedSubmission] = useState<string | null>(null);

  const credentialsReady = Boolean(
    enaUsername.trim() && (enaPassword.trim() || enaHasPassword)
  );
  const credentialsDirty =
    enaUsername.trim() !== loadedEnaUsername || Boolean(enaPassword.trim());
  const brokerSettingsDirty =
    enaBrokerAccount !== loadedEnaBrokerAccount ||
    enaCenterName.trim() !== loadedEnaCenterName;
  const settingsDirty = credentialsDirty || enaTestMode !== loadedEnaTestMode;
  const brokerConfigured = !enaBrokerAccount || Boolean(enaCenterName.trim());
  const canSave =
    (settingsDirty || brokerSettingsDirty) &&
    credentialsReady &&
    brokerConfigured &&
    (!credentialsDirty || Boolean(enaTestResult?.success));

  const pendingOrPartialSubmissions = useMemo(
    () =>
      submissions.filter(
        (submission) =>
          submission.status === "PENDING" || submission.status === "PARTIAL"
      ).length,
    [submissions]
  );
  const failedSubmissions = useMemo(
    () =>
      submissions.filter(
        (submission) =>
          submission.status === "ERROR" || submission.status === "FAILED"
      ).length,
    [submissions]
  );
  const acceptedSubmissions = useMemo(
    () => submissions.filter((submission) => submission.status === "ACCEPTED").length,
    [submissions]
  );
  const enaReadinessItems = useMemo(
    () => [
      {
        label: "Credentials",
        state: credentialsReady ? "ok" : "warning",
        detail: credentialsReady ? "Ready for connection test" : "Username and password required",
      },
      {
        label: "Server",
        state: enaTestMode ? "ok" : "warning",
        detail: enaTestMode ? "Test server selected" : "Production is permanent",
      },
      {
        label: "Account",
        state: brokerConfigured ? "ok" : "warning",
        detail: enaBrokerAccount
          ? enaCenterName.trim()
            ? `Broker center ${enaCenterName.trim()}`
            : "Broker center missing"
          : "Regular Webin account",
      },
      {
        label: "Submissions",
        state: failedSubmissions > 0 || pendingOrPartialSubmissions > 0 ? "warning" : "ok",
        detail:
          failedSubmissions > 0
            ? `${failedSubmissions} failed`
            : pendingOrPartialSubmissions > 0
            ? `${pendingOrPartialSubmissions} pending or partial`
            : submissions.length > 0
            ? `${acceptedSubmissions} accepted`
            : "No submissions yet",
      },
    ],
    [
      acceptedSubmissions,
      brokerConfigured,
      credentialsReady,
      enaBrokerAccount,
      enaCenterName,
      enaTestMode,
      failedSubmissions,
      pendingOrPartialSubmissions,
      submissions.length,
    ]
  );

  const updateSubmissionServer = (useTestMode: boolean) => {
    if (enaTestMode === useTestMode) {
      return;
    }
    setEnaTestMode(useTestMode);
    setEnaTestResult(null);
    setEnaSaved(false);
  };

  const fetchSubmissions = useCallback(async () => {
    setLoadingSubmissions(true);
    try {
      const res = await fetch("/api/admin/submissions");
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "Failed to load submissions");
      }
      const data = (await res.json()) as Submission[];
      setSubmissions(data);
    } catch (error) {
      console.error("Failed to load submissions:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to load submissions"
      );
    } finally {
      setLoadingSubmissions(false);
    }
  }, []);

  const fetchEnaSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/settings/ena");
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "Failed to load ENA settings");
      }
      const data = (await res.json()) as {
        enaUsername?: string;
        hasPassword?: boolean;
        enaTestMode?: boolean;
        enaBrokerAccount?: boolean;
        enaCenterName?: string;
        configured?: boolean;
      };

      const nextUsername = data.enaUsername || "";
      const nextTestMode = data.enaTestMode ?? true;
      const nextBrokerAccount = data.enaBrokerAccount === true;
      const nextCenterName = data.enaCenterName || "";

      setEnaUsername(nextUsername);
      setLoadedEnaUsername(nextUsername);
      setEnaHasPassword(Boolean(data.hasPassword));
      setEnaTestMode(nextTestMode);
      setLoadedEnaTestMode(nextTestMode);
      setEnaBrokerAccount(nextBrokerAccount);
      setLoadedEnaBrokerAccount(nextBrokerAccount);
      setEnaCenterName(nextCenterName);
      setLoadedEnaCenterName(nextCenterName);
      setEnaConfigured(Boolean(data.configured));
      setEnaPassword("");
      setEnaTestResult(null);
    } catch (error) {
      console.error("Failed to load ENA settings:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to load ENA settings"
      );
    }
  }, []);

  const refreshAll = useCallback(
    async (initial = false) => {
      if (!initial) {
        setRefreshingPage(true);
      }
      await Promise.all([fetchEnaSettings(), fetchSubmissions()]);
      if (!initial) {
        setRefreshingPage(false);
      }
    },
    [fetchEnaSettings, fetchSubmissions]
  );

  useEffect(() => {
    void refreshAll(true);
  }, [refreshAll]);

  const handleSaveEnaSettings = async () => {
    if (!canSave) {
      if (credentialsDirty && !enaTestResult?.success) {
        toast.error("Test credentials before saving changes");
      } else if (!brokerConfigured) {
        toast.error("Enter a center name or disable broker account mode");
      } else {
        toast.error("No changes to save");
      }
      return;
    }

    setSaving(true);
    setEnaSaved(false);

    try {
      const updateData: Record<string, unknown> = {
        enaUsername: enaUsername.trim(),
        enaTestMode,
        enaBrokerAccount,
        enaCenterName: enaCenterName.trim(),
      };

      if (enaPassword.trim()) {
        updateData.enaPassword = enaPassword.trim();
      }

      const res = await fetch("/api/admin/settings/ena", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      });

      const payload = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!res.ok) {
        throw new Error(payload?.error || "Failed to save ENA settings");
      }

      setLoadedEnaUsername(enaUsername.trim());
      setLoadedEnaTestMode(enaTestMode);
      setLoadedEnaBrokerAccount(enaBrokerAccount);
      setLoadedEnaCenterName(enaCenterName.trim());
      setEnaHasPassword(Boolean(enaPassword.trim() || enaHasPassword));
      setEnaConfigured(Boolean(enaUsername.trim() && (enaPassword.trim() || enaHasPassword)));
      setEnaPassword("");
      setEnaSaved(true);
      setTimeout(() => setEnaSaved(false), 2500);
      toast.success("ENA settings saved");
    } catch (error) {
      console.error("Failed to save ENA settings:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to save ENA settings"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleTestEnaConnection = async () => {
    if (!credentialsReady) {
      toast.error("Enter username and password before testing");
      return;
    }

    setTestingEna(true);
    setEnaTestResult(null);

    try {
      const requestBody: Record<string, unknown> = {
        enaUsername: enaUsername.trim(),
        enaTestMode,
      };

      if (enaPassword.trim()) {
        requestBody.enaPassword = enaPassword.trim();
      } else if (enaHasPassword) {
        requestBody.useSavedPassword = true;
      }

      const res = await fetch("/api/admin/settings/ena/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const result = (await res.json()) as EnaTestResult;
      setEnaTestResult(result);
      if (result.success) {
        toast.success("ENA connection verified");
      }
    } catch (error) {
      console.error("Failed to test ENA connection:", error);
      setEnaTestResult({ success: false, error: "Connection test failed" });
    } finally {
      setTestingEna(false);
    }
  };

  const handleClearEnaCredentials = async () => {
    const confirmed = window.confirm(
      "Clear the saved ENA Webin username and password?\n\nThis removes the stored credentials from this SeqDesk installation. Existing submissions are not deleted."
    );
    if (!confirmed) return;

    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings/ena", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enaUsername: "",
          enaPassword: "",
          enaTestMode,
          enaBrokerAccount,
          enaCenterName: enaCenterName.trim(),
        }),
      });

      const payload = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!res.ok) {
        throw new Error(payload?.error || "Failed to clear credentials");
      }

      setEnaUsername("");
      setLoadedEnaUsername("");
      setEnaPassword("");
      setEnaHasPassword(false);
      setEnaConfigured(false);
      setEnaTestResult(null);
      toast.success("ENA credentials cleared");
    } catch (error) {
      console.error("Failed to clear ENA credentials:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to clear credentials"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="sticky top-0 z-30 bg-card border-b border-border">
        <div className="relative flex items-center justify-center h-[52px] px-6 lg:px-8">
          <span className="text-sm font-medium">ENA Configuration</span>
        </div>
      </div>
    <PageContainer>
      <div className="mb-4 mt-6">
        <h1 className="text-xl font-semibold">ENA Configuration</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Configure Webin credentials and monitor ENA registration submissions
        </p>
      </div>

      <HelpBox title="What is an ENA account?">
        <>
          SeqDesk uses an ENA Webin account to register studies and samples with
          the European Nucleotide Archive. A regular account submits data under
          the affiliation stored in that Webin account.
          <br />
          <br />
          A broker account is for submitting on behalf of other people or
          institutes, for example a sequencing facility handling customer studies.
          Broker accounts can set a per-submission center name, which SeqDesk
          writes as <code className="font-mono">center_name</code> in the ENA XML.
          <br />
          <br />
          Use broker mode only if ENA has granted broker permissions to the Webin
          account. Otherwise keep regular mode and manage the affiliation in the
          Webin portal.
        </>
      </HelpBox>

      <div className="sticky top-16 z-30 mb-6">
        <div className="rounded-lg border border-border bg-background/95 backdrop-blur px-3 py-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {refreshingPage ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" />
                Refreshing ENA settings and submissions...
              </span>
            ) : (
              <>
                {enaConfigured ? "Credentials configured" : "Credentials missing"} •{" "}
                {enaTestMode ? "Test server" : "Production server"} •{" "}
                {pendingOrPartialSubmissions} pending/partial submission
                {pendingOrPartialSubmissions === 1 ? "" : "s"} •{" "}
                {enaBrokerAccount
                  ? enaCenterName.trim()
                    ? `Broker center: ${enaCenterName.trim()}`
                    : "Broker center missing"
                  : "Regular Webin account"}
              </>
            )}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="bg-white"
              onClick={() => void refreshAll(false)}
              disabled={refreshingPage || loadingSubmissions || saving || testingEna}
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${
                  refreshingPage ? "animate-spin" : ""
                }`}
              />
              Refresh all
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <section className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold">Upload Readiness</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Checks that affect ENA registration before users submit studies
              </p>
            </div>
            <Badge
              variant={
                enaReadinessItems.some((item) => item.state === "warning")
                  ? "secondary"
                  : "outline"
              }
              className="w-fit"
            >
              {enaReadinessItems.some((item) => item.state === "warning")
                ? "Review before upload"
                : "Ready"}
            </Badge>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            {enaReadinessItems.map((item) => (
              <div
                key={item.label}
                className={`rounded-lg border px-3 py-3 ${
                  item.state === "ok"
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-amber-200 bg-amber-50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{item.label}</p>
                  {item.state === "ok" ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-700" />
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <GlassCard className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <h2 className="text-base font-semibold">ENA Connection</h2>
              <p className="text-sm text-muted-foreground">
                Webin account credentials for study and sample registration
              </p>
            </div>
            <Badge variant={enaConfigured ? "secondary" : "outline"}>
              {enaConfigured ? "Configured" : "Not configured"}
            </Badge>
          </div>

          <div className="border-t pt-4 space-y-6">
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
              <div className="flex items-start gap-2">
                <Server className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">ENA registrations create archive records.</p>
                  <p className="mt-1">
                    Use the test server for dry runs. Production registrations are permanent
                    and should only be used after metadata has been checked.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Submission server</Label>
              <div className="rounded-lg border bg-white px-3 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">
                      {enaTestMode ? "Test server" : "Production server"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {enaTestMode
                        ? "`wwwdev.ebi.ac.uk` temporary data, safe for dry runs."
                        : "`www.ebi.ac.uk` permanent public registrations."}
                    </p>
                  </div>
                  <div className="inline-flex items-center gap-2">
                    <button
                      type="button"
                      className={`text-xs transition-colors ${
                        enaTestMode
                          ? "text-emerald-700 font-medium"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => updateSubmissionServer(true)}
                      disabled={saving}
                    >
                      Test
                    </button>
                    <Switch
                      checked={!enaTestMode}
                      onCheckedChange={(checked) =>
                        updateSubmissionServer(!checked)
                      }
                      disabled={saving}
                      aria-label="Toggle ENA submission server"
                    />
                    <button
                      type="button"
                      className={`text-xs transition-colors ${
                        !enaTestMode
                          ? "text-amber-700 font-medium"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => updateSubmissionServer(false)}
                      disabled={saving}
                    >
                      Production
                    </button>
                  </div>
                </div>
              </div>
              {!enaTestMode && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Production submissions are permanent. Validate on test server first.
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ena-username">Webin username</Label>
                <Input
                  id="ena-username"
                  value={enaUsername}
                  onChange={(event) => {
                    setEnaUsername(event.target.value);
                    setEnaTestResult(null);
                    setEnaSaved(false);
                  }}
                  placeholder="Webin-12345"
                  disabled={saving}
                  className="bg-white"
                />
                <p className="text-xs text-muted-foreground">
                  Format: `Webin-XXXXX`
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ena-password">Webin password</Label>
                <div className="relative">
                  <Input
                    id="ena-password"
                    type={showEnaPassword ? "text" : "password"}
                    value={enaPassword}
                    onChange={(event) => {
                      setEnaPassword(event.target.value);
                      setEnaTestResult(null);
                      setEnaSaved(false);
                    }}
                    placeholder={
                      enaHasPassword
                        ? "Saved password in use"
                        : "Enter your Webin password"
                    }
                    disabled={saving}
                    className="pr-10 bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowEnaPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showEnaPassword ? "Hide password" : "Show password"}
                  >
                    {showEnaPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                {enaHasPassword && !enaPassword.trim() && (
                  <p className="text-xs text-emerald-700">
                    Saved password is available. Enter a new one to replace it.
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-3 rounded-lg border bg-white px-4 py-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <Label className="text-sm font-medium">Broker account</Label>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Enable this only for Webin accounts with ENA broker permissions.
                    Broker submissions can set <code className="font-mono">center_name</code>{" "}
                    per study and sample.
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {enaBrokerAccount ? "Broker" : "Regular"}
                  </span>
                  <Switch
                    checked={enaBrokerAccount}
                    onCheckedChange={(checked) => {
                      setEnaBrokerAccount(checked);
                      setEnaSaved(false);
                    }}
                    disabled={saving}
                    aria-label="Enable ENA broker account mode"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ena-center-name">Center name</Label>
                <Input
                  id="ena-center-name"
                  value={enaCenterName}
                  onChange={(event) => {
                    setEnaCenterName(event.target.value);
                    setEnaSaved(false);
                  }}
                  placeholder="e.g. HZI-BIFO"
                  disabled={saving || !enaBrokerAccount}
                  className="bg-white"
                />
                <p className="text-xs text-muted-foreground">
                  For regular accounts, ENA uses the affiliation on the Webin account.
                  For broker accounts, this value is written as{" "}
                  <code className="font-mono">center_name</code> in submitted XML.
                  Center names are free text on the ENA side.
                </p>
              </div>

              {enaBrokerAccount && !enaCenterName.trim() && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Enter the broker center name before saving.
                </div>
              )}
            </div>

            {enaTestResult && (
              <div
                className={`rounded-lg border px-3 py-2 text-sm flex items-start gap-2 ${
                  enaTestResult.success
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-red-200 bg-red-50 text-red-900"
                }`}
              >
                {enaTestResult.success ? (
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                )}
                <div>
                  <p className="font-medium">
                    {enaTestResult.success ? "Connection successful" : "Connection failed"}
                  </p>
                  <p className="text-xs mt-0.5 opacity-90">
                    {enaTestResult.message || enaTestResult.error}
                  </p>
                  {enaTestResult.server && (
                    <p className="text-xs mt-0.5 opacity-80">
                      Server: {enaTestResult.server}
                    </p>
                  )}
                </div>
              </div>
            )}

            {!enaConfigured && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                ENA credentials are required before using &quot;Register with ENA&quot;
                actions in studies and samples.
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                variant="outline"
                className="bg-white"
                onClick={handleTestEnaConnection}
                disabled={saving || testingEna || !credentialsReady}
              >
                {testingEna ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                Test connection
              </Button>
              <Button onClick={handleSaveEnaSettings} disabled={saving || !canSave}>
                {saving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : enaSaved ? (
                  <Check className="h-4 w-4 mr-2 text-emerald-500" />
                ) : null}
                {enaSaved ? "Saved" : "Save changes"}
              </Button>
              {enaConfigured && (
                <Button
                  variant="outline"
                  className="bg-white text-destructive hover:text-destructive"
                  onClick={handleClearEnaCredentials}
                  disabled={saving}
                >
                  Clear credentials
                </Button>
              )}
            </div>

            {credentialsDirty && !enaTestResult?.success && (
              <p className="text-xs text-muted-foreground">
                Test the connection after changing username/password.
              </p>
            )}
            {brokerSettingsDirty && !credentialsDirty && (
              <p className="text-xs text-muted-foreground">
                Broker settings can be saved without re-testing credentials.
              </p>
            )}
          </div>
        </GlassCard>

        <GlassCard className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
              <History className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <h2 className="text-base font-semibold">Submission History</h2>
              <p className="text-sm text-muted-foreground">
                Latest ENA submissions and responses
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {failedSubmissions > 0 && (
                <Badge variant="destructive">{failedSubmissions} failed</Badge>
              )}
              {pendingOrPartialSubmissions > 0 && (
                <Badge
                  variant="outline"
                  className="border-amber-300 bg-amber-50 text-amber-800"
                >
                  {pendingOrPartialSubmissions} pending/partial
                </Badge>
              )}
              <Badge variant="outline">{submissions.length} total</Badge>
            </div>
          </div>

          {loadingSubmissions ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : submissions.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
              No submissions yet
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-2 text-sm sm:grid-cols-3">
                <div className="rounded-lg border bg-white px-3 py-2">
                  <p className="text-xs text-muted-foreground">Accepted</p>
                  <p className="font-medium">{acceptedSubmissions}</p>
                </div>
                <div className="rounded-lg border bg-white px-3 py-2">
                  <p className="text-xs text-muted-foreground">Pending or partial</p>
                  <p className="font-medium">{pendingOrPartialSubmissions}</p>
                </div>
                <div className="rounded-lg border bg-white px-3 py-2">
                  <p className="text-xs text-muted-foreground">Failed</p>
                  <p className="font-medium">{failedSubmissions}</p>
                </div>
              </div>

              {submissions.length > 10 && (
                <p className="text-xs text-muted-foreground">
                  Showing the latest 10 submissions.
                </p>
              )}

              {submissions.slice(0, 10).map((submission) => {
                const response = parseJsonSafe<Record<string, unknown>>(
                  submission.response
                );
                const accessions = parseJsonSafe<Record<string, unknown>>(
                  submission.accessionNumbers
                );
                const isExpanded = expandedSubmission === submission.id;
                const isTest =
                  typeof response?.isTest === "boolean" ? response.isTest : true;
                const studyAccession =
                  typeof accessions?.study === "string"
                    ? accessions.study
                    : null;
                const responseMessage =
                  typeof response?.message === "string" ? response.message : null;
                const samplesError =
                  typeof response?.samplesError === "string"
                    ? response.samplesError
                    : null;
                const responseError =
                  typeof response?.error === "string" ? response.error : null;

                return (
                  <div key={submission.id} className="border rounded-lg overflow-hidden">
                    <button
                      type="button"
                      className="w-full text-left p-3 flex items-center gap-3 hover:bg-secondary/40 transition-colors"
                      onClick={() =>
                        setExpandedSubmission(isExpanded ? null : submission.id)
                      }
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
                            ? "bg-emerald-100 text-emerald-800"
                            : submission.status === "PARTIAL"
                            ? "bg-amber-100 text-amber-800"
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
                          {new Date(submission.createdAt).toLocaleString()} •{" "}
                          {isTest ? "Test server" : "Production"}
                        </p>
                      </div>
                      {studyAccession && (
                        <span className="text-xs font-mono text-muted-foreground">
                          {studyAccession}
                        </span>
                      )}
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="border-t bg-muted/20 p-3 space-y-3">
                        {studyAccession && (
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-xs font-medium text-muted-foreground mb-1">
                                Study accession
                              </p>
                              <p className="text-sm font-mono">{studyAccession}</p>
                            </div>
                            <a
                              href={`https://${isTest ? "wwwdev.ebi.ac.uk" : "www.ebi.ac.uk"}/ena/submit/webin/report/studies`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
                            >
                              Open in Webin
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        )}

                        {responseMessage && (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">
                              Message
                            </p>
                            <p className="text-sm">{responseMessage}</p>
                          </div>
                        )}

                        {responseError && (
                          <div>
                            <p className="text-xs font-medium text-red-700 mb-1">
                              Error
                            </p>
                            <div className="text-xs text-red-800 bg-red-50 border border-red-200 rounded p-2">
                              {responseError}
                            </div>
                          </div>
                        )}

                        {samplesError && (
                          <div>
                            <p className="text-xs font-medium text-red-700 mb-1">
                              Sample errors
                            </p>
                            <div className="text-xs text-red-800 bg-red-50 border border-red-200 rounded p-2 max-h-28 overflow-y-auto">
                              {samplesError
                                .split(";")
                                .map((item) => item.trim())
                                .filter(Boolean)
                                .map((item, index) => (
                                  <p key={`${submission.id}-err-${index}`}>- {item}</p>
                                ))}
                            </div>
                          </div>
                        )}

                        <details>
                          <summary className="text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground">
                            Raw response
                          </summary>
                          <div className="mt-2 max-h-64 overflow-y-auto bg-muted/40 rounded p-2 border">
                            <pre className="text-xs whitespace-pre-wrap break-words font-mono">
                              {JSON.stringify(response ?? {}, null, 2)}
                            </pre>
                          </div>
                        </details>

                        {submission.xmlContent && (
                          <details>
                            <summary className="text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground">
                              Submitted XML
                            </summary>
                            <div className="mt-2 max-h-64 overflow-y-auto bg-muted/40 rounded p-2 border">
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

        <GlassCard className="p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
              <Globe className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Useful Links</h2>
              <p className="text-sm text-muted-foreground">
                Official ENA resources and portals
              </p>
            </div>
          </div>
          <div className="grid gap-2 text-sm">
            <a
              href="https://www.ebi.ac.uk/ena/submit/webin/login"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-blue-600 hover:underline"
            >
              <ExternalLink className="h-4 w-4" />
              ENA Webin Portal
            </a>
            <a
              href="https://www.ebi.ac.uk/ena/submit/webin/accountInfo"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-blue-600 hover:underline"
            >
              <ExternalLink className="h-4 w-4" />
              Register Webin Account
            </a>
            <a
              href="https://ena-docs.readthedocs.io/en/latest/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-blue-600 hover:underline"
            >
              <ExternalLink className="h-4 w-4" />
              ENA Documentation
            </a>
            <a
              href="https://wwwdev.ebi.ac.uk/ena/browser/home"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-blue-600 hover:underline"
            >
              <ExternalLink className="h-4 w-4" />
              ENA Test Browser
            </a>
          </div>
        </GlassCard>
      </div>
    </PageContainer>
    </>
  );
}
