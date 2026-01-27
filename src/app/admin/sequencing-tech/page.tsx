"use client";

import { useState, useEffect } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
  Dna,
  Plus,
  Pencil,
  Trash2,
  RotateCcw,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  AlertCircle,
  ExternalLink,
  GripVertical,
} from "lucide-react";
import { toast } from "sonner";
import { useModule, useModules } from "@/lib/modules/ModuleContext";
import {
  SequencingTechnology,
  SequencingTechConfig,
} from "@/types/sequencing-technology";

export default function SequencingTechPage() {
  const { enabled: moduleEnabled } = useModule("sequencing-tech");
  const { loading: moduleLoading } = useModules();
  const [config, setConfig] = useState<SequencingTechConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  // Edit dialog state
  const [editDialog, setEditDialog] = useState(false);
  const [editingTech, setEditingTech] = useState<SequencingTechnology | null>(null);
  const [editForm, setEditForm] = useState<Partial<SequencingTechnology>>({});

  // Expanded cards
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Confirmation dialogs
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [techToDelete, setTechToDelete] = useState<SequencingTechnology | null>(null);

  // Fetch config
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch("/api/admin/sequencing-tech");
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

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/sequencing-tech", {
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
      const res = await fetch("/api/admin/sequencing-tech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      });
      if (!res.ok) throw new Error("Failed to reset");
      const data = await res.json();
      setConfig(data.config);
      toast.success("Reset to defaults");
    } catch {
      toast.error("Failed to reset");
    } finally {
      setResetting(false);
    }
  };

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true);
    try {
      const res = await fetch("/api/admin/sequencing-tech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check-updates" }),
      });
      if (!res.ok) throw new Error("Failed to check");
      const data = await res.json();

      // Update local config if updates were found and merged
      if (data.hasUpdates && data.config) {
        setConfig(data.config);
        toast.success(data.message);
      } else if (data.error) {
        toast.error(data.message);
      } else {
        toast.info(data.message);
      }
    } catch {
      toast.error("Failed to check for updates");
    } finally {
      setCheckingUpdates(false);
    }
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAvailable = (id: string) => {
    if (!config) return;
    setConfig({
      ...config,
      technologies: config.technologies.map((t) =>
        t.id === id ? { ...t, available: !t.available } : t
      ),
    });
  };

  const openEditDialog = (tech: SequencingTechnology) => {
    setEditingTech(tech);
    setEditForm({ ...tech });
    setEditDialog(true);
  };

  const handleEditSave = () => {
    if (!config || !editingTech || !editForm.name) return;

    setConfig({
      ...config,
      technologies: config.technologies.map((t) =>
        t.id === editingTech.id
          ? { ...t, ...editForm, localOverrides: true }
          : t
      ),
    });
    setEditDialog(false);
    setEditingTech(null);
    toast.success("Technology updated. Remember to save changes.");
  };

  const openDeleteDialog = (tech: SequencingTechnology) => {
    setTechToDelete(tech);
    setDeleteDialogOpen(true);
  };

  const deleteTechnology = () => {
    if (!config || !techToDelete) return;
    setConfig({
      ...config,
      technologies: config.technologies.filter((t) => t.id !== techToDelete.id),
    });
    setDeleteDialogOpen(false);
    setTechToDelete(null);
    toast.success("Technology removed. Remember to save changes.");
  };

  const addNewTechnology = () => {
    const newTech: SequencingTechnology = {
      id: `custom-${Date.now()}`,
      name: "New Technology",
      manufacturer: "",
      shortDescription: "Description here",
      specs: [],
      pros: [],
      cons: [],
      bestFor: [],
      available: true,
      order: config?.technologies.length || 0,
    };
    setEditingTech(newTech);
    setEditForm(newTech);
    setEditDialog(true);
  };

  const handleAddNewTech = () => {
    if (!config || !editForm.name) return;

    const newTech: SequencingTechnology = {
      id: editForm.id || `custom-${Date.now()}`,
      name: editForm.name || "New Technology",
      manufacturer: editForm.manufacturer || "",
      shortDescription: editForm.shortDescription || "",
      description: editForm.description,
      specs: editForm.specs || [],
      pros: editForm.pros || [],
      cons: editForm.cons || [],
      bestFor: editForm.bestFor || [],
      available: editForm.available ?? true,
      order: config.technologies.length,
      localOverrides: true,
    };

    setConfig({
      ...config,
      technologies: [...config.technologies, newTech],
    });
    setEditDialog(false);
    setEditingTech(null);
    toast.success("Technology added. Remember to save changes.");
  };

  if (moduleLoading || loading) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </PageContainer>
    );
  }

  if (!moduleEnabled) {
    return (
      <PageContainer>
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
              <Dna className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Sequencing Technologies</h1>
              <p className="text-muted-foreground">
                Configure available sequencing platforms
              </p>
            </div>
          </div>

          <GlassCard className="p-8">
            <div className="flex items-center gap-3 text-amber-600">
              <AlertCircle className="h-5 w-5" />
              <div>
                <h3 className="font-medium">Module Not Enabled</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Enable the "Sequencing Technologies" module in{" "}
                  <a href="/admin/modules" className="text-primary hover:underline">
                    Modules
                  </a>{" "}
                  to configure this feature.
                </p>
              </div>
            </div>
          </GlassCard>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
              <Dna className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Sequencing Technologies</h1>
              <p className="text-muted-foreground">
                Configure available sequencing platforms for your facility
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
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
              Reset to Defaults
            </Button>
          </div>
        </div>

        {/* Technologies List */}
        <div className="space-y-3">
          {config?.technologies.map((tech) => {
            const isExpanded = expandedIds.has(tech.id);
            return (
              <GlassCard
                key={tech.id}
                className={`transition-opacity ${!tech.available ? "opacity-60" : ""}`}
              >
                {/* Header Row */}
                <div className="p-4 flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(tech.id)}
                    className="flex-1 flex items-center gap-4 text-left"
                  >
                    <div
                      className="h-10 w-10 rounded-lg flex items-center justify-center text-lg font-bold"
                      style={{
                        backgroundColor: tech.color
                          ? `${tech.color}20`
                          : "var(--primary-10)",
                        color: tech.color || "var(--primary)",
                      }}
                    >
                      {tech.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{tech.name}</h3>
                        {tech.localOverrides && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600">
                            Modified
                          </span>
                        )}
                        {tech.comingSoon && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-500">
                            Coming Soon
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {tech.manufacturer} - {tech.shortDescription}
                      </p>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="h-5 w-5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-muted-foreground" />
                    )}
                  </button>

                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Label
                        htmlFor={`avail-${tech.id}`}
                        className="text-xs text-muted-foreground"
                      >
                        Available
                      </Label>
                      <Switch
                        id={`avail-${tech.id}`}
                        checked={tech.available}
                        onCheckedChange={() => toggleAvailable(tech.id)}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditDialog(tech)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => openDeleteDialog(tech)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-0 border-t border-border/50">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
                      {/* Specs */}
                      <div>
                        <h4 className="text-sm font-medium mb-2">Specifications</h4>
                        <div className="space-y-1">
                          {tech.specs.map((spec, i) => (
                            <div
                              key={i}
                              className="text-sm flex justify-between"
                            >
                              <span className="text-muted-foreground">
                                {spec.label}
                              </span>
                              <span>
                                {spec.value}
                                {spec.unit && ` ${spec.unit}`}
                              </span>
                            </div>
                          ))}
                          {tech.specs.length === 0 && (
                            <p className="text-sm text-muted-foreground italic">
                              No specs defined
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Pros */}
                      <div>
                        <h4 className="text-sm font-medium mb-2 text-green-600">
                          Pros
                        </h4>
                        <ul className="space-y-1">
                          {tech.pros.map((pro, i) => (
                            <li
                              key={i}
                              className="text-sm flex items-start gap-2"
                            >
                              <Check className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
                              <span>{pro.text}</span>
                            </li>
                          ))}
                          {tech.pros.length === 0 && (
                            <p className="text-sm text-muted-foreground italic">
                              No pros defined
                            </p>
                          )}
                        </ul>
                      </div>

                      {/* Cons */}
                      <div>
                        <h4 className="text-sm font-medium mb-2 text-red-600">
                          Cons
                        </h4>
                        <ul className="space-y-1">
                          {tech.cons.map((con, i) => (
                            <li
                              key={i}
                              className="text-sm flex items-start gap-2"
                            >
                              <X className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                              <span>{con.text}</span>
                            </li>
                          ))}
                          {tech.cons.length === 0 && (
                            <p className="text-sm text-muted-foreground italic">
                              No cons defined
                            </p>
                          )}
                        </ul>
                      </div>
                    </div>

                    {/* Best For */}
                    {tech.bestFor.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-border/50">
                        <h4 className="text-sm font-medium mb-2">Best For</h4>
                        <div className="flex flex-wrap gap-2">
                          {tech.bestFor.map((use, i) => (
                            <span
                              key={i}
                              className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary"
                            >
                              {use}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Price & Turnaround */}
                    <div className="mt-4 pt-4 border-t border-border/50 flex items-center gap-6 text-sm">
                      {tech.priceIndicator && (
                        <div>
                          <span className="text-muted-foreground">Cost: </span>
                          <span className="font-medium">{tech.priceIndicator}</span>
                        </div>
                      )}
                      {tech.turnaroundDays && (
                        <div>
                          <span className="text-muted-foreground">
                            Turnaround:{" "}
                          </span>
                          <span className="font-medium">
                            {tech.turnaroundDays.min}-{tech.turnaroundDays.max} days
                          </span>
                        </div>
                      )}
                      {tech.sourceUrl && (
                        <a
                          href={tech.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline flex items-center gap-1"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Documentation
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </GlassCard>
            );
          })}
        </div>

        {/* Add New */}
        <Button variant="outline" onClick={addNewTechnology} className="w-full">
          <Plus className="h-4 w-4 mr-2" />
          Add Custom Technology
        </Button>

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

      {/* Edit Dialog */}
      <Dialog open={editDialog} onOpenChange={setEditDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingTech?.id?.startsWith("custom-") && !config?.technologies.find(t => t.id === editingTech?.id)
                ? "Add Technology"
                : "Edit Technology"}
            </DialogTitle>
            <DialogDescription>
              Customize the technology information shown to users
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={editForm.name || ""}
                  onChange={(e) =>
                    setEditForm({ ...editForm, name: e.target.value })
                  }
                  placeholder="e.g., NovaSeq 6000"
                />
              </div>
              <div className="space-y-2">
                <Label>Manufacturer</Label>
                <Input
                  value={editForm.manufacturer || ""}
                  onChange={(e) =>
                    setEditForm({ ...editForm, manufacturer: e.target.value })
                  }
                  placeholder="e.g., Illumina"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Short Description</Label>
              <Input
                value={editForm.shortDescription || ""}
                onChange={(e) =>
                  setEditForm({ ...editForm, shortDescription: e.target.value })
                }
                placeholder="Brief description"
              />
            </div>

            <div className="space-y-2">
              <Label>Full Description (optional)</Label>
              <Textarea
                value={editForm.description || ""}
                onChange={(e) =>
                  setEditForm({ ...editForm, description: e.target.value })
                }
                placeholder="Detailed description"
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Brand Color (optional)</Label>
                <div className="flex gap-2">
                  <Input
                    type="color"
                    value={editForm.color || "#3b82f6"}
                    onChange={(e) =>
                      setEditForm({ ...editForm, color: e.target.value })
                    }
                    className="w-12 h-10 p-1"
                  />
                  <Input
                    value={editForm.color || ""}
                    onChange={(e) =>
                      setEditForm({ ...editForm, color: e.target.value })
                    }
                    placeholder="#0066CC"
                    className="flex-1"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Price Indicator</Label>
                <select
                  value={editForm.priceIndicator || ""}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      priceIndicator: e.target.value as "$" | "$$" | "$$$" | "$$$$" | undefined,
                    })
                  }
                  className="w-full h-10 rounded-md border border-input bg-background px-3"
                >
                  <option value="">Not set</option>
                  <option value="$">$ (Low)</option>
                  <option value="$$">$$ (Moderate)</option>
                  <option value="$$$">$$$ (High)</option>
                  <option value="$$$$">$$$$ (Very High)</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Specifications (one per line: Label: Value)</Label>
              <Textarea
                value={
                  editForm.specs
                    ?.map((s) => `${s.label}: ${s.value}${s.unit ? ` ${s.unit}` : ""}`)
                    .join("\n") || ""
                }
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                  const specs = e.target.value
                    .split("\n")
                    .filter((line: string) => line.includes(":"))
                    .map((line: string) => {
                      const [label, ...rest] = line.split(":");
                      return { label: label.trim(), value: rest.join(":").trim() };
                    });
                  setEditForm({ ...editForm, specs });
                }}
                placeholder="Read Length: 150bp&#10;Output: 6TB"
                rows={4}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Pros (one per line)</Label>
                <Textarea
                  value={editForm.pros?.map((p) => p.text).join("\n") || ""}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                    const pros = e.target.value
                      .split("\n")
                      .filter((line: string) => line.trim())
                      .map((text: string) => ({ text: text.trim() }));
                    setEditForm({ ...editForm, pros });
                  }}
                  placeholder="High throughput&#10;Low cost per sample"
                  rows={4}
                />
              </div>
              <div className="space-y-2">
                <Label>Cons (one per line)</Label>
                <Textarea
                  value={editForm.cons?.map((c) => c.text).join("\n") || ""}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                    const cons = e.target.value
                      .split("\n")
                      .filter((line: string) => line.trim())
                      .map((text: string) => ({ text: text.trim() }));
                    setEditForm({ ...editForm, cons });
                  }}
                  placeholder="Short read length&#10;High initial cost"
                  rows={4}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Best For (comma-separated)</Label>
              <Input
                value={editForm.bestFor?.join(", ") || ""}
                onChange={(e) => {
                  const bestFor = e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter((s) => s);
                  setEditForm({ ...editForm, bestFor });
                }}
                placeholder="Whole genome sequencing, RNA-seq, Metagenomics"
              />
            </div>

            <div className="space-y-2">
              <Label>Documentation URL (optional)</Label>
              <Input
                value={editForm.sourceUrl || ""}
                onChange={(e) =>
                  setEditForm({ ...editForm, sourceUrl: e.target.value })
                }
                placeholder="https://..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={
                editingTech?.id?.startsWith("custom-") &&
                !config?.technologies.find((t) => t.id === editingTech?.id)
                  ? handleAddNewTech
                  : handleEditSave
              }
            >
              {editingTech?.id?.startsWith("custom-") &&
              !config?.technologies.find((t) => t.id === editingTech?.id)
                ? "Add Technology"
                : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Confirmation Dialog */}
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset to Defaults</DialogTitle>
            <DialogDescription>
              This will reset all technologies to the default configuration. Your customizations will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleReset}>
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Technology Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Technology</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove &quot;{techToDelete?.name}&quot;? You can restore it by resetting to defaults.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={deleteTechnology}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
