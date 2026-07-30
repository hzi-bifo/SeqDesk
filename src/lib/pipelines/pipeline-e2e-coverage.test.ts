import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface CoverageEntry {
  tier: "required" | "extended";
  proofs?: string[];
  reason?: string;
}

interface CoveragePolicy {
  schemaVersion: number;
  pipelines: Record<string, CoverageEntry>;
}

const repoRoot = process.cwd();
const policy = JSON.parse(
  fs.readFileSync(
    path.join(repoRoot, "data", "pipeline-e2e-coverage.json"),
    "utf8"
  )
) as CoveragePolicy;
const workflow = fs.readFileSync(
  path.join(repoRoot, ".github", "workflows", "pipeline-slurm-e2e.yml"),
  "utf8"
);
const requiredSourceMatrix = workflow.slice(
  workflow.indexOf("- name: Run required fastq-checksum E2E"),
  workflow.indexOf("- name: Run additionally requested runtime pipeline")
);
const requiredInstalledMatrix = workflow.slice(
  workflow.indexOf(
    'echo "=== run pipelines through the INSTALLED app (managed config from the install) ==="'
  ),
  workflow.indexOf(
    'echo "=== prove installed runs used the packaged pipeline tree ==="'
  )
);
const FORBIDDEN_REQUIRED_FLAGS = [
  "--skip-local",
  "--skip-slurm",
  "--skip-if-disabled",
] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function requiredSourceInvocations(pipelineId: string): string[] {
  const pipelineFlag = new RegExp(
    `--pipeline-id ${escapeRegExp(pipelineId)}(?:\\s|$)`,
    "g"
  );
  const matches = [...requiredSourceMatrix.matchAll(pipelineFlag)];
  expect(
    matches.length,
    `${pipelineId} must have at least one invocation in the required source matrix`
  ).toBeGreaterThan(0);

  return matches.map((match, variantIndex) => {
    const pipelineFlagIndex = match.index ?? -1;
    const invocationStart = requiredSourceMatrix.lastIndexOf(
      "npm run pipeline:e2e:runtime --",
      pipelineFlagIndex
    );
    const invocationEnd = requiredSourceMatrix.indexOf(
      "2>&1 | tee",
      pipelineFlagIndex
    );
    const variant = `${pipelineId} source invocation ${variantIndex + 1}`;
    expect(
      invocationStart,
      `${variant} must use the runtime harness`
    ).toBeGreaterThanOrEqual(0);
    expect(
      invocationEnd,
      `${variant} must have a bounded command body`
    ).toBeGreaterThan(pipelineFlagIndex);

    return requiredSourceMatrix.slice(invocationStart, invocationEnd);
  });
}

function requiredInstalledInvocation(pipelineId: string): string {
  const invocationPattern = new RegExp(
    `^[ \\t]*run_installed[ \\t]+${escapeRegExp(pipelineId)}(?=[ \\t]|$)`,
    "gm"
  );
  const matches = [...requiredInstalledMatrix.matchAll(invocationPattern)];
  expect(
    matches,
    `${pipelineId} must have exactly one canonical invocation in the required installed matrix`
  ).toHaveLength(1);

  const invocationStart = matches[0]?.index ?? -1;
  let invocationEnd = requiredInstalledMatrix.indexOf("\n", invocationStart);
  if (invocationEnd < 0) invocationEnd = requiredInstalledMatrix.length;
  while (
    requiredInstalledMatrix
      .slice(invocationStart, invocationEnd)
      .trimEnd()
      .endsWith("\\")
  ) {
    const nextLineEnd = requiredInstalledMatrix.indexOf("\n", invocationEnd + 1);
    invocationEnd =
      nextLineEnd < 0 ? requiredInstalledMatrix.length : nextLineEnd;
  }
  return requiredInstalledMatrix.slice(invocationStart, invocationEnd);
}

function builtInPipelineIds(): string[] {
  const pipelinesRoot = path.join(repoRoot, "pipelines");
  return fs
    .readdirSync(pipelinesRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith("_") &&
        fs.existsSync(path.join(pipelinesRoot, entry.name, "manifest.json"))
    )
    .map((entry) => entry.name)
    .sort();
}

describe("pipeline E2E coverage policy", () => {
  it("classifies every shipped pipeline exactly once", () => {
    expect(Object.keys(policy.pipelines).sort()).toEqual(
      builtInPipelineIds()
    );
  });

  it("requires every lightweight pipeline in both source and installed matrices", () => {
    const required = Object.entries(policy.pipelines).filter(
      ([, entry]) => entry.tier === "required"
    );
    expect(required.length).toBeGreaterThan(0);

    for (const [pipelineId, entry] of required) {
      expect(entry.proofs).toEqual(
        expect.arrayContaining([
          "local",
          "slurm",
          "app-retrieval",
          "output-correctness",
        ])
      );
      expect(workflow).toContain(`--pipeline-id ${pipelineId}`);
      const sourceInvocations = requiredSourceInvocations(pipelineId);
      const installedInvocation = requiredInstalledInvocation(pipelineId);
      for (const sourceInvocation of sourceInvocations) {
        expect(sourceInvocation).toContain(
          '--expected-pipeline-root "$SEQDESK_STAGED_PIPELINES_DIR"'
        );
        for (const forbiddenFlag of FORBIDDEN_REQUIRED_FLAGS) {
          expect(sourceInvocation).not.toContain(forbiddenFlag);
        }
      }
      expect(installedInvocation).toContain(`--pipeline-id ${pipelineId}`);
      for (const forbiddenFlag of FORBIDDEN_REQUIRED_FLAGS) {
        expect(installedInvocation).not.toContain(forbiddenFlag);
      }
    }
  });

  it("documents why every extended pipeline is not part of the required green gate", () => {
    const extended = Object.entries(policy.pipelines).filter(
      ([, entry]) => entry.tier === "extended"
    );
    expect(extended.length).toBeGreaterThan(0);

    for (const [, entry] of extended) {
      expect(entry.reason?.trim().length).toBeGreaterThan(20);
    }
  });
});
