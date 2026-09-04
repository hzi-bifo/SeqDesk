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
