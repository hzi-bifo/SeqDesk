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

interface SandboxSettings {
  mode: "required" | "auto" | "off";
  network: "none" | "host";
  extraReadOnly: string[];
  localTimeLimitHours: number;
}

interface SandboxStatus {
  settings: SandboxSettings;
  host: { platform: "linux" | "darwin" | null; tool: "bubblewrap" | "seatbelt" | null; toolPath: string | null; problem: string | null };
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

export default function ExploreEnvironmentsPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "FACILITY_ADMIN";
  const { data, mutate, isLoading } = useSWR<{ environments: EnvironmentSummary[] }>("/api/explore/environments", fetcher, {
    refreshInterval: (latest) => (latest?.environments.some((entry) => entry.status === "building") ? 5000 : 0),
  });
  const { data: sandbox, mutate: mutateSandbox } = useSWR<SandboxStatus>("/api/explore/sandbox", fetcher);
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
    <PageContainer maxWidth="wide">
      <Link href="/explore" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Explore
      </Link>
      <h1 className="mt-2 text-xl font-semibold">Analysis environments</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Conda environments that analyses run in. Each one is built from a specification shipped with the app and cached by the
        hash of the specification on the shared filesystem, so compute nodes reuse it.
      </p>

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
                {isAdmin && (
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

      {sandbox && <IsolationCard status={sandbox} isAdmin={isAdmin} onSaved={() => void mutateSandbox()} />}

      {isAdmin && (
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
  const [saving, setSaving] = useState(false);
  const host = status.host;
  const toolLabel = host.tool === "bubblewrap" ? "bubblewrap" : host.tool === "seatbelt" ? "sandbox-exec (macOS, best effort)" : null;
  const dirty = JSON.stringify({ ...draft, extraReadOnly: extra.split("\n").map((line) => line.trim()).filter(Boolean) }) !== JSON.stringify(status.settings);

  const save = async () => {
    setSaving(true);
    try {
      await postJson("/api/explore/sandbox", { ...draft, extraReadOnly: extra.split("\n").map((line) => line.trim()).filter(Boolean) });
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
        Every run is confined to its own folder: it sees its inputs, its environment and the system, and nothing else. Other runs, the tables
        storage, the application and the home directory do not exist inside. The plan of each run is on its page under Isolation.
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
          <div>
            <label htmlFor="sandbox-extra" className="text-xs font-medium">Extra read-only paths</label>
            <textarea id="sandbox-extra" className="mt-1 min-h-[4.5rem] w-full rounded-md border bg-background px-2 py-1 font-mono text-xs" value={extra} placeholder={"/vol/biotools\n/net/references"} onChange={(event) => setExtra(event.target.value)} />
            <p className="mt-1 text-xs text-muted-foreground">Site tool trees or reference data every analysis may read, one absolute path per line.</p>
          </div>
          <div className="md:col-span-2">
            <Button size="sm" onClick={() => void save()} disabled={saving || !dirty}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">{MODE_TEXT[status.settings.mode]}</p>
      )}
    </div>
  );
}
