// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: mocks.usePathname,
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

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { WorkbenchSidebarNav } from "./WorkbenchSidebarNav";

describe("WorkbenchSidebarNav", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usePathname.mockReturnValue("/workbench/imports");
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the workspace selector and canvas-only Workbench navigation", () => {
    render(<WorkbenchSidebarNav collapsed={false} />);

    expect(screen.getByText("Private Workbench")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Canvas/i }).getAttribute("href")).toBe("/workbench/data");
    expect(screen.queryByRole("link", { name: /Imports/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /Pipelines/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /Runs/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /Results/i })).toBeNull();

    const canvasLink = screen.getByRole("link", { name: /Canvas/i });
    expect(canvasLink.getAttribute("aria-current")).toBe("page");
    expect(canvasLink.className).toContain("border-teal");
  });

  it("treats /workbench as the data entry point", () => {
    mocks.usePathname.mockReturnValue("/workbench");

    render(<WorkbenchSidebarNav collapsed={false} />);

    expect(screen.getByRole("link", { name: /Canvas/i }).getAttribute("aria-current")).toBe("page");
  });
});
