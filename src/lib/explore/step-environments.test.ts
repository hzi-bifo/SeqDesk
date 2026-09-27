import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), update: vi.fn(), build: vi.fn(), specs: vi.fn(), rm: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { exploreEnvironment: { findUnique: mocks.findUnique, findMany: mocks.findMany, upsert: mocks.upsert, update: mocks.update } } }));
vi.mock("fs/promises", () => ({ default: { rm: mocks.rm } }));
vi.mock("./environments", () => ({
  buildEnvironment: mocks.build,
  readEnvironmentSpecs: mocks.specs,
  hashEnvironmentSpec: (spec: string) => `h${spec.length}`,
  readBuildLogTail: vi.fn().mockResolvedValue("Solving environment: done\nDownloading…"),
  reconcileEnvironmentRecord: async (record: unknown) => record,
}));

import {
  condaErrorExcerpt, deriveEnvironment, normalizePackageSpec, normalizeStepPackages, parseBaseSpec, prepareStepEnvironment, preparingWords,
  pruneStepEnvironments, resolveStepEnvironment, PackageSpecError,
} from "./step-environments";

const BASE = `# comment
name: seqdesk-explore-r
channels:
  - conda-forge
  - bioconda
  - nodefaults
dependencies:
  - r-base=4.5.*
  - r-jsonlite
  # a note
  - bioconductor-deseq2
`;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.specs.mockResolvedValue(new Map([["seqdesk-explore-r", BASE]]));
  mocks.rm.mockResolvedValue(undefined);
  mocks.update.mockResolvedValue({});
  mocks.upsert.mockImplementation(async ({ create }) => ({ ...create, prefixPath: null, builtAt: null, lastError: null, lockDigest: null, lockSpecHash: null, updatedAt: new Date() }));
});

describe("package specs", () => {
  it("accepts conda match specs and normalises them", () => {
    expect(normalizePackageSpec("bioconductor-deseq2")).toBe("bioconductor-deseq2");
    expect(normalizePackageSpec(" Bioconductor-DESeq2 = 1.42 ")).toBe("bioconductor-deseq2=1.42");
    expect(normalizePackageSpec("r-lme4>=1.1,<1.2")).toBe("r-lme4>=1.1,<1.2");
    expect(normalizePackageSpec("bioconda::bioconductor-apeglm=1.24.*")).toBe("bioconda::bioconductor-apeglm=1.24.*");
    expect(normalizePackageSpec("numpy==2.0.1")).toBe("numpy==2.0.1");
  });
  it.each([
    "deseq2; rm -rf /", "$(curl x)", "`id`", "pkg && echo", "pkg | tee", "a b", "https://evil/x.tar.bz2", "../x", "pkg=1.0'", "pkg\n- other", "-e .", "pkg[build=abc]", "",
  ])("rejects %j", (raw) => {
    expect(() => normalizePackageSpec(raw)).toThrow(PackageSpecError);
  });
  it("dedupes by package name (last wins), sorts, and validates channels", () => {
    expect(normalizeStepPackages({ packages: ["r-lme4", "bioconductor-deseq2=1.40", "bioconductor-deseq2=1.42", "r-lme4"], channels: ["Bioconda", "bioconda"] }))
      .toEqual({ packages: ["bioconductor-deseq2=1.42", "r-lme4"], channels: ["bioconda"] });
    expect(() => normalizeStepPackages({ packages: [], channels: ["https://x"] })).toThrow(PackageSpecError);
    expect(() => normalizeStepPackages({ packages: Array.from({ length: 41 }, (_, i) => `p${i}`) })).toThrow(PackageSpecError);
    expect(normalizeStepPackages(null)).toEqual({ packages: [], channels: [] });
  });
});

describe("derived environments", () => {
  it("parses the flat base spec", () => {
    expect(parseBaseSpec(BASE)).toEqual({ channels: ["conda-forge", "bioconda", "nodefaults"], dependencies: ["r-base=4.5.*", "r-jsonlite", "bioconductor-deseq2"] });
  });
  it("gives the same name for the same packages in any order, a new one for other packages", () => {
    const a = deriveEnvironment("seqdesk-explore-r", BASE, { packages: ["r-lme4", "bioconductor-fgsea"], channels: [] });
    const b = deriveEnvironment("seqdesk-explore-r", BASE, { packages: ["bioconductor-fgsea", "r-lme4", "r-lme4"], channels: [] });
    const c = deriveEnvironment("seqdesk-explore-r", BASE, { packages: ["bioconductor-fgsea"], channels: [] });
    expect(a.name).toMatch(/^seqdesk-explore-r\+[a-f0-9]{12}$/);
    expect(b.name).toBe(a.name);
    expect(b.spec).toBe(a.spec);
    expect(c.name).not.toBe(a.name);
    // A changed base gives a new environment too.
    expect(deriveEnvironment("seqdesk-explore-r", `${BASE}  - r-vegan\n`, { packages: ["r-lme4", "bioconductor-fgsea"], channels: [] }).name).not.toBe(a.name);
  });
  it("merges packages into the base: a pinned package replaces the base entry, extra channels go before nodefaults", () => {
    const derived = deriveEnvironment("seqdesk-explore-r", BASE, { packages: ["bioconductor-deseq2=1.42"], channels: ["my-lab"] });
    expect(derived.spec).toContain(`name: ${derived.name}`);
    expect(derived.spec).toMatch(/channels:\n  - my-lab\n  - conda-forge\n  - bioconda\n  - nodefaults\n/);
    expect(derived.spec).toMatch(/dependencies:\n  - r-base=4\.5\.\*\n  - r-jsonlite\n  - bioconductor-deseq2=1\.42\n$/);
  });
  it("is the base itself without packages", () => {
    expect(deriveEnvironment("seqdesk-explore-r", BASE, { packages: [], channels: [] }).name).toBe("seqdesk-explore-r");
  });
});

describe("resolving and preparing a step environment", () => {
  const step = { environmentName: "seqdesk-explore-r", packages: { packages: ["r-lme4"], channels: [] } };
  it("creates the derived record once and reuses it", async () => {
    const first = await resolveStepEnvironment(step);
    expect(first).toMatchObject({ derived: true, status: "missing", baseName: "seqdesk-explore-r" });
    const call = mocks.upsert.mock.calls[0][0];
    expect(call.where.name).toBe(first.name);
    expect(call.create).toMatchObject({ baseName: "seqdesk-explore-r", packages: { packages: ["r-lme4"], channels: [] }, status: "missing" });
    // A second step with the same packages resolves to the same record.
    await resolveStepEnvironment({ environmentName: "seqdesk-explore-r", packages: ["r-lme4", "r-lme4"] });
    expect(mocks.upsert.mock.calls[1][0].where.name).toBe(first.name);
  });
  it("uses the base for a step without packages and never builds a shared base on a step's behalf", async () => {
    mocks.findUnique.mockResolvedValue({ name: "seqdesk-explore-r", spec: BASE, specHash: `h${BASE.length}`, status: "missing", prefixPath: null });
    const state = await prepareStepEnvironment({ environmentName: "seqdesk-explore-r", packages: null });
    expect(state).toMatchObject({ derived: false, name: "seqdesk-explore-r" });
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.build).not.toHaveBeenCalled();
  });
  it("starts one build for a missing derived environment and reports progress while it builds", async () => {
    let status = "missing";
    mocks.upsert.mockImplementation(async ({ create }) => ({ ...create, status, prefixPath: status === "building" ? "/envs/x" : null, updatedAt: new Date() }));
    mocks.build.mockImplementation(async () => { status = "building"; return { started: true, message: "" }; });
    const state = await prepareStepEnvironment(step);
    expect(mocks.build).toHaveBeenCalledOnce();
    expect(state.status).toBe("building");
    expect(state.log).toContain("Solving environment");
    expect(preparingWords(state)).toBe("Preparing environment · installing 1 package");
    // Already building: no second build.
    await prepareStepEnvironment(step);
    expect(mocks.build).toHaveBeenCalledOnce();
  });
  it("keeps a failed build failed unless asked to retry, with the conda error as the excerpt", async () => {
    const error = "conda env create exited with 1\nCollecting package metadata\nLibMambaUnsatisfiableError: Encountered problems while solving:\n  - nothing provides r-nope";
    mocks.upsert.mockImplementation(async ({ create }) => ({ ...create, status: "failed", prefixPath: "/envs/x", lastError: error, updatedAt: new Date() }));
    const state = await prepareStepEnvironment(step);
    expect(state.status).toBe("failed");
    expect(state.log).toMatch(/^LibMambaUnsatisfiableError/);
    expect(mocks.build).not.toHaveBeenCalled();
    await prepareStepEnvironment(step, { retryFailed: true });
    expect(mocks.build).toHaveBeenCalledOnce();
  });
  it("excerpts from the first conda error line", () => {
    expect(condaErrorExcerpt("a\nb\nPackagesNotFoundError: x\n  - y")).toBe("PackagesNotFoundError: x\n  - y");
    expect(condaErrorExcerpt("plain\ntail")).toBe("plain\ntail");
  });
});

describe("pruning derived environments", () => {
  it("removes prefixes unused for the cutoff and beyond the cap, keeping the rows", async () => {
    const now = new Date("2026-09-27T00:00:00Z");
    const day = 24 * 60 * 60 * 1000;
    mocks.findMany.mockResolvedValue([
      { name: "r+recent", prefixPath: "/e/1", lastUsedAt: new Date(now.getTime() - day), updatedAt: now },
      { name: "r+second", prefixPath: "/e/2", lastUsedAt: new Date(now.getTime() - 2 * day), updatedAt: now },
      { name: "r+old", prefixPath: "/e/3", lastUsedAt: new Date(now.getTime() - 40 * day), updatedAt: now },
    ]);
    expect(await pruneStepEnvironments({ now, cap: 1, dryRun: true })).toEqual({ pruned: ["r+second", "r+old"] });
    expect(mocks.rm).not.toHaveBeenCalled();
    expect(await pruneStepEnvironments({ now })).toEqual({ pruned: ["r+old"] });
    expect(mocks.rm).toHaveBeenCalledWith("/e/3", { recursive: true, force: true });
    expect(mocks.update).toHaveBeenCalledWith({ where: { name: "r+old" }, data: { status: "missing", prefixPath: null, builtAt: null } });
  });
});
