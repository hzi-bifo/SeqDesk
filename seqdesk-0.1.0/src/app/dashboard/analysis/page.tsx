"use client";

import { useState } from "react";
import useSWR from "swr";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Dna, FlaskConical } from "lucide-react";
import Link from "next/link";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function getStatusBadge(status: string) {
  switch (status) {
    case "completed":
      return <Badge variant="default" className="bg-green-600">Completed</Badge>;
    case "running":
      return <Badge variant="default" className="bg-blue-600">Running</Badge>;
    case "queued":
      return <Badge variant="secondary">Queued</Badge>;
    case "pending":
      return <Badge variant="outline">Pending</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    case "cancelled":
      return <Badge variant="outline" className="text-muted-foreground">Cancelled</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function getPipelineIcon(icon: string) {
  switch (icon) {
    case "Dna":
      return <Dna className="h-4 w-4" />;
    default:
      return <FlaskConical className="h-4 w-4" />;
  }
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return "-";
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : new Date();
  const diff = endDate.getTime() - startDate.getTime();

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
}

export default function AnalysisDashboardPage() {
  const [pipelineFilter, setPipelineFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Build query params
  const params = new URLSearchParams();
  if (pipelineFilter !== "all") params.set("pipelineId", pipelineFilter);
  if (statusFilter !== "all") params.set("status", statusFilter);

  const {
    data,
    error,
    isLoading,
    mutate,
  } = useSWR(`/api/pipelines/runs?${params.toString()}`, fetcher, {
    refreshInterval: 10000, // Refresh every 10 seconds for running jobs
  });

  return (
    <PageContainer>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Analysis Runs</h1>
          <p className="text-muted-foreground">
            Monitor and manage pipeline executions
          </p>
        </div>
        <Button variant="outline" onClick={() => mutate()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <Select value={pipelineFilter} onValueChange={setPipelineFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Pipeline" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Pipelines</SelectItem>
            <SelectItem value="mag">MAG Pipeline</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="queued">Queued</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Runs Table */}
      <GlassCard>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="text-center py-12 text-destructive">
            Failed to load pipeline runs
          </div>
        ) : data?.runs?.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            No pipeline runs found
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Pipeline</TableHead>
                <TableHead>Study</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Started By</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.runs?.map((run: {
                id: string;
                runNumber: string;
                pipelineName: string;
                pipelineIcon: string;
                study: { id: string; title: string } | null;
                status: string;
                progress: number | null;
                currentStep: string | null;
                startedAt: string | null;
                completedAt: string | null;
                user: { firstName: string; lastName: string };
                createdAt: string;
                _count: { assembliesCreated: number; binsCreated: number };
              }) => (
                <TableRow key={run.id}>
                  <TableCell>
                    <Link
                      href={`/dashboard/analysis/${run.id}`}
                      className="font-mono text-sm hover:underline"
                    >
                      {run.runNumber}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {getPipelineIcon(run.pipelineIcon)}
                      <span>{run.pipelineName}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {run.study ? (
                      <Link
                        href={`/dashboard/studies/${run.study.id}`}
                        className="hover:underline"
                      >
                        {run.study.title}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>{getStatusBadge(run.status)}</TableCell>
                  <TableCell>
                    {run.status === "running" ? (
                      <div className="flex flex-col">
                        <div className="w-24 h-2 bg-secondary rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-600 transition-all"
                            style={{ width: `${run.progress || 0}%` }}
                          />
                        </div>
                        {run.currentStep && (
                          <span className="text-xs text-muted-foreground mt-1">
                            {run.currentStep}
                          </span>
                        )}
                      </div>
                    ) : run.status === "completed" ? (
                      <span className="text-sm text-muted-foreground">
                        {run._count.assembliesCreated} assemblies, {run._count.binsCreated} bins
                      </span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDuration(run.startedAt, run.completedAt)}
                  </TableCell>
                  <TableCell>
                    {run.user.firstName} {run.user.lastName}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(run.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </GlassCard>

      {/* Summary stats */}
      {data?.runs && data.runs.length > 0 && (
        <div className="mt-4 text-sm text-muted-foreground">
          Showing {data.runs.length} of {data.total} runs
        </div>
      )}
    </PageContainer>
  );
}
