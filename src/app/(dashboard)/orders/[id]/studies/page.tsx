"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageContainer } from "@/components/layout/PageContainer";
import { HelpBox } from "@/components/ui/help-box";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  BookOpen,
  Plus,
  Check,
  FlaskConical,
  ArrowRight,
  X,
  Leaf,
  Droplets,
  User,
  Bug,
  Mountain,
  Wind,
  Waves,
  Microscope,
} from "lucide-react";

interface Sample {
  id: string;
  sampleId: string;
  sampleTitle: string | null;
  studyId: string | null;
  study: {
    id: string;
    title: string;
    checklistType: string | null;
  } | null;
}

interface Study {
  id: string;
  title: string;
  description: string | null;
  checklistType: string | null;
  submitted: boolean;
  _count: { samples: number };
}

interface Order {
  id: string;
  name: string | null;
  orderNumber: string;
  status: string;
  samples: Sample[];
}

const CHECKLIST_TYPES = [
  { id: "human-gut", name: "Human Gut", icon: User },
  { id: "human-oral", name: "Human Oral", icon: User },
  { id: "human-skin", name: "Human Skin", icon: User },
  { id: "human-associated", name: "Human Associated", icon: User },
  { id: "host-associated", name: "Host Associated", icon: Bug },
  { id: "plant-associated", name: "Plant Associated", icon: Leaf },
  { id: "soil", name: "Soil", icon: Mountain },
  { id: "water", name: "Water", icon: Droplets },
  { id: "wastewater-sludge", name: "Wastewater/Sludge", icon: Waves },
  { id: "air", name: "Air", icon: Wind },
  { id: "sediment", name: "Sediment", icon: Mountain },
  { id: "microbial-mat", name: "Microbial Mat/Biofilm", icon: Microscope },
  { id: "misc-environment", name: "Miscellaneous", icon: FlaskConical },
];

export default function OrderStudiesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [order, setOrder] = useState<Order | null>(null);
  const [studies, setStudies] = useState<Study[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Selection state
  const [selectedSamples, setSelectedSamples] = useState<Set<string>>(new Set());
  const [targetStudyId, setTargetStudyId] = useState<string | null>(null);

  // New study dialog
  const [showNewStudyDialog, setShowNewStudyDialog] = useState(false);
  const [newStudyTitle, setNewStudyTitle] = useState("");
  const [newStudyDescription, setNewStudyDescription] = useState("");
  const [newStudyChecklist, setNewStudyChecklist] = useState("");
  const [creatingStudy, setCreatingStudy] = useState(false);

  useEffect(() => {
    fetchData();
  }, [id]);

  const fetchData = async () => {
    try {
      const [orderRes, studiesRes] = await Promise.all([
        fetch(`/api/orders/${id}`),
        fetch("/api/studies"),
      ]);

      if (!orderRes.ok) throw new Error("Failed to fetch order");

      const orderData = await orderRes.json();
      setOrder(orderData);

      if (studiesRes.ok) {
        const studiesData = await studiesRes.json();
        setStudies(studiesData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  const handleToggleSample = (sampleId: string) => {
    const newSelected = new Set(selectedSamples);
    if (newSelected.has(sampleId)) {
      newSelected.delete(sampleId);
    } else {
      newSelected.add(sampleId);
    }
    setSelectedSamples(newSelected);
  };

  const handleSelectAllUnassigned = () => {
    if (!order) return;
    const unassigned = order.samples.filter(s => !s.studyId).map(s => s.id);
    setSelectedSamples(new Set(unassigned));
  };

  const handleAssignToStudy = async () => {
    if (!targetStudyId || selectedSamples.size === 0) return;

    setSaving(true);
    setError("");

    try {
      const res = await fetch(`/api/studies/${targetStudyId}/samples`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sampleIds: Array.from(selectedSamples),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to assign samples");
      }

      setSelectedSamples(new Set());
      setTargetStudyId(null);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign samples");
    } finally {
      setSaving(false);
    }
  };

  const handleUnassignSample = async (sampleId: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/samples/${sampleId}/study`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to unassign");
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unassign sample");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateStudy = async () => {
    if (!newStudyTitle.trim()) {
      setError("Study title is required");
      return;
    }

    if (!newStudyChecklist) {
      setError("Please select a MIxS checklist type");
      return;
    }

    setCreatingStudy(true);
    setError("");

    try {
      const res = await fetch("/api/studies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newStudyTitle.trim(),
          description: newStudyDescription.trim() || null,
          checklistType: newStudyChecklist,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create study");
      }

      const newStudy = await res.json();

      setShowNewStudyDialog(false);
      setNewStudyTitle("");
      setNewStudyDescription("");
      setNewStudyChecklist("");

      // Set as target for assignment
      setTargetStudyId(newStudy.id);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create study");
    } finally {
      setCreatingStudy(false);
    }
  };

  const getChecklistIcon = (checklistType: string | null) => {
    const checklist = CHECKLIST_TYPES.find(c => c.id === checklistType);
    return checklist?.icon || FlaskConical;
  };

  const getChecklistName = (checklistType: string | null) => {
    const checklist = CHECKLIST_TYPES.find(c => c.id === checklistType);
    return checklist?.name || "Not set";
  };

  // Group samples by study
  const groupedSamples = order?.samples.reduce((acc, sample) => {
    const key = sample.studyId || "unassigned";
    if (!acc[key]) acc[key] = [];
    acc[key].push(sample);
    return acc;
  }, {} as Record<string, Sample[]>) || {};

  const unassignedSamples = groupedSamples["unassigned"] || [];
  const assignedStudyIds = Object.keys(groupedSamples).filter(k => k !== "unassigned");

  if (loading) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </PageContainer>
    );
  }

  if (!order) {
    return (
      <PageContainer>
        <div className="text-center py-12">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
          <h2 className="text-xl font-semibold mb-2">Order Not Found</h2>
          <Button asChild variant="outline">
            <Link href="/orders">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Orders
            </Link>
          </Button>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {/* Header */}
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="mb-4">
          <Link href={`/orders/${id}`}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Order
          </Link>
        </Button>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Assign Samples to Studies</h1>
            <p className="text-muted-foreground mt-1">
              {order.name || order.orderNumber} - {order.samples.length} samples
            </p>
          </div>
          <Button onClick={() => setShowNewStudyDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Study
          </Button>
        </div>
      </div>

      <HelpBox title="How to assign samples">
        Select samples from the left panel, choose or create a study, then click Assign.
        Each study must have a MIxS checklist type that matches your sample environment.
        After assigning, you can fill in metadata on the study page.
      </HelpBox>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          {error}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setError("")}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Assignment Panel */}
      {selectedSamples.size > 0 && (
        <GlassCard className="p-4 mb-6 bg-blue-50/50 border-blue-200">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="font-medium">{selectedSamples.size} samples selected</span>
              <Button variant="ghost" size="sm" onClick={() => setSelectedSamples(new Set())}>
                Clear
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Select value={targetStudyId || ""} onValueChange={setTargetStudyId}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Select study..." />
                </SelectTrigger>
                <SelectContent>
                  {studies.filter(s => !s.submitted).map(study => {
                    const hasChecklist = !!study.checklistType;
                    return (
                      <SelectItem
                        key={study.id}
                        value={study.id}
                        disabled={!hasChecklist}
                      >
                        <span className={!hasChecklist ? "text-muted-foreground" : ""}>
                          {study.title}
                          {hasChecklist
                            ? ` (${getChecklistName(study.checklistType)})`
                            : " - No checklist set"
                          }
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <Button
                onClick={handleAssignToStudy}
                disabled={!targetStudyId || saving}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <ArrowRight className="h-4 w-4 mr-2" />
                    Assign
                  </>
                )}
              </Button>
            </div>
          </div>
        </GlassCard>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Unassigned Samples */}
        <div>
          <GlassCard className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-amber-500" />
                Unassigned Samples ({unassignedSamples.length})
              </h2>
              {unassignedSamples.length > 0 && (
                <Button variant="outline" size="sm" onClick={handleSelectAllUnassigned}>
                  Select All
                </Button>
              )}
            </div>

            {unassignedSamples.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Check className="h-10 w-10 mx-auto mb-2 text-green-500" />
                <p>All samples are assigned to studies</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {unassignedSamples.map(sample => (
                  <label
                    key={sample.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedSamples.has(sample.id)
                        ? "bg-blue-50 border-blue-300"
                        : "bg-white border-stone-200 hover:border-stone-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSamples.has(sample.id)}
                      onChange={() => handleToggleSample(sample.id)}
                      className="rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{sample.sampleId}</p>
                      {sample.sampleTitle && (
                        <p className="text-xs text-muted-foreground truncate">{sample.sampleTitle}</p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </GlassCard>
        </div>

        {/* Assigned Studies */}
        <div className="space-y-4">
          {assignedStudyIds.length === 0 && unassignedSamples.length > 0 && (
            <GlassCard className="p-6 text-center">
              <BookOpen className="h-10 w-10 mx-auto mb-2 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground mb-4">No studies created yet</p>
              <Button onClick={() => setShowNewStudyDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create First Study
              </Button>
            </GlassCard>
          )}

          {assignedStudyIds.map(studyId => {
            const studySamples = groupedSamples[studyId];
            const firstSample = studySamples[0];
            const study = firstSample?.study;
            if (!study) return null;

            const ChecklistIcon = getChecklistIcon(study.checklistType);

            return (
              <GlassCard key={studyId} className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <ChecklistIcon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold">{study.title}</h3>
                      <p className="text-sm text-muted-foreground">
                        {study.checklistType ? getChecklistName(study.checklistType) : "No checklist set"}
                        {" - "}
                        {studySamples.length} sample{studySamples.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/studies/${studyId}`}>
                      View Study
                    </Link>
                  </Button>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {studySamples.map(sample => (
                    <div
                      key={sample.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-stone-50"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{sample.sampleId}</p>
                        {sample.sampleTitle && (
                          <p className="text-xs text-muted-foreground truncate">{sample.sampleTitle}</p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => handleUnassignSample(sample.id)}
                        disabled={saving}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </GlassCard>
            );
          })}
        </div>
      </div>

      {/* New Study Dialog */}
      <Dialog open={showNewStudyDialog} onOpenChange={setShowNewStudyDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Study</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="study-title">Study Title</Label>
              <Input
                id="study-title"
                value={newStudyTitle}
                onChange={(e) => setNewStudyTitle(e.target.value)}
                placeholder="e.g., Gut Microbiome Analysis 2024"
              />
            </div>

            <div>
              <Label htmlFor="study-description">Description (optional)</Label>
              <Textarea
                id="study-description"
                value={newStudyDescription}
                onChange={(e) => setNewStudyDescription(e.target.value)}
                placeholder="Describe the study..."
                rows={2}
              />
            </div>

            <div>
              <Label>MIxS Checklist Type *</Label>
              <Select value={newStudyChecklist} onValueChange={setNewStudyChecklist}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select environment type..." />
                </SelectTrigger>
                <SelectContent>
                  {CHECKLIST_TYPES.map(checklist => {
                    const Icon = checklist.icon;
                    return (
                      <SelectItem key={checklist.id} value={checklist.id}>
                        <span className="flex items-center gap-2">
                          <Icon className="h-4 w-4" />
                          {checklist.name}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                This determines which MIxS metadata fields will be available
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewStudyDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateStudy} disabled={creatingStudy}>
              {creatingStudy ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Study
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
