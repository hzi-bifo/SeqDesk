import { afterEach, describe, expect, it } from "vitest";

import { getSeqDeskAppSurface, isLabAppSurface, isWorkbenchAppSurface } from "./app-surface";

describe("app surface", () => {
  afterEach(() => {
    delete process.env.SEQDESK_APP_SURFACE;
    delete process.env.NEXT_PUBLIC_SEQDESK_APP_SURFACE;
    delete process.env.NEXT_PUBLIC_SEQDESK_WORKBENCH_ONLY;
    delete process.env.NEXT_PUBLIC_SEQDESK_DEPLOYMENT_PROFILE;
    delete process.env.SEQDESK_DEPLOYMENT_PROFILE;
  });

  it("defaults to the Lab app surface", () => {
    expect(getSeqDeskAppSurface()).toBe("lab");
    expect(isLabAppSurface()).toBe(true);
    expect(isWorkbenchAppSurface()).toBe(false);
  });

  // Deployment presets are one application (57854cfa): every preset shares
  // the sequencing experience, so legacy Workbench inputs still resolve to it.
  it("keeps the Lab surface for the explicit Workbench app surface", () => {
    process.env.SEQDESK_APP_SURFACE = "workbench";

    expect(getSeqDeskAppSurface()).toBe("lab");
    expect(isWorkbenchAppSurface()).toBe(false);
  });

  it("keeps the Lab surface for the public app surface value", () => {
    process.env.SEQDESK_APP_SURFACE = "lab";
    process.env.NEXT_PUBLIC_SEQDESK_APP_SURFACE = "workbench";

    expect(getSeqDeskAppSurface()).toBe("lab");
  });

  it("keeps the Lab surface for the legacy Workbench-only flag", () => {
    process.env.NEXT_PUBLIC_SEQDESK_WORKBENCH_ONLY = "1";

    expect(getSeqDeskAppSurface()).toBe("lab");
  });

  it("keeps the Lab surface for the research-workbench preset", () => {
    process.env.NEXT_PUBLIC_SEQDESK_DEPLOYMENT_PROFILE = "research-workbench";

    expect(getSeqDeskAppSurface()).toBe("lab");
  });
});
