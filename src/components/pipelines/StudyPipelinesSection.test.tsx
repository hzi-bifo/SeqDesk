// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useSWR: vi.fn(),
  useSession: vi.fn(),
  refreshSystemReady: vi.fn(),
  useQuickPrerequisiteStatus: vi.fn(),
  useSlurmAvailability: vi.fn(),
}));

vi.mock("swr", () => ({
  default: mocks.useSWR,
}));

vi.mock("next-auth/react", () => ({
  useSession: mocks.useSession,
}));

vi.mock("@/lib/pipelines/useQuickPrerequisiteStatus", () => ({
  useQuickPrerequisiteStatus: mocks.useQuickPrerequisiteStatus,
}));

vi.mock("./ExecutionTargetControl", () => ({
  ExecutionTargetControl: () => <div data-testid="execution-target-control" />,
  getExecutionTargetBlockMessage: () => null,
  isExecutionTargetBlocked: () => false,
  useSlurmAvailability: mocks.useSlurmAvailability,
}));

// The runs table drives Radix dropdowns / dialogs / selects / checkboxes which
// rely on portals + pointer APIs that JSDOM does not implement. Replace them
// with light DOM stand-ins (matching OrderPipelineView.test.tsx) so we can
// drive the interactions. PipelineRunSettings still uses the real Switch +
// Collapsible, so those are intentionally left unmocked.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
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
    variant?: string;
    asChild?: boolean;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect?.({ preventDefault: vi.fn() })}
    >
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
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
    <div
      data-selected={value}
      data-on-value-change={Boolean(onValueChange)}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        const next = target.getAttribute("data-value");
        if (next != null) onValueChange?.(next);
      }}
    >
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

import { StudyPipelinesSection } from "./StudyPipelinesSection";

function jsonResponse(payload: unknown, ok = true) {
  return {
    ok,
    json: async () => payload,
  } as Response;
}

const metaxPathConfigSchema = {
  properties: {
    sequencer: {
      type: "string",
      title: "Sequencer",
      enum: ["Nanopore", "PacBio"],
      default: "Nanopore",
      "x-seqdesk": {
        placement: "derived",
        derive: {
          source: "order.sequencingTechnology.platformFamily",
          map: {
            "oxford-nanopore": "Nanopore",
            pacbio: "PacBio",
          },
          requireSingleValue: true,
        },
      },
    },
    skipSylph: {
      type: "boolean",
      title: "Sylph",
      default: false,
      description: "Run optional k-mer abundance profiling with Sylph.",
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
        helpText: "Execution thread hint for tools that expose a thread parameter.",
      },
    },
    topn: {
      type: "number",
      title: "Top N Report Rows",
      default: 50,
      "x-seqdesk": {
        placement: "advanced",
        group: "reporting",
        helpText: "Number of rows included in summary tables.",
      },
    },
  },
};

const metaxPathPipeline = {
  pipelineId: "metaxpath",
  name: "MetaxPath",
  description: "ONT metagenomics",
  icon: "Dna",
  enabled: true,
  version: "0.1.3",
  category: "analysis",
  config: {
    sequencer: "Nanopore",
    skipSylph: false,
    skipVirulence: false,
    skipAmr: false,
    threads: 20,
    topn: 50,
  },
  defaultConfig: {
    sequencer: "Nanopore",
    skipSylph: false,
    skipVirulence: false,
    skipAmr: false,
    threads: 20,
    topn: 50,
  },
  configSchema: metaxPathConfigSchema,
  runtimeWarnings: [
    "Kraken2 PlusPF is configured without memory mapping. PlusPF can exceed common Slurm cgroup memory limits and be SIGKILLed while loading the database.",
  ],
  input: {
    perSample: {
      reads: true,
      pairedEnd: false,
      readMode: "single_or_paired",
    },
  },
};

const samples: React.ComponentProps<typeof StudyPipelinesSection>["samples"] = [
  {
    id: "sample-a",
    sampleId: "SAMPLE_A",
    sampleAlias: null,
    reads: [
      {
        id: "read-a",
        file1: "/data/SAMPLE_A.fastq.gz",
        file2: null,
        checksum1: null,
        checksum2: null,
      },
    ],
    order: null,
    preferredAssemblyId: null,
    assemblies: [],
    bins: [],
  },
];

type RunOverrides = Partial<{
  id: string;
  runNumber: string;
  status: string;
  progress: number | null;
  currentStep: string | null;
  errorTail: string | null;
  inputSampleIds: string | null;
  isSelectedFinal: boolean;
  queueStatus: string | null;
  queueJobId: string | null;
  results: { errors?: string[]; warnings?: string[] } | null;
  resultFiles: unknown[];
  primaryResultFile: unknown;
  user: { firstName: string | null; lastName: string | null; email: string } | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}>;

function makeRun(overrides: RunOverrides = {}) {
  return {
    id: "run-1",
    runNumber: "METAXPATH-20260520-001",
    pipelineId: "metaxpath",
    pipelineName: "MetaxPath",
    pipelineIcon: "Dna",
    status: "completed",
    progress: 100,
    currentStep: "Completed successfully",
    errorTail: null,
    inputSampleIds: JSON.stringify(["sample-a"]),
    runFolder: "/runs/run-1",
    queueJobId: null,
    queueStatus: null,
    queueReason: null,
    queueUpdatedAt: null,
    results: null,
    artifacts: [],
    isSelectedFinal: false,
    selectedFinal: null,
    resultFiles: [],
    primaryResultFile: null,
    createdAt: "2026-05-20T10:00:00.000Z",
    startedAt: "2026-05-20T10:00:00.000Z",
    completedAt: "2026-05-20T10:05:00.000Z",
    user: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.test" },
    _count: { assembliesCreated: 0, binsCreated: 0 },
    ...overrides,
  };
}

/**
 * Builds a useSWR implementation returning the supplied pipelines + runs.
 */
function makeSwr(options: {
  pipelines?: unknown[];
  runs?: unknown[];
  runsMutate?: () => void;
  pipelinesLoading?: boolean;
}) {
  const {
    pipelines = [metaxPathPipeline],
    runs = [],
    runsMutate = vi.fn(),
    pipelinesLoading = false,
  } = options;
  return (url: string | null) => {
    if (typeof url !== "string") {
      return { data: undefined, isLoading: false, mutate: vi.fn() };
    }
    if (url.includes("/api/admin/settings/pipelines")) {
      return {
        data: pipelinesLoading ? undefined : { pipelines },
        isLoading: pipelinesLoading,
        mutate: vi.fn(),
      };
    }
    if (url.includes("/api/pipelines/runs")) {
      return { data: { runs, total: runs.length }, isLoading: false, mutate: runsMutate };
    }
    return { data: undefined, isLoading: false, mutate: vi.fn() };
  };
}

describe("StudyPipelinesSection", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useSession.mockReturnValue({
      data: { user: { role: "FACILITY_ADMIN" } },
    });
    mocks.useQuickPrerequisiteStatus.mockReturnValue({
      systemReady: { ready: true, summary: "Ready" },
      checkingSystem: false,
      refreshSystemReady: mocks.refreshSystemReady,
      initialCheckPending: false,
      systemBlocked: false,
    });
    mocks.useSlurmAvailability.mockReturnValue({
      slurmAvailability: null,
      slurmAvailabilityLoading: false,
      slurmAvailabilityError: null,
    });
    mocks.useSWR.mockImplementation(makeSwr({}));
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/settings/pipelines/check-prerequisites")) {
        return Promise.resolve(
          jsonResponse({
            requiredPassed: true,
            checks: [],
            summary: "Ready",
          })
        );
      }
      if (url.includes("/api/pipelines/validate-metadata")) {
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
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("open", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  // ---------------------------------------------------------------------------
  // Existing assertions — preserved
  // ---------------------------------------------------------------------------

  it("renders metadata-driven MetaxPath settings with derived mode and collapsed advanced controls", async () => {
    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    expect(await screen.findByText("MetaxPath will run in Nanopore mode.")).toBeTruthy();
    expect(screen.queryByLabelText("Sequencer")).toBeNull();
    expect(screen.getByLabelText("AMR Prediction")).toBeTruthy();
    expect(
      screen.getByText(/Predict antimicrobial resistance markers with ResFinder\/PointFinder\/Kover/i)
    ).toBeTruthy();
    expect(screen.getByText("Optional k-mer abundance profiling with Sylph.")).toBeTruthy();
    expect(screen.getByText("Search assembled contigs against VFDB with BLAST.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Advanced settings/i })).toBeTruthy();
    expect(screen.queryByLabelText("Threads")).toBeNull();
  });

  it("shows MetaxPath runtime warnings without disabling launch", async () => {
    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    expect(await screen.findByText("MetaxPath runtime warning")).toBeTruthy();
    expect(screen.getByText(/PlusPF is configured without memory mapping/i)).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Start Pipeline" }).hasAttribute("disabled")).toBe(false);
    });
  });

  it("shows selected final run and result link in the runs table", async () => {
    mocks.useSWR.mockImplementation(
      makeSwr({
        runs: [
          makeRun({
            isSelectedFinal: true,
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
          }),
        ],
      })
    );

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    expect(await screen.findByText("Final")).toBeTruthy();
    expect(screen.getByRole("link", { name: /combined report/i })).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // Loading / empty / overview render states
  // ---------------------------------------------------------------------------

  it("renders the loading state while pipelines are still fetching", () => {
    mocks.useSWR.mockImplementation(makeSwr({ pipelinesLoading: true }));

    render(<StudyPipelinesSection studyId="study-1" samples={samples} />);

    expect(screen.getByText("Loading pipelines...")).toBeTruthy();
  });

  it("renders the empty state when no study pipelines are enabled", () => {
    mocks.useSWR.mockImplementation(makeSwr({ pipelines: [] }));

    render(<StudyPipelinesSection studyId="study-1" samples={samples} />);

    expect(screen.getByText("No Study Pipelines Enabled")).toBeTruthy();
    expect(
      screen.getByText(/Enable a study-scoped pipeline in admin settings/i)
    ).toBeTruthy();
  });

  it("renders the overview grid with aggregate run badges when no pipeline is selected", () => {
    const second = {
      ...metaxPathPipeline,
      pipelineId: "mag",
      name: "MAG",
      description: "Metagenome-assembled genomes",
    };
    const third = {
      ...metaxPathPipeline,
      pipelineId: "qc",
      name: "QC",
      description: "Quality control",
    };
    mocks.useSWR.mockImplementation(
      makeSwr({
        pipelines: [metaxPathPipeline, second, third],
        runs: [
          // metaxpath: a running run dominates the active badge
          makeRun({ id: "r-run", status: "running", pipelineId: "metaxpath" } as RunOverrides),
          makeRun({ id: "r-done", status: "completed", pipelineId: "metaxpath" } as RunOverrides),
          // mag: only completed runs -> Completed badge
          {
            ...makeRun({ id: "m-done", status: "completed" } as RunOverrides),
            pipelineId: "mag",
            pipelineName: "MAG",
          },
          // qc: only a failed run -> Failed badge
          {
            ...makeRun({ id: "q-fail", status: "failed" } as RunOverrides),
            pipelineId: "qc",
            pipelineName: "QC",
          },
        ],
      })
    );

    // No selectedPipelineId => overview mode.
    render(<StudyPipelinesSection studyId="study-1" samples={samples} />);

    expect(screen.getByText("Analysis")).toBeTruthy();
    expect(screen.getByText("Pipeline overview for this study")).toBeTruthy();
    // metaxpath card: 2 runs, 1 completed, active running badge.
    expect(screen.getByText("Running")).toBeTruthy();
    // mag card: completed badge.
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
    // qc card: failed badge + failed count text.
    expect(screen.getByText("Failed")).toBeTruthy();
    // The "2 runs total" summary line for metaxpath.
    expect(screen.getByText("2 runs total")).toBeTruthy();
  });

  it("shows a 'Not run yet' badge for pipelines without runs in overview mode", () => {
    mocks.useSWR.mockImplementation(makeSwr({ runs: [] }));

    render(<StudyPipelinesSection studyId="study-1" samples={samples} />);

    expect(screen.getByText("Not run yet")).toBeTruthy();
    expect(screen.getByText("0 runs total")).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // Runs table — status badge mapping + details rendering
  // ---------------------------------------------------------------------------

  it("renders a status badge, progress, and details cell for every run status", async () => {
    mocks.useSWR.mockImplementation(
      makeSwr({
        runs: [
          makeRun({ id: "c", runNumber: "MX-001", status: "completed" }),
          makeRun({
            id: "r",
            runNumber: "MX-002",
            status: "running",
            progress: 42,
            currentStep: "ALIGN_READS",
            completedAt: null,
          }),
          makeRun({
            id: "q",
            runNumber: "MX-003",
            status: "queued",
            currentStep: null,
            completedAt: null,
          }),
          makeRun({
            id: "f",
            runNumber: "MX-004",
            status: "failed",
            errorTail: "boom: out of memory",
            currentStep: null,
            completedAt: null,
          }),
          makeRun({
            id: "p",
            runNumber: "MX-005",
            status: "pending",
            currentStep: null,
            completedAt: null,
          }),
          makeRun({
            id: "x",
            runNumber: "MX-006",
            status: "cancelled",
            currentStep: null,
            completedAt: null,
          }),
        ],
      })
    );

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    // One labelled status badge for each status value. Several of these labels
    // also appear as status-filter options in the toolbar Select, so allow
    // multiple matches. "Pending" has no filter option, so it is unique.
    expect((await screen.findAllByText("Completed")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Running").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Queued").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Failed").length).toBeGreaterThan(0);
    expect(screen.getByText("Pending")).toBeTruthy();
    expect(screen.getAllByText("Cancelled").length).toBeGreaterThan(0);

    // Running progress percentage is shown.
    expect(screen.getByText("42%")).toBeTruthy();
    // Running current step surfaces in the Details column.
    expect(screen.getByText("ALIGN_READS")).toBeTruthy();
    // Failed run shows its error tail (mono/destructive details).
    expect(screen.getByText("boom: out of memory")).toBeTruthy();
    // The run count chip reflects the number of visible runs.
    expect(screen.getByText("6")).toBeTruthy();
  });

  it("derives running/queued display status from active queue state and surfaces a queue summary", async () => {
    mocks.useSWR.mockImplementation(
      makeSwr({
        runs: [
          makeRun({
            id: "queued-run",
            runNumber: "MX-Q",
            status: "pending",
            currentStep: null,
            completedAt: null,
            queueStatus: "PENDING",
            queueJobId: "12345",
          }),
        ],
      })
    );

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    // A PENDING SLURM queue state maps to the "Queued" display badge even
    // though the stored status is "pending". "Queued" also appears as a
    // status-filter option in the toolbar, so allow multiple matches.
    expect((await screen.findAllByText("Queued")).length).toBeGreaterThan(0);
    expect(screen.getByText(/SLURM: PENDING/)).toBeTruthy();
  });

  it("renders an empty runs message when no runs exist for the selected pipeline", async () => {
    mocks.useSWR.mockImplementation(makeSwr({ runs: [] }));

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    expect(
      await screen.findByText("No runs started for this pipeline yet.")
    ).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // Status filter
  // ---------------------------------------------------------------------------

  it("filters runs by status, shows counts, and clears the filter", async () => {
    mocks.useSWR.mockImplementation(
      makeSwr({
        runs: [
          makeRun({ id: "c", runNumber: "MX-001", status: "completed" }),
          makeRun({
            id: "f",
            runNumber: "MX-002",
            status: "failed",
            errorTail: "kaboom",
            completedAt: null,
          }),
        ],
      })
    );

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    // The status filter Select offers Failed with a (1) count.
    const failedOption = await screen.findByRole("button", { name: /Failed/ });
    expect(failedOption).toBeTruthy();
    fireEvent.click(failedOption);

    // After selecting "failed", only the failed run remains; completed run gone.
    await waitFor(() => {
      expect(screen.queryByTitle("MX-001")).toBeNull();
    });
    expect(screen.getByTitle("MX-002")).toBeTruthy();

    // The clear-filter (X) button resets to all statuses.
    const clearButtons = screen.getAllByRole("button");
    const xButton = clearButtons.find((b) => b.querySelector("svg.lucide-x"));
    expect(xButton).toBeTruthy();
  });

  it("shows the 'no <status> runs found' row when a filter matches nothing", async () => {
    mocks.useSWR.mockImplementation(
      makeSwr({
        runs: [makeRun({ id: "c", runNumber: "MX-001", status: "completed" })],
      })
    );

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    // Filter by "running" while only a completed run exists.
    const runningOption = await screen.findByRole("button", { name: "Running" });
    fireEvent.click(runningOption);

    await waitFor(() => {
      expect(screen.getByText("No running runs found.")).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // Select mode + bulk delete
  // ---------------------------------------------------------------------------

  it("supports select mode with select-all and bulk delete", async () => {
    const runsMutate = vi.fn().mockResolvedValue(undefined);
    mocks.useSWR.mockImplementation(
      makeSwr({
        runs: [
          makeRun({ id: "run-1", runNumber: "MX-001", status: "completed" }),
          makeRun({
            id: "run-2",
            runNumber: "MX-002",
            status: "failed",
            errorTail: "x",
            completedAt: null,
          }),
        ],
        runsMutate,
      })
    );

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByLabelText("Select all runs"));
    expect(screen.getByText("2 selected")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Delete$/ }));
    // Bulk delete confirmation dialog opens.
    expect(screen.getByText("Delete 2 runs?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Delete 2 Runs/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/pipelines/runs/run-1/delete", {
        method: "POST",
      });
      expect(fetchMock).toHaveBeenCalledWith("/api/pipelines/runs/run-2/delete", {
        method: "POST",
      });
    });
    expect(runsMutate).toHaveBeenCalled();
  });

  it("toggles a single run selection and can cancel select mode", async () => {
    mocks.useSWR.mockImplementation(
      makeSwr({
        runs: [makeRun({ id: "run-1", runNumber: "MX-001", status: "completed" })],
      })
    );

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Select" }));
    const rowCheckbox = screen.getByLabelText("Select run MX-001");
    fireEvent.click(rowCheckbox);
    expect(screen.getByText("1 selected")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    // Back to non-select toolbar with the Select button.
    expect(screen.getByRole("button", { name: "Select" })).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // Per-run dropdown actions
  // ---------------------------------------------------------------------------

  it("opens the run in a new tab from the actions menu", async () => {
    mocks.useSWR.mockImplementation(
      makeSwr({ runs: [makeRun({ id: "run-1", runNumber: "MX-001", status: "completed" })] })
    );

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "View details" }));
    expect(window.open).toHaveBeenCalledWith(
      expect.stringContaining("/analysis/run-1?studyId=study-1"),
      "_blank"
    );
  });

  it("lets a facility admin mark a completed run as final", async () => {
    const runsMutate = vi.fn().mockResolvedValue(undefined);
    mocks.useSWR.mockImplementation(
      makeSwr({
        runs: [
          makeRun({
            id: "run-1",
            runNumber: "MX-001",
            status: "completed",
            isSelectedFinal: false,
          }),
        ],
        runsMutate,
      })
    );

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Use as final" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/pipelines/runs/run-1/selection", {
        method: "PUT",
      });
    });
    expect(runsMutate).toHaveBeenCalled();
  });

  it("lets a facility admin clear a final run selection", async () => {
    const runsMutate = vi.fn().mockResolvedValue(undefined);
    mocks.useSWR.mockImplementation(
      makeSwr({
        runs: [
          makeRun({
            id: "run-1",
            runNumber: "MX-001",
            status: "completed",
            isSelectedFinal: true,
          }),
        ],
        runsMutate,
      })
    );

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Clear final" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/pipelines/runs/run-1/selection", {
        method: "DELETE",
      });
    });
  });

  it("deletes a single run via the confirmation dialog", async () => {
    const runsMutate = vi.fn().mockResolvedValue(undefined);
    mocks.useSWR.mockImplementation(
      makeSwr({
        runs: [makeRun({ id: "run-1", runNumber: "MX-001", status: "completed" })],
        runsMutate,
      })
    );

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Delete run" }));
    // The delete dialog shows the run number.
    expect(screen.getByText("Delete run MX-001?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete Run" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/pipelines/runs/run-1/delete", {
        method: "POST",
      });
    });
    expect(runsMutate).toHaveBeenCalled();
  });

  it("surfaces an error when deleting a run fails", async () => {
    mocks.useSWR.mockImplementation(
      makeSwr({ runs: [makeRun({ id: "run-1", runNumber: "MX-001", status: "completed" })] })
    );
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/pipelines/runs/run-1/delete") {
        return Promise.resolve(jsonResponse({ error: "cannot delete" }, false));
      }
      if (url.includes("/api/pipelines/validate-metadata")) {
        return Promise.resolve(
          jsonResponse({ valid: true, issues: [], metadata: {}, derivedSettings: [] })
        );
      }
      return Promise.resolve(jsonResponse({}));
    });

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Delete run" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Run" }));

    expect(await screen.findByText("cannot delete")).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // Start pipeline interaction + error state
  // ---------------------------------------------------------------------------

  it("creates and starts a pipeline run on launch", async () => {
    const runsMutate = vi.fn().mockResolvedValue(undefined);
    mocks.useSWR.mockImplementation(makeSwr({ runs: [], runsMutate }));
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/pipelines/runs") {
        expect(init?.method).toBe("POST");
        return Promise.resolve(jsonResponse({ run: { id: "created-run" } }));
      }
      if (url === "/api/pipelines/runs/created-run/start") {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (url.includes("/api/pipelines/validate-metadata")) {
        return Promise.resolve(
          jsonResponse({ valid: true, issues: [], metadata: {}, derivedSettings: [] })
        );
      }
      if (url.includes("/api/admin/settings/pipelines/check-prerequisites")) {
        return Promise.resolve(jsonResponse({ requiredPassed: true, checks: [], summary: "Ready" }));
      }
      return Promise.resolve(jsonResponse({}));
    });

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    const startButton = await screen.findByRole("button", { name: "Start Pipeline" });
    await waitFor(() => {
      expect(startButton.hasAttribute("disabled")).toBe(false);
    });
    fireEvent.click(startButton);

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
      pipelineId: "metaxpath",
      studyId: "study-1",
      sampleIds: ["sample-a"],
      executionMode: "default",
    });
    expect(runsMutate).toHaveBeenCalled();
  });

  it("shows an error banner when starting a pipeline fails", async () => {
    mocks.useSWR.mockImplementation(makeSwr({ runs: [] }));
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/pipelines/runs") {
        return Promise.resolve(jsonResponse({ error: "launch blew up" }, false));
      }
      if (url.includes("/api/pipelines/validate-metadata")) {
        return Promise.resolve(
          jsonResponse({ valid: true, issues: [], metadata: {}, derivedSettings: [] })
        );
      }
      if (url.includes("/api/admin/settings/pipelines/check-prerequisites")) {
        return Promise.resolve(jsonResponse({ requiredPassed: true, checks: [], summary: "Ready" }));
      }
      return Promise.resolve(jsonResponse({}));
    });

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    const startButton = await screen.findByRole("button", { name: "Start Pipeline" });
    await waitFor(() => {
      expect(startButton.hasAttribute("disabled")).toBe(false);
    });
    fireEvent.click(startButton);

    expect(await screen.findByText("Pipeline action failed")).toBeTruthy();
    expect(screen.getByText("launch blew up")).toBeTruthy();
  });

  it("disables launch and surfaces a readiness issue when no samples are eligible", async () => {
    // A sample with no reads is not eligible for a reads-required pipeline.
    const noReadSamples: React.ComponentProps<typeof StudyPipelinesSection>["samples"] = [
      {
        ...samples[0],
        reads: [],
      },
    ];
    mocks.useSWR.mockImplementation(makeSwr({ runs: [] }));

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={noReadSamples}
        selectedPipelineId="metaxpath"
      />
    );

    const startButton = await screen.findByRole("button", { name: "Start Pipeline" });
    await waitFor(() => {
      expect(startButton.hasAttribute("disabled")).toBe(true);
    });
    // The sample row flags the missing reads issue.
    expect(screen.getByText("Missing reads")).toBeTruthy();
    expect(screen.getByText("No reads")).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // System-readiness header button branches
  // ---------------------------------------------------------------------------

  it("renders the 'Checking environment' button while the initial check is pending", async () => {
    mocks.useQuickPrerequisiteStatus.mockReturnValue({
      systemReady: null,
      checkingSystem: true,
      refreshSystemReady: mocks.refreshSystemReady,
      initialCheckPending: true,
      systemBlocked: false,
    });

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    expect(await screen.findByText("Checking environment...")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start Pipeline" })).toBeNull();
  });

  it("renders the blocked-environment button and re-checks on click", async () => {
    mocks.useQuickPrerequisiteStatus.mockReturnValue({
      systemReady: { ready: false, summary: "SLURM unreachable" },
      checkingSystem: false,
      refreshSystemReady: mocks.refreshSystemReady,
      initialCheckPending: false,
      systemBlocked: true,
    });

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    const blockedButton = await screen.findByRole("button", { name: "SLURM unreachable" });
    fireEvent.click(blockedButton);
    expect(mocks.refreshSystemReady).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Non-admin behaviour
  // ---------------------------------------------------------------------------

  it("hides the execution target control and final-run actions for non-admins", async () => {
    mocks.useSession.mockReturnValue({ data: { user: { role: "CUSTOMER" } } });
    mocks.useSWR.mockImplementation(
      makeSwr({
        runs: [
          makeRun({ id: "run-1", runNumber: "MX-001", status: "completed", isSelectedFinal: false }),
        ],
      })
    );

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    await screen.findByText("View details");
    // Admin-only execution target control is absent.
    expect(screen.queryByTestId("execution-target-control")).toBeNull();
    // "Use as final" is admin-only.
    expect(screen.queryByRole("button", { name: "Use as final" })).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Run details derivation — getStudyPipelineRunDetails branches
  // ---------------------------------------------------------------------------

  it("shows 'Completed successfully' detail for a completed run without a meaningful step", async () => {
    mocks.useSWR.mockImplementation(
      makeSwr({
        runs: [
          makeRun({
            id: "done",
            runNumber: "MX-OK",
            status: "completed",
            // Generic step that is filtered out as not meaningful.
            currentStep: "Completed",
          }),
        ],
      })
    );

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    expect(await screen.findByText("Completed successfully")).toBeTruthy();
  });

  it("surfaces an output-error detail and 'Output error' results cell for a completed run with result errors", async () => {
    mocks.useSWR.mockImplementation(
      makeSwr({
        runs: [
          makeRun({
            id: "done-err",
            runNumber: "MX-ERR",
            status: "completed",
            currentStep: null,
            results: { errors: ["assembly produced no contigs"] },
            resultFiles: [],
            primaryResultFile: null,
          }),
        ],
      })
    );

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    // Output error flows into the Details column (destructive/mono branch).
    expect(await screen.findByText("assembly produced no contigs")).toBeTruthy();
    // PipelineRunResultLinks renders the "Output error" results cell.
    expect(screen.getByText("Output error")).toBeTruthy();
  });

  it("shows a 'Waiting for execution' detail for a queued run lacking a queue summary", async () => {
    mocks.useSWR.mockImplementation(
      makeSwr({
        runs: [
          makeRun({
            id: "q",
            runNumber: "MX-Q",
            status: "queued",
            currentStep: null,
            completedAt: null,
            queueStatus: null,
          }),
        ],
      })
    );

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    expect(await screen.findByText("Waiting for execution")).toBeTruthy();
  });

  it("maps an active local-process queue state to a running display status with a 'Local process' summary", async () => {
    mocks.useSWR.mockImplementation(
      makeSwr({
        runs: [
          makeRun({
            id: "local-run",
            runNumber: "MX-LOCAL",
            status: "pending",
            currentStep: null,
            completedAt: null,
            queueStatus: "RUNNING",
            queueJobId: "local-42",
          }),
        ],
      })
    );

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    // An active RUNNING queue state overrides the stored "pending" status.
    expect((await screen.findAllByText("Running")).length).toBeGreaterThan(0);
    expect(screen.getByText(/Local process: RUNNING/)).toBeTruthy();
  });

  it("renders 'Per-sample outputs' results cell for a completed run with omitted sample files", async () => {
    mocks.useSWR.mockImplementation(
      makeSwr({
        runs: [
          {
            ...makeRun({
              id: "persample",
              runNumber: "MX-PS",
              status: "completed",
              resultFiles: [],
              primaryResultFile: null,
            }),
            resultFilesOmittedSampleFileCount: 3,
          },
        ],
      })
    );

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    expect(await screen.findByText("Per-sample outputs")).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // Sample table — read files, source link, user display, sample count guards
  // ---------------------------------------------------------------------------

  it("renders paired-end read badge, an order source link, and the sample count for a run", async () => {
    const pairedSamples: React.ComponentProps<typeof StudyPipelinesSection>["samples"] = [
      {
        id: "sample-a",
        sampleId: "SAMPLE_A",
        sampleAlias: "Alias A",
        reads: [
          {
            id: "read-a",
            file1: "/data/SAMPLE_A_R1.fastq.gz",
            file2: "/data/SAMPLE_A_R2.fastq.gz",
            checksum1: "c1",
            checksum2: "c2",
          },
        ],
        order: {
          id: "order-1",
          orderNumber: "ORD-7",
          name: "Order Seven",
          status: "completed",
        },
        preferredAssemblyId: null,
        assemblies: [],
        bins: [],
      },
    ];
    mocks.useSWR.mockImplementation(
      makeSwr({
        runs: [
          makeRun({
            id: "run-1",
            runNumber: "MX-001",
            status: "completed",
            inputSampleIds: JSON.stringify(["sample-a", "sample-b"]),
          }),
        ],
      })
    );

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={pairedSamples}
        selectedPipelineId="metaxpath"
      />
    );

    // Paired-end badge + alias surface in the sample table.
    expect(await screen.findByText("Paired-end")).toBeTruthy();
    expect(screen.getByText("Alias A")).toBeTruthy();
    // Order source renders as a link.
    expect(screen.getByRole("link", { name: "ORD-7" })).toBeTruthy();
    // R1/R2 file basenames render.
    expect(screen.getByText(/SAMPLE_A_R1.fastq.gz/)).toBeTruthy();
    expect(screen.getByText(/SAMPLE_A_R2.fastq.gz/)).toBeTruthy();
    // Sample count cell shows 2 from the parsed inputSampleIds.
    expect(screen.getByText("2")).toBeTruthy();
    // The user display joins first + last name.
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
  });

  it("falls back to '-' for sample count and user when run data is missing", async () => {
    mocks.useSWR.mockImplementation(
      makeSwr({
        runs: [
          makeRun({
            id: "run-1",
            runNumber: "MX-001",
            status: "completed",
            inputSampleIds: null,
            user: null,
          }),
        ],
      })
    );

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    await screen.findByText("No issues");
    // Both the sample-count cell and started-by cell collapse to "-".
    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
  });

  it("falls back to the user email when no name is set", async () => {
    mocks.useSWR.mockImplementation(
      makeSwr({
        runs: [
          makeRun({
            id: "run-1",
            runNumber: "MX-001",
            status: "completed",
            user: { firstName: null, lastName: null, email: "nameless@example.test" },
          }),
        ],
      })
    );

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    expect(await screen.findByText("nameless@example.test")).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // MAG pipeline — assembly column + metadata error issues
  // ---------------------------------------------------------------------------

  const magPipeline = {
    ...metaxPathPipeline,
    pipelineId: "mag",
    name: "MAG",
    description: "Metagenome-assembled genomes",
    category: "analysis",
  };

  it("shows the assembly column with a selectable assembly for MAG", async () => {
    const magSamples: React.ComponentProps<typeof StudyPipelinesSection>["samples"] = [
      {
        id: "sample-a",
        sampleId: "SAMPLE_A",
        sampleAlias: null,
        reads: [
          {
            id: "read-a",
            file1: "/data/SAMPLE_A.fastq.gz",
            file2: null,
            checksum1: null,
            checksum2: null,
          },
        ],
        order: null,
        preferredAssemblyId: "asm-1",
        assemblies: [
          {
            id: "asm-1",
            assemblyName: "Assembly 1",
            assemblyFile: "/data/asm1.fasta",
            createdByPipelineRunId: "prun-1",
            createdByPipelineRun: {
              id: "prun-1",
              runNumber: "MAG-001",
              status: "completed",
              createdAt: "2026-05-01T00:00:00.000Z",
              completedAt: "2026-05-01T01:00:00.000Z",
            },
          },
        ],
        bins: [],
      },
    ];
    mocks.useSWR.mockImplementation(makeSwr({ pipelines: [magPipeline], runs: [] }));

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={magSamples}
        selectedPipelineId="mag"
      />
    );

    // The Assembly column header renders for MAG.
    expect(await screen.findByText("Assembly")).toBeTruthy();
    // The "Auto (latest)" option and the named assembly option appear.
    expect(screen.getByText("Auto (latest)")).toBeTruthy();
    expect(screen.getByText(/MAG-001 - asm1.fasta/)).toBeTruthy();
  });

  it("changing the preferred assembly persists the selection via the API", async () => {
    const magSamples: React.ComponentProps<typeof StudyPipelinesSection>["samples"] = [
      {
        id: "sample-a",
        sampleId: "SAMPLE_A",
        sampleAlias: null,
        reads: [
          {
            id: "read-a",
            file1: "/data/SAMPLE_A.fastq.gz",
            file2: null,
            checksum1: null,
            checksum2: null,
          },
        ],
        order: null,
        preferredAssemblyId: null,
        assemblies: [
          {
            id: "asm-1",
            assemblyName: "Assembly 1",
            assemblyFile: "/data/asm1.fasta",
            createdByPipelineRunId: "prun-1",
            createdByPipelineRun: {
              id: "prun-1",
              runNumber: "MAG-001",
              status: "completed",
              createdAt: "2026-05-01T00:00:00.000Z",
              completedAt: "2026-05-01T01:00:00.000Z",
            },
          },
        ],
        bins: [],
      },
    ];
    mocks.useSWR.mockImplementation(makeSwr({ pipelines: [magPipeline], runs: [] }));

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={magSamples}
        selectedPipelineId="mag"
      />
    );

    // Click the assembly option (mocked Select forwards data-value to onValueChange).
    fireEvent.click(await screen.findByText(/MAG-001 - asm1.fasta/));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/samples/sample-a/preferred-assembly",
        expect.objectContaining({ method: "PUT" })
      );
    });
  });

  it("reports a MAG metadata error issue inline", async () => {
    mocks.useSWR.mockImplementation(makeSwr({ pipelines: [magPipeline], runs: [] }));
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/settings/pipelines/check-prerequisites")) {
        return Promise.resolve(jsonResponse({ requiredPassed: true, checks: [], summary: "Ready" }));
      }
      if (url.includes("/api/pipelines/validate-metadata")) {
        return Promise.resolve(
          jsonResponse({
            valid: false,
            issues: [
              { field: "studyMeta", message: "Study is missing a description.", severity: "error" },
            ],
            metadata: {},
          })
        );
      }
      return Promise.resolve(jsonResponse({}));
    });

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="mag"
      />
    );

    // The study-level metadata warning notice surfaces the error.
    expect(await screen.findByText("Metadata needs attention")).toBeTruthy();
    expect(screen.getAllByText("Study is missing a description.").length).toBeGreaterThan(0);
    // Launch is blocked because of the metadata error.
    const startButton = screen.getByRole("button", { name: "Start Pipeline" });
    await waitFor(() => {
      expect(startButton.hasAttribute("disabled")).toBe(true);
    });
  });

  it("renders a study metadata warning with a Fix link", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/settings/pipelines/check-prerequisites")) {
        return Promise.resolve(jsonResponse({ requiredPassed: true, checks: [], summary: "Ready" }));
      }
      if (url.includes("/api/pipelines/validate-metadata")) {
        return Promise.resolve(
          jsonResponse({
            valid: false,
            issues: [
              {
                field: "studyMeta",
                message: "Study warning needing attention.",
                severity: "warning",
                fixUrl: "/studies/study-1/edit",
              },
            ],
            metadata: {},
          })
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    mocks.useSWR.mockImplementation(makeSwr({ runs: [] }));

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    expect(await screen.findByText("Study warning needing attention.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Fix/ })).toBeTruthy();
  });

  it("renders per-sample metadata error and warning rows in the sample table", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/settings/pipelines/check-prerequisites")) {
        return Promise.resolve(jsonResponse({ requiredPassed: true, checks: [], summary: "Ready" }));
      }
      if (url.includes("/api/pipelines/validate-metadata")) {
        return Promise.resolve(
          jsonResponse({
            valid: false,
            issues: [
              {
                field: "sampleMetadata",
                message: "Sample SAMPLE_A is missing a tax id.",
                severity: "error",
                fixUrl: "/samples/sample-a",
              },
              {
                field: "sampleMetadata",
                message: "Sample SAMPLE_A has an unusual collection date.",
                severity: "warning",
              },
            ],
            metadata: {},
          })
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    mocks.useSWR.mockImplementation(makeSwr({ runs: [] }));

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    // The per-sample error renders in the Issues cell with a Fix link.
    expect(await screen.findByText("Sample SAMPLE_A is missing a tax id.")).toBeTruthy();
    expect(
      screen.getByText("Sample SAMPLE_A has an unusual collection date.")
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: /Fix/ })).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // SubMG pipeline — coverage summary, checksum compute, ENA target
  // ---------------------------------------------------------------------------

  const submgPipeline = {
    ...metaxPathPipeline,
    pipelineId: "submg",
    name: "SubMG",
    description: "ENA submission",
    category: "submission",
    config: { ...metaxPathPipeline.config, submitBins: true },
    defaultConfig: { ...metaxPathPipeline.defaultConfig, submitBins: true },
    input: {
      perSample: {
        reads: true,
        pairedEnd: true,
        readMode: "paired_only" as const,
      },
    },
  };

  function submgSwr(runs: unknown[] = [], enaTestMode?: boolean) {
    const base = makeSwr({ pipelines: [submgPipeline], runs });
    return (url: string | null) => {
      if (typeof url === "string" && url.includes("/api/admin/settings/ena")) {
        return {
          data: typeof enaTestMode === "boolean" ? { enaTestMode } : undefined,
          isLoading: false,
          mutate: vi.fn(),
        };
      }
      return base(url);
    };
  }

  it("shows the SubMG coverage summary, missing-required flags, and an assembly issue", async () => {
    const submgSamples: React.ComponentProps<typeof StudyPipelinesSection>["samples"] = [
      {
        id: "sample-a",
        sampleId: "SAMPLE_A",
        sampleAlias: null,
        // Single-ended reads: SubMG needs paired reads, so paired-reads check fails.
        reads: [
          {
            id: "read-a",
            file1: "/data/SAMPLE_A_R1.fastq.gz",
            file2: "/data/SAMPLE_A_R2.fastq.gz",
            checksum1: "c1",
            checksum2: "c2",
          },
        ],
        order: null,
        preferredAssemblyId: null,
        // No assemblies -> assemblies check fails -> blocking.
        assemblies: [],
        bins: [],
      },
    ];
    mocks.useSWR.mockImplementation(submgSwr([]));

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={submgSamples}
        selectedPipelineId="submg"
      />
    );

    // The coverage summary line renders (blocking -> amber styling branch).
    expect(
      await screen.findByText(/required inputs available for selected samples/)
    ).toBeTruthy();
    // Missing assemblies are flagged in the sample issues cell.
    expect(screen.getByText(/Missing:/)).toBeTruthy();
  });

  it("flags a missing study accession for SubMG", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/settings/pipelines/check-prerequisites")) {
        return Promise.resolve(jsonResponse({ requiredPassed: true, checks: [], summary: "Ready" }));
      }
      if (url.includes("/api/pipelines/validate-metadata")) {
        return Promise.resolve(
          jsonResponse({
            valid: false,
            issues: [
              {
                field: "studyAccessionId",
                message: "Study accession is required.",
                severity: "error",
              },
            ],
            metadata: {},
          })
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    mocks.useSWR.mockImplementation(submgSwr([]));

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="submg"
      />
    );

    expect(
      await screen.findByText("Study accession is missing. Register in Publishing first.")
    ).toBeTruthy();
  });

  it("shows the ENA test-server target line for SubMG when test mode is on", async () => {
    mocks.useSWR.mockImplementation(submgSwr([], true));

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="submg"
      />
    );

    expect(
      await screen.findByText(/ENA target: Test server \(wwwdev.ebi.ac.uk\)/)
    ).toBeTruthy();
    expect(screen.getByText(/test submission mode/)).toBeTruthy();
  });

  it("shows the ENA production-server target line for SubMG when test mode is off", async () => {
    mocks.useSWR.mockImplementation(submgSwr([], false));

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="submg"
      />
    );

    expect(
      await screen.findByText(/ENA target: Production server \(www.ebi.ac.uk\)/)
    ).toBeTruthy();
  });

  it("offers a compute-checksums action for SubMG when reads lack checksums", async () => {
    const noChecksumSamples: React.ComponentProps<typeof StudyPipelinesSection>["samples"] = [
      {
        id: "sample-a",
        sampleId: "SAMPLE_A",
        sampleAlias: null,
        reads: [
          {
            id: "read-a",
            file1: "/data/SAMPLE_A_R1.fastq.gz",
            file2: "/data/SAMPLE_A_R2.fastq.gz",
            checksum1: null,
            checksum2: null,
          },
        ],
        order: null,
        preferredAssemblyId: null,
        assemblies: [],
        bins: [],
      },
    ];
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/settings/pipelines/check-prerequisites")) {
        return Promise.resolve(jsonResponse({ requiredPassed: true, checks: [], summary: "Ready" }));
      }
      if (url.includes("/api/pipelines/validate-metadata")) {
        return Promise.resolve(jsonResponse({ valid: true, issues: [], metadata: {} }));
      }
      if (url.includes("/api/files/checksum")) {
        return Promise.resolve(
          jsonResponse({
            summary: { total: 2, successful: 2, failed: 0, updatedReadRecords: 2, notLinkedToRead: 0 },
            results: [
              { filePath: "/data/SAMPLE_A_R1.fastq.gz", checksum: "abc" },
              { filePath: "/data/SAMPLE_A_R2.fastq.gz", checksum: "def" },
            ],
          })
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    mocks.useSWR.mockImplementation(submgSwr([]));

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={noChecksumSamples}
        selectedPipelineId="submg"
      />
    );

    const computeButton = await screen.findByRole("button", { name: /Compute checksums \(2\)/ });
    fireEvent.click(computeButton);

    // The checksum result message surfaces after the batch call resolves.
    expect(await screen.findByText(/Calculated MD5 for 2\/2 read files\./)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/files/checksum",
      expect.objectContaining({ method: "POST" })
    );
  });

  // ---------------------------------------------------------------------------
  // Category filter + URL-driven pipeline auto-selection
  // ---------------------------------------------------------------------------

  it("auto-selects the first enabled pipeline when the requested id is unknown", async () => {
    mocks.useSWR.mockImplementation(makeSwr({ runs: [] }));

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="does-not-exist"
      />
    );

    // Falls back to the first enabled pipeline (MetaxPath) header.
    expect(await screen.findByText("MetaxPath")).toBeTruthy();
  });

  it("excludes submission pipelines when categoryFilter is 'analysis'", () => {
    mocks.useSWR.mockImplementation(
      makeSwr({ pipelines: [metaxPathPipeline, submgPipeline], runs: [] })
    );

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        categoryFilter="analysis"
      />
    );

    // Overview mode lists only the analysis pipeline; submission is filtered out.
    expect(screen.getByText("MetaxPath")).toBeTruthy();
    expect(screen.queryByText("SubMG")).toBeNull();
  });

  it("includes only submission pipelines when categoryFilter is 'submission'", () => {
    mocks.useSWR.mockImplementation(
      makeSwr({ pipelines: [metaxPathPipeline, submgPipeline], runs: [] })
    );

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        categoryFilter="submission"
      />
    );

    expect(screen.getByText("SubMG")).toBeTruthy();
    expect(screen.queryByText("MetaxPath")).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Overview mode — queued aggregate badge + per-pipeline run counts
  // ---------------------------------------------------------------------------

  it("shows a 'Queued' aggregate badge and completed/failed counts in overview mode", () => {
    mocks.useSWR.mockImplementation(
      makeSwr({
        runs: [
          // An active queued run (no running) -> queued aggregate badge.
          makeRun({
            id: "queued",
            status: "pending",
            queueStatus: "PENDING",
            queueJobId: "9",
            completedAt: null,
          } as RunOverrides),
          makeRun({ id: "done", status: "completed" } as RunOverrides),
          makeRun({ id: "fail", status: "failed", completedAt: null } as RunOverrides),
        ],
      })
    );

    render(<StudyPipelinesSection studyId="study-1" samples={samples} />);

    // Queued aggregate badge wins when there is no running run.
    expect(screen.getByText("Queued")).toBeTruthy();
    // Completed + failed counts render in the card footer.
    expect(screen.getByText("1 completed")).toBeTruthy();
    expect(screen.getByText("1 failed")).toBeTruthy();
    expect(screen.getByText("3 runs total")).toBeTruthy();
    // A "Last run" relative-time chip renders for a pipeline with runs.
    expect(screen.getByText(/Last run:/)).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // Bulk delete cancel + delete-dialog cancel paths
  // ---------------------------------------------------------------------------

  it("cancels the bulk delete confirmation dialog without deleting", async () => {
    mocks.useSWR.mockImplementation(
      makeSwr({
        runs: [makeRun({ id: "run-1", runNumber: "MX-001", status: "completed" })],
      })
    );

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByLabelText("Select all runs"));
    fireEvent.click(screen.getByRole("button", { name: /Delete$/ }));
    expect(screen.getByText("Delete 1 run?")).toBeTruthy();

    // Cancel closes the dialog; no delete call is issued. Scope to the dialog
    // because the select-mode toolbar also renders a "Cancel" button.
    const dialog = screen.getByTestId("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByText("Delete 1 run?")).toBeNull();
    });
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/pipelines/runs/run-1/delete",
      { method: "POST" }
    );
  });

  it("cancels the single-run delete dialog without deleting", async () => {
    mocks.useSWR.mockImplementation(
      makeSwr({
        runs: [makeRun({ id: "run-1", runNumber: "MX-001", status: "completed" })],
      })
    );

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Delete run" }));
    expect(screen.getByText("Delete run MX-001?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByText("Delete run MX-001?")).toBeNull();
    });
  });

  it("surfaces an error when a final-run selection update fails", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/pipelines/runs/run-1/selection") {
        return Promise.resolve(jsonResponse({ error: "selection failed" }, false));
      }
      if (url.includes("/api/pipelines/validate-metadata")) {
        return Promise.resolve(jsonResponse({ valid: true, issues: [], metadata: {} }));
      }
      if (url.includes("/api/admin/settings/pipelines/check-prerequisites")) {
        return Promise.resolve(jsonResponse({ requiredPassed: true, checks: [], summary: "Ready" }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    mocks.useSWR.mockImplementation(
      makeSwr({
        runs: [
          makeRun({ id: "run-1", runNumber: "MX-001", status: "completed", isSelectedFinal: false }),
        ],
      })
    );

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Use as final" }));

    expect(await screen.findByText("selection failed")).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // Failed run output-errors + selectable runs in select mode (running excluded)
  // ---------------------------------------------------------------------------

  it("formats an hour-plus run duration for a completed run", async () => {
    mocks.useSWR.mockImplementation(
      makeSwr({
        runs: [
          makeRun({
            id: "long-run",
            runNumber: "MX-LONG",
            status: "completed",
            startedAt: "2026-05-20T10:00:00.000Z",
            completedAt: "2026-05-20T12:30:00.000Z",
          }),
        ],
      })
    );

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    // 2h 30m duration exercises the hours branch of formatDuration.
    expect(await screen.findByText("2h 30m")).toBeTruthy();
  });

  it("aggregates a 'details' array into the start-pipeline error banner", async () => {
    mocks.useSWR.mockImplementation(makeSwr({ runs: [] }));
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/pipelines/runs") {
        return Promise.resolve(
          jsonResponse({ error: "validation", details: ["first problem", "second problem"] }, false)
        );
      }
      if (url.includes("/api/pipelines/validate-metadata")) {
        return Promise.resolve(jsonResponse({ valid: true, issues: [], metadata: {} }));
      }
      if (url.includes("/api/admin/settings/pipelines/check-prerequisites")) {
        return Promise.resolve(jsonResponse({ requiredPassed: true, checks: [], summary: "Ready" }));
      }
      return Promise.resolve(jsonResponse({}));
    });

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    const startButton = await screen.findByRole("button", { name: "Start Pipeline" });
    await waitFor(() => {
      expect(startButton.hasAttribute("disabled")).toBe(false);
    });
    fireEvent.click(startButton);

    // The details array is joined with newlines into the error banner body.
    expect(await screen.findByText(/first problem/)).toBeTruthy();
    expect(screen.getByText(/second problem/)).toBeTruthy();
  });

  it("blocks launch with a system-prerequisites readiness issue when the server check fails", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/settings/pipelines/check-prerequisites")) {
        return Promise.resolve(
          jsonResponse({ requiredPassed: false, checks: [], summary: "Missing tool: kraken2" })
        );
      }
      if (url.includes("/api/pipelines/validate-metadata")) {
        return Promise.resolve(jsonResponse({ valid: true, issues: [], metadata: {} }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    mocks.useSWR.mockImplementation(makeSwr({ runs: [] }));

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    const startButton = await screen.findByRole("button", { name: "Start Pipeline" });
    await waitFor(() => {
      expect(startButton.hasAttribute("disabled")).toBe(true);
    });
    // The failed server prerequisite is surfaced as the disabled-button title.
    expect(startButton.getAttribute("title")).toContain(
      "System requirements not met: Missing tool: kraken2"
    );
  });

  it("ignores prerequisite/metadata fetch failures and still renders the workspace", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/settings/pipelines/check-prerequisites")) {
        return Promise.reject(new Error("network down"));
      }
      if (url.includes("/api/pipelines/validate-metadata")) {
        return Promise.reject(new Error("network down"));
      }
      return Promise.resolve(jsonResponse({}));
    });
    mocks.useSWR.mockImplementation(makeSwr({ runs: [] }));

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    // The catch + finally path clears loading and the Start button settles.
    expect(await screen.findByRole("button", { name: "Start Pipeline" })).toBeTruthy();
  });

  it("surfaces per-sample missing metadata fields in the SubMG coverage summary", async () => {
    const submgSamples: React.ComponentProps<typeof StudyPipelinesSection>["samples"] = [
      {
        id: "sample-a",
        sampleId: "SAMPLE_A",
        sampleAlias: null,
        reads: [
          {
            id: "read-a",
            file1: "/data/SAMPLE_A_R1.fastq.gz",
            file2: "/data/SAMPLE_A_R2.fastq.gz",
            checksum1: "c1",
            checksum2: "c2",
          },
        ],
        order: null,
        preferredAssemblyId: "asm-1",
        assemblies: [
          {
            id: "asm-1",
            assemblyName: "Assembly 1",
            assemblyFile: "/data/asm1.fasta",
            createdByPipelineRunId: "prun-1",
            createdByPipelineRun: {
              id: "prun-1",
              runNumber: "MAG-001",
              status: "completed",
              createdAt: "2026-05-01T00:00:00.000Z",
              completedAt: "2026-05-01T01:00:00.000Z",
            },
          },
        ],
        bins: [],
      },
    ];
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/settings/pipelines/check-prerequisites")) {
        return Promise.resolve(jsonResponse({ requiredPassed: true, checks: [], summary: "Ready" }));
      }
      if (url.includes("/api/pipelines/validate-metadata")) {
        return Promise.resolve(
          jsonResponse({
            valid: false,
            issues: [
              {
                field: "sampleMetadata",
                message:
                  "Sample SAMPLE_A is missing required metadata fields for SubMG: collection date, geographic location",
                severity: "error",
              },
            ],
            metadata: {},
          })
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    mocks.useSWR.mockImplementation(submgSwr([]));

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={submgSamples}
        selectedPipelineId="submg"
      />
    );

    // The Sample metadata check renders the missing field detail in its row.
    expect(
      await screen.findByText(/Missing: Sample metadata \(collection date, geographic location\)/)
    ).toBeTruthy();
  });

  it("excludes running runs from select-all but allows other statuses", async () => {
    mocks.useSWR.mockImplementation(
      makeSwr({
        runs: [
          makeRun({ id: "run-done", runNumber: "MX-DONE", status: "completed" }),
          makeRun({
            id: "run-running",
            runNumber: "MX-RUN",
            status: "running",
            progress: 10,
            completedAt: null,
          }),
        ],
      })
    );

    render(
      <StudyPipelinesSection
        studyId="study-1"
        samples={samples}
        selectedPipelineId="metaxpath"
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByLabelText("Select all runs"));

    // Only the non-running run is selectable, so the count is 1.
    expect(screen.getByText("1 selected")).toBeTruthy();
    // The running row checkbox is disabled.
    const runningCheckbox = screen.getByLabelText("Select run MX-RUN") as HTMLInputElement;
    expect(runningCheckbox.disabled).toBe(true);
  });
});
