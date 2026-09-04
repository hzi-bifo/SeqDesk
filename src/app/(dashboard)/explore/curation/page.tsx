"use client";

import { Suspense, useCallback, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { ArrowLeft, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { fetcher, postJson } from "@/lib/explore/client";
import type { CurationListRecord } from "@/lib/explore/curation";
import { isValidTargetKey } from "@/lib/explore/target-key";

interface SeedSummary {
  seedId: string;
  label: string;
  description?: string;
  listCount: number;
}

export default function CurationPage() {
  return (
    <Suspense fallback={<PageContainer><Skeleton className="h-8 w-48" /></PageContainer>}>
      <CurationEditor />
    </Suspense>
  );
}

function CurationEditor() {
  const searchParams = useSearchParams();
  const scope = searchParams.get("scope");
  const validScope = scope && isValidTargetKey(scope) ? scope : null;
  const key = validScope ? `/api/explore/curation?targetKey=${encodeURIComponent(validScope)}` : null;
  const { data, mutate, isLoading } = useSWR<{ lists: CurationListRecord[]; seeds: SeedSummary[] }>(key, fetcher);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const applySeed = useCallback(
    async (seedId: string) => {
      if (!validScope) return;
      if (data && data.lists.length > 0 && !window.confirm("Applying a seed replaces lists with the same ids. Continue?")) return;
      setBusy(seedId);
      try {
        const result = await postJson<{ applied: number }>("/api/explore/curation/seed", { targetKey: validScope, seedId });
        await mutate();
        toast.success(`${result.applied} lists applied`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not apply the seed");
      } finally {
        setBusy(null);
      }
    },
    [validScope, data, mutate]
  );

  if (!validScope) {
    return (
      <PageContainer maxWidth="medium">
        <p className="text-sm text-muted-foreground">Open the curated lists from an Explore scope.</p>
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
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Curated lists</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Named organism lists of this scope. Pathogen and flora lists drive the highlights in views; artifact lists
            remove taxa from compositions and renormalize abundances. Edits apply immediately to every view and to new
            analysis runs without rebuilding datasets.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New list
        </Button>
      </div>

      {data && data.seeds.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
          <span className="font-medium">Start from a seed:</span>
          {data.seeds.map((seed) => (
            <Button key={seed.seedId} size="sm" variant="outline" onClick={() => void applySeed(seed.seedId)} disabled={busy !== null} title={seed.description}>
              {busy === seed.seedId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {seed.label} ({seed.listCount} lists)
            </Button>
          ))}
        </div>
      )}

      {isLoading ? (
        <Skeleton className="mt-6 h-40 w-full" />
      ) : (
        <div className="mt-6 space-y-4">
          {creating && (
            <ListEditor
              scope={validScope}
              list={{ listId: "", label: "", role: "pathogen", site: null, tier: null, color: null, entries: [], version: 0, updatedAt: "" }}
              isNew
              onSaved={async () => {
                setCreating(false);
                await mutate();
              }}
              onCancel={() => setCreating(false)}
            />
          )}
          {(data?.lists ?? []).map((list) => (
            <ListEditor key={list.listId} scope={validScope} list={list} onSaved={() => mutate()} />
          ))}
          {data && data.lists.length === 0 && !creating && (
            <p className="text-sm text-muted-foreground">No lists yet. Apply a seed or create a list.</p>
          )}
        </div>
      )}
    </PageContainer>
  );
}

function ListEditor({ scope, list, isNew, onSaved, onCancel }: { scope: string; list: CurationListRecord; isNew?: boolean; onSaved: () => Promise<unknown> | unknown; onCancel?: () => void }) {
  const [listId, setListId] = useState(list.listId);
  const [label, setLabel] = useState(list.label);
  const [role, setRole] = useState<CurationListRecord["role"]>(list.role);
  const [site, setSite] = useState(list.site ?? "");
  const [tier, setTier] = useState(list.tier ?? "");
  const [color, setColor] = useState(list.color ?? "");
  const [entriesText, setEntriesText] = useState(list.entries.map((entry) => entry.name).join("\n"));
  const [open, setOpen] = useState(Boolean(isNew));
  const [busy, setBusy] = useState(false);
  const notes = new Map(list.entries.map((entry) => [entry.name, entry] as const));

  const save = async () => {
    setBusy(true);
    try {
      const names = entriesText.split("\n").map((line) => line.trim()).filter(Boolean);
      const entries = names.map((name) => ({ name, note: notes.get(name)?.note, refs: notes.get(name)?.refs }));
      await postJson("/api/explore/curation", { targetKey: scope, listId, label, role, site: site || null, tier: tier || null, color: color || null, entries }, "PUT");
      toast.success(`${label || listId} saved`);
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the list");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete the list "${list.label}"?`)) return;
    setBusy(true);
    try {
      await postJson(`/api/explore/curation?targetKey=${encodeURIComponent(scope)}&listId=${encodeURIComponent(list.listId)}`, undefined, "DELETE");
      toast.success("List deleted");
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the list");
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border">
      <button type="button" className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left" onClick={() => setOpen((value) => !value)}>
        <span className="h-3 w-3 rounded-full" style={{ background: list.color ?? "#999" }} />
        <span className="font-medium">{list.label || "New list"}</span>
        <Badge variant="outline">{list.role}</Badge>
        {list.site && <Badge variant="secondary">{list.site}</Badge>}
        {list.tier && <span className="text-xs text-muted-foreground">{list.tier}</span>}
        <span className="flex-1" />
        <span className="text-xs text-muted-foreground">{list.entries.length} entries</span>
      </button>
      {open && (
        <div className="space-y-3 border-t p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="text-xs font-medium">List id</label>
              <Input value={listId} disabled={!isNew} onChange={(event) => setListId(event.target.value)} placeholder="urine_verified" className="mt-1" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium">Label</label>
              <Input value={label} onChange={(event) => setLabel(event.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium">Role</label>
              <Select value={role} onValueChange={(value) => setRole(value as CurationListRecord["role"])}>
                <SelectTrigger className="mt-1" aria-label="Role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pathogen">pathogen (highlighted)</SelectItem>
                  <SelectItem value="flora">flora (context)</SelectItem>
                  <SelectItem value="artifact">artifact (removed)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium">Specimen type (site)</label>
              <Input value={site} onChange={(event) => setSite(event.target.value)} placeholder="Urine" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium">Tier</label>
              <Input value={tier} onChange={(event) => setTier(event.target.value)} placeholder="verified" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium">Color</label>
              <Input value={color} onChange={(event) => setColor(event.target.value)} placeholder="#C0392B" className="mt-1" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium">Entries, one organism per line</label>
            <Textarea value={entriesText} onChange={(event) => setEntriesText(event.target.value)} rows={8} className="mt-1 font-mono text-xs" />
            <p className="mt-1 text-xs text-muted-foreground">Notes and references of seeded entries are kept when the name stays unchanged.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void save()} disabled={busy || !listId || !label}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save
            </Button>
            {!isNew && (
              <Button size="sm" variant="outline" onClick={() => void remove()} disabled={busy}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            )}
            {onCancel && <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>}
          </div>
        </div>
      )}
    </div>
  );
}
