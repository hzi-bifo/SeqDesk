"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { ArrowLeft, Code2, Loader2 } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { ParamsForm, type ParamsSchema } from "@/components/explore/ParamsForm";
import { fetcher, postJson, ROLE_LABELS } from "@/lib/explore/client";
import { TABLE_KIND_DEFINITIONS } from "@/lib/explore/dataset-kinds";
import { isValidTargetKey } from "@/lib/explore/target-key";
import type { ExploreDatasetSummary, ExploreRole } from "@/lib/explore/types";

interface KitSummary {
  id: string;
  name: string;
  description: string;
  language: "python" | "r";
  environment: string;
  inputs: Array<{ alias: string; label: string; description?: string; tableKind?: string | null; requiredRoles: ExploreRole[]; optionalRoles: ExploreRole[]; optional?: boolean }>;
  params?: ParamsSchema;
  outputs: Array<{ name: string; kind: string; description?: string }>;
  tags: string[];
  citation?: string;
}

interface EnvironmentSummary {
  name: string;
  status: string;
}

const BLANK = "__blank__";
const NONE = "__none__";

export default function NewAnalysisPage() {
  return (
    <Suspense fallback={<PageContainer><Skeleton className="h-8 w-48" /></PageContainer>}>
      <NewAnalysisForm />
    </Suspense>
  );
}

function NewAnalysisForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const scope = searchParams.get("scope");
  const validScope = scope && isValidTargetKey(scope) ? scope : null;
  const [selectedKitId, setKitId] = useState<string>(searchParams.get("kit") ?? "");
  const [name, setName] = useState("");
  // Overrides are keyed by kit so switching kits starts from that kit's defaults again.
  const [bindingOverrides, setBindingOverrides] = useState<{ kitId: string; values: Record<string, string> }>({ kitId: "", values: {} });
  const [paramOverrides, setParamOverrides] = useState<{ kitId: string; values: Record<string, unknown> }>({ kitId: "", values: {} });
  const [busy, setBusy] = useState(false);

  const { data: kitsData } = useSWR<{ kits: KitSummary[]; problems: Array<{ kitDir: string; message: string }> }>("/api/explore/kits", fetcher);
  const { data: datasetsData } = useSWR<{ datasets: ExploreDatasetSummary[] }>(
    validScope ? `/api/explore/datasets?targetKey=${encodeURIComponent(validScope)}` : null,
    fetcher
  );
  const { data: environmentsData } = useSWR<{ environments: EnvironmentSummary[] }>("/api/explore/environments", fetcher);

  const kits = useMemo(() => kitsData?.kits ?? [], [kitsData]);
  const datasets = useMemo(() => datasetsData?.datasets ?? [], [datasetsData]);
  const kitId = selectedKitId || kits[0]?.id || BLANK;
  const kit = kits.find((entry) => entry.id === kitId) ?? null;
  const environmentName = kit?.environment ?? "seqdesk-explore-python";
  const environment = environmentsData?.environments.find((entry) => entry.name === environmentName) ?? null;

  const inputs = useMemo(
    () => (kit ? kit.inputs : [{ alias: "table", label: "Table", requiredRoles: [] as ExploreRole[], optionalRoles: [] as ExploreRole[], tableKind: null, optional: false }]),
    [kit]
  );
  const defaultParams = useMemo(() => {
    const defaults: Record<string, unknown> = {};
    for (const [key, property] of Object.entries(kit?.params?.properties ?? {})) {
      if (property && typeof property === "object" && "default" in property) defaults[key] = (property as { default: unknown }).default;
    }
    return defaults;
  }, [kit]);
  const requestedDatasetId = searchParams.get("dataset");
  const defaultBindings = useMemo(() => {
    const auto: Record<string, string> = {};
    const requested = requestedDatasetId ? datasets.find((dataset) => dataset.id === requestedDatasetId) : undefined;
    let requestedUsed = false;
    for (const input of inputs) {
      if (requested && !requestedUsed && datasetFits(requested, input).ok) {
        auto[input.alias] = requested.id;
        requestedUsed = true;
        continue;
      }
      const match = datasets.find((dataset) => datasetFits(dataset, input).ok);
      if (match) auto[input.alias] = match.id;
    }
    return auto;
  }, [inputs, datasets, requestedDatasetId]);
  const params = useMemo(
    () => ({ ...defaultParams, ...(paramOverrides.kitId === kitId ? paramOverrides.values : {}) }),
    [defaultParams, paramOverrides, kitId]
  );
  const bindings = useMemo(
    () => ({ ...defaultBindings, ...(bindingOverrides.kitId === kitId ? bindingOverrides.values : {}) }),
    [defaultBindings, bindingOverrides, kitId]
  );
  const setParams = (values: Record<string, unknown>) => setParamOverrides({ kitId, values });
  const setBindingValue = (alias: string, value: string) =>
    setBindingOverrides((current) => ({ kitId, values: { ...(current.kitId === kitId ? current.values : {}), [alias]: value } }));
  const problems = inputs
    .map((input) => {
      const datasetId = bindings[input.alias];
      if (!datasetId) return input.optional ? null : `${input.label}: choose a dataset`;
      const dataset = datasets.find((entry) => entry.id === datasetId);
      if (!dataset) return `${input.label}: dataset not found`;
      const fit = datasetFits(dataset, input);
      return fit.ok ? null : `${input.label}: ${fit.reason}`;
    })
    .filter((problem): problem is string => Boolean(problem));

  const create = async () => {
    if (!validScope) return;
    setBusy(true);
    try {
      const result = await postJson<{ analysis: { id: string } }>("/api/explore/analyses", {
        targetKey: validScope,
        kitId: kit?.id ?? null,
        name: name.trim() || undefined,
        language: kit?.language ?? "python",
        inputs: inputs.filter((input) => bindings[input.alias]).map((input) => ({ alias: input.alias, datasetId: bindings[input.alias] })),
        params,
      });
      toast.success("Analysis created");
      router.push(`/explore/analyses/${result.analysis.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the analysis");
      setBusy(false);
    }
  };

  if (!validScope) {
    return (
      <PageContainer maxWidth="medium">
        <p className="text-sm text-muted-foreground">Start a new analysis from an Explore scope.</p>
        <Button asChild variant="link"><Link href="/explore">Go to Explore</Link></Button>
      </PageContainer>
    );
  }

  return (
    <PageContainer maxWidth="wide">
      <Link href={`/explore?scope=${encodeURIComponent(validScope)}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Explore
      </Link>
      <h1 className="mt-2 text-xl font-semibold">New analysis</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Pick a kit, connect the datasets it needs and set its parameters. The code of the kit is copied into your analysis, where you can read and change it.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-2">
          {kits.length === 0 && !kitsData && <Skeleton className="h-24 w-full" />}
          {kits.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setKitId(entry.id)}
              className={`w-full rounded-lg border p-3 text-left transition-colors ${kitId === entry.id ? "border-primary bg-secondary" : "hover:bg-muted/40"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{entry.name}</span>
                <Badge variant="outline" className="capitalize">{entry.language}</Badge>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{entry.description}</p>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setKitId(BLANK)}
            className={`w-full rounded-lg border border-dashed p-3 text-left transition-colors ${kitId === BLANK ? "border-primary bg-secondary" : "hover:bg-muted/40"}`}
          >
            <div className="flex items-center gap-2 font-medium"><Code2 className="h-4 w-4" /> Blank Python analysis</div>
            <p className="mt-1 text-xs text-muted-foreground">Start from a minimal script that loads one table.</p>
          </button>
          {kitsData?.problems && kitsData.problems.length > 0 && (
            <p className="text-xs text-amber-700">{kitsData.problems.length} kit{kitsData.problems.length === 1 ? "" : "s"} could not be loaded; check the server log.</p>
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-lg border p-4">
            <h2 className="text-sm font-semibold">{kit ? kit.name : "Blank analysis"}</h2>
            {kit && <p className="mt-1 text-sm text-muted-foreground">{kit.description}</p>}
            {kit && kit.outputs.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">Produces: {kit.outputs.map((output) => `${output.name} (${output.kind})`).join(", ")}</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="secondary">{environmentName}</Badge>
              {environment ? (
                <span className={environment.status === "ready" ? "text-muted-foreground" : "text-amber-700"}>
                  environment {environment.status}
                  {environment.status !== "ready" && (
                    <>
                      {" "}
                      <Link href="/explore/environments" className="underline">manage</Link>
                    </>
                  )}
                </span>
              ) : null}
            </div>
            <div className="mt-4">
              <label htmlFor="analysis-name" className="text-sm font-medium">Name</label>
              <Input id="analysis-name" className="mt-1" value={name} placeholder={kit?.name ?? "Untitled analysis"} onChange={(event) => setName(event.target.value)} />
            </div>
          </div>

          <div className="rounded-lg border p-4">
            <h2 className="text-sm font-semibold">Inputs</h2>
            <div className="mt-3 space-y-3">
              {inputs.map((input) => {
                const chosen = datasets.find((entry) => entry.id === bindings[input.alias]);
                const fit = chosen ? datasetFits(chosen, input) : null;
                return (
                  <div key={input.alias} className="grid gap-2 sm:grid-cols-[220px_minmax(0,1fr)] sm:items-start">
                    <div>
                      <div className="text-sm font-medium">
                        {input.label} {input.optional ? <span className="text-xs text-muted-foreground">optional</span> : null}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {input.tableKind ? TABLE_KIND_DEFINITIONS[input.tableKind]?.label ?? input.tableKind : "any table"}
                        {input.requiredRoles.length > 0 && ` with ${input.requiredRoles.map((role) => ROLE_LABELS[role]).join(", ")}`}
                      </div>
                    </div>
                    <div>
                      <Select value={bindings[input.alias] || NONE} onValueChange={(value) => setBindingValue(input.alias, value === NONE ? "" : value)}>
                        <SelectTrigger aria-label={`${input.label} dataset`}><SelectValue placeholder="Choose a dataset" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>not set</SelectItem>
                          {datasets.map((dataset) => (
                            <SelectItem key={dataset.id} value={dataset.id}>
                              {dataset.name} ({dataset.currentVersion?.rowCount ?? 0} rows)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {fit && !fit.ok && <p className="mt-1 text-xs text-amber-700">{fit.reason}</p>}
                    </div>
                  </div>
                );
              })}
              {datasets.length === 0 && <p className="text-sm text-muted-foreground">This scope has no datasets yet. Build or import one first.</p>}
            </div>
          </div>

          <div className="rounded-lg border p-4">
            <h2 className="text-sm font-semibold">Parameters</h2>
            <div className="mt-3">
              <ParamsForm schema={kit?.params} values={params} onChange={setParams} />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={() => void create()} disabled={busy || problems.length > 0}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create analysis
            </Button>
            {problems.length > 0 && <span className="text-xs text-amber-700">{problems[0]}</span>}
          </div>
        </div>
      </div>
    </PageContainer>
  );
}

function datasetFits(
  dataset: ExploreDatasetSummary,
  input: { tableKind?: string | null; requiredRoles: ExploreRole[] }
): { ok: boolean; reason?: string } {
  if (input.tableKind && dataset.tableKind !== input.tableKind) {
    return { ok: false, reason: `needs a ${TABLE_KIND_DEFINITIONS[input.tableKind]?.label ?? input.tableKind} dataset` };
  }
  const missing = input.requiredRoles.filter((role) => !dataset.roles[role]);
  if (missing.length > 0) {
    return { ok: false, reason: `set the ${missing.map((role) => ROLE_LABELS[role]).join(", ")} role on the dataset first` };
  }
  return { ok: true };
}
