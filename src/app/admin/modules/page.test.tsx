// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import ModulesPage from "./page";
import { AVAILABLE_MODULES, DEFAULT_BILLING_SETTINGS, DEFAULT_MODULE_STATES, isAlwaysEnabledModule } from "@/lib/modules/types";

const hooks = vi.hoisted(() => ({
  query: "",
  replace: vi.fn(),
  toggle: vi.fn(),
  refresh: vi.fn(),
  setGlobalDisabled: vi.fn(),
  fetch: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
let moduleState: {
  availableModules: typeof AVAILABLE_MODULES;
  moduleStates: Record<string, boolean>;
  globalDisabled: boolean;
  incompatibleModules: string[];
  loading: boolean;
  error: string | null;
};
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: hooks.replace }),
  useSearchParams: () => new URLSearchParams(hooks.query),
}));
vi.mock("@/lib/modules", () => ({ useModules: () => ({
  ...moduleState,
  setModuleEnabled: hooks.toggle,
  refresh: hooks.refresh,
  setGlobalDisabled: hooks.setGlobalDisabled,
  isModuleEnabled: (id: string) => !moduleState.incompatibleModules.includes(id) &&
    (!moduleState.globalDisabled || isAlwaysEnabledModule(id)) && !!moduleState.moduleStates[id],
}) }));
vi.mock("@/components/deployment-profile/DeploymentProfileProvider", () => ({
  useDeploymentProfile: () => ({ label: "SeqDesk" }),
}));
vi.mock("@/components/ui/toast", () => ({ toast: hooks.toast }));
vi.mock("@/lib/notifications/client", () => ({ notifyPanel: { error: vi.fn() } }));

const response = (data: unknown, ok = true) => ({ ok, json: async () => data });
function mockSettings(url: string) {
  if (url.endsWith("/account-validation")) return response({ settings: { allowedDomains: ["lab.example"], enforceValidation: true } });
  if (url.endsWith("/billing")) return response({ settings: DEFAULT_BILLING_SETTINGS });
  return response({ fields: [], groups: [], enabledMixsChecklists: [] });
}

beforeEach(() => {
  vi.clearAllMocks();
  hooks.query = "";
  moduleState = {
    availableModules: AVAILABLE_MODULES,
    moduleStates: { ...DEFAULT_MODULE_STATES },
    globalDisabled: false, incompatibleModules: [], loading: false, error: null,
  };
  hooks.fetch.mockReset().mockImplementation(async (url: string) => mockSettings(url));
  hooks.toggle.mockReset().mockResolvedValue(undefined);
  hooks.refresh.mockReset().mockResolvedValue(undefined);
  hooks.setGlobalDisabled.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", hooks.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Modules settings", () => {
  it("shows facility and import modules together with shared catalog descriptions", async () => {
    hooks.query = "category=data-sources";
    render(<ModulesPage />);
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getByRole("heading", { name: "Facility sequencing" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "CAMI benchmark reads" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "SRA / ENA reads" })).toBeTruthy();
    expect(screen.getByText("Import short or long reads from CAMI benchmarks, together with sample metadata.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "MIxS Metadata" })).toBeNull();
    await waitFor(() => expect(hooks.fetch).toHaveBeenCalledTimes(4));
    expect(hooks.toggle).not.toHaveBeenCalled();
  });

  it("supports all modules, legacy category IDs and category URL navigation", async () => {
    const view = render(<ModulesPage />);
    expect(screen.getAllByRole("article")).toHaveLength(AVAILABLE_MODULES.length);
    fireEvent.click(screen.getByRole("button", { name: "Metadata & forms" }));
    expect(hooks.replace).toHaveBeenCalledWith("/admin/modules?category=order-form", { scroll: false });
    hooks.query = "category=order-form";
    view.rerender(<ModulesPage />);
    expect(screen.getByRole("heading", { name: "MIxS Metadata" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "CAMI benchmark reads" })).toBeNull();
    await waitFor(() => expect(hooks.fetch).toHaveBeenCalledTimes(4));
  });

  it("falls back safely for unknown categories and searches names, features and formats", async () => {
    hooks.query = "category=not-a-category";
    render(<ModulesPage />);
    expect(screen.getByRole("button", { name: "All modules" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(screen.getByRole("textbox", { name: "Search modules" }), { target: { value: "  paired-end  " } });
    expect(screen.getAllByRole("article")).toHaveLength(2);
    fireEvent.change(screen.getByRole("textbox", { name: "Search modules" }), { target: { value: "missing-module" } });
    expect(screen.getByRole("heading", { name: "No matching modules" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all modules" }));
    expect(screen.getAllByRole("article")).toHaveLength(AVAILABLE_MODULES.length);
    await waitFor(() => expect(hooks.fetch).toHaveBeenCalledTimes(4));
  });

  it("keeps toggles explicit and prevents a second toggle while saving", async () => {
    hooks.query = "category=data-sources";
    let finish!: () => void;
    hooks.toggle.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<ModulesPage />);
    fireEvent.click(screen.getByRole("switch", { name: "Enable CAMI benchmark reads" }));
    expect(hooks.toggle).toHaveBeenCalledWith("import-cami", false);
    expect(screen.getByRole("switch", { name: "Enable SRA / ENA reads" }).hasAttribute("disabled")).toBe(true);
    finish();
    await waitFor(() => expect(screen.getByRole("switch", { name: "Enable SRA / ENA reads" }).hasAttribute("disabled")).toBe(false));
    expect(hooks.toast.success).toHaveBeenCalled();
  });

  it("preserves unavailable, always-active, coming-soon and globally paused states", async () => {
    moduleState.globalDisabled = true;
    moduleState.incompatibleModules = ["import-sra"];
    moduleState.availableModules = [...AVAILABLE_MODULES, { id: "future", name: "Future source", description: "Not shipped", category: "data-sources", comingSoon: true }];
    render(<ModulesPage />);
    expect(within(screen.getByRole("article", { name: "SRA / ENA reads" })).getByText("Unavailable in SeqDesk")).toBeTruthy();
    expect(within(screen.getByRole("article", { name: "Sequencing Technology" })).getByText("Always active")).toBeTruthy();
    expect(within(screen.getByRole("article", { name: "Future source" })).getByText("Coming Soon")).toBeTruthy();
    expect(within(screen.getByRole("article", { name: "CAMI benchmark reads" })).getByText("Paused by installation setting")).toBeTruthy();
    expect(screen.getAllByRole("switch").every(element => element.hasAttribute("disabled"))).toBe(true);
    await waitFor(() => expect(hooks.fetch).toHaveBeenCalledTimes(4));
  });

  it("shows a retry when module availability could not be loaded", async () => {
    moduleState.error = "Could not load module settings.";
    render(<ModulesPage />);
    expect(screen.getByRole("alert").textContent).toContain("Module availability is unknown");
    expect(screen.queryByRole("switch")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(hooks.refresh).toHaveBeenCalledTimes(1));
  });

  it("confirms resuming previously enabled modules without modifying individual choices", async () => {
    moduleState.globalDisabled = true;
    let finish!: () => void;
    hooks.setGlobalDisabled.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<ModulesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Resume optional modules" }));
    expect(screen.getByRole("dialog").textContent).toContain("Individually disabled modules stay disabled");
    expect(hooks.setGlobalDisabled).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Resume modules" }));
    expect(hooks.setGlobalDisabled).toHaveBeenCalledWith(false);
    expect(screen.getByRole("button", { name: "Resuming…" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
    finish();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(hooks.toggle).not.toHaveBeenCalled();
  });

  it("keeps resume confirmation available for retry after a failed save", async () => {
    moduleState.globalDisabled = true;
    hooks.setGlobalDisabled.mockRejectedValueOnce(new Error("offline"));
    render(<ModulesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Resume optional modules" }));
    fireEvent.click(screen.getByRole("button", { name: "Resume modules" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Resume modules" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByRole("switch").every(element => element.hasAttribute("disabled"))).toBe(true);
    expect(hooks.toggle).not.toHaveBeenCalled();
  });

  it("retains form builder links and explicit field-add actions without changing forms on load", async () => {
    hooks.query = "category=order-form";
    render(<ModulesPage />);
    const mixs = screen.getByRole("article", { name: "MIxS Metadata" });
    fireEvent.click(within(mixs).getByText("Configure form fields"));
    expect(within(mixs).getByRole("link", { name: "Study Form Builder" }).getAttribute("href")).toBe("/admin/study-form-builder");
    const add = within(mixs).getByRole("button", { name: "Add MIxS to Study Form" });
    await waitFor(() => expect(add.hasAttribute("disabled")).toBe(false));
    expect(hooks.fetch.mock.calls.every(call => call[1]?.method !== "PUT")).toBe(true);
    fireEvent.click(add);
    await waitFor(() => expect(hooks.fetch).toHaveBeenCalledWith("/api/admin/study-form-config", expect.objectContaining({ method: "PUT", body: expect.stringContaining('"type":"mixs"') })));
  });

  it("keeps account and billing settings editable through their expanded cards", async () => {
    moduleState.moduleStates["account-validation"] = true;
    moduleState.moduleStates["billing-info"] = true;
    render(<ModulesPage />);
    fireEvent.click(screen.getByText("Configure allowed email domains"));
    fireEvent.click(screen.getByText("Configure billing fields"));
    await screen.findByRole("button", { name: "Save access settings" });
    fireEvent.change(screen.getByRole("textbox", { name: "Allowed email domain" }), { target: { value: "another.example" } });
    fireEvent.click(within(screen.getByRole("article", { name: "Account Validation" })).getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Save access settings" }));
    await waitFor(() => expect(hooks.fetch).toHaveBeenCalledWith("/api/admin/modules/account-validation", expect.objectContaining({ method: "PUT", body: JSON.stringify({ settings: { allowedDomains: ["lab.example", "another.example"], enforceValidation: true } }) })));
    expect(screen.getByRole("button", { name: "Save billing settings" })).toBeTruthy();
  });

  it("does not mistake unavailable form configuration for missing fields", async () => {
    hooks.query = "category=order-form";
    hooks.fetch.mockImplementation(async (url: string) => url.includes("form-config") ? response({}, false) : mockSettings(url));
    render(<ModulesPage />);
    const mixs = screen.getByRole("article", { name: "MIxS Metadata" });
    fireEvent.click(within(mixs).getByText("Configure form fields"));
    await within(mixs).findByText("Could not check form fields");
    expect(within(mixs).getByRole("button", { name: "Add MIxS to Study Form" }).hasAttribute("disabled")).toBe(true);
    expect(within(mixs).getByRole("link", { name: "Study Form Builder" })).toBeTruthy();
    hooks.fetch.mockImplementation(async (url: string) => mockSettings(url));
    fireEvent.click(within(mixs).getByRole("button", { name: "Retry form settings" }));
    await waitFor(() => expect(within(mixs).getByRole("button", { name: "Add MIxS to Study Form" }).hasAttribute("disabled")).toBe(false));
  });

  it("does not expose default access or billing values as editable when loading fails", async () => {
    moduleState.moduleStates["account-validation"] = true;
    moduleState.moduleStates["billing-info"] = true;
    hooks.fetch.mockImplementation(async (url: string) => url.includes("/api/admin/modules/") ? response({}, false) : mockSettings(url));
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ModulesPage />);
    fireEvent.click(screen.getByText("Configure allowed email domains"));
    fireEvent.click(screen.getByText("Configure billing fields"));
    await screen.findByRole("button", { name: "Retry access settings" });
    expect(screen.getByRole("button", { name: "Retry billing settings" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save access settings" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save billing settings" })).toBeNull();
    hooks.fetch.mockImplementation(async (url: string) => mockSettings(url));
    fireEvent.click(screen.getByRole("button", { name: "Retry access settings" }));
    await screen.findByRole("button", { name: "Save access settings" });
    vi.restoreAllMocks();
  });

  it("links notification, facility, study and analysis configuration to existing settings pages", async () => {
    render(<ModulesPage />);
    expect(screen.getByRole("link", { name: "Configure report analysis" }).getAttribute("href")).toBe("/admin/settings/analysis");
    expect(screen.getByRole("link", { name: "Configure notifications" }).getAttribute("href")).toBe("/admin/settings/notifications");
    expect(screen.getByRole("link", { name: "Configure study definitions" }).getAttribute("href")).toBe("/admin/study-definitions");
    expect(screen.getByRole("link", { name: "Configure facility forms" }).getAttribute("href")).toBe("/admin/form-builder");
    await waitFor(() => expect(hooks.fetch).toHaveBeenCalledTimes(4));
  });
});
