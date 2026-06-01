// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useSWR: vi.fn(),
  useSession: vi.fn(),
  useQuickPrerequisiteStatus: vi.fn(),
  useSlurmAvailability: vi.fn(),
  getExecutionTargetBlockMessage: vi.fn(),
  isExecutionTargetBlocked: vi.fn(),
}));

vi.mock("swr", () => ({
  default: mocks.useSWR,
}));

vi.mock("next-auth/react", () => ({
  useSession: mocks.useSession,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/pipelines/useQuickPrerequisiteStatus", () => ({
  useQuickPrerequisiteStatus: mocks.useQuickPrerequisiteStatus,
}));

vi.mock("./ExecutionTargetControl", () => ({
  ExecutionTargetControl: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <div data-testid="execution-target-control">
      <button type="button" onClick={() => onChange("slurm")}>
        choose-slurm
      </button>
      <span>mode:{value}</span>
    </div>
  ),
  getExecutionTargetBlockMessage: mocks.getExecutionTargetBlockMessage,
  isExecutionTargetBlocked: mocks.isExecutionTargetBlocked,
  useSlurmAvailability: mocks.useSlurmAvailability,
}));

// Radix Dialog/Checkbox/Collapsible rely on portals + pointer APIs that JSDOM
// does not implement. Replace them with light DOM stand-ins (matching
// StudyPipelinesSection.test.tsx) so we can drive the interactions.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    id,
    checked,
    disabled,
    onCheckedChange,
  }: {
    id?: string;
    checked?: boolean;
    disabled?: boolean;
    onCheckedChange?: (checked: boolean) => void;
  }) => (
    <input
      type="checkbox"
      id={id}
      checked={Boolean(checked)}
      disabled={disabled}
      onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
    />
  ),
}));

vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CollapsibleTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  CollapsibleContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { RunPipelineSection } from "./RunPipelineSection";

function jsonResponse(payload: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => payload,
  } as Response;
}

type Pipeline = {
  pipelineId: string;
  name: string;
  description: string;
  icon: string;
  enabled: boolean;
  config?: Record<string, unknown>;
  configSchema: { properties: Record<string, unknown> };
  defaultConfig: Record<string, unknown>;
  executionPolicy?: { mode: string; source: string };
};

const magPipeline: Pipeline = {
  pipelineId: "mag",
  name: "MAG",
  description: "Metagenome-assembled genomes assembly and binning pipeline run",
  icon: "Dna",
  enabled: true,
  config: { resume: true, threads: 8 },
  defaultConfig: { resume: true, threads: 8 },
  configSchema: {
    properties: {
      resume: {
        type: "boolean",
        title: "Resume",
        description: "Resume from last checkpoint",
      },
      mode: {
        type: "string",
        title: "Mode",
      },
      threads: {
        type: "number",
        title: "Threads",
        description: "Number of threads",
      },
    },
  },
  executionPolicy: { mode: "local", source: "global" },
};

const submgPipeline: Pipeline = {
  pipelineId: "submg",
  name: "SubMG",
  description: "Short",
  icon: "Upload",
  enabled: true,
  config: {},
  defaultConfig: {},
  configSchema: { properties: {} },
};

type Sample = React.ComponentProps<typeof RunPipelineSection>["samples"][number];

const samples: Sample[] = [
  {
    id: "sample-a",
    sampleId: "SAMPLE_A",
    reads: [{ id: "read-a", file1: "/data/a_1.fq.gz", file2: "/data/a_2.fq.gz" }],
  },
  {
    id: "sample-b",
    sampleId: "SAMPLE_B",
    reads: [{ id: "read-b", file1: "/data/b_1.fq.gz", file2: "/data/b_2.fq.gz" }],
  },
];

const samplesNoReads: Sample[] = [
  {
    id: "sample-x",
    sampleId: "SAMPLE_X",
    reads: [{ id: "read-x", file1: null, file2: null }],
  },
];

function makeSwr(pipelines: Pipeline[] | undefined) {
  return (url: string) => {
    if (url.includes("/api/admin/settings/pipelines")) {
      return { data: pipelines === undefined ? undefined : { pipelines } };
    }
    return { data: undefined };
  };
}

/**
 * Default fetch handler: prereqs pass, metadata valid.
 */
function defaultFetch(input: RequestInfo | URL) {
  const url = String(input);
  if (url.includes("/api/admin/settings/pipelines/check-prerequisites")) {
    return Promise.resolve(
      jsonResponse({ requiredPassed: true, allPassed: true, checks: [], summary: "All good" })
    );
  }
  if (url.includes("/api/pipelines/validate-metadata")) {
    return Promise.resolve(
      jsonResponse({ valid: true, issues: [], metadata: { platform: "ILLUMINA" } })
    );
  }
  return Promise.resolve(jsonResponse({}));
}

describe("RunPipelineSection", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useSession.mockReturnValue({ data: { user: { role: "CUSTOMER" } } });
    mocks.useQuickPrerequisiteStatus.mockReturnValue({
      systemReady: { ready: true, summary: "Ready" },
      checkingSystem: false,
    });
    mocks.useSlurmAvailability.mockReturnValue({
      slurmAvailability: { success: true, message: "ok" },
      slurmAvailabilityLoading: false,
      slurmAvailabilityError: null,
    });
    mocks.getExecutionTargetBlockMessage.mockReturnValue(null);
    mocks.isExecutionTargetBlocked.mockReturnValue(false);
    mocks.useSWR.mockImplementation(makeSwr([magPipeline]));
    fetchMock.mockImplementation(defaultFetch);
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  // ---------------------------------------------------------------------------
  // Top-level render branches
  // ---------------------------------------------------------------------------

  it("renders nothing when no pipelines are enabled", () => {
    mocks.useSWR.mockImplementation(makeSwr([]));
    const { container } = render(<RunPipelineSection studyId="study-1" samples={samples} />);
    expect(container.firstChild).toBeNull();
  });

  it("treats undefined SWR data as no enabled pipelines", () => {
    mocks.useSWR.mockImplementation(makeSwr(undefined));
    const { container } = render(<RunPipelineSection studyId="study-1" samples={samples} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the checking-system state", async () => {
    mocks.useQuickPrerequisiteStatus.mockReturnValue({
      systemReady: null,
      checkingSystem: true,
    });
    render(<RunPipelineSection studyId="study-1" samples={samples} />);
    expect(screen.getByText("Checking system...")).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it("shows the system-not-ready warning with a configure link", async () => {
    mocks.useQuickPrerequisiteStatus.mockReturnValue({
      systemReady: { ready: false, summary: "Nextflow missing" },
      checkingSystem: false,
    });
    render(<RunPipelineSection studyId="study-1" samples={samples} />);
    expect(screen.getByText("Nextflow missing")).toBeTruthy();
    expect(screen.getByText("Configure in Admin Settings")).toBeTruthy();
    // The pipeline launch buttons are not rendered while blocked.
    expect(screen.queryByRole("button", { name: /MAG/ })).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it("renders the icon variants (Dna, Upload, default)", async () => {
    const defaultIcon: Pipeline = { ...submgPipeline, pipelineId: "other", icon: "Something", name: "Other" };
    mocks.useSWR.mockImplementation(makeSwr([magPipeline, submgPipeline, defaultIcon]));
    const { container } = render(<RunPipelineSection studyId="study-1" samples={samples} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container.querySelector("svg.lucide-dna")).toBeTruthy();
    expect(container.querySelector("svg.lucide-upload")).toBeTruthy();
    expect(container.querySelector("svg.lucide-flask-conical")).toBeTruthy();
  });

  it("truncates long descriptions and shows the paired-reads count", async () => {
    render(<RunPipelineSection studyId="study-1" samples={samples} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText("2 of 2 samples have paired reads")).toBeTruthy();
    // The long MAG description (>40 chars) is truncated with an ellipsis.
    expect(screen.getByText(/\.\.\.$/)).toBeTruthy();
  });

  it("shows the no-paired-reads hint when ready but no eligible samples", async () => {
    render(<RunPipelineSection studyId="study-1" samples={samplesNoReads} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(
      screen.getByText(/No samples have paired-end reads assigned/)
    ).toBeTruthy();
    // MAG requires reads -> disabled.
    expect(screen.getByRole("button", { name: /MAG/ }).hasAttribute("disabled")).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Metadata precheck effect
  // ---------------------------------------------------------------------------

  it("renders precheck error and warning summaries with a fix link", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/settings/pipelines/check-prerequisites")) {
        return Promise.resolve(jsonResponse({ requiredPassed: true, checks: [], summary: "ok" }));
      }
      if (url.includes("/api/pipelines/validate-metadata")) {
        return Promise.resolve(
          jsonResponse({
            valid: false,
            metadata: {},
            issues: [
              { field: "platform", message: "Platform missing", severity: "error", fixUrl: "/fix-platform" },
              { field: "model", message: "Model is a guess", severity: "warning" },
            ],
          })
        );
      }
      return Promise.resolve(jsonResponse({}));
    });

    render(<RunPipelineSection studyId="study-1" samples={samples} />);

    expect(await screen.findByText("Platform missing")).toBeTruthy();
    expect(screen.getByText("Model is a guess")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Fix/ }).getAttribute("href")).toBe("/fix-platform");
    // Metadata error disables the MAG launch button.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /MAG/ }).hasAttribute("disabled")).toBe(true);
    });
  });

  it("renders nothing extra when precheck reports no issues", async () => {
    render(<RunPipelineSection studyId="study-1" samples={samples} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // No issue rows -> launch enabled.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /MAG/ }).hasAttribute("disabled")).toBe(false);
    });
  });

  it("ignores precheck fetch failures", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/pipelines/validate-metadata")) {
        return Promise.reject(new Error("network down"));
      }
      return defaultFetch(input);
    });
    render(<RunPipelineSection studyId="study-1" samples={samples} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // submg without metadata defaults to having errors (disabled); mag without
    // a precheck result falls back to canRunMag = true.
    expect(screen.getByRole("button", { name: /MAG/ })).toBeTruthy();
  });

  it("disables submg by default when precheck is not ok", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/pipelines/validate-metadata")) {
        // res.ok=false -> no precheck entry recorded for submg
        return Promise.resolve(jsonResponse({}, false));
      }
      return defaultFetch(input);
    });
    mocks.useSWR.mockImplementation(makeSwr([submgPipeline]));
    render(<RunPipelineSection studyId="study-1" samples={samples} />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /SubMG/ }).hasAttribute("disabled")).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Run dialog open + prerequisites
  // ---------------------------------------------------------------------------

  async function openDialog(pipeline = magPipeline) {
    render(<RunPipelineSection studyId="study-1" samples={samples} />);
    const button = await screen.findByRole("button", { name: new RegExp(pipeline.name) });
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    fireEvent.click(button);
    await screen.findByTestId("dialog");
  }

  it("opens the dialog and shows passing prerequisites collapsed", async () => {
    await openDialog();
    expect(screen.getByText("Run MAG")).toBeTruthy();
    expect(await screen.findByText("System Requirements")).toBeTruthy();
    expect(screen.getByText("All good")).toBeTruthy();
    // Sample selection lists both eligible samples, pre-selected.
    expect(screen.getByText(/2 selected/)).toBeTruthy();
    expect(screen.getByText("SAMPLE_A")).toBeTruthy();
    expect(screen.getByText("SAMPLE_B")).toBeTruthy();
  });

  it("auto-expands prerequisites and lists failing/required checks when required checks fail", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/settings/pipelines/check-prerequisites")) {
        return Promise.resolve(
          jsonResponse({
            requiredPassed: false,
            allPassed: false,
            summary: "Issues found",
            checks: [
              { id: "c1", name: "Nextflow", description: "", status: "fail", message: "not installed", required: true },
              { id: "c2", name: "Disk", description: "", status: "warning", message: "low space", required: false },
              { id: "c3", name: "Java", description: "", status: "pass", message: "ok", required: true },
              { id: "c4", name: "Skip", description: "", status: "pass", message: "ignored", required: false },
            ],
          })
        );
      }
      return defaultFetch(input);
    });

    await openDialog();

    // fail / warning / required-pass checks render; the non-required pass is filtered out.
    expect(await screen.findByText("Nextflow")).toBeTruthy();
    expect(screen.getByText("not installed")).toBeTruthy();
    expect(screen.getByText("Disk")).toBeTruthy();
    expect(screen.getByText("Java")).toBeTruthy();
    expect(screen.queryByText("Skip")).toBeNull();
    // "required" tag appears for the failing required check.
    expect(screen.getByText("required")).toBeTruthy();
    expect(screen.getByText("Issues found")).toBeTruthy();
    // Start button disabled because required prereqs failed.
    expect(screen.getByRole("button", { name: "Start Pipeline" }).hasAttribute("disabled")).toBe(true);
  });

  it("ignores prerequisite fetch errors", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/settings/pipelines/check-prerequisites")) {
        return Promise.reject(new Error("prereq boom"));
      }
      return defaultFetch(input);
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await openDialog();
    // No prerequisites block rendered, but dialog is usable.
    expect(screen.queryByText("System Requirements")).toBeNull();
    await waitFor(() => expect(errSpy).toHaveBeenCalled());
    errSpy.mockRestore();
  });

  it("handles a non-ok prerequisites response without crashing", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/settings/pipelines/check-prerequisites")) {
        return Promise.resolve(jsonResponse({}, false));
      }
      return defaultFetch(input);
    });
    await openDialog();
    expect(screen.queryByText("System Requirements")).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Metadata validation inside the dialog
  // ---------------------------------------------------------------------------

  it("shows valid study metadata with the platform label", async () => {
    await openDialog();
    expect(await screen.findByText("Study Metadata")).toBeTruthy();
    expect(screen.getByText(/Platform: ILLUMINA/)).toBeTruthy();
  });

  it("shows metadata errors and disables start", async () => {
    // The precheck call (no sampleIds) reports valid so the MAG launch button
    // stays enabled, while the in-dialog validation (with sampleIds) reports an
    // error so the Start button is disabled.
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/admin/settings/pipelines/check-prerequisites")) {
        return Promise.resolve(jsonResponse({ requiredPassed: true, checks: [], summary: "ok" }));
      }
      if (url.includes("/api/pipelines/validate-metadata")) {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        if (body.sampleIds) {
          return Promise.resolve(
            jsonResponse({
              valid: false,
              metadata: {},
              issues: [{ field: "platform", message: "Bad platform", severity: "error", fixUrl: "/fix" }],
            })
          );
        }
        return Promise.resolve(jsonResponse({ valid: true, issues: [], metadata: {} }));
      }
      return Promise.resolve(jsonResponse({}));
    });

    await openDialog();
    const dialog = screen.getByTestId("dialog");
    expect(await within(dialog).findByText("Bad platform")).toBeTruthy();
    expect(within(dialog).getByText("Study Metadata")).toBeTruthy();
    expect(within(dialog).getAllByRole("link", { name: /Fix/ }).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Start Pipeline" }).hasAttribute("disabled")).toBe(true);
    });
  });

  it("shows a warning-only metadata state without disabling start", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/settings/pipelines/check-prerequisites")) {
        return Promise.resolve(jsonResponse({ requiredPassed: true, checks: [], summary: "ok" }));
      }
      if (url.includes("/api/pipelines/validate-metadata")) {
        return Promise.resolve(
          jsonResponse({
            valid: false,
            metadata: {},
            issues: [{ field: "model", message: "Model guessed", severity: "warning" }],
          })
        );
      }
      return Promise.resolve(jsonResponse({}));
    });

    await openDialog();
    expect((await screen.findAllByText("Model guessed")).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Start Pipeline" }).hasAttribute("disabled")).toBe(false);
    });
  });

  it("clears metadata validation when all samples are deselected", async () => {
    await openDialog();
    expect(await screen.findByText("Study Metadata")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    await waitFor(() => {
      expect(screen.queryByText("Study Metadata")).toBeNull();
    });
    expect(screen.getByText(/0 selected/)).toBeTruthy();
    // Start is disabled with no samples selected.
    expect(screen.getByRole("button", { name: "Start Pipeline" }).hasAttribute("disabled")).toBe(true);
  });

  it("ignores metadata validation fetch errors inside the dialog", async () => {
    let prereqDone = false;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/settings/pipelines/check-prerequisites")) {
        prereqDone = true;
        return Promise.resolve(jsonResponse({ requiredPassed: true, checks: [], summary: "ok" }));
      }
      if (url.includes("/api/pipelines/validate-metadata")) {
        // The in-dialog validation (with sampleIds) rejects.
        return Promise.reject(new Error("metadata boom"));
      }
      return Promise.resolve(jsonResponse({}));
    });

    await openDialog();
    await waitFor(() => expect(prereqDone).toBe(true));
    // No Study Metadata block since the request rejected.
    expect(screen.queryByText("Study Metadata")).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Sample selection controls
  // ---------------------------------------------------------------------------

  it("toggles individual samples and re-selects all", async () => {
    await openDialog();
    const checkbox = screen.getByLabelText("SAMPLE_A").parentElement?.querySelector(
      "#sample-sample-a"
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    fireEvent.click(checkbox);
    await waitFor(() => expect(screen.getByText(/2 selected/)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(screen.getByText(/0 selected/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Select All" }));
    await waitFor(() => expect(screen.getByText(/2 selected/)).toBeTruthy());
  });

  // ---------------------------------------------------------------------------
  // Configuration form
  // ---------------------------------------------------------------------------

  it("renders boolean, text, and number config controls and edits them", async () => {
    await openDialog();
    expect(await screen.findByText("Configuration")).toBeTruthy();

    // boolean control with description
    expect(screen.getByLabelText("Resume")).toBeTruthy();
    expect(screen.getByText("Resume from last checkpoint")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Resume"));

    // text control (no description)
    const modeInput = screen.getByLabelText("Mode") as HTMLInputElement;
    expect(modeInput.getAttribute("type")).toBe("text");
    fireEvent.change(modeInput, { target: { value: "fast" } });
    expect(modeInput.value).toBe("fast");

    // number control with description
    const threadsInput = screen.getByLabelText("Threads") as HTMLInputElement;
    expect(threadsInput.getAttribute("type")).toBe("number");
    expect(screen.getByText("Number of threads")).toBeTruthy();
    fireEvent.change(threadsInput, { target: { value: "16" } });
    expect(threadsInput.value).toBe("16");
  });

  it("omits the configuration section when the schema has no properties", async () => {
    fetchMock.mockImplementation(defaultFetch);
    mocks.useSWR.mockImplementation(makeSwr([{ ...submgPipeline, defaultConfig: {}, config: undefined }]));
    render(<RunPipelineSection studyId="study-1" samples={samples} />);
    const button = await screen.findByRole("button", { name: /SubMG/ });
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    fireEvent.click(button);
    await screen.findByTestId("dialog");
    expect(screen.queryByText("Configuration")).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Facility admin / execution target
  // ---------------------------------------------------------------------------

  it("renders the execution target control for facility admins", async () => {
    mocks.useSession.mockReturnValue({ data: { user: { role: "FACILITY_ADMIN" } } });
    await openDialog();
    expect(await screen.findByTestId("execution-target-control")).toBeTruthy();
  });

  it("blocks the run when the execution target is blocked", async () => {
    mocks.useSession.mockReturnValue({ data: { user: { role: "FACILITY_ADMIN" } } });
    mocks.getExecutionTargetBlockMessage.mockReturnValue("SLURM unavailable: down.");
    mocks.isExecutionTargetBlocked.mockReturnValue(true);

    await openDialog();
    // The block message disables Start (executionTargetBlocked branch).
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Start Pipeline" }).hasAttribute("disabled")).toBe(true);
    });
  });

  it("surfaces the block message if Start is somehow triggered while blocked", async () => {
    mocks.useSession.mockReturnValue({ data: { user: { role: "FACILITY_ADMIN" } } });
    // Not blocked for the disabled-button computation, but isExecutionTargetBlocked
    // returns true inside handleStartRun.
    mocks.getExecutionTargetBlockMessage.mockReturnValue(null);
    mocks.isExecutionTargetBlocked.mockReturnValue(true);

    await openDialog();
    const startButton = await screen.findByRole("button", { name: "Start Pipeline" });
    await waitFor(() => expect(startButton.hasAttribute("disabled")).toBe(false));
    fireEvent.click(startButton);

    expect(
      await screen.findByText("The selected execution target is not available.")
    ).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // handleStartRun outcomes
  // ---------------------------------------------------------------------------

  function startFetch(handlers: {
    create?: () => Promise<Response>;
    start?: () => Promise<Response>;
  }) {
    return (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/settings/pipelines/check-prerequisites")) {
        return Promise.resolve(jsonResponse({ requiredPassed: true, checks: [], summary: "ok" }));
      }
      if (url.includes("/api/pipelines/validate-metadata")) {
        return Promise.resolve(jsonResponse({ valid: true, issues: [], metadata: {} }));
      }
      if (url === "/api/pipelines/runs") {
        return (handlers.create ?? (() => Promise.resolve(jsonResponse({ run: { id: "run-x", runNumber: 7 } }))))();
      }
      if (url.endsWith("/start")) {
        return (handlers.start ?? (() => Promise.resolve(jsonResponse({ runNumber: 7 }))))();
      }
      return Promise.resolve(jsonResponse({}));
    };
  }

  async function clickStart() {
    render(<RunPipelineSection studyId="study-1" samples={samples} />);
    const button = await screen.findByRole("button", { name: /MAG/ });
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    fireEvent.click(button);
    const startButton = await screen.findByRole("button", { name: "Start Pipeline" });
    await waitFor(() => expect(startButton.hasAttribute("disabled")).toBe(false));
    fireEvent.click(startButton);
  }

  it("creates and starts a run, then shows the success state with a details link", async () => {
    fetchMock.mockImplementation(
      startFetch({
        create: () => Promise.resolve(jsonResponse({ run: { id: "run-x", runNumber: 7 } })),
        start: () => Promise.resolve(jsonResponse({ runNumber: 42 })),
      })
    );

    await clickStart();

    expect(await screen.findByText("Pipeline Run Started")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    const detailsLink = screen.getByRole("link", { name: /View Run Details/ });
    expect(detailsLink.getAttribute("href")).toContain("/analysis/run-x?studyId=study-1");
    expect(detailsLink.getAttribute("href")).toContain("pipeline=mag");

    // Create body includes the selected samples and config.
    const createCall = fetchMock.mock.calls.find(([u]) => String(u) === "/api/pipelines/runs");
    const body = JSON.parse((createCall![1] as RequestInit).body as string);
    expect(body).toMatchObject({ pipelineId: "mag", studyId: "study-1" });
    expect(body.sampleIds.sort()).toEqual(["sample-a", "sample-b"]);
    // Non-admin -> no executionMode in payload.
    expect(body.executionMode).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByTestId("dialog")).toBeNull());
  });

  it("includes executionMode in the payload for facility admins", async () => {
    mocks.useSession.mockReturnValue({ data: { user: { role: "FACILITY_ADMIN" } } });
    fetchMock.mockImplementation(startFetch({}));
    await clickStart();
    await screen.findByText("Pipeline Run Started");
    const createCall = fetchMock.mock.calls.find(([u]) => String(u) === "/api/pipelines/runs");
    const body = JSON.parse((createCall![1] as RequestInit).body as string);
    expect(body.executionMode).toBe("default");
  });

  it("shows an error when run creation fails, with normalized array details", async () => {
    fetchMock.mockImplementation(
      startFetch({
        create: () =>
          Promise.resolve(
            jsonResponse({ error: "Create failed", details: ["bad config", 42] }, false, 422)
          ),
      })
    );

    await clickStart();

    expect(await screen.findByText("Failed to Start")).toBeTruthy();
    expect(screen.getByText("Create failed")).toBeTruthy();
    expect(screen.getByText("bad config")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("Check Pipeline Settings")).toBeTruthy();
  });

  it("falls back to an HTTP detail string when create fails without details", async () => {
    fetchMock.mockImplementation(
      startFetch({
        create: () => Promise.resolve(jsonResponse({}, false, 500)),
      })
    );

    await clickStart();

    expect(await screen.findByText("Failed to create pipeline run")).toBeTruthy();
    expect(screen.getByText("HTTP 500")).toBeTruthy();
  });

  it("errors when the server returns success but no run id", async () => {
    fetchMock.mockImplementation(
      startFetch({
        create: () => Promise.resolve(jsonResponse({ run: {} })),
      })
    );

    await clickStart();

    expect(await screen.findByText("Failed to create pipeline run")).toBeTruthy();
    expect(
      screen.getByText("Server returned success but no run ID was provided.")
    ).toBeTruthy();
  });

  it("shows an error when starting the run fails", async () => {
    fetchMock.mockImplementation(
      startFetch({
        create: () => Promise.resolve(jsonResponse({ run: { id: "run-x" } })),
        start: () => Promise.resolve(jsonResponse({ error: "Start blew up" }, false, 400)),
      })
    );

    await clickStart();

    expect(await screen.findByText("Failed to Start")).toBeTruthy();
    expect(screen.getByText("Start blew up")).toBeTruthy();
  });

  it("handles a thrown error during run creation", async () => {
    fetchMock.mockImplementation(
      startFetch({
        create: () => Promise.reject(new Error("offline")),
      })
    );

    await clickStart();

    expect(await screen.findByText("Failed to Start")).toBeTruthy();
    expect(screen.getByText("offline")).toBeTruthy();
  });

  it("renders the success state without runNumber and links to the analysis dashboard fallback", async () => {
    fetchMock.mockImplementation(
      startFetch({
        // run id present but no runNumber anywhere
        create: () => Promise.resolve(jsonResponse({ run: { id: "run-x" } })),
        start: () => Promise.resolve(jsonResponse({})),
      })
    );

    await clickStart();

    expect(await screen.findByText("Pipeline Run Started")).toBeTruthy();
    // The "Go to Analysis Dashboard" link is always present in the success state.
    expect(screen.getByRole("link", { name: "Go to Analysis Dashboard" }).getAttribute("href")).toBe(
      "/analysis"
    );
  });

  it("cancels the dialog without starting a run", async () => {
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("dialog")).toBeNull());
  });
});
