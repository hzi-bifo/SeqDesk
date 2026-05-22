import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
}));

import WorkbenchLayout from "./layout";

describe("WorkbenchLayout", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.SEQDESK_APP_SURFACE;
    delete process.env.NEXT_PUBLIC_SEQDESK_APP_SURFACE;
    delete process.env.NEXT_PUBLIC_SEQDESK_WORKBENCH_ONLY;
  });

  it("blocks Workbench pages in the default Lab app surface", () => {
    expect(() => WorkbenchLayout({ children: <div>canvas</div> })).toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledTimes(1);
  });

  it("renders Workbench pages in Workbench mode", () => {
    process.env.SEQDESK_APP_SURFACE = "workbench";

    expect(WorkbenchLayout({ children: <div>canvas</div> })).toEqual(<div>canvas</div>);
    expect(mocks.notFound).not.toHaveBeenCalled();
  });
});
