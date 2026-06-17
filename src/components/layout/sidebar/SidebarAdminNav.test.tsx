// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModuleProvider } from "@/lib/modules";

const fetchMock = vi.fn();

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
  useRouter: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: mocks.usePathname,
  useRouter: mocks.useRouter,
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

function readinessResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  };
}

import { SidebarAdminNav } from "./SidebarAdminNav";

describe("SidebarAdminNav", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    mocks.useRouter.mockReturnValue({ push: mocks.push });
    mocks.usePathname.mockReturnValue("/admin/form-builder");
    fetchMock.mockResolvedValue(
      readinessResponse({
        ready: true,
        requiredMissing: [],
        recommendedMissing: [],
        firstMissingHref: "/admin/data-compute",
        missingItems: [],
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("links to Study Forms by default (dynamic-studies module off)", () => {
    render(<SidebarAdminNav collapsed={false} unreadMessages={0} />);
    expect(screen.getByRole("link", { name: "Study Forms" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Define Studies" })).toBeNull();
  });

  it("links to Define Studies when the dynamic-studies module is enabled", async () => {
    // ModuleProvider fetches /api/modules; the nav also fetches readiness.
    fetchMock.mockImplementation((url: string | URL) =>
      Promise.resolve(
        String(url).includes("/api/modules")
          ? {
              ok: true,
              status: 200,
              json: async () => ({
                modules: { "dynamic-studies": true },
                globalDisabled: false,
              }),
            }
          : readinessResponse({
              ready: true,
              requiredMissing: [],
              recommendedMissing: [],
              firstMissingHref: "/admin/data-compute",
              missingItems: [],
            })
      )
    );

    render(
      <ModuleProvider>
        <SidebarAdminNav collapsed={false} unreadMessages={0} />
      </ModuleProvider>
    );

    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Define Studies" })).toBeTruthy()
    );
    expect(screen.queryByRole("link", { name: "Study Forms" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Define Studies" }).getAttribute("href")
    ).toBe("/admin/study-definitions");
  });

  it("renders the expanded admin nav with the MIxS Checklists link and settings items", async () => {
    render(<SidebarAdminNav collapsed={false} unreadMessages={0} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/infrastructure/readiness");
    });

    const mixsLink = screen.getByRole("link", { name: "MIxS Checklists" });
    expect(mixsLink.getAttribute("href")).toBe("/admin/mixs-checklists");

    // Accounts section header plus the settings tree items.
    expect(screen.getByRole("button", { name: /Users/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Settings/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Researchers" }).getAttribute("href")).toBe(
      "/admin/users"
    );
    expect(screen.getByRole("link", { name: "Sequencing Order Form" }).getAttribute("href")).toBe(
      "/admin/form-builder"
    );
    expect(screen.getByRole("link", { name: "Sequencers" }).getAttribute("href")).toBe(
      "/admin/sequencing-tech"
    );
    expect(screen.getByRole("link", { name: "Pipelines" }).getAttribute("href")).toBe(
      "/admin/settings/pipelines"
    );

    // The settings section is active because the path is a config page.
    expect(screen.getByRole("link", { name: "Sequencing Order Form" }).className).toContain("bg-secondary");
  });

  it("shows the unread support badge and toggles the accounts section", () => {
    mocks.usePathname.mockReturnValue("/admin/users");

    render(<SidebarAdminNav collapsed={false} unreadMessages={12} />);

    const supportLink = screen.getByRole("link", { name: /Support/i });
    expect(supportLink.getAttribute("href")).toBe("/messages");
    // Counts above nine collapse to a "9+" badge.
    expect(screen.getByText("9+")).toBeTruthy();

    const accountsButton = screen.getByRole("button", { name: /Users/i });
    // Accounts page is active so the header carries active styling.
    expect(accountsButton.className).toContain("bg-secondary");
    fireEvent.click(accountsButton);
    fireEvent.click(screen.getByRole("button", { name: /Settings/i }));
  });

  it("renders collapsed icon links without the expandable sections", async () => {
    render(<SidebarAdminNav collapsed unreadMessages={3} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/infrastructure/readiness");
    });

    const usersLink = screen.getByRole("link", { name: "Users" });
    expect(usersLink.getAttribute("href")).toBe("/admin/users");
    const settingsLink = screen.getByRole("link", { name: "Settings" });
    expect(settingsLink.getAttribute("href")).toBe("/admin/form-builder");

    // Expandable tree items and the MIxS link are not rendered while collapsed.
    expect(screen.queryByRole("link", { name: "MIxS Checklists" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Settings/i })).toBeNull();
  });

  it("shows a required infrastructure gap badge that navigates to the first missing item", async () => {
    fetchMock.mockResolvedValue(
      readinessResponse({
        ready: false,
        requiredMissing: ["data-compute", "storage"],
        recommendedMissing: [],
        firstMissingHref: "/admin/data-compute",
        missingItems: [
          {
            key: "data-compute",
            label: "Compute backend",
            href: "/admin/data-compute",
            severity: "required",
          },
        ],
      })
    );

    render(<SidebarAdminNav collapsed={false} unreadMessages={0} />);

    const badge = await screen.findByRole("button", {
      name: /2 required infrastructure settings missing/i,
    });
    expect(badge.textContent).toBe("!");
    expect(badge.className).toContain("bg-red-100");
    expect(screen.getByRole("link", { name: "Compute backend" }).getAttribute("href")).toBe(
      "/admin/data-compute"
    );

    fireEvent.click(badge);
    expect(mocks.push).toHaveBeenCalledWith("/admin/data-compute");

    fireEvent.keyDown(badge, { key: "Enter" });
    expect(mocks.push).toHaveBeenCalledTimes(2);
  });

  it("shows a recommended infrastructure gap badge when nothing is required", async () => {
    fetchMock.mockResolvedValue(
      readinessResponse({
        ready: false,
        requiredMissing: [],
        recommendedMissing: ["notifications"],
        firstMissingHref: "/admin/settings/notifications",
        missingItems: [
          {
            key: "notifications",
            label: "Notifications channel",
            href: "/admin/settings/notifications",
            severity: "recommended",
          },
        ],
      })
    );

    render(<SidebarAdminNav collapsed={false} unreadMessages={0} />);

    const badge = await screen.findByRole("button", {
      name: /1 recommended infrastructure settings pending/i,
    });
    expect(badge.className).toContain("bg-amber-100");
    expect(screen.getByText(/1 recommended setting pending/i)).toBeTruthy();

    fireEvent.keyDown(badge, { key: " " });
    expect(mocks.push).toHaveBeenCalledWith("/admin/settings/notifications");
  });

  it("stops loading without a badge when the readiness fetch fails", async () => {
    fetchMock.mockResolvedValue(readinessResponse({}, false));

    render(<SidebarAdminNav collapsed={false} unreadMessages={0} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/infrastructure/readiness");
    });

    // No gaps reported, so no readiness badge button is rendered.
    expect(
      screen.queryByRole("button", { name: /infrastructure settings/i })
    ).toBeNull();
    expect(screen.getByRole("link", { name: "Infrastructure" })).toBeTruthy();
  });
});
