// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  signOut: vi.fn(),
  useSession: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock("next-auth/react", () => ({
  signOut: mocks.signOut,
  useSession: mocks.useSession,
}));

vi.mock("@/components/ui/toast", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

import { AccountLifecycleControl } from "./AccountLifecycleControl";

function jsonResponse(data: unknown, ok = true) {
  return { ok, json: async () => data } as Response;
}

describe("AccountLifecycleControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.useSession.mockReturnValue({ data: { user: { id: "admin-1" } } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses reversible deactivation as the primary removal action", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.fetch.mockResolvedValueOnce(jsonResponse({ isActive: false }));

    render(
      <AccountLifecycleControl
        userId="member-1"
        email="member@example.test"
        isActive
        isFinalAdministrator={false}
      />
    );

    expect(screen.getByText(/keeping scientific records and provenance/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Deactivate account" }));

    await waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalledWith(
        "/api/admin/users/member-1/status",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ isActive: false }),
        })
      );
    });
    expect(mocks.refresh).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /permanently delete/i })).toBeNull();
  });

  it("disables deactivation for the final active administrator", () => {
    render(
      <AccountLifecycleControl
        userId="admin-1"
        email="admin@example.test"
        isActive
        isFinalAdministrator
      />
    );

    expect(
      screen.getByRole("button", { name: "Deactivate account" }).hasAttribute("disabled")
    ).toBe(true);
    expect(screen.getByText(/another active administrator/i)).toBeTruthy();
  });

  it("keeps permanent deletion separate and requires email confirmation", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("member@example.test");
    mocks.fetch.mockResolvedValueOnce(jsonResponse({ deleted: true }));

    render(
      <AccountLifecycleControl
        userId="member-1"
        email="member@example.test"
        isActive={false}
        isFinalAdministrator={false}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Permanently delete empty account" })
    );

    await waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalledWith(
        "/api/admin/users/member-1",
        expect.objectContaining({
          method: "DELETE",
          body: JSON.stringify({ confirmationEmail: "member@example.test" }),
        })
      );
    });
    expect(mocks.push).toHaveBeenCalledWith("/admin/users");
  });
});
