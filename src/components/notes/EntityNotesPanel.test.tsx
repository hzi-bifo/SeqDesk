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

  it("renders the study subject and empty-notes placeholder", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/studies/study-1") {
        return Promise.resolve(
          jsonResponse({
            id: "study-1",
            title: "Microbiome Study",
            alias: "MBS",
            notes: null,
            notesEditedAt: null,
            notesEditedBy: null,
          })
        );
      }
      if (url.startsWith("/api/notes/mentions")) {
        return Promise.resolve(jsonResponse({ groups: [], mentions: [] }));
      }
      return Promise.resolve(jsonResponse({}));
    });

    render(
      <EntityNotesPanel
        desktopPanelStateKey="study-notes-open"
        entityLabel="study"
        fetchUrl="/api/studies/study-1"
        panelDataAttribute="data-study-notes-panel"
        saveMethod="PUT"
        saveUrl="/api/studies/study-1/notes"
      />
    );

    expect(await screen.findByText("For study Microbiome Study")).toBeTruthy();
    // Empty notes => the editor shows the empty placeholder with shared-access copy.
    expect(
      screen.getByLabelText("notes editor").getAttribute("placeholder")
    ).toContain("Type here to add notes for this study");
    expect(
      screen.getByText(/Shared with everyone who can access this study/)
    ).toBeTruthy();
    // No editor metadata when the notes were never edited.
    expect(screen.queryByText(/^Edited /)).toBeNull();
  });

  it("shows the loading spinner before notes resolve", () => {
    let resolveFetch: ((value: Response) => void) | null = null;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/orders/order-1") {
        return new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        });
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

    // While the fetch promise is pending the body shows a spinner, not the editor.
    expect(container.querySelector(".animate-spin")).toBeTruthy();
    expect(screen.queryByLabelText("notes editor")).toBeNull();
    // Resolve to avoid an unhandled pending promise after teardown.
    resolveFetch?.(jsonResponse({ id: "order-1", orderNumber: "ORD-1", notes: null, notesEditedAt: null, notesEditedBy: null }));
  });

  it("renders an error state and retries via Try again", async () => {
    let calls = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/orders/order-1") {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve(jsonResponse({ error: "Boom" }, false));
        }
        return Promise.resolve(
          jsonResponse({
            id: "order-1",
            orderNumber: "ORD-1",
            notes: "recovered",
            notesEditedAt: null,
            notesEditedBy: null,
          })
        );
      }
      if (url.startsWith("/api/notes/mentions")) {
        return Promise.resolve(jsonResponse({ groups: [], mentions: [] }));
      }
      return Promise.resolve(jsonResponse({}));
    });

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

    expect(await screen.findByText("Boom")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    // The retry succeeds and the editor renders the recovered notes.
    expect(await screen.findByLabelText("notes editor")).toBeTruthy();
    expect(screen.queryByText("Boom")).toBeNull();
  });

  it("prompts for a schema update when notes are unsupported", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/orders/order-1") {
        return Promise.resolve(
          jsonResponse({
            id: "order-1",
            orderNumber: "ORD-1",
            notes: null,
            notesEditedAt: null,
            notesEditedBy: null,
            notesSupported: false,
          })
        );
      }
      return Promise.resolve(jsonResponse({}));
    });

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

    expect(
      await screen.findByText("Database schema update required for notes.")
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Recheck" })).toBeTruthy();
    // No editor or footer metadata when notes are unsupported.
    expect(screen.queryByLabelText("notes editor")).toBeNull();
  });

  it("opens the mobile notepad and closes it with the Escape key", async () => {
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

    await screen.findByText("For order ORD-1");

    // While mobile is closed the desktop aside renders a single panel body
    // (one editor) plus the floating launcher Button labelled "Notepad".
    const launcher = screen.getByRole("button", { name: "Notepad" });
    expect(screen.getAllByLabelText("notes editor").length).toBe(1);

    // Opening the mobile drawer mounts a second copy of the panel body.
    fireEvent.click(launcher);
    await waitFor(() => {
      expect(screen.getAllByLabelText("notes editor").length).toBe(2);
    });
    // The floating launcher hides while the mobile drawer is open.
    expect(screen.queryByRole("button", { name: "Notepad" })).toBeNull();

    // Escape closes the mobile drawer, restoring the launcher.
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.getAllByLabelText("notes editor").length).toBe(1);
    });
    expect(screen.getByRole("button", { name: "Notepad" })).toBeTruthy();
  });

  it("opens, applies, and cancels the link editor", async () => {
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

    await screen.findByLabelText("notes editor");

    // Open the link editor via the toolbar Link button (mouseDown handler).
    fireEvent.mouseDown(screen.getByTitle("Link"));
    const urlInput = await screen.findByPlaceholderText("Paste URL");
    expect(urlInput).toBeTruthy();

    // Cancel closes the link editor.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByPlaceholderText("Paste URL")).toBeNull();
    });

    // Re-open and apply a URL — execCommand("createLink") is invoked.
    fireEvent.mouseDown(screen.getByTitle("Link"));
    const reopenedInput = await screen.findByPlaceholderText("Paste URL");
    fireEvent.change(reopenedInput, { target: { value: "https://example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(document.execCommand).toHaveBeenCalledWith(
        "createLink",
        false,
        "https://example.test"
      );
    });
  });

  it("invokes formatting toolbar commands via execCommand", async () => {
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

    await screen.findByLabelText("notes editor");

    fireEvent.mouseDown(screen.getByTitle("Bold"));
    fireEvent.mouseDown(screen.getByTitle("Italic"));
    fireEvent.mouseDown(screen.getByTitle("Bullet list"));

    expect(document.execCommand).toHaveBeenCalledWith("bold");
    expect(document.execCommand).toHaveBeenCalledWith("italic");
    expect(document.execCommand).toHaveBeenCalledWith("insertUnorderedList");
  });

  it("surfaces a save failure toast and a Save failed status when saving errors", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/orders/order-1") {
        return Promise.resolve(
          jsonResponse({
            id: "order-1",
            orderNumber: "ORD-1",
            notes: "Initial note",
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
        return Promise.resolve(jsonResponse({ groups: [], mentions: [] }));
      }
      if (url === "/api/orders/order-1/notes") {
        return Promise.resolve(jsonResponse({ error: "Save rejected" }, false));
      }
      return Promise.resolve(jsonResponse({}));
    });

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

    await screen.findByLabelText("notes editor");

    // Edited-by metadata is shown for a previously edited note.
    expect(screen.getByText(/Edited Apr 1.*by Ada Lovelace/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("notes editor"), {
      target: { value: "<p>Changed text</p>" },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Save now" }));

    await waitFor(() => {
      expect(mocks.panelError).toHaveBeenCalledWith("Save rejected");
    });
  });

  it("shows the unsaved-content dot when the panel is collapsed", async () => {
    window.localStorage.setItem("order-notes-open", "false");

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

    // When collapsed, the panel renders the vertical "Show order notepad" affordance.
    const showButton = await screen.findByLabelText("Show order notepad");
    expect(showButton).toBeTruthy();
    // Notes exist ("Initial **note**") so the content indicator dot is rendered.
    // The dot only appears once the notes fetch resolves, which can lag the
    // button's initial render under coverage-instrumented CI parallelism — wait
    // for it rather than asserting synchronously (this raced and flaked on CI).
    await waitFor(() => {
      expect(showButton.querySelector(".bg-primary")).toBeTruthy();
    });
    // The editor is not rendered while collapsed.
    expect(screen.queryByLabelText("notes editor")).toBeNull();
  });
});
