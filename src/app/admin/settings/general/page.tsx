"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Loader2, LockKeyhole } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { installationDetailsResponseSchema, installationDetailsSchema, type InstallationDetails, type InstallationDetailsValues } from "@/lib/settings/site-settings";

const sourceLabels = { default: "SeqDesk default", database: "Saved in SeqDesk", file: "Managed by settings file", env: "Managed by environment variable" } as const;

export default function InstallationDetailsPage() {
  const [loaded, setLoaded] = useState<InstallationDetails | null>(null);
  const [values, setValues] = useState<InstallationDetailsValues>({ name: "", contactEmail: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setProblem(null);
    try {
      const response = await fetch("/api/admin/settings/site", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Installation details could not be loaded.");
      const snapshot = installationDetailsResponseSchema.parse(data);
      setLoaded(snapshot);
      setValues(snapshot.settings);
      setNeedsReload(false);
      setSaved(false);
    } catch (error) {
      setProblem(error instanceof Error && !(error.name === "ZodError") ? error.message : "Installation details could not be loaded. Try again.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const changed = loaded ? (["name", "contactEmail"] as const).filter(field => loaded.editable[field] && values[field].trim() !== loaded.settings[field]) : [];
  const dirty = changed.length > 0;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!loaded || !dirty || saving || needsReload) return;
    // Validate only editable fields; a server-managed value must not prevent an
    // administrator updating the other field or be sent back as a UI override.
    const updates = Object.fromEntries(changed.map(field => [field, values[field]]));
    const validation = installationDetailsSchema.partial().safeParse(updates);
    if (!validation.success) {
      setProblem(validation.error.issues[0]?.message || "Check the values below.");
      return;
    }
    setSaving(true);
    setSaved(false);
    setProblem(null);
    try {
      const response = await fetch("/api/admin/settings/site", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validation.data, expectedRevision: loaded.revision }),
      });
      const data = await response.json().catch(() => {
        setNeedsReload(true);
        throw new Error("The save response could not be read. Reload saved values before trying again.");
      });
      if (!response.ok) {
        setNeedsReload(response.status === 409 || data.code === "saved-refresh-failed");
        throw new Error(data.error || "Installation details could not be saved.");
      }
      const snapshot = installationDetailsResponseSchema.parse(data);
      setLoaded(snapshot);
      setValues(snapshot.settings);
      setSaved(true);
    } catch (error) {
      setProblem(error instanceof Error && error.name !== "ZodError" ? error.message : "The save response could not be read. Reload saved values before trying again.");
      if (error instanceof Error && error.name === "ZodError") setNeedsReload(true);
    } finally {
      setSaving(false);
    }
  }

  return <PageContainer className="space-y-6">
    <Link href="/admin/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> Application settings</Link>
    <header className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">Installation details</h1>
      <p className="text-sm leading-6 text-muted-foreground">Name this installation and set the contact address used for notification replies. These settings apply to your whole team, not your personal account.</p>
    </header>
    {loading ? <div role="status" aria-label="Loading installation details" className="space-y-6 rounded-xl border bg-card p-5"><span className="sr-only">Loading installation details</span>{[0, 1].map(index => <div key={index} className="space-y-3"><Skeleton className="h-4 w-36" /><Skeleton className="h-10 w-full" /><Skeleton className="h-4 w-64 max-w-full" /></div>)}</div> : <>
      {problem && <div role="alert" className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4"><p className="text-sm">{problem}</p>{!loaded ? <Button variant="outline" onClick={() => void load()}>Try again</Button> : needsReload ? <><p className="text-sm text-muted-foreground">Your edits are still below. Reloading replaces them with the saved values.</p><Button variant="outline" onClick={() => void load()}>Reload saved values (discard edits)</Button></> : null}</div>}
      {loaded && <form onSubmit={save} noValidate className="space-y-5">
        {loaded.readOnlyReason && <p className="rounded-lg border bg-muted/30 p-4 text-sm">{loaded.readOnlyReason}</p>}
        <section className="space-y-6 rounded-xl border bg-card p-5 md:p-6" aria-label="Installation identity">
          {(["name", "contactEmail"] as const).map(field => <div key={field} className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2"><Label htmlFor={`installation-${field}`} className="text-sm font-medium">{field === "name" ? "Installation name" : "Contact email (optional)"}</Label><span className="inline-flex items-center gap-1 text-xs text-muted-foreground">{!loaded.editable[field] && <LockKeyhole className="size-3" aria-hidden />}{sourceLabels[loaded.sources[field]]}</span></div>
            <Input id={`installation-${field}`} type={field === "contactEmail" ? "email" : "text"} value={values[field]} maxLength={field === "name" ? 120 : 254} disabled={saving || !loaded.editable[field]} onChange={event => { setValues(previous => ({ ...previous, [field]: event.target.value })); setSaved(false); }} aria-describedby={`installation-${field}-help`} autoComplete={field === "contactEmail" ? "email" : "organization"} />
            <p id={`installation-${field}-help`} className="text-sm leading-5 text-muted-foreground">{field === "name" ? "Identifies this installation in notifications. This does not change the SeqDesk logo or application branding." : "Replies to notification emails go to this address. Leave empty to omit an installation-specific reply address; this does not enable email delivery."}</p>
            {loaded.sources[field] === "env" && <p className="text-xs text-muted-foreground">Change <code>{field === "name" ? "SEQDESK_SITE_NAME" : "SEQDESK_CONTACT_EMAIL"}</code> in the SeqDesk service environment, then restart the service.</p>}
            {loaded.sources[field] === "file" && <p className="text-xs text-muted-foreground">Ask the server operator to change <code>site.{field}</code> in the installed settings file. File-managed values take priority over changes saved in SeqDesk.</p>}
          </div>)}
          <Link href="/admin/settings/notifications" className="inline-block text-sm underline underline-offset-4">Configure email notifications</Link>
        </section>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!dirty || saving || needsReload}>{saving ? <><Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> Saving…</> : "Save installation details"}</Button>
          <p role="status" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">{saved ? <><Check className="size-4 text-emerald-600" aria-hidden /> Saved. No restart is needed for values changed here.</> : dirty ? "Unsaved changes" : "No unsaved changes"}</p>
        </div>
      </form>}
    </>}
  </PageContainer>;
}
