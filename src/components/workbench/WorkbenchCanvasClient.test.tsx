// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkbenchCanvasClient } from "./WorkbenchCanvasClient";

vi.mock("@xyflow/react", () => ({
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ReactFlow: ({
    children,
    nodes,
    nodeTypes,
  }: {
    children: React.ReactNode;
    nodes: Array<{ id: string; type?: string; data: Record<string, unknown> }>;
    nodeTypes: Record<string, React.ComponentType<{ data: Record<string, unknown> }>>;
  }) => (
    <div data-testid="workbench-flow">
      {nodes.map((node) => {
        const NodeComponent = nodeTypes[node.type || "workbench"];
        return <NodeComponent key={node.id} data={node.data} />;
      })}
      {children}
    </div>
  ),
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  useReactFlow: () => ({
    screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
  }),
  applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
  applyEdgeChanges: (_changes: unknown, edges: unknown) => edges,
  addEdge: (connection: unknown, edges: unknown[]) => [...edges, connection],
  MarkerType: { ArrowClosed: "arrowclosed" },
  Position: { Left: "left", Right: "right" },
}));

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

const emptyAnalysis = {
  id: "analysis-1",
  name: "Untitled analysis",
  description: null,
  revision: 1,
  isDefault: true,
  updatedAt: "2026-05-21T10:00:00.000Z",
  canvas: {
    version: 1,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
};

describe("WorkbenchCanvasClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("renders the canvas-first Workbench with palette blocks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString();
        if (url === "/api/workbench/analyses") {
          return jsonResponse({ analyses: [emptyAnalysis] });
        }
        if (url === "/api/workbench/analyses/analysis-1") {
          return jsonResponse({ analysis: emptyAnalysis });
        }
        return jsonResponse({ analysis: { ...emptyAnalysis, revision: 2 } });
      })
    );

    render(<WorkbenchCanvasClient />);

    expect(await screen.findByTestId("workbench-flow")).toBeTruthy();
    expect(screen.getByRole("button", { name: /\+ Source/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /\+ Note/i })).toBeTruthy();
    expect(screen.getByText("Reference genomes")).toBeTruthy();
    expect(screen.getByText("Text note")).toBeTruthy();
  });

  it("adds source and note blocks and can run a source node", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === "/api/workbench/analyses") {
        return jsonResponse({ analyses: [emptyAnalysis] });
      }
      if (url === "/api/workbench/analyses/analysis-1" && !init?.method) {
        return jsonResponse({ analysis: emptyAnalysis });
      }
      if (url === "/api/workbench/analyses/analysis-1" && init?.method === "PATCH") {
        return jsonResponse({ analysis: { ...emptyAnalysis, revision: 2 } });
      }
      if (url.match(/\/api\/workbench\/analyses\/analysis-1\/nodes\/source-.+\/run/)) {
        return jsonResponse({ success: true, job: { id: "job-1" } }, { status: 202 });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchCanvasClient />);

    await screen.findByDisplayValue("Untitled analysis");
    fireEvent.click(screen.getByRole("button", { name: /\+ Source/i }));
    fireEvent.click(screen.getByRole("button", { name: /\+ Note/i }));

    expect(await screen.findAllByText("Reference genomes")).toHaveLength(2);
    expect(await screen.findAllByText("Text note")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /Play/i }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url, init]) =>
          url.toString().includes("/nodes/source-") && (init as RequestInit | undefined)?.method === "POST"
        )
      ).toBe(true)
    );
  });
});
