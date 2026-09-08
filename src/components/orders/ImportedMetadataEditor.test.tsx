// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ImportedMetadataEditor } from "./ImportedMetadataEditor";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("saves only local metadata and never sends origin, source snapshots, files or status", async () => {
  const request = vi.fn().mockResolvedValue({ ok: true }); vi.stubGlobal("fetch", request);
  render(<ImportedMetadataEditor initial={{ id: "data", name: "Local data", samples: [{ id: "sample", sampleId: "source-id", sampleTitle: "Local sample", sampleDescription: "Description", scientificName: "Organism" }] }} />);
  fireEvent.change(screen.getByLabelText("Sample title"), { target: { value: "Updated title" } });
  fireEvent.click(screen.getByRole("button", { name: "Save sample metadata" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Metadata saved"));
  expect(request).toHaveBeenCalledWith("/api/samples/sample", expect.objectContaining({ method: "PUT", body: JSON.stringify({ sampleTitle: "Updated title", sampleDescription: "Description", scientificName: "Organism" }) }));
  fireEvent.click(screen.getByRole("button", { name: "Save data name" }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(request).toHaveBeenLastCalledWith("/api/orders/data", expect.objectContaining({ body: JSON.stringify({ name: "Local data" }) }));
});
it("shows a failed save without reporting success", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Forbidden" }) }));
  render(<ImportedMetadataEditor initial={{ id: "data", name: "Local data", samples: [] }} />);
  fireEvent.click(screen.getByRole("button", { name: "Save data name" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Forbidden"));
  expect(screen.queryByRole("status")).toBeNull();
});
