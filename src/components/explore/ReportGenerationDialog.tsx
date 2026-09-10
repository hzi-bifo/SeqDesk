"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { BarChart3, FileText, Loader2, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ParamsForm, type ParamsSchema } from "./ParamsForm";
import { fetcher, postJson } from "@/lib/explore/client";
import { datasetFitMessage, datasetFitsInput } from "@/lib/explore/dataset-kinds";
import { outputLabel, outputSummary } from "@/lib/explore/report-generation";
import type { KitManifest } from "@/lib/explore/kits/schema";
import { parameterDefaults, parameterProblems } from "@/lib/explore/kits/parameters";
import type { ExploreDatasetSummary } from "@/lib/explore/types";

interface Props { scope: string; reportId: string; kitId: string; inputAlias: string; dataset: ExploreDatasetSummary; onClose: () => void; onStarted: () => void }

export function ReportGenerationDialog(props: Props) {
  const kits = useSWR<{ kits: KitManifest[] }>("/api/explore/kits", fetcher);
  const tables = useSWR<{ datasets: ExploreDatasetSummary[] }>(`/api/explore/datasets?targetKey=${encodeURIComponent(props.scope)}`, fetcher);
  const environments = useSWR<{ environments: Array<{ name: string; status: string }> }>("/api/explore/environments", fetcher);
  const kit = kits.data?.kits.find(kit => kit.id === props.kitId);
  const error = kits.error || tables.error || environments.error;
  return <Dialog open onOpenChange={open => { if (!open) props.onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
    <DialogHeader className="pr-5 text-left"><DialogTitle>Create report content</DialogTitle><DialogDescription>Use saved results to generate charts and tables. Your sequencing pipeline will not run again.</DialogDescription></DialogHeader>
    {error ? <div role="alert" className="space-y-3 text-sm"><p>Could not load the setup. {error.message}</p><Button variant="outline" onClick={() => { void kits.mutate(); void tables.mutate(); void environments.mutate(); }}>Retry setup</Button></div>
      : !kits.data || !tables.data || !environments.data ? <div role="status" className="space-y-3"><p className="text-sm text-muted-foreground">Checking templates and saved data…</p><div className="h-24 rounded-lg bg-muted motion-safe:animate-pulse" /></div>
        : !kit ? <p role="alert">This template is no longer installed. Close this window and choose another.</p>
          : <GenerationForm {...props} kit={kit} datasets={tables.data.datasets} ready={environments.data.environments.some(environment => environment.name === kit.environment && environment.status === "ready")} />}
  </DialogContent></Dialog>;
}

function GenerationForm({ kit, datasets, ready, ...props }: Props & { kit: KitManifest; datasets: ExploreDatasetSummary[]; ready: boolean }) {
  // Keep the exact versions the user reviewed, even if SWR receives newer data.
  const [choices, setChoices] = useState<Record<string, ExploreDatasetSummary | null>>(() => Object.fromEntries(kit.inputs.map(input => {
    if (input.alias === props.inputAlias) return [input.alias, props.dataset];
    const compatible = datasets.filter(dataset => dataset.currentVersion && dataset.currentVersion.rowCount > 0 && datasetFitsInput(dataset, input).ok);
    return [input.alias, !input.optional && compatible.length === 1 ? compatible[0] : null];
  })));
  const [name, setName] = useState(kit.name);
  const [params, setParams] = useState<Record<string, unknown>>(() => parameterDefaults(kit.params));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const outputs = kit.outputs.filter(output => output.report?.include !== false);
  const problems = [...kit.inputs.flatMap(input => {
    const chosen = choices[input.alias];
    if (!chosen) return input.optional ? [] : [`Choose a table for ${input.label}.`];
    if (!chosen.currentVersion?.rowCount) return [`${input.label}: the table has no data.`];
    const fit = datasetFitsInput(chosen, input);
    return fit.ok ? [] : [`${input.label}: ${datasetFitMessage(fit)}`];
  }), ...parameterProblems(kit.params, params)];
  const candidates = useMemo(() => [props.dataset, ...datasets.filter(dataset => dataset.id !== props.dataset.id)], [datasets, props.dataset]);
  const generate = async () => {
    if (inFlight.current || problems.length || !ready) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const body = { kitId: kit.id, name: name.trim(), params, inputs: kit.inputs.flatMap(input => {
      const choice = choices[input.alias];
      return choice?.currentVersion ? [{ alias: input.alias, datasetId: choice.id, versionId: choice.currentVersion.id }] : [];
    }) };
    const signature = JSON.stringify(body);
    if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
    try {
      await postJson(`/api/explore/reports/${encodeURIComponent(props.reportId)}/generations`, { ...body, requestId: request.current.id });
      props.onStarted();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not start generation. Check the report for progress before trying again."); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <div className="space-y-5">
    <section className="rounded-xl border border-teal-200 bg-teal-50/50 p-4 dark:border-teal-800 dark:bg-teal-950/20">
      <h3 className="font-semibold">{kit.name}</h3><p className="mt-1 text-sm text-muted-foreground">{kit.description}</p>
      <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide">What you will get · {outputSummary(outputs)}</h4>
      <ul className="mt-2 space-y-2">{outputs.map(output => {
        const Icon = output.kind === "figure" ? BarChart3 : output.kind === "table" ? Table2 : FileText;
        return <li key={`${output.kind}:${output.name}`} className="flex gap-2 text-sm"><Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-teal-700 dark:text-teal-300" /><div><span className="font-medium">{outputLabel(output)}</span>{output.optional && <span className="ml-1 text-xs text-muted-foreground">when available</span>}{output.description && <p className="text-xs text-muted-foreground">{output.description}</p>}</div></li>;
      })}{Boolean(kit.report?.metrics?.length) && <li className="flex gap-2 text-sm"><BarChart3 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-teal-700 dark:text-teal-300" /><div><span className="font-medium">Summary metrics</span><p className="text-xs text-muted-foreground">{kit.report!.metrics!.map(metric => metric.label).join(" · ")} (when provided)</p></div></li>}</ul>
    </section>
    <section><h3 className="mb-3 text-sm font-semibold">Use these saved results</h3><div className="space-y-3">{kit.inputs.map(input => {
      const selected = choices[input.alias];
      const fits = candidates.map(dataset => ({ dataset, fit: datasetFitsInput(dataset, input), hasRows: Boolean(dataset.currentVersion?.rowCount) }));
      return <div key={input.alias}><label className="text-sm font-medium" htmlFor={`generation-input-${input.alias}`}>{input.label}{input.optional ? " (optional)" : ""}</label>
        <select id={`generation-input-${input.alias}`} disabled={busy} value={selected?.id ?? ""} onChange={event => setChoices(current => ({ ...current, [input.alias]: candidates.find(dataset => dataset.id === event.target.value) ?? null }))} className="mt-1 w-full rounded-lg border bg-background p-2 text-sm">
          <option value="">{input.optional ? "Do not include" : "Choose a compatible table"}</option>
          <optgroup label="Compatible tables">{fits.filter(entry => entry.fit.ok && entry.hasRows).map(({ dataset }) => <option key={dataset.id} value={dataset.id}>{dataset.name} · {dataset.currentVersion?.rowCount} row{dataset.currentVersion?.rowCount === 1 ? "" : "s"}</option>)}</optgroup>
          {fits.some(entry => !entry.fit.ok || !entry.hasRows) && <optgroup label="Unavailable for this input">{fits.filter(entry => !entry.fit.ok || !entry.hasRows).map(({ dataset, fit, hasRows }) => <option key={dataset.id} value={dataset.id} disabled>{dataset.name} — {!hasRows ? "No rows" : datasetFitMessage(fit)}</option>)}</optgroup>}
        </select>
        {selected?.currentVersion && <p className="mt-1 text-xs text-muted-foreground">Saved version {selected.currentVersion.number} · {selected.currentVersion.rowCount} row{selected.currentVersion.rowCount === 1 ? "" : "s"}. Newer versions will not be substituted.</p>}
      </div>;
    })}</div></section>
    <details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer font-medium">Advanced options</summary><div className="mt-3 space-y-3">
      <label className="block">Analysis name<Input className="mt-1" value={name} maxLength={200} disabled={busy} onChange={event => setName(event.target.value)} /></label>
      {Object.keys(kit.params?.properties ?? {}).length > 0 && <ParamsForm schema={kit.params as ParamsSchema | undefined} values={params} onChange={setParams} disabled={busy} />}
      <p className="text-xs text-muted-foreground">Environment: {kit.environment}. Runs using SeqDesk’s configured execution and security settings.</p>
      <Link className="inline-block text-xs underline" href={`/explore/analyses/new?${new URLSearchParams({ scope: props.scope, report: props.reportId, kit: kit.id, dataset: props.dataset.id, input: props.inputAlias })}`}>Open full analysis setup</Link>
    </div></details>
    {!ready && <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">The analysis software is not ready. An administrator needs to <Link href="/explore/environments" className="underline">set up the analysis environment</Link> first. Nothing will be installed automatically.</p>}
    {problems.length > 0 && <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">{problems[0]}</p>}
    {error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{error}</p><Link href={`/explore/reports/${encodeURIComponent(props.reportId)}?scope=${encodeURIComponent(props.scope)}`} className="underline">Check progress on the report</Link></div>}
    <div className="border-t pt-4"><Button disabled={busy || !ready || problems.length > 0 || !outputs.length} onClick={() => void generate()}>{busy && <Loader2 aria-hidden className="mr-2 h-4 w-4 animate-spin" />}{busy ? "Starting generation…" : "Generate report content"}</Button>
      <p className="mt-2 text-xs text-muted-foreground">You can leave while it runs. Review the finished items before adding them; existing report content stays unchanged.</p></div>
  </div>;
}
