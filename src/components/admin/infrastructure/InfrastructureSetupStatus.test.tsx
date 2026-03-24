// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
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

    expect(screen.getByText("Checking setup status...")).toBeTruthy();

    await screen.findByText("Setup Status");

    expect(screen.getByText("Directory looks good")).toBeTruthy();
    expect(screen.getByText("Run directory OK")).toBeTruthy();
    expect(screen.getByText("Conda missing")).toBeTruthy();
    expect(screen.getByText("Not configured")).toBeTruthy();

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
