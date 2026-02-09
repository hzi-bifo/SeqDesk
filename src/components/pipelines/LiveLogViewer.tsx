"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Download, Pause, Play, CheckCircle2, Loader2, XCircle, Clock, Copy, Check } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface StepInfo {
  process: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  tasks: number;
}

interface LiveLogViewerProps {
  runId: string;
  isRunning: boolean;
  initialOutputTail?: string | null;
  initialErrorTail?: string | null;
  onStepsUpdate?: (steps: StepInfo[]) => void;
}

export function LiveLogViewer({
  runId,
  isRunning,
  initialOutputTail,
  initialErrorTail,
  onStepsUpdate,
}: LiveLogViewerProps) {
  const [autoScroll, setAutoScroll] = useState(true);
  const [activeTab, setActiveTab] = useState<"output" | "error" | "steps">("output");
  const [copied, setCopied] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);
  const errorRef = useRef<HTMLPreElement>(null);
  const outputUrl = `/api/pipelines/runs/${runId}/logs?type=output&tail=200`;
  const errorUrl = `/api/pipelines/runs/${runId}/logs?type=error&tail=200`;

  // Poll for output logs when running, but fetch once for finished/failed runs
  const { data: outputData, mutate: mutateOutput } = useSWR(
    outputUrl,
    fetcher,
    {
      refreshInterval: isRunning ? 3000 : 0,
      fallbackData: { content: initialOutputTail || "", steps: [] },
    }
  );

  // Poll for error logs when running, but fetch once for finished/failed runs
  const { data: errorData, mutate: mutateError } = useSWR(
    errorUrl,
    fetcher,
    {
      refreshInterval: isRunning ? 3000 : 0,
      fallbackData: { content: initialErrorTail || "" },
    }
  );

  const outputContent = outputData?.content || initialOutputTail || "";
  const errorContent = errorData?.content || initialErrorTail || "";
  const steps: StepInfo[] = useMemo(() => outputData?.steps || [], [outputData?.steps]);

  // Notify parent of step updates
  useEffect(() => {
    if (onStepsUpdate && steps.length > 0) {
      onStepsUpdate(steps);
    }
  }, [steps, onStepsUpdate]);

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    if (autoScroll && activeTab === "output" && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [outputContent, autoScroll, activeTab]);

  useEffect(() => {
    if (autoScroll && activeTab === "error" && errorRef.current) {
      errorRef.current.scrollTop = errorRef.current.scrollHeight;
    }
  }, [errorContent, autoScroll, activeTab]);

  const handleRefresh = () => {
    mutateOutput();
    mutateError();
  };

  const handleDownload = (type: "output" | "error") => {
    const content = type === "output" ? outputContent : errorContent;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${runId}_${type}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopy = async (type: "output" | "error") => {
    const content = type === "output" ? outputContent : errorContent;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const hasOutput = outputContent.trim().length > 0;
  const hasError = errorContent.trim().length > 0;

  if (!hasOutput && !hasError) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No log output available yet
      </div>
    );
  }

  const getStepIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case 'running':
        return <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-destructive" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "output" | "error" | "steps")}>
          <TabsList>
            <TabsTrigger value="output">
              Output
              {isRunning && hasOutput && (
                <span className="ml-2 h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              )}
            </TabsTrigger>
            <TabsTrigger value="error">
              Error
              {hasError && (
                <span className="ml-2 h-2 w-2 rounded-full bg-red-500" />
              )}
            </TabsTrigger>
            {steps.length > 0 && (
              <TabsTrigger value="steps">
                Steps ({steps.length})
              </TabsTrigger>
            )}
          </TabsList>
        </Tabs>

        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAutoScroll(!autoScroll)}
            title={autoScroll ? "Pause auto-scroll" : "Resume auto-scroll"}
          >
            {autoScroll ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleRefresh} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleCopy(activeTab === "steps" ? "output" : activeTab)}
            disabled={activeTab === "steps"}
            title="Copy to clipboard"
          >
            {copied ? (
              <Check className="h-4 w-4 text-green-600" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleDownload(activeTab === "steps" ? "output" : activeTab)}
            disabled={activeTab === "steps"}
            title="Download"
          >
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="relative">
        {activeTab === "output" && (
          <pre
            ref={outputRef}
            className="bg-muted p-4 rounded-lg text-xs font-mono overflow-auto h-64"
          >
            {outputContent || "No output yet..."}
          </pre>
        )}
        {activeTab === "error" && (
          <pre
            ref={errorRef}
            className="bg-destructive/10 p-4 rounded-lg text-xs font-mono overflow-auto h-64 text-destructive"
          >
            {errorContent || "No errors"}
          </pre>
        )}
        {activeTab === "steps" && (
          <div className="bg-muted p-4 rounded-lg overflow-auto h-64">
            <div className="grid gap-2">
              {steps.map((step) => (
                <div
                  key={step.process}
                  className="flex items-center gap-3 p-2 bg-background rounded border"
                >
                  {getStepIcon(step.status)}
                  <span className="font-mono text-sm flex-1">{step.process}</span>
                  <Badge variant="outline" className="text-xs">
                    {step.tasks} task{step.tasks !== 1 ? 's' : ''}
                  </Badge>
                  <Badge
                    variant={
                      step.status === 'completed' ? 'default' :
                      step.status === 'running' ? 'secondary' :
                      step.status === 'failed' ? 'destructive' : 'outline'
                    }
                    className="text-xs"
                  >
                    {step.status}
                  </Badge>
                </div>
              ))}
              {steps.length === 0 && (
                <p className="text-muted-foreground text-center py-4">
                  No steps discovered yet
                </p>
              )}
            </div>
          </div>
        )}

        {isRunning && (
          <div className="absolute bottom-2 right-2">
            <span className="text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded">
              Auto-refreshing...
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
