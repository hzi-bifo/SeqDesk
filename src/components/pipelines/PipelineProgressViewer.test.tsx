// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock @xyflow/react so the ReactFlow canvas renders each node through its
// registered `nodeTypes` component. This forces the custom node components
// (ProgressStepNode / InputNode / OutputNode / FileNode) and all of their
// internal branches to actually render in jsdom. We also expose
// onNodeClick / onPaneClick via data-attributed buttons so the parent
// component's selection logic (detail panels) can be exercised.
// ---------------------------------------------------------------------------
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({
    children,
    nodes,
    nodeTypes,
    onNodeClick,
    onPaneClick,
  }: {
    children: React.ReactNode;
    nodes: Array<{ id: string; type?: string; data: Record<string, unknown> }>;
    nodeTypes: Record<string, React.ComponentType<{ data: Record<string, unknown> }>>;
    onNodeClick?: (event: unknown, node: { id: string }) => void;
    onPaneClick?: () => void;
  }) => (
    <div data-testid="flow">
      <button
        type="button"
        data-testid="pane-click"
        onClick={() => onPaneClick?.()}
      >
        pane
      </button>
      {nodes.map((node) => {
        const NodeComponent = nodeTypes[node.type || "progressStep"];
        return (
          <div key={node.id} data-testid={`node-${node.id}`}>
            <button
              type="button"
              data-testid={`click-${node.id}`}
              onClick={() => onNodeClick?.({}, { id: node.id })}
            >
              select {node.id}
            </button>
            <NodeComponent data={node.data} />
          </div>
        );
      })}
      {children}
    </div>
  ),
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  // Return the freshly-computed initial value with no-op setters. The real
  // xyflow hooks bail out of re-renders when the value is referentially
  // stable; a naive useState mock would loop forever because the component's
  // `useEffect(() => setNodes(allNodes))` re-runs every render with a new
  // array reference. No-op setters keep the displayed nodes/edges in sync
  // with the latest render (since `initial` is recomputed each render) while
  // avoiding the render loop.
  useNodesState: (initial: unknown[]) => [initial, () => {}, () => {}],
  useEdgesState: (initial: unknown[]) => [initial, () => {}, () => {}],
  MarkerType: { ArrowClosed: "arrowclosed" },
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
}));

// The real Radix ScrollArea relies on ResizeObserver and a ref-callback that
// loops infinitely under jsdom ("Maximum update depth exceeded"). Replace it
// with a passthrough so the detail panels render normally.
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ScrollBar: () => null,
}));

import { PipelineProgressViewer } from "./PipelineProgressViewer";
import type {
  DagNode,
  DagEdge,
  StepStatus,
  PipelineInputFile,
  PipelineOutputFile,
} from "./PipelineProgressViewer";

afterEach(() => {
  cleanup();
});

// A DAG containing a "step" node per status value plus an input and an output
// DAG node so the category / nodeType branches all get hit.
const fullNodes: DagNode[] = [
  {
    id: "input",
    name: "Raw Reads",
    nodeType: "input",
    order: 0,
    fileTypes: ["fastq", "fq", "gz", "bam"],
    docs: "https://example.com/input",
  },
  {
    id: "qc",
    name: "QC Step",
    category: "qc",
    description: "Quality control description",
    order: 1,
    tools: ["fastqc", "multiqc"],
    fileTypes: ["html"],
  },
  { id: "run", name: "Running Step", category: "assembly", order: 2 },
  { id: "fail", name: "Failed Step", category: "binning", order: 3 },
  { id: "skip", name: "Skipped Step", category: "annotation", order: 4 },
  { id: "pend", name: "Pending Step", category: "reporting", order: 5 },
  { id: "uncat", name: "Uncategorized", order: 6 },
  {
    id: "out",
    name: "Final Output",
    nodeType: "output",
    order: 7,
    fileTypes: ["vcf"],
  },
];

const fullEdges: DagEdge[] = [
  { from: "input", to: "qc" },
  { from: "qc", to: "run" },
  { from: "run", to: "fail" },
  { from: "fail", to: "skip" },
  { from: "skip", to: "pend" },
  { from: "pend", to: "uncat" },
  { from: "uncat", to: "out" },
];

const fullStatuses: StepStatus[] = [
  {
    stepId: "qc",
    status: "completed",
    startedAt: "2026-01-01T10:00:00.000Z",
    completedAt: "2026-01-01T10:05:00.000Z",
    outputFiles: ["/data/qc/report.html", "/data/qc/summary.txt"],
  },
  { stepId: "run", status: "running", startedAt: "2026-01-01T10:06:00.000Z" },
  { stepId: "fail", status: "failed" },
  { stepId: "skip", status: "skipped" },
  { stepId: "pend", status: "pending" },
];

const inputFiles: PipelineInputFile[] = [
  {
    id: "f1",
    name: "sample_R1.fastq.gz",
    path: "/data/sample_R1.fastq.gz",
    type: "read_1",
    sampleId: "S1",
    checksum: "abc123",
  },
  {
    id: "f2",
    name: "sheet.csv",
    path: "/data/sheet.csv",
    type: "samplesheet",
  },
];

const outputFiles: PipelineOutputFile[] = [
  {
    id: "o1",
    name: "a-really-long-output-filename.vcf",
    path: "/data/out/a-really-long-output-filename.vcf",
    type: "vcf",
    sampleId: "S1",
    size: 2048,
    producedByStepId: "qc",
    checksum: "def456",
    metadata: "{}",
  },
  {
    id: "o2",
    name: "table.tsv",
    path: "/data/out/table.tsv",
    type: "report",
    size: 5_000_000,
  },
];

describe("PipelineProgressViewer", () => {
  it("renders the status legend stats and run-status badge for a running pipeline", () => {
    render(
      <PipelineProgressViewer
        nodes={fullNodes}
        edges={fullEdges}
        stepStatuses={fullStatuses}
        inputFiles={inputFiles}
        outputFiles={outputFiles}
        runStatus="running"
        currentStepId="run"
        currentStepLabel="Running Step"
      />
    );

    // Run-status badge (running branch)
    expect(screen.getByText("Status: running")).toBeTruthy();
    // Current step label badge (runStatus !== completed, not failed -> "Current")
    expect(screen.getByText(/Current: Running Step/)).toBeTruthy();
    // File-count badges
    expect(screen.getByText("2 input files")).toBeTruthy();
    expect(screen.getByText("2 output files")).toBeTruthy();
    // Stats badges (completed always shown; running/failed/pending > 0)
    expect(screen.getByText("1 completed")).toBeTruthy();
    expect(screen.getByText("1 running")).toBeTruthy();
    expect(screen.getByText("1 failed")).toBeTruthy();
    // pending = total(5) - completed(1) - running(1) - failed(1) = 2 (skipped
    // is folded into the "pending" remainder by the stats calculation).
    expect(screen.getByText("2 pending")).toBeTruthy();
  });

  it("renders each step node with its status icon, label, and inline status pill", () => {
    render(
      <PipelineProgressViewer
        nodes={fullNodes}
        edges={fullEdges}
        stepStatuses={fullStatuses}
        showFiles={false}
      />
    );

    // Step node labels render (status pill text appears multiple places ->
    // use getAllByText for status words).
    expect(screen.getByText("QC Step")).toBeTruthy();
    expect(screen.getByText("Running Step")).toBeTruthy();
    expect(screen.getByText("Failed Step")).toBeTruthy();
    expect(screen.getByText("Skipped Step")).toBeTruthy();
    expect(screen.getByText("Pending Step")).toBeTruthy();
    expect(screen.getByText("Uncategorized")).toBeTruthy();

    // Description renders on the qc node
    expect(screen.getByText("Quality control description")).toBeTruthy();

    // outputFiles count summary on the completed qc node ("2 files")
    expect(screen.getByText("2 files")).toBeTruthy();

    // Inline status pill words appear for several statuses.
    expect(screen.getAllByText("completed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("running").length).toBeGreaterThan(0);
    expect(screen.getAllByText("failed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("skipped").length).toBeGreaterThan(0);
  });

  it("renders the failed run-status badge and 'Failed at' current-step label", () => {
    render(
      <PipelineProgressViewer
        nodes={fullNodes}
        edges={fullEdges}
        stepStatuses={fullStatuses}
        runStatus="failed"
        currentStepLabel="Failed Step"
        showFiles={false}
      />
    );

    expect(screen.getByText("Status: failed")).toBeTruthy();
    expect(screen.getByText(/Failed at: Failed Step/)).toBeTruthy();
  });

  it("renders the completed run-status badge and hides the current-step label", () => {
    render(
      <PipelineProgressViewer
        nodes={fullNodes}
        edges={fullEdges}
        stepStatuses={[{ stepId: "qc", status: "completed" }]}
        runStatus="completed"
        currentStepLabel="QC Step"
        showFiles={false}
      />
    );

    expect(screen.getByText("Status: completed")).toBeTruthy();
    // currentStepLabel suppressed because runStatus === "completed"
    expect(screen.queryByText(/Current: QC Step/)).toBeNull();
  });

  it("renders an unknown run-status with the neutral (default) badge style", () => {
    render(
      <PipelineProgressViewer
        nodes={fullNodes}
        edges={fullEdges}
        runStatus="queued"
        showFiles={false}
      />
    );

    expect(screen.getByText("Status: queued")).toBeTruthy();
  });

  it("renders without stats, run-status, or file badges when no statuses or files are given", () => {
    render(<PipelineProgressViewer nodes={fullNodes} edges={fullEdges} />);

    // No stepStatuses -> stats is null -> no completed/running badges
    expect(screen.queryByText(/completed$/)).toBeNull();
    expect(screen.queryByText(/Status:/)).toBeNull();
    // Steps still render (default status "pending" for non-nodeType nodes)
    expect(screen.getByText("QC Step")).toBeTruthy();
    // Pane click handler is wired
    expect(screen.getByTestId("flow")).toBeTruthy();
  });

  it("opens the node detail panel for a step with completed status, timing, tools, output files, and docs", () => {
    render(
      <PipelineProgressViewer
        nodes={fullNodes}
        edges={fullEdges}
        stepStatuses={fullStatuses}
        inputFiles={inputFiles}
        outputFiles={outputFiles}
      />
    );

    fireEvent.click(screen.getByTestId("click-qc"));

    // Heading in the detail panel
    expect(screen.getByRole("heading", { name: "QC Step" })).toBeTruthy();
    // Category badge (capitalized) + status badge
    expect(screen.getAllByText("qc").length).toBeGreaterThan(0);
    // Timing labels
    expect(screen.getByText("Started")).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();
    // Output files produced by the qc step (from outputFiles)
    expect(screen.getByText("Output Files (1)")).toBeTruthy();
    expect(screen.getByText(/a-really-long-output-filename\.vcf/)).toBeTruthy();
    // Tools section
    expect(screen.getByText("Tools / Software")).toBeTruthy();
    expect(screen.getByText("fastqc")).toBeTruthy();
    // Output Formats (non-input node fileTypes)
    expect(screen.getByText("Output Formats")).toBeTruthy();

    // Close the panel via the pane click handler.
    fireEvent.click(screen.getByTestId("pane-click"));
    expect(screen.queryByText("Tools / Software")).toBeNull();
  });

  it("opens the node detail panel for the input step showing input files and accepted formats", () => {
    const onStepClick = vi.fn();
    render(
      <PipelineProgressViewer
        nodes={fullNodes}
        edges={fullEdges}
        stepStatuses={fullStatuses}
        inputFiles={inputFiles}
        outputFiles={outputFiles}
        onStepClick={onStepClick}
      />
    );

    fireEvent.click(screen.getByTestId("click-input"));

    expect(onStepClick).toHaveBeenCalledWith("input");
    // Input step -> shows input files section
    expect(screen.getByText("Input Files (2)")).toBeTruthy();
    // The file name appears both on the canvas file node and in the panel.
    expect(screen.getAllByText(/sample_R1\.fastq\.gz/).length).toBeGreaterThan(0);
    // Input node -> "Accepted Formats" label branch
    expect(screen.getByText("Accepted Formats")).toBeTruthy();
    // Docs link
    expect(screen.getByText("View Documentation")).toBeTruthy();
  });

  it("shows status.outputFiles in the detail panel when no producedBy outputs exist", () => {
    render(
      <PipelineProgressViewer
        nodes={fullNodes}
        edges={fullEdges}
        stepStatuses={fullStatuses}
        showFiles={false}
      />
    );

    // qc has status.outputFiles but no producedByStepId outputs (no outputFiles prop)
    fireEvent.click(screen.getByTestId("click-qc"));

    expect(screen.getByText("Output Files (2)")).toBeTruthy();
    // The status.outputFiles branch renders basenames
    expect(screen.getByText("report.html")).toBeTruthy();
    expect(screen.getByText("summary.txt")).toBeTruthy();
  });

  it("opens the node detail panel for a step without status (no badge, no timing)", () => {
    render(
      <PipelineProgressViewer
        nodes={[
          { id: "input", name: "In", nodeType: "input", order: 0 },
          { id: "lone", name: "Lone Step", order: 1 },
        ]}
        edges={[{ from: "input", to: "lone" }]}
        showFiles={false}
      />
    );

    fireEvent.click(screen.getByTestId("click-lone"));

    expect(screen.getByRole("heading", { name: "Lone Step" })).toBeTruthy();
    // No status -> no Started/Completed timing
    expect(screen.queryByText("Started")).toBeNull();
  });

  it("opens an output file detail panel (with size, producedBy, checksum) and copies the path", async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const onFileClick = vi.fn();
    render(
      <PipelineProgressViewer
        nodes={fullNodes}
        edges={fullEdges}
        stepStatuses={fullStatuses}
        inputFiles={inputFiles}
        outputFiles={outputFiles}
        onFileClick={onFileClick}
      />
    );

    // Output file node id is "file_output_o1"
    fireEvent.click(screen.getByTestId("click-file_output_o1"));

    expect(onFileClick).toHaveBeenCalled();
    // Output badge + type
    expect(screen.getByText("Output")).toBeTruthy();
    // Size formatted (2048 bytes -> KB branch)
    expect(screen.getByText("2.0 KB")).toBeTruthy();
    // Produced By section
    expect(screen.getByText("Produced By")).toBeTruthy();
    // Checksum
    expect(screen.getByText("def456")).toBeTruthy();
    // Full path
    expect(
      screen.getByText("/data/out/a-really-long-output-filename.vcf")
    ).toBeTruthy();

    // Copy path -> shows "Copied!", then reverts after timers
    fireEvent.click(screen.getByRole("button", { name: /Copy Path/ }));
    expect(writeText).toHaveBeenCalledWith(
      "/data/out/a-really-long-output-filename.vcf"
    );
    expect(screen.getByText("Copied!")).toBeTruthy();

    vi.advanceTimersByTime(2100);
    await waitFor(() => expect(screen.queryByText("Copied!")).toBeNull());

    vi.useRealTimers();
  });

  it("opens an input file detail panel (sample, no size/checksum branches)", () => {
    render(
      <PipelineProgressViewer
        nodes={fullNodes}
        edges={fullEdges}
        inputFiles={inputFiles}
        outputFiles={outputFiles}
      />
    );

    // Input file node id is "file_input_f1"
    fireEvent.click(screen.getByTestId("click-file_input_f1"));

    expect(screen.getByText("Input")).toBeTruthy();
    expect(screen.getByText("Sample")).toBeTruthy();
    // checksum present on f1
    expect(screen.getByText("abc123")).toBeTruthy();
    // type badge
    expect(screen.getByText("read_1")).toBeTruthy();

    // Close the file panel
    fireEvent.click(screen.getByTestId("pane-click"));
    expect(screen.queryByText("Sample")).toBeNull();
  });

  it("clears the selected node when the pane is clicked", () => {
    render(
      <PipelineProgressViewer
        nodes={fullNodes}
        edges={fullEdges}
        stepStatuses={fullStatuses}
        showFiles={false}
      />
    );

    fireEvent.click(screen.getByTestId("click-qc"));
    expect(screen.getByRole("heading", { name: "QC Step" })).toBeTruthy();

    fireEvent.click(screen.getByTestId("pane-click"));
    expect(screen.queryByRole("heading", { name: "QC Step" })).toBeNull();
  });

  it("renders input/output file nodes with truncation and sample labels", () => {
    render(
      <PipelineProgressViewer
        nodes={fullNodes}
        edges={fullEdges}
        inputFiles={inputFiles}
        outputFiles={outputFiles}
      />
    );

    // File node sampleId labels render on the canvas.
    expect(screen.getAllByText("S1").length).toBeGreaterThan(0);
  });

  it("renders an output DAG node that has produced files (CheckCircle + 'files generated')", () => {
    render(
      <PipelineProgressViewer
        nodes={fullNodes}
        edges={fullEdges}
        stepStatuses={[
          {
            stepId: "out",
            status: "completed",
            outputFiles: ["/data/out/final.vcf", "/data/out/report.html"],
          },
        ]}
        showFiles={false}
      />
    );

    // The output DAG node receives outputFiles via its step status -> hasFiles
    // branch renders the "N files generated" summary.
    expect(screen.getByText(/files generated/)).toBeTruthy();
  });

  it("truncates a long input file name on the canvas file node", () => {
    render(
      <PipelineProgressViewer
        nodes={fullNodes}
        edges={fullEdges}
        inputFiles={[
          {
            id: "long",
            name: "this_is_a_very_long_input_name.fastq.gz",
            path: "/data/this_is_a_very_long_input_name.fastq.gz",
            type: "read_1",
          },
        ]}
      />
    );

    // Name > 18 chars -> first 15 chars + "..."
    expect(screen.getByText("this_is_a_very_..." )).toBeTruthy();
  });

  it("renders an output DAG node with no files (arrow-down icon + formats) and input node formats", () => {
    render(
      <PipelineProgressViewer
        nodes={fullNodes}
        edges={fullEdges}
        showFiles={false}
      />
    );

    // Output DAG node with no outputFiles -> shows its fileTypes (.vcf format chip)
    expect(screen.getByText("Final Output")).toBeTruthy();
    // Input DAG node shows file type chips (slice(0,3): fastq, fq, gz)
    expect(screen.getByText(".fastq")).toBeTruthy();
    expect(screen.getByText(".fq")).toBeTruthy();
    expect(screen.getByText(".gz")).toBeTruthy();
    // bam (4th) is sliced out
    expect(screen.queryByText(".bam")).toBeNull();
  });

  it("handles an empty DAG with no nodes or edges", () => {
    render(<PipelineProgressViewer nodes={[]} edges={[]} />);
    expect(screen.getByTestId("flow")).toBeTruthy();
  });

  it("renders output file node where producedByStepId points to a missing step (no edge)", () => {
    render(
      <PipelineProgressViewer
        nodes={fullNodes}
        edges={fullEdges}
        outputFiles={[
          {
            id: "orphan",
            name: "orphan.txt",
            path: "/data/orphan.txt",
            type: "report",
            producedByStepId: "does-not-exist",
          },
        ]}
      />
    );

    // The orphan output file node still renders even though its producing
    // step is not in the node map.
    expect(screen.getByTestId("node-file_output_orphan")).toBeTruthy();
  });

  it("formats large output file sizes in the file detail panel (MB branch)", () => {
    render(
      <PipelineProgressViewer
        nodes={fullNodes}
        edges={fullEdges}
        outputFiles={outputFiles}
      />
    );

    // o2 is 5,000,000 bytes -> MB branch ("4.8 MB")
    fireEvent.click(screen.getByTestId("click-file_output_o2"));
    expect(screen.getByText("4.8 MB")).toBeTruthy();
    // o2 has no sampleId, no checksum, no producedByStepId -> those sections absent
    expect(screen.queryByText("Produced By")).toBeNull();
  });
});
