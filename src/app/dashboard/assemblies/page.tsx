"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertCircle, Download, Loader2, RefreshCw } from "lucide-react";

interface AssemblyItem {
  sample: {
    id: string;
    sampleId: string;
  };
  study: {
    id: string;
    title: string;
    alias: string | null;
  } | null;
  order: {
    id: string;
    orderNumber: string;
    name: string | null;
    status: string;
  };
  selection: {
    mode: "explicit" | "automatic" | "missing_preferred" | "none";
    preferredAssemblyId: string | null;
    preferredMissing: boolean;
  };
  finalAssembly: {
    id: string;
    assemblyName: string | null;
    assemblyFile: string | null;
    fileName: string | null;
    createdByPipelineRunId: string | null;
    createdByPipelineRun: {
      id: string;
      runNumber: string;
      createdAt: string;
    } | null;
  } | null;
  availableAssembliesCount: number;
}

interface AssembliesResponse {
  assemblies: AssemblyItem[];
  total: number;
}

function formatSelectionMode(mode: AssemblyItem["selection"]["mode"]): string {
  if (mode === "explicit") return "Marked Final";
  if (mode === "automatic") return "Automatic";
  if (mode === "missing_preferred") return "Missing Preferred";
  return "Unavailable";
}

export default function AssembliesPage() {
  const [data, setData] = useState<AssembliesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const fetchAssemblies = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    setError("");

    try {
      const res = await fetch("/api/assemblies");
      const payload = (await res.json()) as AssembliesResponse & { error?: string };
      if (!res.ok) {
        throw new Error(payload.error || "Failed to load assemblies");
      }
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load assemblies");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void fetchAssemblies();
  }, []);

  return (
    <PageContainer>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Assemblies</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Download the final assembly per sample. Automatic selections use the latest available assembly.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchAssemblies(true)}
            disabled={loading || refreshing}
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Refresh
          </Button>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded-lg border p-12 flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading assemblies...
          </div>
        ) : data && data.total > 0 ? (
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/40">
                  <TableHead>Study</TableHead>
                  <TableHead>Sample</TableHead>
                  <TableHead>Final Assembly</TableHead>
                  <TableHead>Selection</TableHead>
                  <TableHead>Available</TableHead>
                  <TableHead className="w-[130px]">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.assemblies.map((item) => {
                  const filePath = item.finalAssembly?.assemblyFile || null;
                  const fileName = item.finalAssembly?.fileName || "Unnamed assembly";
                  return (
                    <TableRow key={`${item.sample.id}:${item.finalAssembly?.id || "none"}`}>
                      <TableCell>
                        {item.study ? (
                          <div className="space-y-1">
                            <Link
                              href={`/dashboard/studies/${item.study.id}`}
                              className="text-sm font-medium hover:underline"
                            >
                              {item.study.title}
                            </Link>
                            <p className="text-xs text-muted-foreground">
                              {item.order.orderNumber}
                            </p>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">No study</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm font-medium">{item.sample.sampleId}</TableCell>
                      <TableCell>
                        {item.finalAssembly ? (
                          <div className="space-y-1">
                            <p className="text-sm font-medium">
                              {item.finalAssembly.assemblyName || fileName}
                            </p>
                            <p className="text-xs text-muted-foreground">{fileName}</p>
                            <p className="text-xs text-muted-foreground">
                              {item.finalAssembly.createdByPipelineRun?.runNumber
                                ? `Run ${item.finalAssembly.createdByPipelineRun.runNumber}`
                                : "Manual upload"}
                            </p>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">No final assembly</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {formatSelectionMode(item.selection.mode)}
                        </Badge>
                        {item.selection.preferredMissing && (
                          <p className="text-xs text-destructive mt-1">
                            Preferred assembly is missing
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {item.availableAssembliesCount}
                      </TableCell>
                      <TableCell>
                        {filePath ? (
                          <a
                            href={`/api/files/download?path=${encodeURIComponent(filePath)}`}
                            className="inline-flex items-center gap-1 text-primary hover:text-primary/80 text-sm"
                          >
                            <Download className="h-4 w-4" />
                            Download
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">Unavailable</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="rounded-lg border p-12 text-center text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">No assemblies available yet.</p>
            <p className="text-sm">
              Assemblies for your studies will appear here after the sequencing center
              finishes analysis.
            </p>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
