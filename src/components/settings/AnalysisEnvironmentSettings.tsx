"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useSession } from "next-auth/react";
import { ArrowLeft, Hammer, Loader2 } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { fetcher, formatDateTime, postJson } from "@/lib/explore/client";
import { hasCapability, principalFromSession } from "@/lib/authorization/client";
import { useDeploymentProfile } from "@/components/deployment-profile/DeploymentProfileProvider";
import { useModules } from "@/lib/modules";

interface SandboxSettings {
  mode: "required" | "auto" | "off";
  network: "none" | "host";
  extraReadOnly: string[];
  localTimeLimitHours: number;
  limits: { cores: number; memoryGb: number; pids: number };
}

interface StorageSettings {
  exploreDir: string;
  pruneAfterDays: number;
}

interface StorageStatus {
  stored: StorageSettings;
  effective: { exploreDir: string | null; exploreDirSource: "env" | "settings" | "data-path"; pruneAfterDays: number; pruneAfterDaysSource: "env" | "settings" | "default" };
  dataBasePath: string | null;
  dataBasePathSource: string;
}

interface SandboxStatus {
  settings: SandboxSettings;
  host: { platform: "linux" | "darwin" | null; tool: "bubblewrap" | "seatbelt" | null; toolPath: string | null; problem: string | null; limits?: { mechanism: string; controllers: string[] } | null };
  storage?: StorageStatus;
}

interface ProbeResult {
  status: "passed" | "failed" | "refused" | "unconfined";
  summary: string;
  environment?: string | null;
  probes: Array<{ name: string; expect: "allowed" | "blocked"; outcome: "allowed" | "blocked"; ok: boolean; detail?: string }>;
  durationMs: number;
}

interface EnvironmentSummary {
  name: string;
  specHash: string;
  status: string;
  prefixPath: string | null;
  builtAt: string | null;
  lastError: string | null;
  spec: string;
}

export function AnalysisEnvironmentSettings({ administration = false }: { administration?: boolean }) {
  const { isModuleEnabled, loading, error, refresh } = useModules();
  if (loading || error || !isModuleEnabled("explore")) {
    return <PageContainer>
      <Link href={administration ? "/admin/settings" : "/explore"} className="text-sm text-muted-foreground underline underline-offset-2">{administration ? "Application settings" : "Reports"}</Link>
      <h1 className="mt-3 text-xl font-semibold">Report analysis settings</h1>
      {loading ? <Skeleton className="mt-6 h-32 w-full" aria-label="Loading Reports module" /> : error ? <div role="alert" className="mt-6 rounded-lg border p-5"><p>Could not check whether Reports is enabled.</p><Button variant="outline" className="mt-3" onClick={() => void refresh()}>Retry module status</Button></div> : <div className="mt-6 max-w-2xl space-y-3 rounded-xl border bg-card p-5"><h2 className="font-medium">Reports module is disabled</h2><p className="text-sm leading-6 text-muted-foreground">Enable Reports / Explore in Modules to configure analysis software and isolation settings. Your existing reports and results are not deleted by disabling the module.</p><Button asChild variant="outline"><Link href="/admin/modules?category=analysis">Open analysis modules</Link></Button></div>}
    </PageContainer>;
  }
  return <AnalysisEnvironmentControls administration={administration} />;
}

function AnalysisEnvironmentControls({ administration }: { administration: boolean }) {
  const { data: session } = useSession();
  const profile = useDeploymentProfile();
  const principal = principalFromSession(session);
  const isAdmin = Boolean(principal && hasCapability(profile, principal, "system.pipelines.manage"));
  const { data, error, mutate, isLoading } = useSWR<{ environments: EnvironmentSummary[] }>("/api/explore/environments", fetcher, {
    refreshInterval: (latest) => (latest?.environments.some((entry) => entry.status === "building") ? 5000 : 0),
  });
  const { data: sandbox, error: sandboxError, isLoading: sandboxLoading, mutate: mutateSandbox } = useSWR<SandboxStatus>("/api/explore/sandbox", fetcher);
  const [busy, setBusy] = useState<string | null>(null);
  const [registerName, setRegisterName] = useState("");
  const [registerPath, setRegisterPath] = useState("");

  const build = useCallback(
    async (name: string) => {
      setBusy(name);
      try {
        const result = await postJson<{ started: boolean; message: string }>("/api/explore/environments", { name, action: "build" });
        toast.info(result.message);
        await mutate();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Build failed");
      } finally {
        setBusy(null);
      }
    },
    [mutate]
  );

  const register = useCallback(async () => {
    setBusy("register");
    try {
      await postJson("/api/explore/environments", { name: registerName.trim(), action: "register", prefixPath: registerPath.trim() });
      toast.success("Environment registered");
      setRegisterName("");
      setRegisterPath("");
      await mutate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not register the environment");
    } finally {
      setBusy(null);
    }
  }, [registerName, registerPath, mutate]);

  return (
    <PageContainer>
      <Link href={administration ? "/admin/settings" : "/explore"} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        {administration ? "Application settings" : "Reports"}
      </Link>
      <h1 className="mt-2 text-xl font-semibold">{administration ? "Report analysis settings" : "Analysis environments"}</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Set up the software used to turn tables into figures and analyses in reports. Environments are reusable software installations, separate from sequencing pipelines and their reference databases. Building an environment may download packages; opening this page does not start a build.
      </p>

      {error && <div role="alert" className="mt-5 rounded-lg border border-destructive/30 p-4 text-sm">Could not load analysis environments. <Button variant="outline" size="sm" className="ml-2" onClick={() => void mutate()}>Retry environments</Button></div>}
      {isLoading ? (
        <Skeleton className="mt-6 h-32 w-full" />
      ) : (
        <div className="mt-6 space-y-4">
          {(data?.environments ?? []).map((environment) => (
            <div key={environment.name} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{environment.name}</span>
                  <Badge variant={environment.status === "ready" ? "secondary" : "outline"}>{environment.status}</Badge>
                  <span className="font-mono text-xs text-muted-foreground">{environment.specHash}</span>
                </div>
                {isAdmin && !error && (
                  <Button size="sm" variant="outline" onClick={() => void build(environment.name)} disabled={busy !== null || environment.status === "building"}>
                    {busy === environment.name || environment.status === "building" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Hammer className="mr-2 h-4 w-4" />}
                    {environment.status === "ready" ? "Rebuild" : "Build"}
                  </Button>
                )}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {environment.prefixPath && <div>Prefix: <span className="font-mono">{environment.prefixPath}</span></div>}
                {environment.builtAt && <div>Built {formatDateTime(environment.builtAt)}</div>}
              </div>
              {environment.lastError && <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted/40 p-2 text-xs text-destructive">{environment.lastError}</pre>}
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground">Specification</summary>
                <pre className="mt-1 overflow-auto rounded bg-muted/40 p-2 text-xs">{environment.spec}</pre>
              </details>
            </div>
          ))}
          {data && data.environments.length === 0 && (
            <p className="text-sm text-muted-foreground">No environment specifications were found under explore/environments.</p>
          )}
        </div>
      )}

      {sandboxError ? <div role="alert" className="mt-6 rounded-lg border border-destructive/30 p-4 text-sm">Could not load analysis isolation settings. <Button variant="outline" size="sm" className="ml-2" onClick={() => void mutateSandbox()}>Retry isolation settings</Button></div> : sandboxLoading ? <Skeleton className="mt-6 h-32 w-full" aria-label="Loading analysis isolation settings" /> : sandbox && <IsolationCard status={sandbox} isAdmin={isAdmin} onSaved={() => void mutateSandbox()} />}

      {isAdmin && !error && !isLoading && (
        <div className="mt-8 rounded-lg border p-4">
          <h2 className="text-sm font-semibold">Register an existing environment</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Point a name at a conda prefix that was built by hand or by the installer, for example on a shared cluster path.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="env-name" className="text-xs font-medium">Name</label>
              <Input id="env-name" className="mt-1 w-64" value={registerName} placeholder="seqdesk-explore-python" onChange={(event) => setRegisterName(event.target.value)} />
            </div>
            <div className="min-w-0 flex-1">
              <label htmlFor="env-path" className="text-xs font-medium">Prefix path</label>
              <Input id="env-path" className="mt-1" value={registerPath} placeholder="/net/conda/envs/seqdesk-explore-python" onChange={(event) => setRegisterPath(event.target.value)} />
            </div>
            <Button variant="outline" onClick={() => void register()} disabled={busy !== null || !registerName.trim() || !registerPath.trim()}>
              Register
            </Button>
          </div>
        </div>
      )}
    </PageContainer>
  );
}

const MODE_TEXT: Record<SandboxSettings["mode"], string> = {
  required: "Required: a run only starts confined; hosts without the sandbox tool refuse to run.",
  auto: "When available: confined on hosts that have the tool, unconfined elsewhere, and the run page says which.",
  off: "Off: analyses run with the server's own access to the filesystem. Only for single-user machines.",
};

/** How analyses are confined on this host, and the switch that decides it. */
function IsolationCard({ status, isAdmin, onSaved }: { status: SandboxStatus; isAdmin: boolean; onSaved: () => void }) {
  const [draft, setDraft] = useState<SandboxSettings>(status.settings);
  const [extra, setExtra] = useState(status.settings.extraReadOnly.join("\n"));
  const [storage, setStorage] = useState<StorageSettings>(status.storage?.stored ?? { exploreDir: "", pruneAfterDays: 30 });
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const host = status.host;
  const toolLabel = host.tool === "bubblewrap" ? "bubblewrap" : host.tool === "seatbelt" ? "sandbox-exec (macOS, best effort)" : null;
  const storageDirty = Boolean(status.storage) && JSON.stringify(storage) !== JSON.stringify(status.storage?.stored);
  const dirty = storageDirty || JSON.stringify({ ...draft, extraReadOnly: extra.split("\n").map((line) => line.trim()).filter(Boolean) }) !== JSON.stringify(status.settings);
  const pruneValid = Number.isInteger(storage.pruneAfterDays) && storage.pruneAfterDays >= 1 && storage.pruneAfterDays <= 3650;
  const dirValid = !storage.exploreDir.trim() || (storage.exploreDir.trim().startsWith("/") && storage.exploreDir.trim() !== "/" && !/["'`$\\]/.test(storage.exploreDir));

  const runProbe = async () => {
    setProbing(true);
    setProbe(null);
    try {
      setProbe(await postJson<ProbeResult>("/api/explore/sandbox/probe", {}));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not test the sandbox");
    } finally {
      setProbing(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await postJson("/api/explore/sandbox", { ...draft, extraReadOnly: extra.split("\n").map((line) => line.trim()).filter(Boolean), ...(status.storage ? { storage: { exploreDir: storage.exploreDir.trim(), pruneAfterDays: storage.pruneAfterDays } } : {}) });
      toast.success("Isolation settings saved");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-8 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Isolation of analysis runs</h2>
        <Badge variant={host.tool && !host.problem ? "secondary" : "outline"}>{host.tool && !host.problem ? `${toolLabel} available` : "no sandbox on this host"}</Badge>
      </div>
      <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
        Choose whether analyses must run in an isolated environment, which restricts access to files outside the run. “When available” can run without isolation if the host cannot provide it. Each run records the protection it actually used.
      </p>
      {host.problem && <p className="mt-2 text-xs text-amber-700">{host.problem}</p>}
      {!host.tool && host.platform === "linux" && (
        <p className="mt-2 text-xs text-muted-foreground">Install bubblewrap to confine runs on this host, for example with <span className="font-mono">sudo dnf install bubblewrap</span> or <span className="font-mono">sudo apt install bubblewrap</span>.</p>
      )}
      {isAdmin ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="sandbox-mode" className="text-xs font-medium">Sandbox</label>
            <select id="sandbox-mode" className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" value={draft.mode} onChange={(event) => setDraft({ ...draft, mode: event.target.value as SandboxSettings["mode"] })}>
              <option value="required">Required</option>
              <option value="auto">When available</option>
              <option value="off">Off</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">{MODE_TEXT[draft.mode]}</p>
          </div>
          <div>
            <label htmlFor="sandbox-network" className="text-xs font-medium">Network inside the sandbox</label>
            <select id="sandbox-network" className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" value={draft.network} onChange={(event) => setDraft({ ...draft, network: event.target.value as SandboxSettings["network"] })}>
              <option value="none">None</option>
              <option value="host">The host network</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">Inputs are staged into the run folder, so templates need no network.</p>
          </div>
          <div>
            <label htmlFor="sandbox-limit" className="text-xs font-medium">Time limit for local runs (hours)</label>
            <Input id="sandbox-limit" type="number" min={0} max={720} className="mt-1 w-40" value={draft.localTimeLimitHours} onChange={(event) => setDraft({ ...draft, localTimeLimitHours: Math.max(0, Number.parseInt(event.target.value, 10) || 0) })} />
            <p className="mt-1 text-xs text-muted-foreground">0 means no limit. SLURM runs use the scheduler limit.</p>
          </div>
          <div className="md:col-span-2">
            <span className="text-xs font-medium">Limits per local run</span>
            <div className="mt-1 flex flex-wrap gap-3">
              {([
                ["cores", "CPU cores", 1024],
                ["memoryGb", "Memory (GB)", 16384],
                ["pids", "Processes", 1000000],
              ] as const).map(([key, label, max]) => (
                <label key={key} className="text-xs text-muted-foreground">
                  {label}
                  <Input type="number" min={0} max={max} className="mt-1 w-32" value={draft.limits?.[key] ?? 0} onChange={(event) => setDraft({ ...draft, limits: { ...(draft.limits ?? { cores: 4, memoryGb: 16, pids: 512 }), [key]: Math.max(0, Number.parseInt(event.target.value, 10) || 0) } })} />
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">0 means no cap. On Linux the caps use a systemd user scope when cgroup v2 is delegated, otherwise rlimits; macOS caps processes only. SLURM runs use the scheduler limits.</p>
            {host.limits && <p className="mt-1 text-xs text-muted-foreground">This host applies them with <span className="font-mono">{host.limits.mechanism}</span>{host.limits.controllers.length ? ` (delegated controllers: ${host.limits.controllers.join(", ")})` : ""}.</p>}
          </div>
          <div>
            <label htmlFor="sandbox-extra" className="text-xs font-medium">Extra read-only paths</label>
            <textarea id="sandbox-extra" className="mt-1 min-h-[4.5rem] w-full rounded-md border bg-background px-2 py-1 font-mono text-xs" value={extra} placeholder={"/vol/biotools\n/net/references"} onChange={(event) => setExtra(event.target.value)} />
            <p className="mt-1 text-xs text-muted-foreground">Site tool trees or reference data every analysis may read, one absolute path per line.</p>
          </div>
          {status.storage && <StorageFields status={status.storage} value={storage} onChange={setStorage} dirValid={dirValid} pruneValid={pruneValid} />}
          <div className="flex flex-wrap items-center gap-2 md:col-span-2">
            <Button size="sm" onClick={() => void save()} disabled={saving || !dirty || !pruneValid || !dirValid}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={() => void runProbe()} disabled={probing || dirty} title={dirty ? "Save first: the test uses the saved settings" : undefined}>
              {probing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Test the sandbox
            </Button>
            {dirty && <span className="text-xs text-muted-foreground">The test uses the saved settings.</span>}
          </div>
          {probe && <ProbeReport result={probe} />}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">{MODE_TEXT[status.settings.mode]}</p>
      )}
    </div>
  );
}

const SOURCE_TEXT: Record<string, string> = { env: "set by the server environment, which wins over this field", settings: "set here", "data-path": "the data path's explore folder", default: "the default" };

/** The data path (read-only here), the Explore dataset folder and the prune age. */
function StorageFields({ status, value, onChange, dirValid, pruneValid }: { status: StorageStatus; value: StorageSettings; onChange: (next: StorageSettings) => void; dirValid: boolean; pruneValid: boolean }) {
  const effectiveDir = status.effective.exploreDir ?? (status.dataBasePath ? `${status.dataBasePath.replace(/\/$/, "")}/explore` : null);
  return (
    <div className="grid gap-4 border-t pt-4 md:col-span-2 md:grid-cols-2">
      <div className="md:col-span-2">
        <span className="text-xs font-medium">Data path</span>
        <p className="mt-1 font-mono text-xs">{status.dataBasePath ?? "not set"}</p>
        <p className="mt-1 text-xs text-muted-foreground">Where sequencing files and app data live. Change it under <Link href="/admin/data-storage" className="underline underline-offset-2">Data storage</Link>, which checks the folder before saving.</p>
      </div>
      <div>
        <label htmlFor="explore-dir" className="text-xs font-medium">Explore dataset folder</label>
        <Input id="explore-dir" className="mt-1 font-mono text-xs" value={value.exploreDir} placeholder={status.dataBasePath ? `${status.dataBasePath.replace(/\/$/, "")}/explore` : "/srv/seqdesk/explore"} aria-invalid={!dirValid} onChange={(event) => onChange({ ...value, exploreDir: event.target.value })} />
        <p className={`mt-1 text-xs ${dirValid ? "text-muted-foreground" : "text-destructive"}`}>{dirValid ? `Empty uses the data path. In effect: ${effectiveDir ?? "the app's work folder"} (${SOURCE_TEXT[status.effective.exploreDirSource]}).` : "Use an absolute path without quotes, backslashes or $."}</p>
      </div>
      <div>
        <label htmlFor="prune-days" className="text-xs font-medium">Prune unused run outputs after (days)</label>
        <Input id="prune-days" type="number" min={1} max={3650} className="mt-1 w-32" value={value.pruneAfterDays} aria-invalid={!pruneValid} onChange={(event) => onChange({ ...value, pruneAfterDays: Number.parseInt(event.target.value, 10) || 0 })} />
        <p className={`mt-1 text-xs ${pruneValid ? "text-muted-foreground" : "text-destructive"}`}>{pruneValid ? `In effect: ${status.effective.pruneAfterDays} days (${SOURCE_TEXT[status.effective.pruneAfterDaysSource]}). Cited, held and current runs are always kept.` : "Between 1 and 3650 days."}</p>
      </div>
    </div>
  );
}

const PROBE_HEADLINE: Record<ProbeResult["status"], string> = { passed: "Sandbox test passed", failed: "Sandbox test found gaps", refused: "Runs would be refused", unconfined: "Runs are not confined" };

function ProbeReport({ result }: { result: ProbeResult }) {
  return (
    <div role="status" className="rounded-md border p-3 md:col-span-2">
      <p className={`text-sm font-medium ${result.status === "passed" ? "" : "text-destructive"}`}>{PROBE_HEADLINE[result.status]}</p>
      <p className="mt-1 text-xs text-muted-foreground">{result.summary}{result.environment ? ` Environment: ${result.environment}.` : ""} {(result.durationMs / 1000).toFixed(1)} s.</p>
      {result.probes.length > 0 && (
        <ul className="mt-2 grid gap-1 text-xs md:grid-cols-2">
          {result.probes.map((probe) => (
            <li key={probe.name} className={probe.ok ? "text-muted-foreground" : "text-destructive"}>
              {probe.ok ? "✓" : "✗"} {probe.name}: {probe.outcome}{probe.ok ? "" : ` (expected ${probe.expect})`}{probe.detail ? ` — ${probe.detail}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
