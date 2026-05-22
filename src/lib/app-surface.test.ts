import { afterEach, describe, expect, it } from "vitest";

import { getSeqDeskAppSurface, isLabAppSurface, isWorkbenchAppSurface } from "./app-surface";

describe("app surface", () => {
  afterEach(() => {
    delete process.env.SEQDESK_APP_SURFACE;
    delete process.env.NEXT_PUBLIC_SEQDESK_APP_SURFACE;
    delete process.env.NEXT_PUBLIC_SEQDESK_WORKBENCH_ONLY;
  });

  it("defaults to the Lab app surface", () => {
    expect(getSeqDeskAppSurface()).toBe("lab");
    expect(isLabAppSurface()).toBe(true);
    expect(isWorkbenchAppSurface()).toBe(false);
  });

  it("uses the explicit Workbench app surface", () => {
    process.env.SEQDESK_APP_SURFACE = "workbench";

    expect(getSeqDeskAppSurface()).toBe("workbench");
    expect(isWorkbenchAppSurface()).toBe(true);
  });

  it("uses the public app surface value for client code", () => {
    process.env.SEQDESK_APP_SURFACE = "lab";
    process.env.NEXT_PUBLIC_SEQDESK_APP_SURFACE = "workbench";

    expect(getSeqDeskAppSurface()).toBe("workbench");
  });

  it("keeps the legacy Workbench-only flag as a fallback", () => {
    process.env.NEXT_PUBLIC_SEQDESK_WORKBENCH_ONLY = "1";

    expect(getSeqDeskAppSurface()).toBe("workbench");
  });
});
