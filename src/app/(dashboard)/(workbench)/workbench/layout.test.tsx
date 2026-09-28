import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  profile: { modules: ["data-imports"] } as { modules: string[] },
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
}));

vi.mock("@/lib/deployment-profile/server", () => ({
  getServerDeploymentProfile: () => mocks.profile,
}));

import WorkbenchLayout from "./layout";

describe("WorkbenchLayout", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.profile = { modules: ["data-imports"] };
    delete process.env.SEQDESK_APP_SURFACE;
    delete process.env.NEXT_PUBLIC_SEQDESK_APP_SURFACE;
    delete process.env.NEXT_PUBLIC_SEQDESK_WORKBENCH_ONLY;
  });

  it("renders Workbench pages in every preset, which all include data imports", () => {
    expect(WorkbenchLayout({ children: <div>canvas</div> })).toEqual(<div>canvas</div>);
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("blocks Workbench pages when the profile has no data-imports module", () => {
    mocks.profile = { modules: ["orders"] };

    expect(() => WorkbenchLayout({ children: <div>canvas</div> })).toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledTimes(1);
  });
});
