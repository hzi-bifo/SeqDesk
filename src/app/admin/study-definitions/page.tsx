"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { notifyPanel } from "@/lib/notifications/client";
import { useModuleEnabled } from "@/lib/modules";
import { ArrowLeft, FlaskConical, Loader2, Plus, Settings2 } from "lucide-react";

interface StudyDefinition {
  id: string;
  title: string;
  alias: string | null;
  checklistType: string | null;
  submitted: boolean;
  createdAt: string;
  sampleCount: number;
  hasFormConfig: boolean;
}

export default function StudyDefinitionsPage() {
  const router = useRouter();
  const dynamicStudiesEnabled = useModuleEnabled("dynamic-studies");
  const [studies, setStudies] = useState<StudyDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [seedMode, setSeedMode] = useState<"blank" | "clone">("blank");
  const [cloneFromStudyId, setCloneFromStudyId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/study-definitions");
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to load studies");
      setStudies(data as StudyDefinition[]);
    } catch (error) {
      notifyPanel.error(
        error instanceof Error ? error.message : "Failed to load studies"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const studiesWithConfig = studies.filter((s) => s.hasFormConfig);

  const handleCreate = async () => {
    if (!title.trim()) {
      toast.error("Enter a study name");
      return;
    }
    if (seedMode === "clone" && !cloneFromStudyId) {
      toast.error("Choose a study to clone from");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/admin/study-definitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          seedMode,
          cloneFromStudyId: seedMode === "clone" ? cloneFromStudyId : undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to create study");
      toast.success("Study created");
      // Go straight to editing the new study's questionnaire.
      router.push(
        `/admin/study-form-builder?studyId=${encodeURIComponent(data.id)}`
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create study"
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <PageContainer>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
              <Link href="/admin/settings">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Admin Settings
              </Link>
            </Button>
            <h1 className="text-xl font-semibold">Define Studies</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Each study has its own questionnaire (per-sample and per-study
              fields). Create studies here, then assign samples to them during
              the sequencing run workflow.
            </p>
          </div>
          <Button onClick={() => setShowForm((v) => !v)}>
            <Plus className="mr-2 h-4 w-4" />
            Define new study
          </Button>
        </div>

        {!dynamicStudiesEnabled && (
          <Card>
            <CardContent className="py-4 text-sm text-muted-foreground">
              The <strong>Dynamic Study Definitions</strong> module is currently
              off. You can define studies here, but per-study questionnaires only
              take effect once the module is enabled under{" "}
              <Link
                href="/admin/modules"
                className="underline underline-offset-2"
              >
                Modules
              </Link>
              .
            </CardContent>
          </Card>
        )}

        {showForm && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Define a new study</CardTitle>
              <CardDescription>
                Name the study and choose a starting questionnaire. You can edit
                every field afterwards.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="study-title">Study name</Label>
                <Input
                  id="study-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Soil Microbiome 2026"
                />
              </div>
              <div className="space-y-2">
                <Label>Starting questionnaire</Label>
                <Select
                  value={seedMode}
                  onValueChange={(v) => setSeedMode(v as "blank" | "clone")}
                >
                  <SelectTrigger className="w-full sm:w-80">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blank">Blank (default fields)</SelectItem>
                    <SelectItem
                      value="clone"
                      disabled={studiesWithConfig.length === 0}
                    >
                      Clone an existing study
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {seedMode === "clone" && (
                <div className="space-y-2">
                  <Label>Clone from</Label>
                  <Select
                    value={cloneFromStudyId}
                    onValueChange={setCloneFromStudyId}
                  >
                    <SelectTrigger className="w-full sm:w-80">
                      <SelectValue placeholder="Select a study to clone" />
                    </SelectTrigger>
                    <SelectContent>
                      {studiesWithConfig.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Button onClick={() => void handleCreate()} disabled={creating}>
                  {creating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  Create &amp; edit questionnaire
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setShowForm(false)}
                  disabled={creating}
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Studies</CardTitle>
            <CardDescription>
              {studies.length} stud{studies.length === 1 ? "y" : "ies"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading
                studies...
              </div>
            ) : studies.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-10 text-center">
                <FlaskConical className="mx-auto h-6 w-6 text-muted-foreground" />
                <p className="mt-2 text-sm font-medium">No studies defined yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Define your first study to start collecting per-study metadata.
                </p>
                <Button className="mt-4" onClick={() => setShowForm(true)}>
                  <Plus className="mr-2 h-4 w-4" /> Define new study
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {studies.map((s) => (
                  <div
                    key={s.id}
                    className="flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium">{s.title}</p>
                        {s.hasFormConfig ? (
                          <Badge variant="outline">Custom form</Badge>
                        ) : (
                          <Badge variant="secondary">Global form</Badge>
                        )}
                        {s.submitted && <Badge variant="secondary">Submitted</Badge>}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {s.sampleCount} sample{s.sampleCount === 1 ? "" : "s"}
                        {s.checklistType ? ` · ${s.checklistType}` : ""}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" asChild>
                      <Link
                        href={`/admin/study-form-builder?studyId=${encodeURIComponent(
                          s.id
                        )}`}
                      >
                        <Settings2 className="mr-2 h-4 w-4" /> Edit questionnaire
                      </Link>
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
