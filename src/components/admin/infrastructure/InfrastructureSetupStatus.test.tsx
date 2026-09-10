// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { InfrastructureSetupStatus } from "./InfrastructureSetupStatus";

function jsonResponse(data: unknown, ok = true) {
  return {
    ok,
    json: async () => data,
  } as Response;
}

describe("InfrastructureSetupStatus", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    moduleEnabledMock.mockReturnValue(false);
  });

  it("loads setup statuses, shows failing fix links, and refreshes them", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/admin/settings/sequencing-files") {
        return jsonResponse({
          dataBasePath: "/data",
          config: { allowedExtensions: [".fastq.gz"] },
        });
      }
      if (url === "/api/admin/settings/pipelines/execution") {
        return jsonResponse({
          settings: {
            pipelineRunDir: "/runs",
            condaPath: "/miniconda",
            weblogUrl: "",
            weblogSecret: "",
          },
        });
      }
      if (url === "/api/admin/settings/sequencing-files/test") {
        return jsonResponse({
          valid: true,
          message: "Directory looks good",
        });
      }
      if (url === "/api/admin/settings/pipelines/test-setting") {
        const body = JSON.parse(String(init?.body || "{}"));
        if (body.setting === "pipelineRunDir") {
          return jsonResponse({ success: true, message: "Run directory OK" });
        }
        if (body.setting === "condaPath") {
          return jsonResponse({ success: false, message: "Conda missing" });
        }
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(
      <InfrastructureSetupStatus
        fixLinks={{
          conda: "/docs/conda",
          weblog: "/docs/weblog",
        }}
      />
    );

    expect(screen.getByText("Loading saved configuration...")).toBeTruthy();

    await screen.findByText("Storage & pipeline checks");
    expect(screen.getAllByText("Configured · not checked")).toHaveLength(3);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Run storage and pipeline checks" }));

    expect(await screen.findByText("Directory looks good")).toBeTruthy();
    expect(screen.getByText("Run directory OK")).toBeTruthy();
    expect(screen.getByText("Conda missing")).toBeTruthy();
    expect(screen.getByText("Not configured")).toBeTruthy();
    const pathTest = fetchMock.mock.calls.find(([url]) => url === "/api/admin/settings/sequencing-files/test");
    expect(JSON.parse(pathTest?.[1]?.body)).toMatchObject({ scanForSequencingFiles: false });

    const fixLinks = screen.getAllByRole("link", { name: "Fix" });
    expect(fixLinks.map((link) => link.getAttribute("href"))).toEqual([
      "/docs/conda",
      "/docs/weblog",
    ]);

    const initialCalls = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });

  it("only scans facility files when sequencing management is enabled", async () => {
    moduleEnabledMock.mockImplementation((id: string) => id === "sequencing-management");
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/admin/settings/sequencing-files") return jsonResponse({ dataBasePath: "/data" });
      if (url === "/api/admin/settings/pipelines/execution") return jsonResponse({ settings: {} });
      if (url === "/api/admin/settings/sequencing-files/test") return jsonResponse({ valid: true });
      if (url === "/api/admin/settings/pipelines/test-setting") return jsonResponse({ success: true, message: "Available" });
      throw new Error(`Unexpected request: ${url}`);
    });
    render(<InfrastructureSetupStatus />);
    await screen.findByText("Storage & pipeline checks");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Run storage and pipeline checks" }));
    await screen.findByText("Directory looks good");
    const pathTest = fetchMock.mock.calls.find(([url]) => url === "/api/admin/settings/sequencing-files/test");
    expect(JSON.parse(pathTest?.[1]?.body)).toMatchObject({ scanForSequencingFiles: true });
    expect(screen.getByRole("button", { name: "Run storage and pipeline checks" })).toBeTruthy();
  });

  it("does not repeat requests for identical inline links or run probes after a module update", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/admin/settings/sequencing-files") return jsonResponse({ dataBasePath: "/data" });
      if (url === "/api/admin/settings/pipelines/execution") return jsonResponse({ settings: { pipelineRunDir: "/runs" } });
      throw new Error(`Unexpected probe: ${url}`);
    });
    const { rerender } = render(<InfrastructureSetupStatus fixLinks={{ conda: "#conda" }} />);
    await screen.findByText("Storage & pipeline checks");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    rerender(<InfrastructureSetupStatus fixLinks={{ conda: "#conda" }} />);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    moduleEnabledMock.mockReturnValue(true);
    rerender(<InfrastructureSetupStatus fixLinks={{ conda: "#conda" }} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("surfaces load errors from the admin settings endpoints", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/admin/settings/sequencing-files") {
        return jsonResponse({ error: "Storage unavailable" }, false);
      }
      if (url === "/api/admin/settings/pipelines/execution") {
        return jsonResponse({
          settings: {
            pipelineRunDir: "/runs",
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<InfrastructureSetupStatus />);

    await waitFor(() => {
      expect(screen.getByText("Storage unavailable")).toBeTruthy();
    });
  });
});
