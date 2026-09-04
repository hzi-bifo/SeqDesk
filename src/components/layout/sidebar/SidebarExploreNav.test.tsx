// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
  useModuleEnabled: vi.fn(),
}));

vi.mock("next/navigation", () => ({ usePathname: mocks.usePathname }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...(props as object)}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/modules", () => ({ useModuleEnabled: mocks.useModuleEnabled }));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import { SidebarExploreNav } from "./SidebarExploreNav";

describe("SidebarExploreNav", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usePathname.mockReturnValue("/orders");
    mocks.useModuleEnabled.mockReturnValue(true);
  });

  afterEach(() => cleanup());

  it("renders nothing when the explore module is disabled", () => {
    mocks.useModuleEnabled.mockReturnValue(false);
    const { container } = render(<SidebarExploreNav collapsed={false} />);
    expect(container.innerHTML).toBe("");
  });

  it("links to /explore and marks the active route", () => {
    mocks.usePathname.mockReturnValue("/explore/datasets/d1");
    render(<SidebarExploreNav collapsed={false} />);
    const link = screen.getByRole("link", { name: /Explore/i });
    expect(link.getAttribute("href")).toBe("/explore");
    expect(link.getAttribute("aria-current")).toBe("page");
  });

  it("uses a title in collapsed mode", () => {
    render(<SidebarExploreNav collapsed />);
    expect(screen.getByRole("link").getAttribute("title")).toBe("Explore");
  });
});
