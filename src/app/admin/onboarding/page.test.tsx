// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OnboardingPage from "./page";
import { buildOnboardingStatus, resolveOnboardingCapabilities, type OnboardingStatus } from "@/lib/onboarding";

vi.mock("next/link", () => ({ default: ({ children, href, ...props }: React.ComponentProps<"a">) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/components/layout/PageContainer", () => ({ PageContainer: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));

const fetchMock = vi.fn();
function status(overrides: Partial<OnboardingStatus> = {}) {
  return {
    ...buildOnboardingStatus({ profile: "research-workbench", requiredVersion: 1,
      capabilities: resolveOnboardingCapabilities({ profile: "research-workbench", modulesConfig: JSON.stringify({ modules: { "sequencing-management": false } }), pipelinesEnabled: false }),
    }), ...overrides,
  };
}
function respond(value: OnboardingStatus) { return { ok: true, json: async () => value }; }

describe("module-aware setup page", () => {
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("shows a loading skeleton then only relevant sections without silently running probes", async () => {
    let resolve!: (response: ReturnType<typeof respond>) => void;
    fetchMock.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    render(<OnboardingPage />);
    expect(screen.getByRole("status", { name: "Loading setup checklist" })).toBeTruthy();
    resolve(respond(status()));
    expect(await screen.findByRole("heading", { name: "Setup checklist" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Data imports" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Reports & analysis" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Facility sequencing" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Pipelines" })).toBeNull();
    expect(screen.getByRole("link", { name: /Review environments/ }).getAttribute("href")).toBe("/admin/settings/analysis");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined();
  });

  it("runs checks only explicitly and prevents conflicting checkbox changes until they finish", async () => {
    const current = status();
    fetchMock.mockResolvedValueOnce(respond(current));
    let resolve!: (response: ReturnType<typeof respond>) => void;
    fetchMock.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    render(<OnboardingPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Check readiness" }));
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST" });
    expect(screen.getAllByRole("checkbox").every(element => element.hasAttribute("disabled"))).toBe(true);
    resolve(respond(status({ complete: true, requiredCompletedCount: 1 })));
    expect(await screen.findByRole("link", { name: "Continue to SeqDesk" })).toHaveProperty("href", "http://localhost:3000/orders");
    await waitFor(() => expect(screen.getByRole("button", { name: "Check readiness" }).hasAttribute("disabled")).toBe(false));
  });

  it("does not label legacy optional onboarding as verified when checks are incomplete", async () => {
    fetchMock.mockResolvedValueOnce(respond(status({ complete: true, required: false })));
    render(<OnboardingPage />);
    expect(await screen.findByText("SeqDesk is available")).toBeTruthy();
    expect(screen.queryByText("Required setup is complete")).toBeNull();
    expect(screen.getByRole("link", { name: "Continue to SeqDesk" }).getAttribute("href")).toBe("/orders");
  });
});
