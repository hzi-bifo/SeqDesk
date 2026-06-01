import { describe, expect, it } from "vitest";

import {
  canReadPipelineRun,
  isPipelineRunPublished,
  userOwnsPipelineRun,
} from "./run-visibility";

const owner = { id: "user-1", role: "RESEARCHER" };
const admin = { id: "admin-1", role: "FACILITY_ADMIN" };
const stranger = { id: "user-2", role: "RESEARCHER" };

describe("isPipelineRunPublished", () => {
  it("is true when there is at least one selected result selection", () => {
    expect(isPipelineRunPublished({ selectedResultSelections: [{ id: "s1" }] })).toBe(true);
  });

  it("is false when there are no selections", () => {
    expect(isPipelineRunPublished({ selectedResultSelections: [] })).toBe(false);
    expect(isPipelineRunPublished({ selectedResultSelections: null })).toBe(false);
    expect(isPipelineRunPublished({})).toBe(false);
  });
});

describe("userOwnsPipelineRun", () => {
  it("matches the study owner", () => {
    expect(userOwnsPipelineRun(owner, { study: { userId: "user-1" } })).toBe(true);
  });

  it("matches the order owner", () => {
    expect(userOwnsPipelineRun(owner, { order: { userId: "user-1" } })).toBe(true);
  });

  it("rejects a non-owner", () => {
    expect(userOwnsPipelineRun(stranger, { study: { userId: "user-1" } })).toBe(false);
  });
});

describe("canReadPipelineRun", () => {
  it("always allows facility admins, even for unpublished runs", () => {
    expect(
      canReadPipelineRun(admin, {
        study: { userId: "user-1" },
        selectedResultSelections: [],
      })
    ).toBe(true);
  });

  it("allows a non-admin owner only for published runs", () => {
    expect(
      canReadPipelineRun(owner, {
        study: { userId: "user-1" },
        selectedResultSelections: [{ id: "s1" }],
      })
    ).toBe(true);
  });

  it("rejects a non-admin owner of an unpublished run", () => {
    expect(
      canReadPipelineRun(owner, {
        study: { userId: "user-1" },
        selectedResultSelections: [],
      })
    ).toBe(false);
  });

  it("rejects a non-owner of a published run", () => {
    expect(
      canReadPipelineRun(stranger, {
        study: { userId: "user-1" },
        selectedResultSelections: [{ id: "s1" }],
      })
    ).toBe(false);
  });
});
