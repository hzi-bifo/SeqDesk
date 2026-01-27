"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/PageContainer";
import { HelpBox } from "@/components/ui/help-box";
import {
  BookOpen,
  Plus,
  Loader2,
  AlertCircle,
  ChevronRight,
} from "lucide-react";

interface Study {
  id: string;
  title: string;
  description: string | null;
  checklistType: string | null;
  submitted: boolean;
  submittedAt: string | null;
  studyAccessionId: string | null;
  createdAt: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  _count: {
    samples: number;
  };
  samplesWithReads: number;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  draft: { label: "Draft", color: "text-stone-600", dot: "bg-stone-400" },
  published: { label: "Published", color: "text-emerald-600", dot: "bg-emerald-500" },
};

export default function StudiesPage() {
  const { data: session } = useSession();
  const [studies, setStudies] = useState<Study[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const isResearcher = session?.user?.role === "RESEARCHER";
  const isFacilityAdmin = session?.user?.role === "FACILITY_ADMIN";

  useEffect(() => {
    const fetchStudies = async () => {
      try {
        const res = await fetch("/api/studies");
        if (!res.ok) throw new Error("Failed to fetch studies");
        const data = await res.json();
        setStudies(data);
      } catch {
        setError("Failed to load studies");
      } finally {
        setLoading(false);
      }
    };

    fetchStudies();
  }, []);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  if (loading) {
    return (
      <PageContainer className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">
            {isFacilityAdmin ? "All Studies" : "My Studies"}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {studies.length} stud{studies.length !== 1 ? "ies" : "y"}
          </p>
        </div>
        {isResearcher && (
          <Button size="sm" asChild>
            <Link href="/dashboard/studies/new">
              <Plus className="h-4 w-4 mr-1.5" />
              New Study
            </Link>
          </Button>
        )}
      </div>

      <HelpBox title="What are studies?">
        A study groups samples that share the same environment type (e.g., human gut, soil, water).
        Each study uses a specific MIxS checklist to capture standardized metadata for ENA submission.
      </HelpBox>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          {error}
        </div>
      )}

      {studies.length === 0 ? (
        <div className="bg-white rounded-xl p-12 text-center">
          <BookOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-30" />
          <h2 className="text-lg font-medium mb-2">No studies yet</h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            {isResearcher
              ? "Studies group samples for ENA submission. First create an order with samples, then create a study to associate those samples with metadata."
              : "Studies group samples for ENA submission. Researchers need to first create orders with samples, then create studies to associate those samples with metadata."}
          </p>
          {isResearcher && (
            <div className="flex flex-col items-center gap-3">
              <Button size="sm" asChild>
                <Link href="/dashboard/studies/new">
                  <Plus className="h-4 w-4 mr-1.5" />
                  New Study
                </Link>
              </Button>
              <Link href="/dashboard/orders" className="text-xs text-muted-foreground hover:text-primary">
                Or create an order first
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl overflow-hidden">
          {/* Table Header */}
          <div className="grid grid-cols-12 gap-4 px-5 py-2.5 border-b border-stone-100 bg-stone-50/50 text-xs font-medium text-muted-foreground">
            <div className={isFacilityAdmin ? "col-span-3" : "col-span-4"}>Study</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2">Environment</div>
            {isFacilityAdmin && <div className="col-span-2">Researcher</div>}
            <div className="col-span-2 text-right">Samples / Reads</div>
            <div className="col-span-1">Created</div>
          </div>

          {/* Studies List */}
          <div className="divide-y divide-stone-100">
            {studies.map((study) => {
              const status = study.submitted ? "published" : "draft";
              const statusConfig = STATUS_CONFIG[status];

              return (
                <Link
                  key={study.id}
                  href={`/dashboard/studies/${study.id}`}
                  className="grid grid-cols-12 gap-4 px-5 py-4 hover:bg-stone-50/80 transition-colors group items-center"
                >
                  {/* Study Info */}
                  <div className={`${isFacilityAdmin ? "col-span-3" : "col-span-4"} min-w-0`}>
                    <p className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                      {study.title}
                    </p>
                    {study.studyAccessionId && (
                      <p className="text-xs text-emerald-600 font-mono mt-0.5">
                        {study.studyAccessionId}
                      </p>
                    )}
                  </div>

                  {/* Status */}
                  <div className="col-span-2">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${statusConfig.dot}`} />
                      <span className={`text-xs font-medium ${statusConfig.color}`}>
                        {statusConfig.label}
                      </span>
                    </div>
                  </div>

                  {/* Environment Type */}
                  <div className="col-span-2 min-w-0">
                    <p className="text-sm text-muted-foreground truncate capitalize">
                      {study.checklistType?.replace(/-/g, " ") || "Not set"}
                    </p>
                  </div>

                  {/* Researcher (Admin only) */}
                  {isFacilityAdmin && (
                    <div className="col-span-2 min-w-0">
                      <p className="text-sm truncate">
                        {study.user.firstName} {study.user.lastName}
                      </p>
                    </div>
                  )}

                  {/* Samples / Reads */}
                  <div className="col-span-2 text-right">
                    <span className="text-sm tabular-nums">
                      <span className="text-muted-foreground">{study._count.samples}</span>
                      <span className="text-muted-foreground/50 mx-1">/</span>
                      <span className={study.samplesWithReads === study._count.samples && study._count.samples > 0
                        ? "text-green-600"
                        : study.samplesWithReads > 0
                          ? "text-amber-600"
                          : "text-muted-foreground"
                      }>
                        {study.samplesWithReads}
                      </span>
                    </span>
                  </div>

                  {/* Date */}
                  <div className="col-span-1">
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {formatDate(study.createdAt)}
                    </span>
                  </div>

                  {/* Arrow */}
                  <div className="col-span-0 flex justify-end">
                    <ChevronRight className="h-4 w-4 text-stone-300 group-hover:text-stone-400 transition-colors" />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </PageContainer>
  );
}
