import { describe, expect, it } from "vitest";

import { getDeploymentProfileDefinition } from "@/lib/deployment-profile";

import {
  authorizePipelineRunRead,
  canReadPipelineRun,
  decideFacilityPipelineCapability,
  isPipelineRunPublished,
  requireFacilityPipelineCapability,
  userOwnsPipelineRunTarget,
} from "./run-visibility";

const ownerSession = {
  user: { id: "user-1", role: "RESEARCHER" },
};
const adminSession = {
  user: { id: "admin-1", role: "FACILITY_ADMIN" },
};
const strangerSession = {
  user: { id: "user-2", role: "RESEARCHER" },
};
const sequencingCenter = getDeploymentProfileDefinition("sequencing-center");
const sharedLab = getDeploymentProfileDefinition("shared-lab");
const workbench = getDeploymentProfileDefinition("research-workbench");

describe("pipeline run capability boundary", () => {
  it("returns 401 for missing or invalid authentication", () => {
    expect(
      requireFacilityPipelineCapability(null, "analysis.read_own", sequencingCenter)
    ).toMatchObject({ status: 401, body: { error: "Unauthorized" } });
    expect(
      requireFacilityPipelineCapability(
        { user: { id: "removed", role: "FACILITY_ADMIN", authorizationValid: false } },
        "analysis.read_all",
        sequencingCenter
      )
    ).toMatchObject({ status: 401 });
  });

  it("allows owned analysis without granting facility output management", () => {
    expect(
      decideFacilityPipelineCapability(
        ownerSession,
        "analysis.read_own",
        workbench
      )
    ).toMatchObject({
      allowed: true,
      grant: { scope: "own" },
    });
    expect(
      decideFacilityPipelineCapability(
        adminSession,
        "analysis.resolve_outputs",
        workbench
      )
    ).toMatchObject({ allowed: false, status: 403 });
  });

  it("keeps pipeline configuration separate from running workflows", () => {
    expect(
      decideFacilityPipelineCapability(
        ownerSession,
        "analysis.run",
        sharedLab
      ).allowed
    ).toBe(true);
    expect(
      decideFacilityPipelineCapability(
        ownerSession,
        "system.pipelines.manage",
        sharedLab
      )
    ).toMatchObject({ allowed: false, status: 403 });
  });
});

describe("isPipelineRunPublished", () => {
  it("requires at least one selected result", () => {
    expect(isPipelineRunPublished({ selectedResultSelections: [{ id: "s1" }] })).toBe(
      true
    );
    expect(isPipelineRunPublished({ selectedResultSelections: [] })).toBe(false);
    expect(isPipelineRunPublished({ selectedResultSelections: null })).toBe(false);
  });
});

describe("pipeline run read scopes", () => {
  const publishedOwnerRun = {
    study: { userId: "user-1" },
    selectedResultSelections: [{ id: "s1" }],
  };

  it("recognizes the order or study owner as the requester-facing owner", () => {
    expect(userOwnsPipelineRunTarget("user-1", publishedOwnerRun)).toBe(true);
    expect(
      userOwnsPipelineRunTarget("user-1", { order: { userId: "user-1" } })
    ).toBe(true);
    expect(userOwnsPipelineRunTarget("user-2", publishedOwnerRun)).toBe(false);
  });

  it("lets Sequencing Center operators read every run", () => {
    const access = requireFacilityPipelineCapability(
      adminSession,
      "analysis.read_all",
      sequencingCenter
    );
    if (!("grant" in access)) throw new Error("Expected an analysis.read_all grant");

    expect(
      canReadPipelineRun(access.grant, access.principalId, {
        study: { userId: "someone-else" },
        selectedResultSelections: [],
      })
    ).toBe(true);
  });

  it("lets a runnable owner read progress and results only for their target", () => {
    expect(
      authorizePipelineRunRead(ownerSession, publishedOwnerRun, sequencingCenter)
    ).toBeNull();
    expect(
      authorizePipelineRunRead(
        ownerSession,
        { ...publishedOwnerRun, selectedResultSelections: [] },
        sequencingCenter
      )
    ).toBeNull();
    expect(
      authorizePipelineRunRead(strangerSession, publishedOwnerRun, sequencingCenter)
    ).toMatchObject({ status: 403 });
  });

  it("lets every Shared Lab member read runs installation-wide", () => {
    expect(
      authorizePipelineRunRead(
        strangerSession,
        {
          study: { userId: "user-1" },
          selectedResultSelections: [],
        },
        sharedLab
      )
    ).toBeNull();
  });

  it("allows owned source-neutral runs but never other members' targets", () => {
    expect(
      authorizePipelineRunRead(ownerSession, publishedOwnerRun, workbench)
    ).toBeNull();
    expect(authorizePipelineRunRead(strangerSession, publishedOwnerRun, workbench)).toMatchObject({ status: 403 });
  });
});
