import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildMegahitAssemblyGz,
  resolveFixtureAssemblySource as resolveFixtureAssemblySourceImpl,
  selectAssemblySource,
} from "./run-submg-e2e.mjs";

const resolveFixtureAssemblySource = resolveFixtureAssemblySourceImpl as (options?: {
  requestedSource?: string;
  submitAssembly?: boolean;
}) => string;

const temporaryDirectories: string[] = [];

function makeTemporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "submg-assembly-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writeFakeMegahit(
  directory: string,
  behavior: "nonzero" | "empty" | "valid",
) {
  const binary = path.join(directory, `megahit-${behavior}`);
  const source = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
if (process.argv.includes("--version")) process.exit(0);
const behavior = ${JSON.stringify(behavior)};
if (behavior === "nonzero") process.exit(17);
const outputIndex = process.argv.indexOf("-o");
const outputDirectory = process.argv[outputIndex + 1];
fs.mkdirSync(outputDirectory, { recursive: true });
const contigs = path.join(outputDirectory, "final.contigs.fa");
if (behavior === "empty") fs.writeFileSync(contigs, "");
if (behavior === "valid") fs.writeFileSync(contigs, ">contig_1\\n" + "A".repeat(1000) + "\\n");
`;
  fs.writeFileSync(binary, source, { mode: 0o755 });
  return binary;
}

function pairedReads(directory: string) {
  const read1 = path.join(directory, "reads_1.fastq");
  const read2 = path.join(directory, "reads_2.fastq");
  fs.writeFileSync(read1, "@r1\nACGT\n+\nIIII\n");
  fs.writeFileSync(read2, "@r1\nTGCA\n+\nIIII\n");
  return { read1, read2 };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("SubMG E2E assembly provenance", () => {
  it("fails when the MEGAHIT binary is missing", () => {
    const directory = makeTemporaryDirectory();
    const { read1, read2 } = pairedReads(directory);

    expect(() =>
      buildMegahitAssemblyGz(read1, read2, {
        bin: path.join(directory, "missing-megahit"),
        tempRoot: directory,
      }),
    ).toThrow(/MEGAHIT binary is unavailable/);
  });

  it("fails when MEGAHIT exits nonzero", () => {
    const directory = makeTemporaryDirectory();
    const { read1, read2 } = pairedReads(directory);

    expect(() =>
      buildMegahitAssemblyGz(read1, read2, {
        bin: writeFakeMegahit(directory, "nonzero"),
        tempRoot: directory,
      }),
    ).toThrow(/MEGAHIT execution failed[\s\S]*exit status 17/);
  });

  it("fails when MEGAHIT produces an empty assembly", () => {
    const directory = makeTemporaryDirectory();
    const { read1, read2 } = pairedReads(directory);

    expect(() =>
      buildMegahitAssemblyGz(read1, read2, {
        bin: writeFakeMegahit(directory, "empty"),
        tempRoot: directory,
      }),
    ).toThrow(/no usable contig/);
  });

  it("returns a gzipped MEGAHIT assembly when output is valid", () => {
    const directory = makeTemporaryDirectory();
    const { read1, read2 } = pairedReads(directory);

    const compressed = buildMegahitAssemblyGz(read1, read2, {
      bin: writeFakeMegahit(directory, "valid"),
      tempRoot: directory,
    });

    expect(zlib.gunzipSync(compressed).toString("utf8")).toMatch(
      /^>contig_1\nA{1000}\n$/,
    );
  });

  it("defaults to MEGAHIT and selects synthetic only as an explicit mode", () => {
    expect(selectAssemblySource()).toBe("megahit");
    expect(selectAssemblySource({ requestedSource: "synthetic" })).toBe(
      "synthetic",
    );
    expect(() => selectAssemblySource({ requestedSource: "fallback" })).toThrow(
      /Invalid assembly source/,
    );
  });

  it("keeps non-assembly submission legs on an explicit synthetic input", () => {
    expect(resolveFixtureAssemblySource()).toBe("synthetic");
    expect(
      resolveFixtureAssemblySource({
        requestedSource: "megahit",
        submitAssembly: false,
      }),
    ).toBe("synthetic");
    expect(
      resolveFixtureAssemblySource({
        requestedSource: "megahit",
        submitAssembly: true,
      }),
    ).toBe("megahit");
  });

  it("hard-asserts MEGAHIT provenance in the real-data workflow", () => {
    const workflow = fs.readFileSync(
      path.join(process.cwd(), ".github/workflows/pipeline-submg-e2e.yml"),
      "utf8",
    );
    const realDataStep = workflow.slice(
      workflow.indexOf("- name: Run submg on the REAL human-gut shotgun study"),
      workflow.indexOf("# Proof on the *installed* app"),
    );

    expect(realDataStep).toContain("SEQDESK_SUBMG_E2E_ASSEMBLY_SOURCE: megahit");
    expect(realDataStep).toContain("grep -F '\"assemblySource\": \"megahit\"'");
    expect(realDataStep).not.toContain("|| true");
  });

  it("never represents the synthetic fixture as a completed MAG run", () => {
    const driver = fs.readFileSync(
      path.join(process.cwd(), "scripts/run-submg-e2e.mjs"),
      "utf8",
    );

    expect(driver).toContain(
      'if (assemblySource === "megahit" && adminUserId)',
    );
    expect(driver).not.toContain("synthetic assembly fallback");
  });
});
