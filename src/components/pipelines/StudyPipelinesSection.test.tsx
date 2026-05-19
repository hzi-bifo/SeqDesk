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

const metaxPathPipeline = {
  pipelineId: "metaxpath",
  name: "MetaxPath",
  description: "ONT metagenomics",
  icon: "Dna",
  enabled: true,
  version: "0.1.3",
  category: "analysis",
  config: {},
  defaultConfig: {},
  configSchema: {
    properties: {},
  },
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
});
