// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ExecutionTargetControl,
  isExecutionTargetBlocked,
  type ExecutionModeRequest,
} from "./ExecutionTargetControl";

describe("ExecutionTargetControl", () => {
  afterEach(() => {
    cleanup();
  });

  it("enables the SLURM segment when the SLURM probe succeeds", () => {
    const onChange = vi.fn();

    render(
      <ExecutionTargetControl
        value="default"
        onChange={onChange}
        executionPolicy={{ mode: "local", source: "global" }}
        slurmAvailability={{ success: true, message: "SLURM available" }}
      />
    );

    const slurm = screen.getByRole("radio", { name: "Compute cluster (SLURM)" }) as HTMLButtonElement;
    expect(slurm.disabled).toBe(false);
    expect(slurm.title).toBe("Runs on the configured compute cluster (SLURM).");

    fireEvent.click(slurm);

    expect(onChange).toHaveBeenCalledWith("slurm");
  });

  it("disables the SLURM segment and reports the failed probe reason", () => {
    const onChange = vi.fn();
    const availability = {
      success: false,
      message: "sinfo command not found",
    };

    render(
      <ExecutionTargetControl
        value="slurm"
        onChange={onChange}
        executionPolicy={{ mode: "local", source: "global" }}
        slurmAvailability={availability}
      />
    );

    const slurm = screen.getByRole("radio", { name: "Compute cluster (SLURM)" }) as HTMLButtonElement;
    expect(slurm.disabled).toBe(true);
    expect(screen.getByText(/Compute cluster unavailable: sinfo command not found/i)).toBeTruthy();
    expect(
      isExecutionTargetBlocked({
        executionMode: "slurm",
        executionPolicy: { mode: "local", source: "global" },
        slurmAvailability: availability,
      })
    ).toBe(true);
  });

  it("shows the resolved SLURM default when policy resolves to SLURM", () => {
    const onChange = vi.fn<(value: ExecutionModeRequest) => void>();

    render(
      <ExecutionTargetControl
        value="default"
        onChange={onChange}
        executionPolicy={{ mode: "slurm", source: "pipeline" }}
        slurmAvailability={{ success: true, message: "SLURM available" }}
      />
    );

    expect(screen.getByRole("radio", { name: "Use default" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Runs on the configured compute cluster (SLURM).")).toBeTruthy();
    expect(screen.getByText("Using this pipeline's default setting.")).toBeTruthy();
  });

  it("explains that local execution means the SeqDesk server, not the browser computer", () => {
    render(<ExecutionTargetControl value="default" onChange={vi.fn()} executionPolicy={{ mode: "local", source: "global" }} />);

    expect(screen.getByRole("radiogroup", { name: "Where to run" })).toBeTruthy();
    expect(screen.getByText("Runs on the computer where SeqDesk is installed.")).toBeTruthy();
    expect(screen.getByText("Using the SeqDesk default setting.")).toBeTruthy();
    expect(screen.queryByText(/global policy|Default resolves to|Selected target:/)).toBeNull();
  });

  it("describes the selected override instead of the cluster default and keeps execution values unchanged", () => {
    const onChange = vi.fn();
    render(<ExecutionTargetControl value="local" onChange={onChange} executionPolicy={{ mode: "slurm", source: "global" }} />);

    expect(screen.getByText("Runs on the computer where SeqDesk is installed.")).toBeTruthy();
    expect(screen.getByText("This choice applies only to this run.")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "SeqDesk server (local)" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Use default" }));
    expect(onChange).toHaveBeenCalledWith("default");
    fireEvent.click(screen.getByRole("radio", { name: "SeqDesk server (local)" }));
    expect(onChange).toHaveBeenLastCalledWith("local");
    expect(isExecutionTargetBlocked({ executionMode: "local", executionPolicy: { mode: "slurm", source: "global" } })).toBe(false);
  });

  it.each([
    { loading: true, error: null, message: "Checking the compute cluster before starting this run." },
    { loading: false, error: "Connection timed out", message: "Could not check the compute cluster: Connection timed out. Choose SeqDesk server to run without the cluster." },
  ])("keeps unavailable cluster execution blocked with understandable feedback", ({ loading, error, message }) => {
    render(<ExecutionTargetControl value="default" onChange={vi.fn()} executionPolicy={{ mode: "slurm", source: "global" }} slurmAvailabilityLoading={loading} slurmAvailabilityError={error} />);
    expect(screen.getByText(message)).toBeTruthy();
    expect((screen.getByRole("radio", { name: "Compute cluster (SLURM)" }) as HTMLButtonElement).disabled).toBe(true);
    expect(isExecutionTargetBlocked({ executionMode: "default", executionPolicy: { mode: "slurm", source: "global" }, slurmAvailabilityLoading: loading, slurmAvailabilityError: error })).toBe(true);
  });

  it("shows just the local choice when the default is local and SLURM is not installed, without changing the saved default", () => {
    const onChange = vi.fn();
    render(<ExecutionTargetControl value="default" onChange={onChange} executionPolicy={{ mode: "local", source: "global" }} slurmAvailability={{ success: false, message: "Not available", details: "Missing required SLURM commands: sinfo, sbatch." }} />);
    expect(screen.queryByRole("radio", { name: "Use default" })).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByText("Runs on the SeqDesk server")).toBeTruthy();
    expect(screen.getByText("Compute cluster unavailable").closest("details")?.open).toBe(false);
    expect(screen.getByText(/SLURM is not set up on this SeqDesk server/)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    expect(isExecutionTargetBlocked({ executionMode: "default", executionPolicy: { mode: "local", source: "global" }, slurmAvailability: { success: false, message: "Not available" } })).toBe(false);
  });

  it("does not silently replace an unavailable cluster default with local execution", () => {
    const onChange = vi.fn();
    render(<ExecutionTargetControl value="default" onChange={onChange} executionPolicy={{ mode: "slurm", source: "pipeline" }} slurmAvailability={{ success: false, message: "Partition is down" }} />);
    expect(screen.getByRole("radio", { name: "Use default" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "SeqDesk server (local)" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(/Partition is down/)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    { loading: true, error: null, message: "Checking whether a compute cluster is available…" },
    { loading: false, error: "Connection timed out", message: "Could not check the compute cluster: Connection timed out" },
  ])("explains an unavailable cluster even when local is selected", ({ loading, error, message }) => {
    render(<ExecutionTargetControl value="local" onChange={vi.fn()} slurmAvailabilityLoading={loading} slurmAvailabilityError={error} />);
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.queryByText(/required cluster tools are missing/)).toBeNull();
    expect((screen.getByRole("radio", { name: "Compute cluster (SLURM)" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
