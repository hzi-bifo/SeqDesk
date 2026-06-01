import fs from "fs/promises";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { gzipSync } from "zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyProfilePipelineDatabases,
  applyProfileSeedData,
  buildProfilePipelineDatabaseInstallDir,
  buildProfilePipelineDatabaseRoot,
  buildProfilePipelineDatabaseTargetPath,
  resolveProfileDatabaseRequests,
} from "../../../scripts/lib/install-profile-assets.mjs";

let tempDir: string;

async function createDownloadedFastqBundle(options?: { corruptSha?: boolean }) {
  const sourceDir = path.join(tempDir, "fastq-bundle-source");
  const readsDir = path.join(sourceDir, "reads");
  await fs.mkdir(readsDir, { recursive: true });
  await fs.writeFile(
    path.join(sourceDir, "manifest.json"),
    JSON.stringify(
      {
        order: { name: "CI runner FASTQ checksum smoke order" },
        samples: [
          {
            sampleId: "CI-RUNNER-FASTQ-01",
            sampleAlias: "CI-SMOKE-01",
            sampleTitle: "CI smoke sample 01",
            materialBodySite: "control",
            file1: "reads/CI-RUNNER-FASTQ-01.fastq.gz",
            readCount1: 2,
          },
          {
            sampleId: "CI-RUNNER-FASTQ-02",
            sampleAlias: "CI-SMOKE-02",
            sampleTitle: "CI smoke sample 02",
            materialBodySite: "control",
            file1: "reads/CI-RUNNER-FASTQ-02.fastq.gz",
            readCount1: 2,
          },
        ],
      },
      null,
      2
    )
  );
  await fs.writeFile(
    path.join(readsDir, "CI-RUNNER-FASTQ-01.fastq.gz"),
    gzipSync(Buffer.from("@r1\nACGT\n+\nIIII\n@r2\nTGCA\n+\nHHHH\n", "utf8"))
  );
  await fs.writeFile(
    path.join(readsDir, "CI-RUNNER-FASTQ-02.fastq.gz"),
    gzipSync(Buffer.from("@r1\nGATTACA\n+\nIIIIIII\n@r2\nCATTAG\n+\nHHHHHH\n", "utf8"))
  );

  const archivePath = path.join(tempDir, "ci-runner-fastq-bundle.tar.gz");
  execFileSync("tar", ["-czf", archivePath, "-C", sourceDir, "."], { stdio: "ignore" });
  const archive = await fs.readFile(archivePath);
  const sha256 = createHash("sha256").update(archive).digest("hex");
  return {
    archivePath,
    sha256: options?.corruptSha ? "0".repeat(64) : sha256,
  };
}

async function createMetaxDbInstallRoot() {
  const rootDir = path.join(tempDir, `install-root-${Date.now()}`);
  const archiveSource = path.join(tempDir, "source", "metaxpath_db_bundle.tar");
  await fs.mkdir(path.dirname(archiveSource), { recursive: true });
  await fs.writeFile(archiveSource, "test archive");
  await fs.mkdir(path.join(rootDir, "data"), { recursive: true });
  await fs.writeFile(
    path.join(rootDir, "data", "pipeline-databases.json"),
    JSON.stringify({
      metaxpath: [
        {
          id: "db-bundle",
          label: "MetaxPath Database Bundle",
          description: "Test bundle",
          version: "test",
          fileName: "metaxpath_db_bundle.tar",
          downloadUrl: `file://${archiveSource}`,
          configKey: "paramsFile",
          install: {
            type: "metaxpath_db_bundle",
            paramsFileName: "metaxpath.downloaded.params.yaml",
          },
        },
      ],
    })
  );

  const installerPath = path.join(
    rootDir,
    "pipelines",
    "metaxpath",
    "workflow",
    "scripts",
    "install_db_bundle.sh"
  );
  await fs.mkdir(path.dirname(installerPath), { recursive: true });
  await fs.writeFile(
    installerPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "dest=\"\"",
      "while [ $# -gt 0 ]; do",
      "  case \"$1\" in",
      "    --dest) dest=\"$2\"; shift 2 ;;",
      "    *) shift ;;",
      "  esac",
      "done",
      "mkdir -p \"$dest\"",
      "printf 'params: test\\n' > \"$dest/metaxpath.downloaded.params.yaml\"",
      "",
    ].join("\n")
  );

  return { rootDir, archiveSource };
}

function makeDatabasePrisma(databaseRoot: string, pipelineConfigUpsert = vi.fn().mockResolvedValue({})) {
  return {
    siteSettings: {
      findUnique: vi.fn().mockResolvedValue({
        dataBasePath: tempDir,
        extraSettings: JSON.stringify({ pipelineExecution: { pipelineRunDir: tempDir } }),
      }),
    },
    pipelineConfig: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: pipelineConfigUpsert,
    },
    databaseRoot,
  };
}

describe("install profile asset script helpers", () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-profile-assets-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("resolves custom database roots and falls back to run-dir databases", () => {
    expect(buildProfilePipelineDatabaseRoot("/runs", "")).toBe("/runs/databases");
    expect(buildProfilePipelineDatabaseRoot("/runs", "/shared/dbs")).toBe("/shared/dbs");
    expect(
      buildProfilePipelineDatabaseTargetPath({
        pipelineRunDir: "/runs",
        databaseDirectory: "/shared/dbs",
        pipelineId: "metaxpath",
        databaseId: "db-bundle",
        fileName: "metaxpath_db_bundle.tar",
      })
    ).toBe("/shared/dbs/metaxpath/db-bundle/metaxpath_db_bundle.tar");
    expect(
      buildProfilePipelineDatabaseInstallDir({
        pipelineRunDir: "/runs",
        databaseDirectory: "/shared/dbs",
        pipelineId: "metaxpath",
        databaseId: "db-bundle",
      })
    ).toBe("/shared/dbs/metaxpath/db-bundle/installed");
  });

  it("skips database downloads unless the profile opts in", async () => {
    const result = await applyProfilePipelineDatabases({
      prisma: {},
      profile: {
        pipelines: {
          databases: {
            autoDownload: false,
            downloads: [{ pipelineId: "metaxpath", databaseId: "db-bundle" }],
          },
        },
      },
      rootDir: process.cwd(),
      logger: { log: vi.fn(), warn: vi.fn() },
    });

    expect(result).toEqual({ skipped: true, downloaded: 0, failed: 0 });
  });

  it("fails install when a required database is not defined", async () => {
    await expect(
      applyProfilePipelineDatabases({
        prisma: {
          siteSettings: {
            findUnique: vi.fn().mockResolvedValue({
              dataBasePath: tempDir,
              extraSettings: JSON.stringify({ pipelineExecution: { pipelineRunDir: tempDir } }),
            }),
          },
        },
        profile: {
          pipelines: {
            databases: {
              autoDownload: true,
              downloads: [{ pipelineId: "metaxpath", databaseId: "missing-db", required: true }],
            },
          },
        },
        rootDir: process.cwd(),
        logger: { log: vi.fn(), warn: vi.fn() },
      })
    ).rejects.toThrow("Database missing-db is not defined for pipeline metaxpath");
  });

  it("installs a MetaXpath DB bundle into the configured directory and writes paramsFile config", async () => {
    const rootDir = path.join(tempDir, "install-root");
    const databaseRoot = path.join(tempDir, "profile-dbs");
    const archiveSource = path.join(tempDir, "source", "metaxpath_db_bundle.tar");
    await fs.mkdir(path.dirname(archiveSource), { recursive: true });
    await fs.writeFile(archiveSource, "test archive");
    await fs.mkdir(path.join(rootDir, "data"), { recursive: true });
    await fs.writeFile(
      path.join(rootDir, "data", "pipeline-databases.json"),
      JSON.stringify({
        metaxpath: [
          {
            id: "db-bundle",
            label: "MetaxPath Database Bundle",
            description: "Test bundle",
            version: "test",
            fileName: "metaxpath_db_bundle.tar",
            downloadUrl: `file://${archiveSource}`,
            configKey: "paramsFile",
            install: {
              type: "metaxpath_db_bundle",
              paramsFileName: "metaxpath.downloaded.params.yaml",
            },
          },
        ],
      })
    );

    const installerPath = path.join(
      rootDir,
      "pipelines",
      "metaxpath",
      "workflow",
      "scripts",
      "install_db_bundle.sh"
    );
    await fs.mkdir(path.dirname(installerPath), { recursive: true });
    await fs.writeFile(
      installerPath,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "dest=\"\"",
        "while [ $# -gt 0 ]; do",
        "  case \"$1\" in",
        "    --dest) dest=\"$2\"; shift 2 ;;",
        "    *) shift ;;",
        "  esac",
        "done",
        "mkdir -p \"$dest\"",
        "printf 'params: test\\n' > \"$dest/metaxpath.downloaded.params.yaml\"",
        "",
      ].join("\n")
    );

    const pipelineConfigUpsert = vi.fn().mockResolvedValue({});
    const prisma = {
      siteSettings: {
        findUnique: vi.fn().mockResolvedValue({
          dataBasePath: tempDir,
          extraSettings: JSON.stringify({ pipelineExecution: { pipelineRunDir: tempDir } }),
        }),
      },
      pipelineConfig: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: pipelineConfigUpsert,
      },
    };

    const result = await applyProfilePipelineDatabases({
      prisma,
      profile: {
        pipelines: {
          databaseDirectory: databaseRoot,
          databases: {
            autoDownload: true,
            downloads: [{ pipelineId: "metaxpath", databaseId: "db-bundle", required: true }],
          },
        },
      },
      rootDir,
      logger: { log: vi.fn(), warn: vi.fn() },
    });

    const archivePath = path.join(
      databaseRoot,
      "metaxpath",
      "db-bundle",
      "metaxpath_db_bundle.tar"
    );
    const paramsPath = path.join(
      databaseRoot,
      "metaxpath",
      "db-bundle",
      "installed",
      "metaxpath.downloaded.params.yaml"
    );
    await expect(fs.stat(archivePath)).resolves.toMatchObject({ size: expect.any(Number) });
    await expect(fs.stat(paramsPath)).resolves.toMatchObject({ size: expect.any(Number) });
    expect(result).toMatchObject({ skipped: false, downloaded: 1, failed: 0 });
    expect(pipelineConfigUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pipelineId: "metaxpath" },
        create: expect.objectContaining({
          enabled: true,
          config: JSON.stringify({ paramsFile: paramsPath }),
        }),
        update: {
          config: JSON.stringify({ paramsFile: paramsPath }),
        },
      })
    );
  });

  it("accepts the SeqDesk.com admin array shape for database requests", async () => {
    expect(
      resolveProfileDatabaseRequests(
        {
          pipelines: {
            databases: [
              {
                pipelineId: "metaxpath",
                databaseId: "db-bundle",
                configKey: "paramsFile",
                mode: "ensure",
                path: "/shared/dbs/metaxpath/params.yaml",
                sourceUrlOverride: "https://mirror.example.org/metaxpath_db_bundle.tar",
                sha256: "a".repeat(64),
              },
            ],
          },
        },
        {}
      )
    ).toEqual({
      autoDownload: true,
      requests: [
        {
          pipelineId: "metaxpath",
          databaseId: "db-bundle",
          required: true,
          mode: "ensure",
          configKey: "paramsFile",
          path: "/shared/dbs/metaxpath/params.yaml",
          sourceUrlOverride: "https://mirror.example.org/metaxpath_db_bundle.tar",
          sha256: "a".repeat(64),
        },
      ],
    });
  });

  it("applies a SeqDesk.com admin array database request", async () => {
    const { rootDir } = await createMetaxDbInstallRoot();
    const databaseRoot = path.join(tempDir, "array-profile-dbs");
    const pipelineConfigUpsert = vi.fn().mockResolvedValue({});
    const prisma = makeDatabasePrisma(databaseRoot, pipelineConfigUpsert);

    const result = await applyProfilePipelineDatabases({
      prisma,
      profile: {
        pipelines: {
          databaseDirectory: databaseRoot,
          databases: [
            {
              pipelineId: "metaxpath",
              databaseId: "db-bundle",
              configKey: "paramsFile",
              mode: "ensure",
            },
          ],
        },
      },
      rootDir,
      logger: { log: vi.fn(), warn: vi.fn() },
    });

    const paramsPath = path.join(
      databaseRoot,
      "metaxpath",
      "db-bundle",
      "installed",
      "metaxpath.downloaded.params.yaml"
    );
    await expect(fs.stat(paramsPath)).resolves.toMatchObject({ size: expect.any(Number) });
    expect(result).toMatchObject({ skipped: false, downloaded: 1, failed: 0 });
    expect(result.results).toEqual([
      expect.objectContaining({
        pipelineId: "metaxpath",
        databaseId: "db-bundle",
        mode: "ensure",
        status: "success",
        path: paramsPath,
      }),
    ]);
    expect(pipelineConfigUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pipelineId: "metaxpath" },
        create: expect.objectContaining({
          enabled: true,
          config: JSON.stringify({ paramsFile: paramsPath }),
        }),
        update: {
          config: JSON.stringify({ paramsFile: paramsPath }),
        },
      })
    );
  });

  it("links an existing database path when mode is skip", async () => {
    const { rootDir } = await createMetaxDbInstallRoot();
    const databaseRoot = path.join(tempDir, "skip-profile-dbs");
    const existingParamsPath = path.join(tempDir, "existing", "metaxpath.downloaded.params.yaml");
    await fs.mkdir(path.dirname(existingParamsPath), { recursive: true });
    await fs.writeFile(existingParamsPath, "params: existing\n");
    const pipelineConfigUpsert = vi.fn().mockResolvedValue({});
    const prisma = makeDatabasePrisma(databaseRoot, pipelineConfigUpsert);

    const result = await applyProfilePipelineDatabases({
      prisma,
      profile: {
        pipelines: {
          databaseDirectory: databaseRoot,
          databases: [
            {
              pipelineId: "metaxpath",
              databaseId: "db-bundle",
              configKey: "paramsFile",
              mode: "skip",
              path: existingParamsPath,
            },
          ],
        },
      },
      rootDir,
      logger: { log: vi.fn(), warn: vi.fn() },
    });

    expect(result).toMatchObject({ skipped: false, downloaded: 1, failed: 0 });
    expect(pipelineConfigUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pipelineId: "metaxpath" },
        create: expect.objectContaining({
          config: JSON.stringify({ paramsFile: existingParamsPath }),
        }),
        update: {
          config: JSON.stringify({ paramsFile: existingParamsPath }),
        },
      })
    );
  });

  it("requires a path when database mode is skip", async () => {
    const { rootDir } = await createMetaxDbInstallRoot();
    const prisma = makeDatabasePrisma(path.join(tempDir, "skip-missing-dbs"));

    await expect(
      applyProfilePipelineDatabases({
        prisma,
        profile: {
          pipelines: {
            databases: [
              {
                pipelineId: "metaxpath",
                databaseId: "db-bundle",
                mode: "skip",
              },
            ],
          },
        },
        rootDir,
        logger: { log: vi.fn(), warn: vi.fn() },
      })
    ).rejects.toThrow("uses mode=skip but no path was provided");
  });

  it("requires sha256 for remote database URL overrides", async () => {
    const { rootDir } = await createMetaxDbInstallRoot();

    await expect(
      applyProfilePipelineDatabases({
        prisma: makeDatabasePrisma(path.join(tempDir, "override-dbs")),
        profile: {
          pipelines: {
            databases: [
              {
                pipelineId: "metaxpath",
                databaseId: "db-bundle",
                sourceUrlOverride: "https://mirror.example.org/metaxpath_db_bundle.tar",
              },
            ],
          },
        },
        rootDir,
        logger: { log: vi.fn(), warn: vi.fn() },
      })
    ).rejects.toThrow("requires sha256");
  });

  it("requires sha256 for file:// database URL overrides", async () => {
    const { rootDir, archiveSource } = await createMetaxDbInstallRoot();

    await expect(
      applyProfilePipelineDatabases({
        prisma: makeDatabasePrisma(path.join(tempDir, "file-override-dbs")),
        profile: {
          pipelines: {
            databases: [
              {
                pipelineId: "metaxpath",
                databaseId: "db-bundle",
                sourceUrlOverride: `file://${archiveSource}`,
              },
            ],
          },
        },
        rootDir,
        logger: { log: vi.fn(), warn: vi.fn() },
      })
    ).rejects.toThrow("requires sha256");
  });

  it("rejects skipped database paths outside allowed asset roots", async () => {
    const { rootDir } = await createMetaxDbInstallRoot();

    await expect(
      applyProfilePipelineDatabases({
        prisma: makeDatabasePrisma(path.join(tempDir, "skip-root-dbs")),
        profile: {
          pipelines: {
            databases: [
              {
                pipelineId: "metaxpath",
                databaseId: "db-bundle",
                mode: "skip",
                path: "/private/var/seqdesk-untrusted/metaxpath.params.yaml",
              },
            ],
          },
        },
        rootDir,
        logger: { log: vi.fn(), warn: vi.fn() },
      })
    ).rejects.toThrow("allowed asset root");
  });

  it("overwrites a stale database archive when mode is overwrite", async () => {
    const { rootDir } = await createMetaxDbInstallRoot();
    const databaseRoot = path.join(tempDir, "overwrite-profile-dbs");
    const archivePath = path.join(
      databaseRoot,
      "metaxpath",
      "db-bundle",
      "metaxpath_db_bundle.tar"
    );
    await fs.mkdir(path.dirname(archivePath), { recursive: true });
    await fs.writeFile(archivePath, "stale archive");

    const result = await applyProfilePipelineDatabases({
      prisma: makeDatabasePrisma(databaseRoot),
      profile: {
        pipelines: {
          databaseDirectory: databaseRoot,
          databases: [
            {
              pipelineId: "metaxpath",
              databaseId: "db-bundle",
              mode: "overwrite",
            },
          ],
        },
      },
      rootDir,
      logger: { log: vi.fn(), warn: vi.fn() },
    });

    await expect(fs.readFile(archivePath, "utf8")).resolves.toBe("test archive");
    expect(result.results).toEqual([
      expect.objectContaining({
        pipelineId: "metaxpath",
        databaseId: "db-bundle",
        mode: "overwrite",
        status: "success",
      }),
    ]);
  });

  it("resolves explicit database requests and enabled-pipeline defaults", () => {
    expect(
      resolveProfileDatabaseRequests(
        {
          pipelines: {
            databases: {
              autoDownload: true,
              downloads: [{ pipelineId: "metaxpath", databaseId: "db-bundle", required: true }],
            },
          },
        },
        {}
      )
    ).toEqual({
      autoDownload: true,
      requests: [
        { pipelineId: "metaxpath", databaseId: "db-bundle", required: true, mode: "ensure" },
      ],
    });

    expect(
      resolveProfileDatabaseRequests(
        {
          pipelines: {
            enable: ["metaxpath"],
            databases: { autoDownload: true },
          },
        },
        {
          metaxpath: [{ id: "db-bundle" }],
        }
      )
    ).toEqual({
      autoDownload: true,
      requests: [
        { pipelineId: "metaxpath", databaseId: "db-bundle", required: true, mode: "ensure" },
      ],
    });
  });

  it("seeds a smoke order with real FASTQ files and Read rows", async () => {
    const readCreate = vi.fn().mockResolvedValue({});
    const sampleCreate = vi
      .fn()
      .mockResolvedValueOnce({ id: "sample-1", reads: [] })
      .mockResolvedValueOnce({ id: "sample-2", reads: [] });
    const prisma = {
      siteSettings: {
        findUnique: vi.fn().mockResolvedValue({
          dataBasePath: tempDir,
          extraSettings: JSON.stringify({ pipelineExecution: {} }),
        }),
      },
      user: {
        findFirst: vi.fn(async ({ where }: { where: { role: string } }) => ({
          id: where.role === "FACILITY_ADMIN" ? "admin-1" : "researcher-1",
          email: where.role === "FACILITY_ADMIN" ? "admin@example.com" : "user@example.com",
          firstName: where.role === "FACILITY_ADMIN" ? "Admin" : "Researcher",
          lastName: "User",
          role: where.role,
        })),
        create: vi.fn(),
      },
      study: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "study-1" }),
        update: vi.fn(),
      },
      order: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "order-1", orderNumber: "TWINCORE-SMOKE-001" }),
        update: vi.fn(),
      },
      sample: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: sampleCreate,
        update: vi.fn(),
      },
      read: {
        create: readCreate,
        update: vi.fn(),
      },
    };

    const result = await applyProfileSeedData({
      prisma,
      profile: {
        id: "twincore",
        site: { dataBasePath: tempDir },
        seedData: {
          enabled: true,
          fixtures: [
            { id: "twincore-ont-smoke", kind: "orderPipelineSmoke", writeFastqFiles: true },
          ],
        },
      },
      logger: { log: vi.fn(), warn: vi.fn() },
    });

    expect(result.seeded).toBe(1);
    expect(readCreate).toHaveBeenCalledTimes(2);
    expect(readCreate.mock.calls[0][0].data.file1).toBe(
      "fixtures/twincore/twincore-ont-smoke/TWINCORE-ONT-01.fastq.gz"
    );

    const firstFastq = path.join(
      tempDir,
      "fixtures/twincore/twincore-ont-smoke/TWINCORE-ONT-01.fastq.gz"
    );
    await expect(fs.stat(firstFastq)).resolves.toMatchObject({ size: expect.any(Number) });
  });

  it("downloads a FASTQ bundle fixture and creates Read rows without precomputed checksums", async () => {
    const bundle = await createDownloadedFastqBundle();
    const installedDataPath = path.join(tempDir, "installed-data");
    const profileDefaultDataPath = path.join(tempDir, "profile-default-data");
    const readCreate = vi.fn().mockResolvedValue({});
    const sampleCreate = vi
      .fn()
      .mockResolvedValueOnce({ id: "sample-1", reads: [] })
      .mockResolvedValueOnce({ id: "sample-2", reads: [] });
    const prisma = {
      siteSettings: {
        findUnique: vi.fn().mockResolvedValue({
          dataBasePath: installedDataPath,
          extraSettings: JSON.stringify({ pipelineExecution: {} }),
        }),
      },
      user: {
        findFirst: vi.fn(async ({ where }: { where: { role: string } }) => ({
          id: where.role === "FACILITY_ADMIN" ? "admin-1" : "researcher-1",
          email: where.role === "FACILITY_ADMIN" ? "admin@example.com" : "user@example.com",
          firstName: where.role === "FACILITY_ADMIN" ? "Admin" : "Researcher",
          lastName: "User",
          role: where.role,
        })),
        create: vi.fn(),
      },
      study: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "study-1" }),
        update: vi.fn(),
      },
      order: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "order-1", orderNumber: "CI-RUNNER-SMOKE-001" }),
        update: vi.fn(),
      },
      sample: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: sampleCreate,
        update: vi.fn(),
      },
      read: {
        create: readCreate,
        update: vi.fn(),
      },
    };

    const result = await applyProfileSeedData({
      prisma,
      profile: {
        id: "ci-runner",
        site: { dataBasePath: profileDefaultDataPath },
        seedData: {
          enabled: true,
          fixtures: [
            {
              id: "ci-runner-fastq-checksum-smoke",
              kind: "orderPipelineSmoke",
              orderNumber: "CI-RUNNER-SMOKE-001",
              source: {
                type: "downloadedFastqBundle",
                url: `file://${bundle.archivePath}`,
                sha256: bundle.sha256,
              },
            },
          ],
        },
      },
      rootDir: tempDir,
      logger: { log: vi.fn(), warn: vi.fn() },
    });

    expect(result.seeded).toBe(1);
    expect(result.results[0]).toMatchObject({
      fixtureId: "ci-runner-fastq-checksum-smoke",
      orderNumber: "CI-RUNNER-SMOKE-001",
      samples: 2,
    });
    expect(readCreate).toHaveBeenCalledTimes(2);
    expect(readCreate.mock.calls[0][0].data).toMatchObject({
      file1: "fixtures/ci-runner/ci-runner-fastq-checksum-smoke/reads/CI-RUNNER-FASTQ-01.fastq.gz",
      checksum1: null,
      pipelineSources: null,
    });
    await expect(
      fs.stat(
        path.join(
          installedDataPath,
          "fixtures/ci-runner/ci-runner-fastq-checksum-smoke/reads/CI-RUNNER-FASTQ-01.fastq.gz"
        )
      )
    ).resolves.toMatchObject({ size: expect.any(Number) });
    await expect(
      fs.stat(
        path.join(
          profileDefaultDataPath,
          "fixtures/ci-runner/ci-runner-fastq-checksum-smoke/reads/CI-RUNNER-FASTQ-01.fastq.gz"
        )
      )
    ).rejects.toThrow();
  });

  it("seeds metadata-driven example dataset fixtures from downloaded bundles", async () => {
    const sourceDir = path.join(tempDir, "example-bundle-source");
    const readsDir = path.join(sourceDir, "reads");
    await fs.mkdir(readsDir, { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "manifest.json"),
      JSON.stringify(
        {
          study: {
            title: "Gemma Nanopore MetaxPath example study",
            alias: "gemma-nanopore-metaxpath",
            description: "Cleaned ONT MinION Mk1D reads for MetaxPath validation.",
            checklistType: "Miscellaneous natural or artificial environment",
            metadata: {
              principal_investigator: "HZI-BIFO",
              study_abstract: "Development example dataset for MetaxPath.",
            },
          },
          order: {
            name: "Gemma Nanopore MetaxPath example order",
            platform: "Nanopore",
            instrumentModel: "ONT MinION Mk1D",
            libraryStrategy: "WGS",
            librarySource: "METAGENOMIC",
            customFields: {
              dataset_url: "https://research.example/gemma.tar.gz",
            },
          },
          samples: [
            {
              sampleId: "S10",
              sampleAlias: "GEMMA-S10",
              sampleTitle: "Gemma S10 cleaned Nanopore reads",
              sampleDescription: "Human-decontaminated Nanopore reads.",
              materialBodySite: "human-decontaminated control",
              file1: "reads/GEMMA_ONT_MINION_MK1D_20260429_FLO-MIN106_barcode10.fastq",
              readCount1: 51644,
              dataClass: "cleaned",
              dataClassSource: "provider_human_decontaminated",
            },
          ],
        },
        null,
        2
      )
    );
    await fs.writeFile(
      path.join(readsDir, "GEMMA_ONT_MINION_MK1D_20260429_FLO-MIN106_barcode10.fastq"),
      "@r1\nACGT\n+\nIIII\n"
    );
    const archivePath = path.join(tempDir, "gemma-example-bundle.tar.gz");
    execFileSync("tar", ["-czf", archivePath, "-C", sourceDir, "."], { stdio: "ignore" });
    const archive = await fs.readFile(archivePath);
    const sha256 = createHash("sha256").update(archive).digest("hex");

    const readCreate = vi.fn().mockResolvedValue({});
    const sampleCreate = vi.fn().mockResolvedValueOnce({ id: "sample-1", reads: [] });
    const studyCreate = vi.fn().mockResolvedValue({ id: "study-1" });
    const orderCreate = vi.fn().mockResolvedValue({
      id: "order-1",
      orderNumber: "DEV-GEMMA-ONT-001",
    });
    const prisma = {
      siteSettings: {
        findUnique: vi.fn().mockResolvedValue({
          dataBasePath: tempDir,
          extraSettings: JSON.stringify({ pipelineExecution: {} }),
        }),
      },
      user: {
        findFirst: vi.fn(async ({ where }: { where: { role: string } }) => ({
          id: where.role === "FACILITY_ADMIN" ? "admin-1" : "researcher-1",
          email: where.role === "FACILITY_ADMIN" ? "admin@example.com" : "user@example.com",
          firstName: where.role === "FACILITY_ADMIN" ? "Admin" : "Researcher",
          lastName: "User",
          role: where.role,
        })),
        create: vi.fn(),
      },
      study: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: studyCreate,
        update: vi.fn(),
      },
      order: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: orderCreate,
        update: vi.fn(),
      },
      sample: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: sampleCreate,
        update: vi.fn(),
      },
      read: {
        create: readCreate,
        update: vi.fn(),
      },
    };

    const result = await applyProfileSeedData({
      prisma,
      profile: {
        id: "dev",
        site: { dataBasePath: tempDir },
        seedData: {
          enabled: true,
          fixtures: [
            {
              id: "gemma-nanopore-metaxpath-5sample",
              kind: "exampleDataset",
              orderNumber: "DEV-GEMMA-ONT-001",
              source: {
                type: "downloadedFastqBundle",
                url: `file://${archivePath}`,
                sha256,
              },
            },
          ],
        },
      },
      rootDir: tempDir,
      logger: { log: vi.fn(), warn: vi.fn() },
    });

    expect(result.seeded).toBe(1);
    expect(studyCreate.mock.calls[0][0].data).toMatchObject({
      title: "Gemma Nanopore MetaxPath example study",
      alias: "gemma-nanopore-metaxpath",
      description: "Cleaned ONT MinION Mk1D reads for MetaxPath validation.",
    });
    expect(orderCreate.mock.calls[0][0].data).toMatchObject({
      orderNumber: "DEV-GEMMA-ONT-001",
      name: "Gemma Nanopore MetaxPath example order",
      platform: null,
      instrumentModel: "ONT MinION Mk1D",
      numberOfSamples: 1,
    });
    expect(JSON.parse(orderCreate.mock.calls[0][0].data.customFields)).toMatchObject({
      _sequencing_tech: {
        technologyId: "ont-minion",
        technologyName: "MinION",
        platformFamily: "oxford-nanopore",
        readLengthClass: "long",
        supportedReadLayouts: ["single"],
        deviceId: "ont-minion-mk1d",
        deviceName: "MinION Mk1D",
      },
      dataset_url: "https://research.example/gemma.tar.gz",
    });
    expect(readCreate.mock.calls[0][0].data).toMatchObject({
      file1:
        "fixtures/dev/gemma-nanopore-metaxpath-5sample/reads/GEMMA_ONT_MINION_MK1D_20260429_FLO-MIN106_barcode10.fastq",
      readCount1: 51644,
      dataClass: "cleaned",
      dataClassSource: "provider_human_decontaminated",
    });
  });

  it("fails a required downloaded FASTQ fixture when the SHA256 does not match", async () => {
    const bundle = await createDownloadedFastqBundle({ corruptSha: true });
    await expect(
      applyProfileSeedData({
        prisma: {
          siteSettings: {
            findUnique: vi.fn().mockResolvedValue({
              dataBasePath: tempDir,
              extraSettings: JSON.stringify({ pipelineExecution: {} }),
            }),
          },
        },
        profile: {
          id: "ci-runner",
          site: { dataBasePath: tempDir },
          seedData: {
            enabled: true,
            fixtures: [
              {
                id: "ci-runner-fastq-checksum-smoke",
                kind: "orderPipelineSmoke",
                source: {
                  type: "downloadedFastqBundle",
                  url: `file://${bundle.archivePath}`,
                  sha256: bundle.sha256,
                },
              },
            ],
          },
        },
        rootDir: tempDir,
        logger: { log: vi.fn(), warn: vi.fn() },
      })
    ).rejects.toThrow("SHA256 mismatch");
  });

  it("keeps downloaded FASTQ fixture read writebacks when reapplied", async () => {
    const bundle = await createDownloadedFastqBundle();
    const relativePath =
      "fixtures/ci-runner/ci-runner-fastq-checksum-smoke/reads/CI-RUNNER-FASTQ-01.fastq.gz";
    const existingRead = {
      id: "read-1",
      file1: relativePath,
      checksum1: "existing-md5",
      pipelineRunId: null,
      pipelineSources: JSON.stringify({ "fastq-checksum": "run-1" }),
    };
    const readUpdate = vi.fn().mockResolvedValue({});
    const prisma = {
      siteSettings: {
        findUnique: vi.fn().mockResolvedValue({
          dataBasePath: tempDir,
          extraSettings: JSON.stringify({ pipelineExecution: {} }),
        }),
      },
      user: {
        findFirst: vi.fn(async ({ where }: { where: { role: string } }) => ({
          id: where.role === "FACILITY_ADMIN" ? "admin-1" : "researcher-1",
          email: where.role === "FACILITY_ADMIN" ? "admin@example.com" : "user@example.com",
          firstName: where.role === "FACILITY_ADMIN" ? "Admin" : "Researcher",
          lastName: "User",
          role: where.role,
        })),
        create: vi.fn(),
      },
      study: {
        findFirst: vi.fn().mockResolvedValue({ id: "study-1" }),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: "study-1" }),
      },
      order: {
        findUnique: vi.fn().mockResolvedValue({ id: "order-1", orderNumber: "CI-RUNNER-SMOKE-001" }),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: "order-1", orderNumber: "CI-RUNNER-SMOKE-001" }),
      },
      sample: {
        findFirst: vi.fn().mockResolvedValue({ id: "sample-1", sampleId: "CI-RUNNER-FASTQ-01" }),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: "sample-1", reads: [existingRead] }),
      },
      read: {
        create: vi.fn(),
        update: readUpdate,
      },
    };

    await applyProfileSeedData({
      prisma,
      profile: {
        id: "ci-runner",
        site: { dataBasePath: tempDir },
        seedData: {
          enabled: true,
          fixtures: [
            {
              id: "ci-runner-fastq-checksum-smoke",
              kind: "orderPipelineSmoke",
              orderNumber: "CI-RUNNER-SMOKE-001",
              source: {
                type: "downloadedFastqBundle",
                url: `file://${bundle.archivePath}`,
                sha256: bundle.sha256,
              },
            },
          ],
        },
      },
      rootDir: tempDir,
      logger: { log: vi.fn(), warn: vi.fn() },
    });

    expect(readUpdate.mock.calls[0][0].data).toMatchObject({
      checksum1: "existing-md5",
      pipelineSources: JSON.stringify({ "fastq-checksum": "run-1" }),
    });
  });
});
