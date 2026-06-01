// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
  panelSuccess: vi.fn(),
  panelError: vi.fn(),
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

vi.mock("@/lib/notifications/client", () => ({
  notifyPanel: {
    success: mocks.panelSuccess,
    error: mocks.panelError,
  },
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("react-simple-wysiwyg", () => ({
  EditorProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Editor: ({
    value,
    onChange,
    placeholder,
    containerProps,
    children,
  }: {
    value: string;
    onChange: (event: { target: { value: string } }) => void;
    placeholder?: string;
    containerProps?: React.HTMLAttributes<HTMLDivElement>;
    children: React.ReactNode;
  }) => (
    <div {...containerProps}>
      {children}
      <textarea
        aria-label="notes editor"
        className="rsw-ce"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange({ target: { value: event.currentTarget.value } })}
      />
    </div>
  ),
  Toolbar: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>,
}));

import { EntityNotesPanel } from "./EntityNotesPanel";

function jsonResponse(payload: unknown, ok = true) {
  return {
    ok,
    json: async () => payload,
  } as Response;
}

describe("EntityNotesPanel", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    document.documentElement.style.removeProperty("--entity-notes-sidebar-offset");
    mocks.usePathname.mockReturnValue("/orders/order-1");
    document.execCommand = vi.fn();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/orders/order-1") {
        return Promise.resolve(
          jsonResponse({
            id: "order-1",
            orderNumber: "ORD-1",
            name: "Genome order",
            notes: "Initial **note**",
            notesEditedAt: "2026-04-01T10:00:00.000Z",
            notesEditedBy: {
              firstName: "Ada",
              lastName: "Lovelace",
              email: "ada@example.test",
            },
          })
        );
      }
      if (url.startsWith("/api/notes/mentions")) {
        return Promise.resolve(
          jsonResponse({
            groups: [
              {
                key: "samples",
                label: "Samples",
                items: [
                  {
                    type: "sample",
                    id: "sample-a",
                    label: "SAMPLE_A",
                    detail: "Alpha sample",
                    status: "available",
                  },
                ],
              },
            ],
            mentions: [
              {
                type: "sample",
                id: "sample-a",
                label: "SAMPLE_A",
                detail: "Alpha sample",
                status: "available",
              },
            ],
          })
        );
      }
      if (url === "/api/orders/order-1/notes") {
        expect(init?.method).toBe("PATCH");
        return Promise.resolve(
          jsonResponse({
            notes: "Updated note",
            notesEditedAt: "2026-04-01T12:00:00.000Z",
            notesEditedById: "user-1",
            notesEditedBy: {
              firstName: null,
              lastName: null,
              email: "writer@example.test",
            },
          })
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    document.documentElement.style.removeProperty("--entity-notes-sidebar-offset");
    vi.unstubAllGlobals();
  });

  it("loads order notes, saves edits, and preserves desktop panel state", async () => {
    render(
      <EntityNotesPanel
        desktopPanelStateKey="order-notes-open"
        entityLabel="order"
        fetchUrl="/api/orders/order-1"
        panelDataAttribute="data-order-notes-panel"
        saveMethod="PATCH"
        saveUrl="/api/orders/order-1/notes"
      />
    );

    expect(await screen.findByText("For order ORD-1")).toBeTruthy();
    expect(screen.queryByText("Study notepads open from each study")).toBeNull();
    expect(screen.getByLabelText("notes editor").getAttribute("placeholder")).toContain(
      "Type here to add notes for this order"
    );
    expect(document.documentElement.style.getPropertyValue("--entity-notes-sidebar-offset")).toBe(
      "320px"
    );
    expect(
      screen.getByText("Shared with everyone who can access this order, including admins.")
        .parentElement?.style.height
    ).toBe("var(--seqdesk-footer-height, 2.5rem)");
    expect(screen.getByText(/Edited Apr 1/)).toBeTruthy();
    expect((screen.getByLabelText("notes editor") as HTMLTextAreaElement).value).toContain(
      "<strong>note</strong>"
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/notes/mentions?"),
        { cache: "no-store" }
      );
    });

    fireEvent.change(screen.getByLabelText("notes editor"), {
      target: { value: "<p>Updated note</p>" },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Save now" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/orders/order-1/notes",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ notes: "Updated note" }),
        })
      );
    });
    expect(mocks.panelSuccess).toHaveBeenCalledWith("Order notepad saved");
    expect(await screen.findByText(/writer@example.test/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Hide order notepad"));
    expect(window.localStorage.getItem("order-notes-open")).toBe("false");
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--entity-notes-sidebar-offset")).toBe(
        "40px"
      );
    });
    fireEvent.click(screen.getByLabelText("Show order notepad"));
    expect(window.localStorage.getItem("order-notes-open")).toBe("true");
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--entity-notes-sidebar-offset")).toBe(
        "320px"
      );
    });
  });

  it("clears the sidebar offset when notes are disabled so no phantom gap is left", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/orders/order-1") {
        return Promise.resolve(
          jsonResponse({
            id: "order-1",
            orderNumber: "ORD-1",
            name: "Genome order",
            notes: null,
            notesEditedAt: null,
            notesEditedBy: null,
            notesEnabled: false,
          })
        );
      }
      return Promise.resolve(jsonResponse({}));
    });

    const { container } = render(
      <EntityNotesPanel
        desktopPanelStateKey="order-notes-open"
        entityLabel="order"
        fetchUrl="/api/orders/order-1"
        panelDataAttribute="data-order-notes-panel"
        saveMethod="PATCH"
        saveUrl="/api/orders/order-1/notes"
      />
    );

    // Panel renders nothing once notes are disabled, and the offset is cleared
    // so the top bar / footer are not pushed against an empty panel.
    await waitFor(() => {
      expect(
        document.documentElement.style.getPropertyValue("--entity-notes-sidebar-offset")
      ).toBe("");
    });
    expect(container.querySelector("[data-order-notes-panel]")).toBeNull();
  });
});
