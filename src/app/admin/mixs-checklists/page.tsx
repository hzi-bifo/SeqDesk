"use client";

import { useState, useEffect } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Loader2,
  ListChecks,
  RefreshCw,
  RotateCcw,
  AlertCircle,
  X,
  Check,
  ExternalLink,
} from "lucide-react";
import { toast } from "@/components/ui/toast";
import { PageLoader } from "@/components/ui/page-loader";

type MixsChecklistField = {
  name: string;
  label: string;
  required: boolean;
  [key: string]: unknown;
};

type MixsChecklist = {
  name: string;
  description?: string;
  version?: string;
  source?: string;
  category?: string;
  accession?: string;
  fields: MixsChecklistField[];
  available?: boolean;
  localOverrides?: boolean;
  deprecated?: boolean;
};

type MixsChecklistConfig = {
  version: number;
  lastUpdated?: string;
  lastSyncedAt?: string;
  syncUrl?: string;
  checklists: MixsChecklist[];
  deprecated?: MixsChecklist[];
};

type DiffChecklist = { accession: string; name: string };

type DiffChangedChecklist = {
  accession: string;
  name: string;
  newFields: string[];
  removedFields: string[];
  newlyRequired: string[];
};

type UpdateDiff = {
  hasUpdates: boolean;
  message: string;
  currentVersion?: number;
  remoteVersion?: number;
  added?: DiffChecklist[];
  removed?: DiffChecklist[];
  changed?: DiffChangedChecklist[];
  error?: boolean;
};

type UpdateNotice = {
  tone: "success" | "error" | "info";
  message: string;
};

export default function MixsChecklistsPage() {
  const [config, setConfig] = useState<MixsChecklistConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [applying, setApplying] = useState(false);
  const [updateNotice, setUpdateNotice] = useState<UpdateNotice | null>(null);
  const [diff, setDiff] = useState<UpdateDiff | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  // Fetch config
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch("/api/admin/mixs-checklists");
        if (res.ok) {
          const data = await res.json();
          setConfig(data.config);
        }
      } catch {
        console.error("Failed to load config");
      } finally {
        setLoading(false);
      }
    };
    fetchConfig();
  }, []);

  const checklists = config?.checklists ?? [];
  const deprecated = config?.deprecated ?? [];

  const updateNoticeStyles: Record<UpdateNotice["tone"], string> = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-700",
    error: "border-red-200 bg-red-50 text-red-700",
    info: "border-slate-200 bg-slate-50 text-slate-700",
  };

  const formatLastSyncedAt = (value?: string) => {
    if (!value) return "Never";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  };

  const mandatoryCount = (checklist: MixsChecklist) =>
    checklist.fields.filter((field) => field.required).length;

  const toggleAvailable = (accession: string | undefined, name: string) => {
    if (!config) return;
    setConfig({
      ...config,
      checklists: checklists.map((checklist) =>
        (accession && checklist.accession === accession) ||
        (!accession && checklist.name === name)
          ? { ...checklist, available: !(checklist.available ?? true) }
          : checklist
      ),
    });
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/mixs-checklists", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const data = await res.json();
      setConfig(data.config);
      toast.success("Configuration saved");
    } catch {
      toast.error("Failed to save configuration");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setResetDialogOpen(false);
    setResetting(true);
    try {
      const syncUrl = config?.syncUrl?.trim();
      const res = await fetch("/api/admin/mixs-checklists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reset",
          ...(syncUrl ? { syncUrl } : {}),
        }),
      });
      if (!res.ok) throw new Error("Failed to reset");
      const data = await res.json();
      setConfig(data.config);
      setDiff(null);
      setUpdateNotice(null);
      toast.success(data.message || "Reset to baseline");
    } catch {
      toast.error("Failed to reset");
    } finally {
      setResetting(false);
    }
  };

  const handleCheckUpdates = async () => {
    setUpdateNotice(null);
    setDiff(null);
    setCheckingUpdates(true);
    try {
      const syncUrl = config?.syncUrl?.trim();
      const res = await fetch("/api/admin/mixs-checklists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "check-updates",
          ...(syncUrl ? { syncUrl } : {}),
        }),
      });
      if (!res.ok) throw new Error("Failed to check");
      const data: UpdateDiff = await res.json();

      setDiff(data);

      if (data.error) {
        setUpdateNotice({ tone: "error", message: data.message });
      } else if (data.hasUpdates) {
        setUpdateNotice({ tone: "success", message: data.message });
      } else {
        setUpdateNotice({ tone: "info", message: data.message });
      }
    } catch {
      setUpdateNotice({
        tone: "error",
        message: "Failed to check for updates",
      });
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleApply = async () => {
    setApplying(true);
    try {
      const syncUrl = config?.syncUrl?.trim();
      const res = await fetch("/api/admin/mixs-checklists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "apply",
          ...(syncUrl ? { syncUrl } : {}),
        }),
      });
      if (!res.ok) throw new Error("Failed to apply");
      const data = await res.json();
      if (data.error || !data.applied) {
        toast.error(data.message || "Failed to apply update");
        return;
      }
      if (data.config) {
        setConfig(data.config);
      }
      setDiff(null);
      setUpdateNotice(null);
      toast.success(data.message || "Update applied");
    } catch {
      toast.error("Failed to apply update");
    } finally {
      setApplying(false);
    }
  };

  if (loading) {
    return <PageLoader />;
  }

  return (
    <PageContainer>
      <div className="space-y-8">
        <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-semibold">MIxS Checklists</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              GSC/ENA environment checklists offered in the study form, sourced
              from the registry. Toggle which checklists researchers can pick.
            </p>
            {config && (
              <p className="text-xs text-muted-foreground">
                Version {config.version} &middot; Last synced:{" "}
                {formatLastSyncedAt(config.lastSyncedAt)} &middot;{" "}
                {checklists.length} active
                {deprecated.length > 0
                  ? ` · ${deprecated.length} deprecated`
                  : ""}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCheckUpdates}
              disabled={checkingUpdates}
            >
              {checkingUpdates ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Check for Updates
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setResetDialogOpen(true)}
              disabled={resetting}
            >
              {resetting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4 mr-2" />
              )}
              Reset to Baseline
            </Button>
          </div>
        </div>

        {updateNotice && (
          <div
            className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${updateNoticeStyles[updateNotice.tone]}`}
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              <span>{updateNotice.message}</span>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setUpdateNotice(null)}
              aria-label="Dismiss update status"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        {diff && diff.hasUpdates && (
          <GlassCard className="p-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">Update Preview</h2>
                <span className="text-xs text-muted-foreground">
                  {typeof diff.currentVersion !== "undefined" && (
                    <>v{diff.currentVersion}</>
                  )}
                  {typeof diff.remoteVersion !== "undefined" && (
                    <> &rarr; v{diff.remoteVersion}</>
                  )}
                </span>
              </div>

              {diff.added && diff.added.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-emerald-700">
                    Added ({diff.added.length})
                  </p>
                  <ul className="space-y-1">
                    {diff.added.map((item) => (
                      <li
                        key={`added-${item.accession}`}
                        className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700"
                      >
                        <span className="font-medium">{item.name}</span>
                        <span className="text-emerald-600/80">
                          {item.accession}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {diff.removed && diff.removed.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-amber-700">
                    To be deprecated ({diff.removed.length})
                  </p>
                  <ul className="space-y-1">
                    {diff.removed.map((item) => (
                      <li
                        key={`removed-${item.accession}`}
                        className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700"
                      >
                        <span className="font-medium">{item.name}</span>
                        <span className="text-amber-600/80">
                          {item.accession}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {diff.changed && diff.changed.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-slate-700">
                    Changed ({diff.changed.length})
                  </p>
                  <ul className="space-y-2">
                    {diff.changed.map((item) => (
                      <li
                        key={`changed-${item.accession}`}
                        className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{item.name}</span>
                          <span className="text-slate-500">
                            {item.accession}
                          </span>
                        </div>
                        {item.newFields.length > 0 && (
                          <p className="mt-1">
                            <span className="font-medium text-emerald-700">
                              New fields:
                            </span>{" "}
                            {item.newFields.join(", ")}
                          </p>
                        )}
                        {item.removedFields.length > 0 && (
                          <p className="mt-1">
                            <span className="font-medium text-amber-700">
                              Removed fields:
                            </span>{" "}
                            {item.removedFields.join(", ")}
                          </p>
                        )}
                        {item.newlyRequired.length > 0 && (
                          <p className="mt-1">
                            <span className="font-medium text-red-700">
                              Newly required:
                            </span>{" "}
                            {item.newlyRequired.join(", ")}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex justify-end">
                <Button onClick={handleApply} disabled={applying} size="sm">
                  {applying ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4 mr-2" />
                  )}
                  Apply Update
                </Button>
              </div>
            </div>
          </GlassCard>
        )}

        {config && (
          <GlassCard className="p-4">
            <div className="space-y-2">
              <Label htmlFor="registry-sync-url">Registry Sync URL</Label>
              <Input
                id="registry-sync-url"
                value={config.syncUrl || ""}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    syncUrl: e.target.value,
                  })
                }
                placeholder="https://www.seqdesk.com/api/registry/mixs"
              />
              <p className="text-xs text-muted-foreground">
                Used for &quot;Check for Updates&quot; and registry reset. Save
                changes to persist it.
              </p>
            </div>
          </GlassCard>
        )}

        {/* Active checklists */}
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Active Checklists
          </h2>
          {checklists.length === 0 ? (
            <GlassCard className="p-4">
              <p className="text-sm text-muted-foreground">
                No checklists configured.
              </p>
            </GlassCard>
          ) : (
            checklists.map((checklist) => {
              const isAvailable = checklist.available ?? true;
              return (
                <GlassCard
                  key={checklist.accession || checklist.name}
                  className={`p-4 transition-opacity ${!isAvailable ? "opacity-60" : ""}`}
                >
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold">{checklist.name}</h3>
                        {checklist.accession && (
                          <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                            {checklist.accession}
                          </span>
                        )}
                        {checklist.localOverrides && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600">
                            Modified
                          </span>
                        )}
                        {checklist.source && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-500">
                            {checklist.source}
                          </span>
                        )}
                      </div>
                      {checklist.description && (
                        <p className="mt-1 text-sm text-muted-foreground truncate">
                          {checklist.description}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {checklist.fields.length} fields &middot;{" "}
                        {mandatoryCount(checklist)} mandatory
                        {checklist.category
                          ? ` · ${checklist.category}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label
                        htmlFor={`avail-${checklist.accession || checklist.name}`}
                        className="text-xs text-muted-foreground"
                      >
                        Available
                      </Label>
                      <Switch
                        id={`avail-${checklist.accession || checklist.name}`}
                        checked={isAvailable}
                        onCheckedChange={() =>
                          toggleAvailable(checklist.accession, checklist.name)
                        }
                      />
                    </div>
                  </div>
                </GlassCard>
              );
            })
          )}
        </div>

        {/* Deprecated checklists */}
        {deprecated.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">
              Deprecated Checklists
            </h2>
            {deprecated.map((checklist) => (
              <GlassCard
                key={`deprecated-${checklist.accession || checklist.name}`}
                className="p-4 opacity-60"
              >
                <div className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{checklist.name}</h3>
                      {checklist.accession && (
                        <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                          {checklist.accession}
                        </span>
                      )}
                      <span className="text-xs px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-500">
                        deprecated
                      </span>
                    </div>
                    {checklist.description && (
                      <p className="mt-1 text-sm text-muted-foreground truncate">
                        {checklist.description}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {checklist.fields.length} fields &middot;{" "}
                      {mandatoryCount(checklist)} mandatory
                    </p>
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        )}

        {/* Registry link */}
        {config?.syncUrl && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ExternalLink className="h-3.5 w-3.5" />
            <a
              href={config.syncUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              View registry source
            </a>
          </div>
        )}

        {/* Save Button */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Changes"
            )}
          </Button>
        </div>
      </div>

      {/* Reset Confirmation Dialog */}
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset to Baseline</DialogTitle>
            <DialogDescription>
              This will reset all MIxS checklists to the baseline registry
              configuration. Your customizations, including availability
              toggles, will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setResetDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleReset}>
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
