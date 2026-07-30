import { describe, expect, it } from "vitest";
import {
  deriveManagedActivationState,
  deriveManagedSetupState,
  getManagedNextActions,
  type PipelineReadiness,
} from "./pipeline-readiness-service";

function readiness(
  items: PipelineReadiness["items"]
): PipelineReadiness {
  return {
    status: "missing",
    summary: "Setup required",
    canEnable: false,
    items,
  };
}

describe("managed pipeline readiness state", () => {
  it("represents an available but inactive package as disabled", () => {
    expect(deriveManagedActivationState(false)).toBe("disabled");
    expect(deriveManagedActivationState(true)).toBe("enabled");
  });

  it("classifies an unmanaged required database path as needs-db", () => {
    const value = readiness([
      {
        id: "required-config",
        label: "Required configuration",
        status: "missing",
        action: "configure",
        blocking: true,
      },
      {
        id: "database-config",
        label: "Database configuration",
        status: "missing",
        action: "configure",
        blocking: true,
      },
    ]);

    expect(deriveManagedSetupState(value)).toBe("needs-db");
    expect(getManagedNextActions(value)).toEqual([
      expect.objectContaining({
        action: "configure",
      }),
    ]);
  });

  it("keeps a disabled but otherwise complete pipeline ready", () => {
    const value: PipelineReadiness = {
      status: "warning",
      summary: "Pipeline is installed but disabled.",
      canEnable: true,
      items: [
        {
          id: "enabled",
          label: "Enabled for users",
          status: "warning",
          action: "enable",
          blocking: false,
        },
      ],
    };

    expect(deriveManagedSetupState(value)).toBe("ready");
    expect(getManagedNextActions(value)).toEqual([
      expect.objectContaining({ action: "enable" }),
    ]);
  });
});
