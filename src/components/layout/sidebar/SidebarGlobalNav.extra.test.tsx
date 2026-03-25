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

import { SidebarGlobalNav } from "./SidebarGlobalNav";

describe("SidebarGlobalNav", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders expanded navigation with counts and active styling", () => {
    mocks.usePathname.mockReturnValue("/orders/order-1");

    render(
      <SidebarGlobalNav
        collapsed={false}
        counts={{
          orders: 120,
          studies: 2,
          submissions: 1,
          analysis: 0,
        }}
        showAdminControls
        hasEntityContext
      />
    );

    const ordersLink = screen.getByRole("link", { name: /Orders/i });
    const analysisLink = screen.getByRole("link", { name: /Analysis/i });

    expect(ordersLink.getAttribute("href")).toBe("/orders");
    expect(ordersLink.className).toContain("bg-secondary");
    expect(screen.getByText("99+")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("ENA Submissions")).toBeTruthy();
    expect(analysisLink.className).toContain("opacity-70");
  });

  it("filters entity links and uses collapsed titles", () => {
    mocks.usePathname.mockReturnValue("/analysis");

    const { container } = render(
      <SidebarGlobalNav
        collapsed
        counts={{
          orders: 3,
          studies: 4,
          submissions: 0,
          analysis: 5,
        }}
        showAdminControls={false}
        hasEntityContext={false}
        showEntityLinks={false}
      />
    );

    const links = Array.from(container.querySelectorAll("a"));

    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/analysis");
    expect(links[0].getAttribute("title")).toBe("Analysis");
    expect(screen.queryByText("Orders")).toBeNull();
    expect(screen.queryByText("Studies")).toBeNull();
  });
});
