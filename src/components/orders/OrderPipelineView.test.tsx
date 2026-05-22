// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useSWR: vi.fn(),
  mutateRuns: vi.fn(),
  refreshSystemReady: vi.fn(),
  useQuickPrerequisiteStatus: vi.fn(),
}));

vi.mock("swr", () => ({
  default: mocks.useSWR,
}));

vi.mock("@/lib/pipelines/useQuickPrerequisiteStatus", () => ({
  useQuickPrerequisiteStatus: mocks.useQuickPrerequisiteStatus,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CollapsibleContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CollapsibleTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    disabled,
    onSelect,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onSelect?: (event: { preventDefault: () => void }) => void;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect?.({ preventDefault: vi.fn() })}
    >
      {children}
    </button>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (value: string) => void;
  }) => (
    <div data-selected={value} data-on-value-change={Boolean(onValueChange)}>
      {children}
    </div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({
    children,
    value,
    disabled,
  }: {
    children: React.ReactNode;
    value: string;
    disabled?: boolean;
  }) => (
    <button type="button" disabled={disabled} data-value={value}>
      {children}
    </button>
  ),
  SelectTrigger: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
  } & React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  SelectValue: () => <span />,
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    disabled,
    onCheckedChange,
    "aria-label": ariaLabel,
  }: {
    checked?: boolean;
    disabled?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    "aria-label"?: string;
  }) => (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      checked={Boolean(checked)}
      disabled={disabled}
      onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
    />
  ),
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    disabled,
    onCheckedChange,
    id,
  }: {
    checked?: boolean;
    disabled?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    id?: string;
  }) => (
    <input
      id={id}
      type="checkbox"
      role="switch"
      checked={Boolean(checked)}
      disabled={disabled}
      onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
    />
  ),
}));

import { OrderPipelineView } from "./OrderPipelineView";
import type {
  SequencingReadSummary,
  SequencingSampleRow,
} from "@/lib/sequencing/types";

function jsonResponse(payload: unknown, ok = true) {
  return {
    ok,
    json: async () => payload,
  } as Response;
}

const simulateReadsSchema = {
  properties: {
    simulationMode: {
      type: "string",
      title: "Simulation mode",
      enum: ["auto", "synthetic", "template"],
      default: "auto",
    },
    mode: {
      type: "string",
      title: "Read mode",
      enum: ["shortReadPaired", "shortReadSingle", "longRead"],
      default: "shortReadPaired",
    },
    readCount: {
      type: "number",
      title: "Read count",
      default: 1000,
      minimum: 2,
      maximum: 50000,
    },
    readLength: {
      type: "number",
      title: "Read length",
      default: 150,
      minimum: 25,
      maximum: 300,
    },
    replaceExisting: {
      type: "boolean",
      title: "Replace existing",
      default: true,
    },
    qualityProfile: {
      type: "string",
      title: "Quality profile",
      enum: ["standard", "highAccuracy", "noisy"],
      default: "standard",
    },
    insertMean: {
      type: "number",
      title: "Insert mean",
      default: 350,
      minimum: 200,
      maximum: 5000,
    },
    insertStdDev: {
      type: "number",
      title: "Insert deviation",
      default: 30,
      minimum: 5,
      maximum: 1000,
    },
    seed: {
      type: "number",
      title: "Seed",
      default: null,
    },
  },
};

const metaxPathConfigSchema = {
  properties: {
    sequencer: {
      type: "string",
      title: "Sequencer",
      enum: ["Nanopore", "PacBio"],
      default: "Nanopore",
      "x-seqdesk": {
        placement: "derived",
      },
    },
    skipSylph: {
      type: "boolean",
      title: "Sylph",
      default: false,
      description: "Optional k-mer abundance profiling with Sylph.",
      "x-seqdesk": {
        placement: "basic",
        group: "analysis",
        booleanMode: "inverse",
        helpText: "Optional k-mer abundance profiling with Sylph.",
      },
    },
    skipVirulence: {
      type: "boolean",
      title: "Virulence Search",
      default: false,
      description: "Search assembled contigs against VFDB with BLAST.",
      "x-seqdesk": {
        placement: "basic",
        group: "analysis",
        booleanMode: "inverse",
        helpText: "Search assembled contigs against VFDB with BLAST.",
      },
    },
    skipAmr: {
      type: "boolean",
      title: "AMR Prediction",
      default: false,
      description:
        "Predict antimicrobial resistance markers with ResFinder/PointFinder/Kover where available.",
      "x-seqdesk": {
        placement: "basic",
        group: "analysis",
        booleanMode: "inverse",
        helpText:
          "Predict antimicrobial resistance markers with ResFinder/PointFinder/Kover where available.",
      },
    },
    threads: {
      type: "number",
      title: "Threads",
      default: 20,
      "x-seqdesk": {
        placement: "advanced",
        group: "runtime",
      },
    },
  },
};

const pipeline = {
  pipelineId: "simulate-reads",
  name: "Simulate Reads",
  description: "Generate test read files",
  category: "simulation",
  enabled: true,
  config: { simulationMode: "synthetic", readCount: 12 },
  defaultConfig: {
    simulationMode: "auto",
    mode: "shortReadPaired",
    readCount: 1000,
    readLength: 150,
    replaceExisting: true,
    qualityProfile: "standard",
    insertMean: 350,
    insertStdDev: 30,
    seed: null,
  },
  configSchema: simulateReadsSchema,
  executionPolicy: {
    mode: "slurm",
    source: "global",
  },
  sampleResult: {
    columnLabel: "Generated reads",
    layout: "columns",
    emptyText: "No generated reads",
    values: [
      { path: "read.file1", label: "R1", format: "filename", previewable: true },
      { path: "read.file2", label: "R2", format: "filename", previewable: true },
    ],
  },
  input: {
    supportedScopes: ["order"],
    perSample: { reads: false, pairedEnd: false },
  },
};

const readCleaningPipeline = {
  ...pipeline,
  pipelineId: "read-cleaning",
  name: "Read Cleaning",
  description: "Remove human and other contaminant reads",
  category: "qc",
  config: {
    classificationKraken2: true,
    kraken2Db: "/refs/kraken2-human",
    tax2filter: "Homo sapiens",
    readType: "auto",
  },
  defaultConfig: {
    classificationKraken2: true,
    kraken2Db: "",
    tax2filter: "Homo sapiens",
    readType: "auto",
  },
  configSchema: {
    properties: {
      kraken2Db: {
        type: "string",
        title: "Kraken2 database",
        default: "",
      },
      tax2filter: {
        type: "string",
        title: "Taxa to filter",
        default: "Homo sapiens",
      },
      readType: {
        type: "string",
        title: "Read type",
        enum: ["auto", "short", "long"],
        default: "auto",
      },
    },
  },
  input: {
    supportedScopes: ["order"],
    perSample: { reads: true, pairedEnd: false },
  },
};

const runs = [
  {
    id: "run-1",
    runNumber: "RUN-2026-001",
    pipelineId: "simulate-reads",
    pipelineName: "Simulate Reads",
    status: "completed",
    currentStep: null,
    progress: null,
    inputSampleIds: JSON.stringify(["sample-a"]),
    errorTail: null,
    config: JSON.stringify({ readCount: 12, replaceExisting: false }),
    results: null,
    isSelectedFinal: true,
    isUserVisible: true,
    selectedFinal: {
      selectedRunId: "run-1",
      selectedAt: "2026-04-01T10:03:00.000Z",
      selectedBy: {
        id: "admin-1",
        firstName: "Ada",
        lastName: "Admin",
        email: "admin@example.test",
      },
    },
    resultFiles: [
      {
        id: "artifact-1",
        name: "Combined Report",
        path: "/runs/run-1/output/combined.html",
        type: "report",
        outputId: "combined_report_html",
        source: "artifact",
        size: 1234,
        previewable: true,
      },
    ],
    primaryResultFile: {
      id: "artifact-1",
      name: "Combined Report",
      path: "/runs/run-1/output/combined.html",
      type: "report",
      outputId: "combined_report_html",
      source: "artifact",
      size: 1234,
      previewable: true,
    },
    createdAt: "2026-04-01T10:00:00.000Z",
    startedAt: "2026-04-01T10:01:00.000Z",
    completedAt: "2026-04-01T10:02:00.000Z",
    user: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.test" },
  },
  {
    id: "run-2",
    runNumber: "RUN-2026-002",
    pipelineId: "simulate-reads",
    pipelineName: "Simulate Reads",
    status: "failed",
    currentStep: null,
    progress: null,
    inputSampleIds: "sample-b",
    errorTail: "template missing",
    config: null,
    createdAt: "2026-04-01T11:00:00.000Z",
    startedAt: "2026-04-01T11:01:00.000Z",
    completedAt: "2026-04-01T11:03:00.000Z",
    user: null,
  },
  {
    id: "run-3",
    runNumber: "RUN-2026-003",
    pipelineId: "simulate-reads",
    pipelineName: "Simulate Reads",
    status: "running",
    currentStep: "SIMULATE",
    progress: 42,
    inputSampleIds: JSON.stringify(["sample-c"]),
    errorTail: null,
    config: null,
    createdAt: "2026-04-01T12:00:00.000Z",
    startedAt: "2026-04-01T12:01:00.000Z",
    completedAt: null,
    user: { firstName: null, lastName: null, email: "runner@example.test" },
  },
];

const readA: SequencingReadSummary = {
  id: "read-a",
  file1: "/data/SAMPLE_A_R1.fastq.gz",
  file2: "/data/SAMPLE_A_R2.fastq.gz",
  checksum1: null,
  checksum2: null,
  readCount1: null,
  readCount2: null,
  fileSize1: null,
  fileSize2: null,
  fastqcReport1: null,
  fastqcReport2: null,
  pipelineRunId: "run-1",
  pipelineRunNumber: "RUN-2026-001",
  pipelineSources: { "simulate-reads": "run-1" },
  dataClass: "cleaned",
  dataClassLabel: "Cleaned",
  dataClassSource: "pipeline",
  readOrigin: "pipeline",
  readOriginLabel: "Pipeline",
  isSimulated: true,
  isProtectedRaw: false,
  isActive: true,
  supersededByReadId: null,
  classifiedAt: null,
  classifiedById: null,
  classificationNote: null,
  filesMissing: false,
};

const rawReadA: SequencingReadSummary = {
  ...readA,
  id: "read-raw-a",
  file1: "/data/SAMPLE_A_raw.fastq.gz",
  file2: null,
  pipelineRunId: null,
  pipelineRunNumber: null,
  pipelineSources: {},
  dataClass: "raw",
  dataClassLabel: "Raw / protected",
  dataClassSource: "upload",
  readOrigin: "upload",
  readOriginLabel: "Uploaded",
  isSimulated: false,
  isProtectedRaw: true,
  classificationNote: "Uploaded raw reads",
};

const sampleBase = {
  sampleTitle: null,
  facilityStatus: "READY",
  facilityStatusUpdatedAt: null,
  updatedAt: "2026-04-01T10:00:00.000Z",
  integrityStatus: "complete",
  hasReads: true,
  protectedProvenanceCount: 0,
  protectedProvenance: [],
  sequencingRun: null,
  artifactCount: 0,
  qcArtifactCount: 0,
  latestArtifactStage: null,
  artifacts: [],
  stream: null,
} satisfies Omit<SequencingSampleRow, "id" | "sampleId" | "sampleAlias" | "read">;

const samples: React.ComponentProps<typeof OrderPipelineView>["samples"] = [
  {
    ...sampleBase,
    id: "sample-a",
    sampleId: "SAMPLE_A",
    sampleAlias: "Alpha",
    read: readA,
  },
  {
    ...sampleBase,
    id: "sample-b",
    sampleId: "SAMPLE_B",
    sampleAlias: null,
    integrityStatus: "empty",
    hasReads: false,
    read: null,
  },
];

describe("OrderPipelineView", () => {
  const fetchMock = vi.fn();
  const onRunCompleted = vi.fn();
  const onSampleDataChanged = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mutateRuns.mockResolvedValue(undefined);
    mocks.useQuickPrerequisiteStatus.mockReturnValue({
      systemReady: { ready: true, summary: "Ready" },
      checkingSystem: false,
      refreshSystemReady: mocks.refreshSystemReady,
      initialCheckPending: false,
      systemBlocked: false,
    });
    mocks.useSWR.mockImplementation((url: string | null) => {
      if (typeof url !== "string") {
        return { data: undefined, isLoading: false, mutate: vi.fn() };
      }
      if (url.includes("/api/admin/settings/pipelines/test-setting")) {
        return {
          data: { success: true, message: "SLURM available" },
          isLoading: false,
          mutate: vi.fn(),
        };
      }
      if (url.includes("/api/admin/settings/pipelines")) {
        return { data: { pipelines: [pipeline] }, isLoading: false, mutate: vi.fn() };
      }
      if (url.includes("/api/pipelines/runs")) {
        return { data: { runs, total: runs.length }, mutate: mocks.mutateRuns };
      }
      return { data: undefined, mutate: vi.fn() };
    });
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/pipelines/runs") {
        expect(init?.method).toBe("POST");
        return Promise.resolve(jsonResponse({ run: { id: "created-run" } }));
      }
      if (url === "/api/pipelines/runs/created-run/start") {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (url === "/api/pipelines/validate-metadata") {
        return Promise.resolve(
          jsonResponse({
            valid: true,
            issues: [],
            metadata: {},
            derivedSettings: [],
          })
        );
      }
      if (url.includes("/delete")) {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (url.includes("/resolve-outputs/sample")) {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (url.includes("/sequencing/reads")) {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("runs ready samples, manages run rows, previews files, and changes result sources", async () => {
    render(
      <OrderPipelineView
        orderId="order-1"
        pipelineId="simulate-reads"
        samples={samples}
        onRunCompleted={onRunCompleted}
        onSampleDataChanged={onSampleDataChanged}
        isFacilityAdmin
      />
    );

    expect(screen.getByText("Simulate Reads")).toBeTruthy();
    expect(screen.getByText("Generate test read files")).toBeTruthy();
    expect(screen.getByLabelText("Run all ready samples")).toBeTruthy();
    expect(screen.getByText("2 ready")).toBeTruthy();
    expect(screen.getByText("1 active")).toBeTruthy();
    expect(screen.getByText("1 completed")).toBeTruthy();
    expect(screen.getByText("1 failed")).toBeTruthy();
    expect(screen.getByText("Visible to user")).toBeTruthy();
    expect(screen.getByRole("link", { name: /combined report/i })).toBeTruthy();
    expect(screen.getByText("SAMPLE_A")).toBeTruthy();
    expect(screen.getByText("SAMPLE_B")).toBeTruthy();
    expect(screen.getAllByText("SAMPLE_A_R1.fastq.gz").length).toBeGreaterThan(0);
    expect(screen.getAllByText("SAMPLE_A_R2.fastq.gz").length).toBeGreaterThan(0);
    expect(screen.getByText("template missing")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Read count"), {
      target: { value: "24" },
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Run all ready samples").hasAttribute("disabled")).toBe(false);
    });
    fireEvent.click(screen.getByLabelText("Run all ready samples"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/pipelines/runs",
        expect.objectContaining({ method: "POST" })
      );
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/pipelines/runs/created-run/start",
        { method: "POST" }
      );
    });
    const createBody = JSON.parse(
      fetchMock.mock.calls.find(([url]) => url === "/api/pipelines/runs")![1].body
    );
    expect(createBody).toMatchObject({
      pipelineId: "simulate-reads",
      orderId: "order-1",
      sampleIds: ["sample-a", "sample-b"],
      executionMode: "default",
    });
    expect(createBody.config.readCount).toBe(24);

    fireEvent.click(screen.getAllByText("SAMPLE_A_R1.fastq.gz")[0]);
    expect(screen.getByText("R1 — SAMPLE_A_R1.fastq.gz")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open in new tab/i }).getAttribute("href")).toBe(
      "/api/files/preview?path=%2Fdata%2FSAMPLE_A_R1.fastq.gz"
    );

    fireEvent.click(screen.getByLabelText("Clear Generated reads for SAMPLE_A"));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/orders/order-1/sequencing/reads",
        expect.objectContaining({ method: "PATCH" })
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "RUN-2026-001" }));
    expect(screen.getByText("Change Source")).toBeTruthy();
    expect(screen.getByText("Current")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByLabelText("View details for RUN-2026-001"));
    expect(screen.getByText("Run Details")).toBeTruthy();
    expect(screen.getByText(/Published by Ada Admin/i)).toBeTruthy();
    expect(screen.getByText("Read count:")).toBeTruthy();
    expect(screen.getByText("No")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByLabelText("Select all runs"));
    expect(screen.getByText("2 selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Delete Pipeline Runs")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete 2 runs" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/pipelines/runs/run-1/delete", {
        method: "POST",
      });
      expect(fetchMock).toHaveBeenCalledWith("/api/pipelines/runs/run-2/delete", {
        method: "POST",
      });
    });
  });

  it("lets admins publish and hide completed runs for the order owner", async () => {
    const unpublishedRun = {
      ...runs[0],
      id: "run-unpublished",
      runNumber: "RUN-2026-004",
      isSelectedFinal: false,
      isUserVisible: false,
      selectedFinal: null,
    };
    mocks.useSWR.mockImplementation((url: string | null) => {
      if (typeof url !== "string") {
        return { data: undefined, isLoading: false, mutate: vi.fn() };
      }
      if (url.includes("/api/admin/settings/pipelines/test-setting")) {
        return {
          data: { success: true, message: "SLURM available" },
          isLoading: false,
          mutate: vi.fn(),
        };
      }
      if (url.includes("/api/admin/settings/pipelines")) {
        return { data: { pipelines: [pipeline] }, isLoading: false, mutate: vi.fn() };
      }
      if (url.includes("/api/pipelines/runs")) {
        return {
          data: { runs: [runs[0], unpublishedRun], total: 2 },
          mutate: mocks.mutateRuns,
        };
      }
      return { data: undefined, mutate: vi.fn() };
    });

    render(
      <OrderPipelineView
        orderId="order-1"
        pipelineId="simulate-reads"
        samples={samples}
        isFacilityAdmin
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Make visible to user/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/pipelines/runs/run-unpublished/selection",
        { method: "PUT" }
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /Hide from user/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/pipelines/runs/run-1/selection",
        { method: "DELETE" }
      );
    });
  });

  it("lets admins review and promote read-cleaning candidates from run details", async () => {
    const readCleaningRun = {
      ...runs[0],
      id: "run-clean",
      runNumber: "RUN-CLEAN-001",
      pipelineId: "read-cleaning",
      pipelineName: "Read Cleaning",
      config: JSON.stringify({
        kraken2Db: "/refs/kraken2-human",
        tax2filter: "Homo sapiens",
      }),
      resultFiles: [
        {
          id: "report-1",
          name: "MultiQC report",
          path: "/runs/run-clean/output/multiqc/multiqc_report.html",
          type: "report",
          outputId: "multiqc_report",
          source: "artifact",
          size: 1234,
          previewable: true,
        },
      ],
      primaryResultFile: null,
    };
    const readCleaningSamples: React.ComponentProps<typeof OrderPipelineView>["samples"] = [
      {
        ...samples[0],
        read: rawReadA,
      },
    ];
    const candidateMutate = vi.fn().mockResolvedValue(undefined);
    const readCleaningRunsResponse = { runs: [readCleaningRun], total: 1 };
    const readCleaningCandidateResponse = {
      run: {
        id: "run-clean",
        runNumber: "RUN-CLEAN-001",
        status: "completed",
        orderId: "order-1",
      },
      candidates: [
        {
          artifactId: "candidate-1",
          sampleId: "sample-a",
          sampleCode: "SAMPLE_A",
          file1: "/runs/run-clean/output/filter/filtered/SAMPLE_A_filtered.fastq.gz",
          file2: null,
          readLayout: "single",
          status: "candidate",
          metadata: { classified_reads: 12 },
          currentRead: {
            id: "read-raw-a",
            file1: "/data/SAMPLE_A_raw.fastq.gz",
            file2: null,
            dataClass: "raw",
            dataClassLabel: "Raw / protected",
            isProtectedRaw: true,
          },
        },
      ],
      reports: [
        {
          id: "report-1",
          name: "MultiQC report",
          path: "/runs/run-clean/output/multiqc/multiqc_report.html",
          outputId: "multiqc_report",
        },
      ],
    };

    mocks.useSWR.mockImplementation((url: string | null) => {
      if (typeof url !== "string") {
        return { data: undefined, isLoading: false, mutate: vi.fn() };
      }
      if (url.includes("/api/admin/settings/pipelines/test-setting")) {
        return {
          data: { success: true, message: "SLURM available" },
          isLoading: false,
          mutate: vi.fn(),
        };
      }
      if (url.includes("/api/admin/settings/pipelines")) {
        return {
          data: { pipelines: [readCleaningPipeline] },
          isLoading: false,
          mutate: vi.fn(),
        };
      }
      if (url.includes("/api/pipelines/runs/run-clean/cleaned-reads")) {
        return {
          data: readCleaningCandidateResponse,
          isLoading: false,
          mutate: candidateMutate,
        };
      }
      if (url.includes("/api/pipelines/runs")) {
        return {
          data: readCleaningRunsResponse,
          mutate: mocks.mutateRuns,
        };
      }
      return { data: undefined, isLoading: false, mutate: vi.fn() };
    });
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/pipelines/runs/run-clean/cleaned-reads") {
        expect(init?.method).toBe("POST");
        return Promise.resolve(jsonResponse({ promoted: 1, readIds: ["read-cleaned"] }));
      }
      if (url === "/api/pipelines/validate-metadata") {
        return Promise.resolve(
          jsonResponse({
            valid: true,
            issues: [],
            metadata: {},
            derivedSettings: [],
          })
        );
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });

    render(
      <OrderPipelineView
        orderId="order-1"
        pipelineId="read-cleaning"
        samples={readCleaningSamples}
        isFacilityAdmin
        onSampleDataChanged={onSampleDataChanged}
      />
    );

    expect(screen.getByText("Promotion required after cleaning")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("View details for RUN-CLEAN-001"));

    expect(screen.getAllByText("Review cleaned reads").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /multiqc report/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("SAMPLE_A").length).toBeGreaterThan(0);
    expect(screen.getAllByText("SAMPLE_A_raw.fastq.gz").length).toBeGreaterThan(0);
    expect(screen.getByText("SAMPLE_A_filtered.fastq.gz")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Set as active cleaned reads" }));
    expect(screen.getByText(/Existing raw or unknown reads will be preserved/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set active" }).hasAttribute("disabled")).toBe(
      true
    );

    fireEvent.click(
      screen.getByLabelText("I reviewed the cleaning report and want to use these cleaned reads")
    );
    fireEvent.click(screen.getByRole("button", { name: "Set active" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/pipelines/runs/run-clean/cleaned-reads",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ sampleIds: ["sample-a"] }),
        })
      );
    });
    expect(candidateMutate).toHaveBeenCalled();
    expect(onSampleDataChanged).toHaveBeenCalled();
  });

  it("warns when simulate reads would preserve stale linked reads", () => {
    const staleSamples: React.ComponentProps<typeof OrderPipelineView>["samples"] = [
      {
        ...samples[0],
        read: {
          ...samples[0].read!,
          filesMissing: true,
          fileSize1: null,
          fileSize2: null,
        },
      },
    ];

    render(
      <OrderPipelineView
        orderId="order-1"
        pipelineId="simulate-reads"
        samples={staleSamples}
      />
    );

    expect(screen.queryByText("Stale reads will be preserved")).toBeNull();

    fireEvent.click(screen.getByLabelText("Replace existing"));

    expect(screen.getByText("Stale reads will be preserved")).toBeTruthy();
    expect(
      screen.getByText(/will leave 1 stale linked sample unchanged/i)
    ).toBeTruthy();
  });

  it("shows MetaxPath runtime warnings without blocking launch", async () => {
    const metaxPathPipeline = {
      ...pipeline,
      pipelineId: "metaxpath",
      name: "MetaxPath",
      description: "ONT metagenomics",
      config: {
        sequencer: "Nanopore",
        skipSylph: false,
        skipVirulence: false,
        skipAmr: false,
        threads: 20,
      },
      defaultConfig: {
        sequencer: "Nanopore",
        skipSylph: false,
        skipVirulence: false,
        skipAmr: false,
        threads: 20,
      },
      configSchema: metaxPathConfigSchema,
      runtimeWarnings: [
        "Kraken2 PlusPF is configured without memory mapping. PlusPF can exceed common Slurm cgroup memory limits and be SIGKILLed while loading the database.",
      ],
      input: {
        supportedScopes: ["order"],
        perSample: { reads: true, pairedEnd: false },
      },
    };
    mocks.useSWR.mockImplementation((url: string | null) => {
      if (typeof url !== "string") {
        return { data: undefined, isLoading: false, mutate: vi.fn() };
      }
      if (url.includes("/api/admin/settings/pipelines/test-setting")) {
        return {
          data: { success: true, message: "SLURM available" },
          isLoading: false,
          mutate: vi.fn(),
        };
      }
      if (url.includes("/api/admin/settings/pipelines")) {
        return { data: { pipelines: [metaxPathPipeline] }, isLoading: false, mutate: vi.fn() };
      }
      if (url.includes("/api/pipelines/runs")) {
        return { data: { runs: [], total: 0 }, mutate: mocks.mutateRuns };
      }
      return { data: undefined, mutate: vi.fn() };
    });
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/pipelines/validate-metadata") {
        return Promise.resolve(
          jsonResponse({
            valid: true,
            issues: [],
            metadata: {},
            derivedSettings: [
              {
                key: "sequencer",
                title: "Sequencer",
                value: "Nanopore",
                message: "MetaxPath will run in Nanopore mode.",
                source: "order.sequencingTechnology.platformFamily",
              },
            ],
          })
        );
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });

    render(
      <OrderPipelineView
        orderId="order-1"
        pipelineId="metaxpath"
        samples={samples}
        isFacilityAdmin
      />
    );

    expect(screen.getByText("MetaxPath runtime warning")).toBeTruthy();
    expect(screen.getByText(/PlusPF is configured without memory mapping/i)).toBeTruthy();
    expect(await screen.findByText("MetaxPath will run in Nanopore mode.")).toBeTruthy();
    expect(screen.queryByLabelText("Sequencer")).toBeNull();
    expect(screen.getByLabelText("AMR Prediction")).toBeTruthy();
    expect(
      screen.getByText(/Predict antimicrobial resistance markers with ResFinder\/PointFinder\/Kover/i)
    ).toBeTruthy();
    expect(screen.getByLabelText("Run all ready samples").hasAttribute("disabled")).toBe(false);
  });
});
