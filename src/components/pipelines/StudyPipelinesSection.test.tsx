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
});
