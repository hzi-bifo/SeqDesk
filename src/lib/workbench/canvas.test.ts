import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKBENCH_CANVAS,
  createReferenceGenomeSourceNode,
  createTextNoteNode,
  parseWorkbenchCanvas,
  stringifyWorkbenchCanvas,
} from "./canvas";

describe("workbench canvas", () => {
  it("normalizes invalid canvas JSON to the default canvas", () => {
    expect(parseWorkbenchCanvas("not json")).toEqual(DEFAULT_WORKBENCH_CANVAS);
    expect(parseWorkbenchCanvas({ version: 99 })).toEqual(DEFAULT_WORKBENCH_CANVAS);
  });

  it("serializes supported source and note nodes", () => {
    const source = createReferenceGenomeSourceNode({ id: "source-1", x: 10, y: 20 });
    const note = createTextNoteNode({ id: "note-1", x: 30, y: 40, note: "hello" });
    const canvas = parseWorkbenchCanvas(
      stringifyWorkbenchCanvas({
        version: 1,
        nodes: [source, note],
        edges: [{ id: "edge-1", source: "source-1", target: "note-1" }],
        viewport: { x: 0, y: 0, zoom: 1 },
      })
    );

    expect(canvas.nodes.map((node) => node.data.kind)).toEqual(["source.importer", "note"]);
    expect(canvas.nodes[0].data.providerId).toBe("ncbi-genomes-taxon");
    expect(canvas.edges[0]).toMatchObject({ source: "source-1", target: "note-1" });
  });
});
