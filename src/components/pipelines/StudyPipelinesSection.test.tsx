// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
    mocks.useSWR.mockImplementation((url: string | null) => {
      if (typeof url !== "string") {
        return { data: undefined, isLoading: false, mutate: vi.fn() };
      }
      if (url.includes("/api/admin/settings/pipelines")) {
        return {
          data: { pipelines: [metaxPathPipeline] },
          isLoading: false,
          mutate: vi.fn(),
        };
      }
      if (url.includes("/api/pipelines/runs")) {
        return { data: { runs: [], total: 0 }, isLoading: false, mutate: vi.fn() };
      }
      return { data: undefined, isLoading: false, mutate: vi.fn() };
    });
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
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

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
    mocks.useSWR.mockImplementation((url: string | null) => {
      if (typeof url !== "string") {
        return { data: undefined, isLoading: false, mutate: vi.fn() };
      }
      if (url.includes("/api/admin/settings/pipelines")) {
        return {
          data: { pipelines: [metaxPathPipeline] },
          isLoading: false,
          mutate: vi.fn(),
        };
      }
      if (url.includes("/api/pipelines/runs")) {
        return {
          data: {
            runs: [
              {
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
                isSelectedFinal: true,
                selectedFinal: null,
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
                createdAt: "2026-05-20T10:00:00.000Z",
                startedAt: "2026-05-20T10:00:00.000Z",
                completedAt: "2026-05-20T10:05:00.000Z",
                user: null,
                _count: { assembliesCreated: 0, binsCreated: 0 },
              },
            ],
            total: 1,
          },
          isLoading: false,
          mutate: vi.fn(),
        };
      }
      return { data: undefined, isLoading: false, mutate: vi.fn() };
    });

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
});
