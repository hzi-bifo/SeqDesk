import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";

import {
  findDagFile,
  getTopologicalOrder,
  parseDagContent,
  parseDagFile,
} from "./dag-parser";

let tempDir: string;

async function writeFile(relPath: string, content: string): Promise<string> {
  const target = path.join(tempDir, relPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
  return target;
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-dag-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("nextflow dag parser", () => {
  it("parses nodes, edges, node types, and process-level edges", () => {
    const content = [
      "digraph {",
      '  o0 [label="origin" shape=point]',
      '  p0 [label="NFCORE_MAG:MAG:FASTQC"]',
      '  op1 [label="Channel.mix" shape=box]',
      '  p1 [label="NFCORE_MAG:MAG:TRIM"]',
      '  end [label="terminal" shape=doublecircle]',
      '  o0 -> p0 [label="reads"]',
      "  p0 -> op1",
      "  op1 -> p1",
      "  p1 -> end",
      "}",
    ].join("\n");

    const dag = parseDagContent(content);

    expect(dag.nodes.get("o0")?.type).toBe("origin");
    expect(dag.nodes.get("op1")?.type).toBe("operator");
    expect(dag.nodes.get("end")?.type).toBe("terminal");
    expect(dag.nodes.get("p0")?.process).toBe("FASTQC");
    expect(dag.nodes.get("p1")?.process).toBe("TRIM");

    expect(dag.edges).toContainEqual({ from: "o0", to: "p0", label: "reads" });
    expect(dag.processNodes.sort()).toEqual(["FASTQC", "TRIM"]);
    expect(dag.processEdges).toContainEqual({ from: "FASTQC", to: "TRIM" });
  });

  it("deduplicates process edges and skips self-process links", () => {
    const content = [
      "digraph {",
      '  p0 [label="WF:A"]',
      '  p1 [label="WF:B"]',
      '  op1 [label="Channel.one" shape=box]',
      '  op2 [label="Channel.two" shape=box]',
      '  same1 [label="WF:SAME"]',
      '  same2 [label="WF:SAME"]',
      "  p0 -> op1",
      "  p0 -> op2",
      "  op1 -> p1",
      "  op2 -> p1",
      "  same1 -> same2",
      "}",
    ].join("\n");

    const dag = parseDagContent(content);

    const aToB = dag.processEdges.filter((e) => e.from === "A" && e.to === "B");
    const selfEdges = dag.processEdges.filter((e) => e.from === "SAME" && e.to === "SAME");

    expect(aToB).toHaveLength(1);
    expect(selfEdges).toHaveLength(0);
  });

  it("parseDagFile reads and parses from disk", async () => {
    const dagPath = await writeFile(
      "pipeline_info/dag.dot",
      ['digraph {', 'p0 [label="WF:FASTQC"]', 'p1 [label="WF:TRIM"]', "p0 -> p1", "}"].join(
        "\n"
      )
    );

    const dag = await parseDagFile(dagPath);

    expect(dag.processNodes.sort()).toEqual(["FASTQC", "TRIM"]);
    expect(dag.processEdges).toContainEqual({ from: "FASTQC", to: "TRIM" });
  });

  it("findDagFile checks known DAG paths in priority order", async () => {
    const topLevel = await writeFile("dag.dot", "digraph {}");
    await writeFile("pipeline_info/dag.dot", "digraph {}");
    await writeFile("pipeline_info/dag.svg", "<svg></svg>");

    const found = await findDagFile(tempDir);

    expect(found).toBe(topLevel);
  });

  it("findDagFile returns null when no DAG file exists", async () => {
    const found = await findDagFile(tempDir);
    expect(found).toBeNull();
  });

  it("getTopologicalOrder sorts process DAG", () => {
    const dag = {
      nodes: new Map(),
      edges: [],
      processNodes: ["QC", "ASSEMBLY", "REPORT"],
      processEdges: [
        { from: "QC", to: "ASSEMBLY" },
        { from: "ASSEMBLY", to: "REPORT" },
      ],
    };

    const order = getTopologicalOrder(dag);

    expect(order).toEqual(["QC", "ASSEMBLY", "REPORT"]);
  });

  it("parseDagContent tolerates malformed attributes", () => {
    const content = [
      "digraph {",
      '  p0 [bad attr]',
      '  p1 [label="B"]',
      "  p0 -> p1",
      "}",
    ].join("\n");

    const dag = parseDagContent(content);

    expect(dag.nodes.get("p0")?.label).toBe("p0");
    expect(dag.processEdges).toContainEqual({ from: "p0", to: "B" });
  });

  it("parseDagContent ignores edges to missing nodes while preserving known process edges", () => {
    const content = [
      "digraph {",
      '  p0 [label="A"]',
      '  p1 [label="B"]',
      "  p0 -> p2",
      "  p1 -> p0",
      "}",
    ].join("\n");

    const dag = parseDagContent(content);

    expect(dag.processNodes.sort()).toEqual(["A", "B"]);
    expect(dag.processEdges).toContainEqual({ from: "B", to: "A" });
    expect(dag.processEdges).not.toContainEqual({ from: "A", to: "p2" });
  });

  it("extracts process name from labels with trailing separators", () => {
    const content = [
      "digraph {",
      '  p0 [label="NFCORE_MAG:"]',
      "  p1 [label=\"FASTQC\"]",
      "  p0 -> p1",
      "}",
    ].join("\n");

    const dag = parseDagContent(content);

    expect(dag.nodes.get("p0")?.process).toBe("NFCORE_MAG:");
    expect(dag.processEdges).toContainEqual({ from: "NFCORE_MAG:", to: "FASTQC" });
  });

  it("getTopologicalOrder handles fan-in edges with delayed readiness", () => {
    const dag = {
      nodes: new Map(),
      edges: [],
      processNodes: ["A", "B", "C", "D"],
      processEdges: [
        { from: "A", to: "B" },
        { from: "A", to: "C" },
        { from: "B", to: "D" },
        { from: "C", to: "D" },
      ],
    };

    const order = getTopologicalOrder(dag);
    const dIndex = order.indexOf("D");
    const bIndex = order.indexOf("B");
    const cIndex = order.indexOf("C");

    expect(order).toHaveLength(4);
    expect(dIndex).toBeGreaterThan(bIndex);
    expect(dIndex).toBeGreaterThan(cIndex);
  });

  it("getTopologicalOrder handles edges to missing process nodes", () => {
    const dag = {
      nodes: new Map(),
      edges: [],
      processNodes: ["A", "B"],
      processEdges: [{ from: "A", to: "MISSING" }],
    };

    const order = getTopologicalOrder(dag);

    expect(order).toEqual(["A", "B", "MISSING"]);
  });

  it("getTopologicalOrder handles unstable process edge targets by treating them as ready", () => {
    let sequence = 0;
    const unstableEdge = {} as { from: string; to: string };
    Object.defineProperty(unstableEdge, "from", { value: "A", enumerable: true });
    Object.defineProperty(unstableEdge, "to", {
      enumerable: true,
      get() {
        return `MISSING-${sequence++}`;
      },
    });

    const dag = {
      nodes: new Map(),
      edges: [],
      processNodes: ["A"],
      processEdges: [unstableEdge],
    };

    const order = getTopologicalOrder(dag as unknown as Parameters<typeof getTopologicalOrder>[0]);

    expect(order).toEqual(["A", "MISSING-0"]);
  });
});
