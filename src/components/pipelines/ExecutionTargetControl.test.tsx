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

    const slurm = screen.getByRole("radio", { name: "SLURM" }) as HTMLButtonElement;
    expect(slurm.disabled).toBe(false);

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

    const slurm = screen.getByRole("radio", { name: "SLURM" }) as HTMLButtonElement;
    expect(slurm.disabled).toBe(true);
    expect(screen.getByText(/SLURM unavailable: sinfo command not found/i)).toBeTruthy();
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

    expect(screen.getByRole("radio", { name: "Default (SLURM)" })).toBeTruthy();
    expect(screen.getByText(/Default resolves to SLURM from pipeline policy/i)).toBeTruthy();
    expect(screen.getByText(/Selected target: Default \(SLURM\)/i)).toBeTruthy();
  });
});
