// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InstallationDetailsPage from "./page";

const revision = "2026-09-10T10:00:00.000Z";
const fixture = {
  settings: { name: "My lab", contactEmail: "lab@example.org" },
  sources: { name: "database", contactEmail: "database" },
  editable: { name: true, contactEmail: true },
  revision,
  readOnlyReason: null,
};
const fetchMock = vi.fn();
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (_input: unknown, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      return response({ ...fixture, settings: { name: body.name ?? fixture.settings.name, contactEmail: body.contactEmail ?? fixture.settings.contactEmail }, revision: "2026-09-10T10:01:00.000Z" });
    }
    return response(fixture);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Installation details form", () => {
  it("loads a skeleton and renders explicit fields without saving on visit", async () => {
    render(<InstallationDetailsPage />);
    expect(screen.getByRole("status", { name: "Loading installation details" })).toBeTruthy();
    expect((await screen.findByLabelText("Installation name") as HTMLInputElement).value).toBe("My lab");
    expect((screen.getByLabelText("Contact email (optional)") as HTMLInputElement).value).toBe("lab@example.org");
    expect((screen.getByRole("button", { name: "Save installation details" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("link", { name: "Configure email notifications" }).getAttribute("href")).toBe("/admin/settings/notifications");
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== "PUT")).toBe(true);
  });

  it("saves only changed fields with the loaded revision and clears dirty state after success", async () => {
    render(<InstallationDetailsPage />);
    fireEvent.change(await screen.findByLabelText("Installation name"), { target: { value: " New lab " } });
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save installation details" }));
    await screen.findByText("Saved. No restart is needed for values changed here.");
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(put?.[1]?.body)).toEqual({ name: "New lab", expectedRevision: revision });
    expect((screen.getByLabelText("Installation name") as HTMLInputElement).value).toBe("New lab");
    expect((screen.getByRole("button", { name: "Save installation details" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps typed values on save failure so retry is possible", async () => {
    render(<InstallationDetailsPage />);
    const input = await screen.findByLabelText("Contact email (optional)") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "new@example.org" } });
    fetchMock.mockResolvedValueOnce(response({ error: "Connection failed" }, 500));
    fireEvent.click(screen.getByRole("button", { name: "Save installation details" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Connection failed");
    expect(input.value).toBe("new@example.org");
    expect((screen.getByRole("button", { name: "Save installation details" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps edits after conflict until explicitly reloading the saved values", async () => {
    render(<InstallationDetailsPage />);
    const input = await screen.findByLabelText("Installation name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "My unsaved name" } });
    fetchMock.mockResolvedValueOnce(response({ error: "Settings changed elsewhere", code: "settings-conflict" }, 409));
    fireEvent.click(screen.getByRole("button", { name: "Save installation details" }));
    await screen.findByRole("alert");
    expect(input.value).toBe("My unsaved name");
    expect((screen.getByRole("button", { name: "Save installation details" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Reload saved values (discard edits)" }));
    expect((await screen.findByLabelText("Installation name") as HTMLInputElement).value).toBe("My lab");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
  });

  it.each(["env", "file"])("explains and omits %s-managed fields when saving an editable field", async source => {
    fetchMock.mockResolvedValueOnce(response({ ...fixture, sources: { ...fixture.sources, name: source }, editable: { name: false, contactEmail: true } }));
    render(<InstallationDetailsPage />);
    const name = await screen.findByLabelText("Installation name") as HTMLInputElement;
    expect(name.disabled).toBe(true);
    expect(screen.getByText(source === "env" ? "SEQDESK_SITE_NAME" : "site.name")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Contact email (optional)"), { target: { value: "new@example.org" } });
    fireEvent.click(screen.getByRole("button", { name: "Save installation details" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(put?.[1]?.body)).toEqual({ contactEmail: "new@example.org", expectedRevision: revision });
  });

  it("keeps demo details read-only", async () => {
    fetchMock.mockResolvedValueOnce(response({ ...fixture, editable: { name: false, contactEmail: false }, readOnlyReason: "Installation details are read-only in the demo." }));
    render(<InstallationDetailsPage />);
    expect((await screen.findByLabelText("Installation name") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Contact email (optional)") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Installation details are read-only in the demo.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save installation details" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("hides the editable form on failed load and provides retry", async () => {
    fetchMock.mockResolvedValueOnce(response({ error: "Cannot load settings" }, 503));
    render(<InstallationDetailsPage />);
    await screen.findByRole("alert");
    expect(screen.queryByLabelText("Installation name")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Installation name")).toBeTruthy();
  });

  it("rejects malformed successful loads instead of making defaults editable", async () => {
    fetchMock.mockResolvedValueOnce(response({}));
    render(<InstallationDetailsPage />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByLabelText("Installation name")).toBeNull();
  });

  it("validates locally and preserves an invalid email without sending it", async () => {
    render(<InstallationDetailsPage />);
    const input = await screen.findByLabelText("Contact email (optional)") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "invalid" } });
    fireEvent.click(screen.getByRole("button", { name: "Save installation details" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Enter a valid contact email or leave it empty.");
    expect(input.value).toBe("invalid");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });
});
