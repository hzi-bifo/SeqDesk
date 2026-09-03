// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeploymentProfileProvider } from "@/components/deployment-profile/DeploymentProfileProvider";
import { getDeploymentProfileDefinition } from "@/lib/deployment-profile";

const fetchMock = vi.fn();

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

function renderProfile(profile: "sequencing-center" | "research-workbench") {
  return render(
    <DeploymentProfileProvider
      profile={getDeploymentProfileDefinition(profile)}
    >
      <DataStoragePage />
    </DeploymentProfileProvider>
  );
}

describe("profile-aware data storage settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
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

  it("uses neutral Workbench labels and skips sequencing-file discovery", async () => {
    renderProfile("research-workbench");

    await screen.findByText("Managed Dataset Directory");
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

  it("keeps sequencing controls and discovery for Sequencing Center", async () => {
    renderProfile("sequencing-center");

    await screen.findByText("Sequencing Data Directory");
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
});
