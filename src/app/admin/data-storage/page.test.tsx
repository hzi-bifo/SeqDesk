// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeploymentProfileProvider } from "@/components/deployment-profile/DeploymentProfileProvider";
import { getDeploymentProfileDefinition } from "@/lib/deployment-profile";

const fetchMock = vi.fn();
const moduleEnabledMock = vi.fn();

vi.mock("@/lib/modules", () => ({
  useModuleEnabled: (id: string) => moduleEnabledMock(id),
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

vi.mock(
  "@/components/admin/infrastructure/InfrastructureSetupStatus",
  () => ({ InfrastructureSetupStatus: () => <div>Infrastructure status</div> })
);

vi.mock("@/lib/notifications/client", () => ({
  notifyPanel: { error: vi.fn() },
}));

vi.mock("@/components/ui/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import DataStoragePage from "./page";

function response(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

function renderProfile(profile: "sequencing-center" | "shared-lab" | "research-workbench") {
  return render(
    <DeploymentProfileProvider
      profile={getDeploymentProfileDefinition(profile)}
    >
      <DataStoragePage />
    </DeploymentProfileProvider>
  );
}

describe("module-aware data storage settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    moduleEnabledMock.mockImplementation((id: string) => id === "sequencing-management");
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/admin/settings/sequencing-files") {
        return response({
          dataBasePath: "/data/seqdesk",
          dataBasePathSource: "database",
          dataBasePathIsImplicit: false,
          config: {
            allowedExtensions: [".fastq.gz"],
            scanDepth: 2,
            ignorePatterns: [],
            allowSingleEnd: true,
            autoAssign: false,
          },
        });
      }
      if (url === "/api/admin/settings/sequencing-files/test") {
        return response({
          valid: true,
          readable: true,
          writable: true,
          message: "Directory is accessible and writable",
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each(["sequencing-center", "shared-lab", "research-workbench"] as const)("keeps shared storage and skips facility discovery when its module is disabled in %s", async (profile) => {
    moduleEnabledMock.mockReturnValue(false);
    renderProfile(profile);

    await screen.findByText("Data directory");
    expect(screen.queryByRole("button", { name: "Advanced" })).toBeNull();
    expect(screen.queryByText("Allowed File Extensions")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Test Path" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/settings/sequencing-files/test",
        expect.objectContaining({ method: "POST" })
      );
    });
    const testCall = fetchMock.mock.calls.find(
      ([url]) => url === "/api/admin/settings/sequencing-files/test"
    );
    expect(JSON.parse(String(testCall?.[1]?.body))).toMatchObject({
      basePath: "/data/seqdesk",
      scanForSequencingFiles: false,
    });
  });

  it.each(["sequencing-center", "shared-lab", "research-workbench"] as const)("enables facility discovery through its module in %s", async (profile) => {
    renderProfile(profile);

    await screen.findByText("Data directory");
    expect(screen.getByRole("button", { name: "Advanced" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Test Path" }));

    await waitFor(() => {
      const testCall = fetchMock.mock.calls.find(
        ([url]) => url === "/api/admin/settings/sequencing-files/test"
      );
      expect(JSON.parse(String(testCall?.[1]?.body))).toMatchObject({
        scanForSequencingFiles: true,
      });
    });
  });

  it("does not overwrite facility matching settings when saving shared storage with the module disabled", async () => {
    moduleEnabledMock.mockReturnValue(false);
    renderProfile("sequencing-center");
    await screen.findByLabelText("Data directory");
    fireEvent.click(screen.getByRole("button", { name: "Save storage settings" }));
    await waitFor(() => {
      const saveCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
      expect(JSON.parse(String(saveCall?.[1]?.body))).toEqual({ dataBasePath: "/data/seqdesk" });
    });
  });

  it("shows a retry state instead of a default editable form when loading fails", async () => {
    fetchMock.mockResolvedValueOnce(response({ error: "Unavailable" }, false));
    renderProfile("sequencing-center");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save storage settings" })).toBeNull();
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByLabelText("Data directory");
  });

  it("keeps operator-managed paths locked and explains where to change them", async () => {
    fetchMock.mockResolvedValueOnce(response({
      dataBasePath: "/installed-data",
      dataBasePathSource: "file",
      config: { allowedExtensions: [".fastq.gz"] },
    }));
    moduleEnabledMock.mockReturnValue(false);
    renderProfile("research-workbench");
    const pathInput = await screen.findByLabelText("Data directory");
    expect((pathInput as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("seqdesk storage configure /absolute/path/to/managed-data")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save storage settings" }));
    await waitFor(() => {
      const saveCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
      expect(JSON.parse(String(saveCall?.[1]?.body))).toEqual({});
    });
  });

  it("allows configuring a legitimately empty storage location without treating it as a load failure", async () => {
    fetchMock.mockResolvedValueOnce(response({ dataBasePath: "", dataBasePathSource: "none", config: {} }));
    renderProfile("shared-lab");
    const pathInput = await screen.findByLabelText("Data directory") as HTMLInputElement;
    expect(pathInput.value).toBe("");
    expect(pathInput.disabled).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
    expect((screen.getByRole("button", { name: "Test Path" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([401, 403])("does not expose a form after a %i access response", async (status) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Access denied" }), { status }));
    renderProfile("sequencing-center");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByLabelText("Data directory")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save storage settings" })).toBeNull();
  });
});
