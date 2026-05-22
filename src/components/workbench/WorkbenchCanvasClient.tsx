"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  addEdge,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type NodeProps,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Database,
  Download,
  FileText,
  Loader2,
  Network,
  PackagePlus,
  Play,
  Plus,
  Save,
  Search,
  StickyNote,
  Store,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { WorkbenchStatusBadge } from "@/components/workbench/WorkbenchPageShell";
import {
  WORKBENCH_SOURCE_DEFAULT_CONFIG,
  createReferenceGenomeSourceNode,
  createTextNoteNode,
  type WorkbenchCanvas,
  type WorkbenchCanvasNode,
} from "@/lib/workbench/canvas";
import { cn } from "@/lib/utils";

interface WorkbenchAnalysis {
  id: string;
  name: string;
  description: string | null;
  canvas: WorkbenchCanvas;
  revision: number;
  isDefault: boolean;
  updatedAt: string;
}

interface WorkbenchDataset {
  id: string;
  providerId: string;
  name: string;
  status: string;
  genomeCount: number | null;
  linkedAt?: string;
}

interface WorkbenchJob {
  id: string;
  providerId: string;
  status: string;
  phase: string | null;
  progress: number | null;
  error: string | null;
}

interface WorkbenchStoreItem {
  id: string;
  label: string;
  status: {
    state: string;
    message: string;
  };
}

type Drawer = "data" | "jobs" | "store" | null;
type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";
type WorkbenchNodeData = WorkbenchCanvasNode["data"] & { onRun?: () => void };
type WorkbenchNode = Node<WorkbenchNodeData>;
type WorkbenchEdge = Edge<{ label?: string }>;

const nodeTypes = {
  workbench: WorkbenchCanvasFlowNode,
};

function nodeStatusTone(status?: string): "neutral" | "accent" | "warning" {
  if (status === "success" || status === "ready") return "accent";
  if (status === "error" || status === "failed") return "warning";
  return "neutral";
}

function WorkbenchCanvasFlowNode({ data }: NodeProps<WorkbenchNode>) {
  const kind = data.kind;
  const isSource = kind === "source.importer";
  const isDataset = kind === "dataset";
  const Icon = isSource ? Download : isDataset ? Database : StickyNote;

  return (
    <div
      className={cn(
        "min-w-52 rounded-lg border bg-card px-3 py-3 shadow-sm ring-1 ring-transparent transition-shadow",
        isSource && "border-teal-200",
        isDataset && "border-emerald-200",
        kind === "note" && "border-amber-200 bg-amber-50/70",
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground" />
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            isSource && "bg-teal-50 text-teal-700 ring-1 ring-teal-200",
            isDataset && "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
            kind === "note" && "bg-amber-100 text-amber-800 ring-1 ring-amber-200",
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{data.label}</p>
              {data.description && (
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                  {data.description}
                </p>
              )}
            </div>
            {data.status && (
              <WorkbenchStatusBadge tone={nodeStatusTone(data.status)}>
                {data.status}
              </WorkbenchStatusBadge>
            )}
          </div>
          {typeof data.progress === "number" && data.status === "running" && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-teal-600"
                style={{ width: `${Math.max(0, Math.min(100, data.progress))}%` }}
              />
            </div>
          )}
          {kind === "note" && data.note && (
            <p className="mt-2 line-clamp-3 text-xs text-amber-950">{data.note}</p>
          )}
          {isSource && (
            <Button
              type="button"
              size="sm"
              className="mt-3 h-8"
              onClick={(event) => {
                event.stopPropagation();
                data.onRun?.();
              }}
              disabled={data.status === "running" || data.status === "queued"}
            >
              {data.status === "running" || data.status === "queued" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Play
            </Button>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground" />
    </div>
  );
}

function toFlowNodes(nodes: WorkbenchCanvasNode[], onRun: (nodeId: string) => void): WorkbenchNode[] {
  return nodes.map((node) => ({
    ...node,
    type: "workbench",
    data: {
      ...node.data,
      onRun: () => onRun(node.id),
    },
  })) as WorkbenchNode[];
}

function toPersistedNodes(nodes: WorkbenchNode[]): WorkbenchCanvasNode[] {
  return nodes.map((node) => {
    const data = { ...node.data };
    delete data.onRun;
    return {
      id: node.id,
      type: "workbench",
      position: node.position,
      data,
    };
  });
}

function toFlowEdges(edges: WorkbenchCanvas["edges"]): WorkbenchEdge[] {
  return edges.map((edge) => ({
    ...edge,
    markerEnd: { type: MarkerType.ArrowClosed },
    type: "smoothstep",
    label: edge.label,
  }));
}

function WorkbenchCanvasInner() {
  const reactFlow = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const hydratedRef = useRef(false);
  const [analyses, setAnalyses] = useState<WorkbenchAnalysis[]>([]);
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>(null);
  const [revision, setRevision] = useState(1);
  const [analysisName, setAnalysisName] = useState("Untitled analysis");
  const [nodes, setNodes] = useState<WorkbenchNode[]>([]);
  const [edges, setEdges] = useState<WorkbenchEdge[]>([]);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [datasets, setDatasets] = useState<WorkbenchDataset[]>([]);
  const [jobs, setJobs] = useState<WorkbenchJob[]>([]);
  const [storeItems, setStoreItems] = useState<WorkbenchStoreItem[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) || null,
    [nodes, selectedNodeId]
  );

  const loadAnalysis = useCallback(
    async (analysisId: string, options?: { silent?: boolean }) => {
      const response = await fetch(`/api/workbench/analyses/${analysisId}`, { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { analysis: WorkbenchAnalysis };
      hydratedRef.current = false;
      setSelectedAnalysisId(payload.analysis.id);
      setRevision(payload.analysis.revision);
      setAnalysisName(payload.analysis.name);
      setNodes(toFlowNodes(payload.analysis.canvas.nodes, runNode));
      setEdges(toFlowEdges(payload.analysis.canvas.edges));
      setViewport(payload.analysis.canvas.viewport);
      setDirty(false);
      setSaveState(options?.silent ? saveState : "saved");
      window.setTimeout(() => {
        hydratedRef.current = true;
      }, 0);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saveState]
  );

  const loadAnalyses = useCallback(async () => {
    const response = await fetch("/api/workbench/analyses", { cache: "no-store" });
    if (!response.ok) return;
    const payload = (await response.json()) as { analyses: WorkbenchAnalysis[] };
    setAnalyses(payload.analyses);
    const next = payload.analyses.find((analysis) => analysis.id === selectedAnalysisId) || payload.analyses[0];
    if (next) await loadAnalysis(next.id);
  }, [loadAnalysis, selectedAnalysisId]);

  useEffect(() => {
    void loadAnalyses();
  }, [loadAnalyses]);

  const markDirty = useCallback(() => {
    if (!hydratedRef.current) return;
    setDirty(true);
    setSaveState("idle");
  }, []);

  const runNode = useCallback(
    async (nodeId: string) => {
      if (!selectedAnalysisId) return;
      setMessage(null);
      setNodes((current) =>
        current.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, status: "queued", error: undefined } }
            : node
        )
      );
      try {
        const response = await fetch(
          `/api/workbench/analyses/${selectedAnalysisId}/nodes/${nodeId}/run`,
          { method: "POST" }
        );
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.details || payload.error || "Failed to run source block");
        }
        setMessage("Source block queued.");
        window.setTimeout(() => void loadAnalysis(selectedAnalysisId, { silent: true }), 1000);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to run source block";
        setMessage(errorMessage);
        setNodes((current) =>
          current.map((node) =>
            node.id === nodeId
              ? { ...node, data: { ...node.data, status: "error", error: errorMessage } }
              : node
          )
        );
      }
    },
    [loadAnalysis, selectedAnalysisId]
  );

  const flowNodes = useMemo(() => toFlowNodes(toPersistedNodes(nodes), runNode), [nodes, runNode]);

  useEffect(() => {
    if (!selectedAnalysisId || !dirty) return;
    setSaveState("saving");
    const timeout = window.setTimeout(async () => {
      const canvas: WorkbenchCanvas = {
        version: 1,
        nodes: toPersistedNodes(nodes),
        edges: edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label: typeof edge.label === "string" ? edge.label : undefined,
        })),
        viewport,
      };
      const response = await fetch(`/api/workbench/analyses/${selectedAnalysisId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          revision,
          name: analysisName,
          canvas,
        }),
      });
      const payload = await response.json();
      if (response.status === 409 && payload.analysis) {
        const latest = payload.analysis as WorkbenchAnalysis;
        setRevision(latest.revision);
        setAnalysisName(latest.name);
        setNodes(toFlowNodes(latest.canvas.nodes, runNode));
        setEdges(toFlowEdges(latest.canvas.edges));
        setViewport(latest.canvas.viewport);
        setDirty(false);
        setSaveState("conflict");
        setMessage("Canvas changed on the server. Reloaded the latest version.");
        return;
      }
      if (!response.ok) {
        setSaveState("error");
        setMessage(payload.error || "Autosave failed.");
        return;
      }
      const saved = payload.analysis as WorkbenchAnalysis;
      setRevision(saved.revision);
      setDirty(false);
      setSaveState("saved");
    }, 750);
    return () => window.clearTimeout(timeout);
  }, [analysisName, dirty, edges, nodes, revision, runNode, selectedAnalysisId, viewport]);

  useEffect(() => {
    const active = nodes.some((node) => node.data.status === "queued" || node.data.status === "running");
    if (!active || !selectedAnalysisId || dirty) return;
    const interval = window.setInterval(
      () => void loadAnalysis(selectedAnalysisId, { silent: true }),
      5000
    );
    return () => window.clearInterval(interval);
  }, [dirty, loadAnalysis, nodes, selectedAnalysisId]);

  const addNode = useCallback(
    (kind: "source" | "note", position?: { x: number; y: number }) => {
      const basePosition = position || {
        x: 140 + nodes.length * 32,
        y: 120 + nodes.length * 32,
      };
      const node =
        kind === "source"
          ? createReferenceGenomeSourceNode({
              id: `source-${Date.now()}`,
              x: basePosition.x,
              y: basePosition.y,
            })
          : createTextNoteNode({
              id: `note-${Date.now()}`,
              x: basePosition.x,
              y: basePosition.y,
            });
      setNodes((current) => [...current, node as WorkbenchNode]);
      markDirty();
    },
    [markDirty, nodes.length]
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((current) => applyNodeChanges(changes, current) as WorkbenchNode[]);
      markDirty();
    },
    [markDirty]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((current) => applyEdgeChanges(changes, current) as WorkbenchEdge[]);
      markDirty();
    },
    [markDirty]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((current) =>
        addEdge(
          {
            ...connection,
            id: `${connection.source}->${connection.target}-${Date.now()}`,
            type: "smoothstep",
            markerEnd: { type: MarkerType.ArrowClosed },
          },
          current
        ) as WorkbenchEdge[]
      );
      markDirty();
    },
    [markDirty]
  );

  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    setSelectedNodeId(node.id);
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const block = event.dataTransfer.getData("application/seqdesk-workbench-block");
      if (block !== "source" && block !== "note") return;
      const position = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      addNode(block, position);
    },
    [addNode, reactFlow]
  );

  const createAnalysis = async () => {
    const response = await fetch("/api/workbench/analyses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Untitled analysis" }),
    });
    if (!response.ok) return;
    const payload = (await response.json()) as { analysis: WorkbenchAnalysis };
    setAnalyses((current) => [payload.analysis, ...current]);
    await loadAnalysis(payload.analysis.id);
  };

  const loadDrawer = async (nextDrawer: Drawer) => {
    setDrawer((current) => (current === nextDrawer ? null : nextDrawer));
    if (nextDrawer === "data") {
      const response = await fetch("/api/workbench/data", { cache: "no-store" });
      if (response.ok) {
        const payload = (await response.json()) as { datasets?: WorkbenchDataset[] };
        setDatasets(Array.isArray(payload.datasets) ? payload.datasets : []);
      }
    }
    if (nextDrawer === "jobs") {
      const response = await fetch("/api/workbench/imports", { cache: "no-store" });
      if (response.ok) {
        const payload = (await response.json()) as { jobs?: WorkbenchJob[] };
        setJobs(Array.isArray(payload.jobs) ? payload.jobs : []);
      }
    }
    if (nextDrawer === "store") {
      const response = await fetch("/api/workbench/store", { cache: "no-store" });
      if (response.ok) {
        const payload = (await response.json()) as { items?: WorkbenchStoreItem[] };
        setStoreItems(Array.isArray(payload.items) ? payload.items : []);
      }
    }
  };

  const updateSelectedNode = (update: Partial<WorkbenchCanvasNode["data"]>) => {
    if (!selectedNodeId) return;
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNodeId
          ? { ...node, data: { ...node.data, ...update } }
          : node
      )
    );
    markDirty();
  };

  const sourceConfig =
    selectedNode?.data.kind === "source.importer"
      ? {
          ...WORKBENCH_SOURCE_DEFAULT_CONFIG,
          ...(typeof selectedNode.data.config === "object" && selectedNode.data.config
            ? selectedNode.data.config
            : {}),
        }
      : WORKBENCH_SOURCE_DEFAULT_CONFIG;

  return (
    <div className="flex h-[calc(100vh-7rem)] min-h-[640px] overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Network className="h-4 w-4 text-teal-700" />
            <select
              value={selectedAnalysisId || ""}
              onChange={(event) => void loadAnalysis(event.target.value)}
              className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
              aria-label="Analysis"
            >
              {analyses.map((analysis) => (
                <option key={analysis.id} value={analysis.id}>
                  {analysis.name}
                </option>
              ))}
            </select>
            <Button type="button" variant="outline" size="sm" onClick={() => void createAnalysis()}>
              <Plus className="h-4 w-4" />
              New
            </Button>
            <Input
              value={analysisName}
              onChange={(event) => {
                setAnalysisName(event.target.value);
                markDirty();
              }}
              className="h-9 w-56"
              aria-label="Analysis name"
            />
            <WorkbenchStatusBadge
              tone={saveState === "error" || saveState === "conflict" ? "warning" : "neutral"}
            >
              {saveState === "saving" ? "Saving" : saveState === "saved" ? "Saved" : saveState}
            </WorkbenchStatusBadge>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => addNode("source")}>
              <Download className="h-4 w-4" />
              + Source
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => addNode("note")}>
              <StickyNote className="h-4 w-4" />
              + Note
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void loadDrawer("data")}>
              <Database className="h-4 w-4" />
              Data
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void loadDrawer("jobs")}>
              <Save className="h-4 w-4" />
              Jobs
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void loadDrawer("store")}>
              <Store className="h-4 w-4" />
              Store
            </Button>
          </div>
        </div>

        {message && (
          <div className="border-b border-border bg-secondary/40 px-4 py-2 text-sm text-muted-foreground">
            {message}
          </div>
        )}

        {drawer && (
          <div className="max-h-48 overflow-auto border-b border-border bg-background px-4 py-3">
            {drawer === "data" && (
              <WorkbenchDrawerList
                empty="No datasets linked yet."
                rows={datasets.map((dataset) => ({
                  id: dataset.id,
                  title: dataset.name,
                  meta: `${dataset.providerId} · ${dataset.status}${
                    dataset.genomeCount ? ` · ${dataset.genomeCount} genomes` : ""
                  }`,
                }))}
              />
            )}
            {drawer === "jobs" && (
              <WorkbenchDrawerList
                empty="No import jobs yet."
                rows={jobs.map((job) => ({
                  id: job.id,
                  title: job.providerId,
                  meta: `${job.status}${job.phase ? ` · ${job.phase}` : ""}${
                    typeof job.progress === "number" ? ` · ${job.progress}%` : ""
                  }${job.error ? ` · ${job.error}` : ""}`,
                }))}
              />
            )}
            {drawer === "store" && (
              <WorkbenchDrawerList
                empty="No Store items available."
                rows={storeItems.map((item) => ({
                  id: item.id,
                  title: item.label,
                  meta: `${item.status.state} · ${item.status.message}`,
                }))}
              />
            )}
          </div>
        )}

        <div
          ref={wrapperRef}
          className="h-full min-h-0 flex-1 bg-slate-50"
          onDrop={onDrop}
          onDragOver={(event) => event.preventDefault()}
        >
          <ReactFlow
            nodes={flowNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onMoveEnd={(_event, nextViewport) => {
              setViewport(nextViewport);
              markDirty();
            }}
            defaultViewport={viewport}
            fitView={nodes.length === 0}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#cbd5e1" gap={18} />
            <Controls showInteractive={false} />
            {nodes.length === 0 && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                <div className="rounded-lg border border-dashed border-teal-200 bg-card/90 px-6 py-5 text-center shadow-sm">
                  <p className="text-base font-semibold text-foreground">Start with a source</p>
                  <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                    Add Reference genomes or a note from the toolbar or right-side element palette.
                  </p>
                </div>
              </div>
            )}
          </ReactFlow>
        </div>
      </div>

      <aside className="w-64 shrink-0 border-l border-border bg-background xl:w-72">
        <WorkbenchBlockPalette onAdd={addNode} />
      </aside>

      <Dialog open={Boolean(selectedNode)} onOpenChange={(open) => !open && setSelectedNodeId(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{selectedNode?.data.label || "Canvas block"}</DialogTitle>
            <DialogDescription>
              Configure this block. Changes autosave into the current analysis canvas.
            </DialogDescription>
          </DialogHeader>
          {selectedNode?.data.kind === "source.importer" && (
            <div className="space-y-3">
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Taxon</span>
                <Input
                  value={String(sourceConfig.taxon || "")}
                  onChange={(event) =>
                    updateSelectedNode({
                      config: { ...sourceConfig, taxon: event.target.value },
                    })
                  }
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Cap</span>
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={Number(sourceConfig.cap || 25)}
                  onChange={(event) =>
                    updateSelectedNode({
                      config: { ...sourceConfig, cap: Number(event.target.value) },
                    })
                  }
                />
              </label>
              {selectedNode.data.error && (
                <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {selectedNode.data.error}
                </p>
              )}
              <Button type="button" onClick={() => void runNode(selectedNode.id)}>
                <Play className="h-4 w-4" />
                Run source
              </Button>
            </div>
          )}
          {selectedNode?.data.kind === "note" && (
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Note</span>
              <Textarea
                value={selectedNode.data.note || ""}
                onChange={(event) => updateSelectedNode({ note: event.target.value })}
                className="min-h-40"
              />
            </label>
          )}
          {selectedNode?.data.kind === "dataset" && (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>{selectedNode.data.description || "Workbench dataset"}</p>
              <p className="font-mono text-xs">{selectedNode.data.datasetId}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WorkbenchDrawerList({
  rows,
  empty,
}: {
  rows: { id: string; title: string; meta: string }[];
  empty: string;
}) {
  if (rows.length === 0) {
    return <p className="py-4 text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {rows.map((row) => (
        <div key={row.id} className="rounded-lg border border-border px-3 py-2">
          <p className="truncate text-sm font-medium text-foreground">{row.title}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.meta}</p>
        </div>
      ))}
    </div>
  );
}

function WorkbenchBlockPalette({ onAdd }: { onAdd: (kind: "source" | "note") => void }) {
  const draggable = (kind: "source" | "note") => ({
    draggable: true,
    onDragStart: (event: DragEvent<HTMLButtonElement>) => {
      event.dataTransfer.setData("application/seqdesk-workbench-block", kind);
      event.dataTransfer.effectAllowed = "copy";
    },
  });

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <p className="text-sm font-semibold text-foreground">Elements</p>
        <p className="mt-1 text-xs text-muted-foreground">Click or drag onto the canvas.</p>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-auto p-4">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Import Sources
          </p>
          <button
            type="button"
            className="flex w-full items-start gap-3 rounded-lg border border-teal-200 bg-teal-50/60 px-3 py-3 text-left transition-colors hover:bg-teal-50"
            onClick={() => onAdd("source")}
            {...draggable("source")}
          >
            <PackagePlus className="mt-0.5 h-4 w-4 text-teal-700" />
            <span>
              <span className="block text-sm font-medium text-foreground">Reference genomes</span>
              <span className="block text-xs text-muted-foreground">NCBI Genomes by Taxon</span>
            </span>
          </button>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</p>
          <button
            type="button"
            className="flex w-full items-start gap-3 rounded-lg border border-border bg-card px-3 py-3 text-left transition-colors hover:bg-secondary/50"
            onClick={() => onAdd("note")}
            {...draggable("note")}
          >
            <StickyNote className="mt-0.5 h-4 w-4 text-amber-700" />
            <span>
              <span className="block text-sm font-medium text-foreground">Text note</span>
              <span className="block text-xs text-muted-foreground">Document assumptions</span>
            </span>
          </button>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Coming Soon
          </p>
          {[
            ["Filters", Search],
            ["Pipelines", Workflow],
            ["Analysis modules", FileText],
          ].map(([label, Icon]) => {
            const PaletteIcon = Icon as typeof Search;
            return (
              <button
                key={label as string}
                type="button"
                disabled
                className="flex w-full items-center gap-3 rounded-lg border border-dashed border-border px-3 py-3 text-left opacity-60"
              >
                <PaletteIcon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">{label as string}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function WorkbenchCanvasClient() {
  return (
    <ReactFlowProvider>
      <WorkbenchCanvasInner />
    </ReactFlowProvider>
  );
}
