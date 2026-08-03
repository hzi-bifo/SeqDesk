import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  HUMAN_GUT_ORDER_NUMBERS,
  HUMAN_GUT_RUNS,
} from "@/lib/seed/human-gut-ena-example";
import {
  MOUSE_GUT_ORDER_NUMBER,
  MOUSE_GUT_RUNS,
} from "@/lib/seed/mouse-gut-ena-example";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("example dataset documentation", () => {
  const guide = read("EXAMPLE_DATASETS.md");

  it("publishes every selected public run under the correct orders", () => {
    expect(guide).toContain(MOUSE_GUT_ORDER_NUMBER);
    for (const orderNumber of HUMAN_GUT_ORDER_NUMBERS) {
      expect(guide).toContain(orderNumber);
    }
    for (const run of [...MOUSE_GUT_RUNS, ...HUMAN_GUT_RUNS]) {
      expect(guide).toContain(run.run);
    }

    expect(guide).toContain("16S V3–V4");
    expect(guide).toContain("Illumina MiSeq");
    expect(guide).toContain("NextSeq 550");
    expect(guide).toContain("library_strategy=WGS");
  });

  it("documents both evaluator entry points and their safety boundary", () => {
    expect(guide).toContain("https://demo.seqdesk.org");
    expect(guide).toContain("Admin → Settings → Demo data");
    expect(guide).toContain("seqdesk demo-data install");
    expect(guide).toContain("seqdesk demo-data remove");
    expect(guide).toContain("synthetic");
    expect(guide).toContain("external ENA submission");
    expect(guide).toContain("facility-admin pages are read-only");

    expect(read("README.md")).toContain("EXAMPLE_DATASETS.md");
    expect(read("reviewer-responses.md")).toContain(
      "https://seqdesk.org/docs/getting-started/example-data"
    );
    for (const path of [
      "scripts/install-dist.sh",
      "scripts/install.sh",
      "npm/seqdesk/bin/seqdesk.js",
    ]) {
      expect(read(path)).toContain(
        "https://seqdesk.org/docs/getting-started/example-data"
      );
    }
  });

  it("does not overstate optional private or real-data paths", () => {
    expect(guide).toContain(
      "public mirror result must wait for the matching private commit"
    );
    expect(guide).toContain("only a green pair is evidence");
    expect(guide).toContain("Mouse PRJDB6165 selection above");
    expect(guide).toContain("Human PRJEB54724 selections above");
    expect(guide).toContain("DEV-MAG-ILMN-001");
    expect(guide).toContain("DEV-GEMMA-ONT-001");
    expect(guide).toContain("DEV-RC-SPIKE-001");
    expect(guide).toContain("report `SKIPPED`");
    expect(guide).toContain("fails closed");
    expect(guide).toContain("never substituted for a claimed real assembly");
  });
});
