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
  buildDownloaderInvocation,
  buildProfilePipelineDatabaseInstallDir,
  buildProfilePipelineDatabaseRoot,
  buildProfilePipelineDatabaseTargetPath,
  redactSourceUrl,
  redactTextForLog,
  resolveProfilePipelineAssetSettings,
  resolveProfileDatabaseRequests,
} from "../../../scripts/lib/install-profile-assets.mjs";

let tempDir: string;

const testLogger = {
  log: vi.fn(),
  warn: vi.fn(),
} as unknown as Console;

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

  it("redacts URL credentials and query tokens from persisted and logged text", () => {
    const sourceUrl =
      "https://download-user:download-pass@example.org/database.tar.gz?token=secret-token&signature=secret-signature#fragment";
    expect(redactSourceUrl(sourceUrl)).toBe(
      "https://example.org/database.tar.gz"
    );
    const redactedLog = redactTextForLog(
      `curl failed for ${sourceUrl}; token=secret-token`,
      [sourceUrl]
    );
    expect(redactedLog).not.toContain("download-user");
    expect(redactedLog).not.toContain("download-pass");
    expect(redactedLog).not.toContain("secret-token");
    expect(redactedLog).not.toContain("secret-signature");
    expect(redactedLog).toContain("https://example.org/database.tar.gz");
  });

  it("passes signed download URLs through stdin instead of process arguments", () => {
    const sourceUrl =
      "https://download-user:download-pass@example.org/database.tar.gz?token=secret-token";

    for (const command of ["curl", "wget"]) {
      const invocation = buildDownloaderInvocation(command, sourceUrl, "/tmp/database.tar.gz");
      expect(invocation.args.join(" ")).not.toContain(sourceUrl);
      expect(invocation.args.join(" ")).not.toContain("secret-token");
      expect(invocation.stdin).toContain(sourceUrl);
    }
  });

  it("expands home-relative profile paths before resolving pipeline assets", async () => {
    const prisma = {
      siteSettings: {
        findUnique: vi.fn().mockResolvedValue({
          dataBasePath: null,
          extraSettings: "{}",
        }),
      },
    };

    await expect(
      resolveProfilePipelineAssetSettings(prisma, {
        site: { dataBasePath: "~/seqdesk-data" },
        pipelines: {
          databaseDirectory: "~/seqdesk-pipeline-databases",
          execution: { runDirectory: "~/seqdesk-pipeline-runs" },
        },
      })
    ).resolves.toEqual({
      dataBasePath: path.join(os.homedir(), "seqdesk-data"),
      pipelineRunDir: path.join(os.homedir(), "seqdesk-pipeline-runs"),
      databaseDirectory: path.join(
        os.homedir(),
        "seqdesk-pipeline-databases"
      ),
    });
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
      logger: testLogger,
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
        logger: testLogger,
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
      logger: testLogger,
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

  it("replaces a poisoned cached archive and extracts the Kraken database directory", async () => {
    const rootDir = path.join(tempDir, "kraken-install-root");
    const databaseRoot = path.join(tempDir, "kraken-profile-dbs");
    const archiveSourceDir = path.join(tempDir, "kraken-source");
    const archiveContentDir = path.join(
      archiveSourceDir,
      "k2_minusb_20260226"
    );
    await fs.mkdir(archiveContentDir, { recursive: true });
    await Promise.all(
      ["hash.k2d", "opts.k2d", "taxo.k2d"].map((fileName) =>
        fs.writeFile(path.join(archiveContentDir, fileName), `${fileName}\n`)
      )
    );
    const archiveSource = path.join(tempDir, "k2_minusb_20260226.tar.gz");
    execFileSync("tar", [
      "-czf",
      archiveSource,
      "-C",
      archiveSourceDir,
      "k2_minusb_20260226",
    ]);
    const archiveSha256 = createHash("sha256")
      .update(await fs.readFile(archiveSource))
      .digest("hex");

    await fs.mkdir(path.join(rootDir, "data"), { recursive: true });
    await fs.writeFile(
      path.join(rootDir, "data", "pipeline-databases.json"),
      JSON.stringify({
        "read-cleaning": [
          {
            id: "kraken2-db",
            version: "k2_minusb_20260226",
            fileName: "k2_minusb_20260226.tar.gz",
            downloadUrl: `file://${archiveSource}`,
            sha256: archiveSha256,
            configKey: "kraken2Db",
          },
        ],
      })
    );

    const poisonedArchivePath = path.join(
      databaseRoot,
      "read-cleaning",
      "kraken2-db",
      "k2_minusb_20260226.tar.gz"
    );
    await fs.mkdir(path.dirname(poisonedArchivePath), { recursive: true });
    await fs.writeFile(poisonedArchivePath, "poisoned cached archive");

    const pipelineConfigUpsert = vi.fn().mockResolvedValue({});
    const result = await applyProfilePipelineDatabases({
      prisma: makeDatabasePrisma(databaseRoot, pipelineConfigUpsert),
      profile: {
        pipelines: {
          databaseDirectory: databaseRoot,
          databases: [
            {
              pipelineId: "read-cleaning",
              databaseId: "kraken2-db",
            },
          ],
        },
      },
      rootDir,
      logger: testLogger,
    });

    const runtimePath = path.join(
      databaseRoot,
      "read-cleaning",
      "kraken2-db",
      "installed",
      "k2_minusb_20260226"
    );
    await expect(fs.readFile(path.join(runtimePath, "hash.k2d"), "utf8")).resolves.toBe(
      "hash.k2d\n"
    );
    expect(
      createHash("sha256")
        .update(await fs.readFile(poisonedArchivePath))
        .digest("hex")
    ).toBe(archiveSha256);
    expect(
      (await fs.readdir(path.dirname(poisonedArchivePath))).some((name) =>
        name.endsWith(".part")
      )
    ).toBe(false);
    expect(result.results).toEqual([
      expect.objectContaining({
        pipelineId: "read-cleaning",
        databaseId: "kraken2-db",
        path: runtimePath,
        status: "success",
      }),
    ]);
    expect(pipelineConfigUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pipelineId: "read-cleaning" },
        create: expect.objectContaining({
          config: JSON.stringify({ kraken2Db: runtimePath }),
        }),
      })
    );
  });

  it("persists redacted database source URLs in private status files", async () => {
    const rootDir = path.join(tempDir, "redacted-status-root");
    const existingDatabase = path.join(tempDir, "existing", "database.bin");
    const sensitiveSourceUrl =
      "https://db-user:db-password@example.org/database.bin?token=secret-token#private";
    await fs.mkdir(path.dirname(existingDatabase), { recursive: true });
    await fs.writeFile(existingDatabase, "existing database\n");
    await fs.mkdir(path.join(rootDir, "data"), { recursive: true });
    await fs.writeFile(
      path.join(rootDir, "data", "pipeline-databases.json"),
      JSON.stringify({
        custom: [
          {
            id: "db",
            fileName: "database.bin",
            downloadUrl: sensitiveSourceUrl,
            configKey: "databasePath",
          },
        ],
      })
    );

    const result = await applyProfilePipelineDatabases({
      prisma: makeDatabasePrisma(path.join(tempDir, "profile-dbs")),
      profile: {
        pipelines: {
          databases: [
            {
              pipelineId: "custom",
              databaseId: "db",
              mode: "skip",
              path: existingDatabase,
            },
          ],
        },
      },
      rootDir,
      logger: testLogger,
    });

    const indexPath = path.join(
      rootDir,
      "pipelines",
      ".pipeline-database-downloads.json"
    );
    const statusPath = path.join(
      rootDir,
      "pipelines",
      ".pipeline-database-download-status.json"
    );
    const persistedText = [
      await fs.readFile(indexPath, "utf8"),
      await fs.readFile(statusPath, "utf8"),
      JSON.stringify(result),
    ].join("\n");
    expect(persistedText).toContain("https://example.org/database.bin");
    expect(persistedText).not.toContain("db-user");
    expect(persistedText).not.toContain("db-password");
    expect(persistedText).not.toContain("secret-token");
    expect((await fs.stat(indexPath)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(statusPath)).mode & 0o777).toBe(0o600);
    const logPath = result.results?.[0]?.logPath;
    expect(typeof logPath).toBe("string");
    expect((await fs.stat(String(logPath))).mode & 0o777).toBe(0o600);
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
      logger: testLogger,
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
      logger: testLogger,
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

  it("rejects a required existing database path that is absent", async () => {
    const { rootDir } = await createMetaxDbInstallRoot();
    const databaseRoot = path.join(tempDir, "missing-profile-dbs");
    const missingParamsPath = path.join(
      tempDir,
      "missing",
      "metaxpath.downloaded.params.yaml"
    );
    const prisma = makeDatabasePrisma(databaseRoot);

    await expect(
      applyProfilePipelineDatabases({
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
                path: missingParamsPath,
                required: true,
              },
            ],
          },
        },
        rootDir,
        logger: testLogger,
      })
    ).rejects.toThrow(
      `metaxpath/db-bundle does not exist or is empty: ${missingParamsPath}`
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
        logger: testLogger,
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
        logger: testLogger,
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
        logger: testLogger,
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
        logger: testLogger,
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
      logger: testLogger,
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

  it("does not resolve database assets for globally or explicitly deselected pipelines", () => {
    const staleDownload = {
      pipelineId: "metaxpath",
      databaseId: "db-bundle",
      required: true,
    };

    expect(
      resolveProfileDatabaseRequests(
        {
          pipelines: {
            enabled: false,
            databases: { autoDownload: true, downloads: [staleDownload] },
          },
        },
        {}
      )
    ).toEqual({ autoDownload: false, requests: [] });

    expect(
      resolveProfileDatabaseRequests(
        {
          pipelines: {
            enabled: true,
            enable: ["fastqc"],
            databases: { autoDownload: true, downloads: [staleDownload] },
          },
        },
        {}
      )
    ).toEqual({ autoDownload: true, requests: [] });

    expect(
      resolveProfileDatabaseRequests(
        {
          pipelines: {
            enabled: true,
            enable: ["metaxpath"],
            databases: { autoDownload: true, downloads: [staleDownload] },
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
        },
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
      activity: undefined,
      logger: testLogger,
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
    const cachedArchivePath = path.join(
      installedDataPath,
      "fixtures",
      "ci-runner",
      ".downloads",
      "ci-runner-fastq-checksum-smoke.tar.gz"
    );
    await fs.mkdir(path.dirname(cachedArchivePath), { recursive: true });
    await fs.writeFile(cachedArchivePath, "poisoned fixture cache");
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
      activity: undefined,
      logger: testLogger,
    });

    expect(result.seeded).toBe(1);
    const seededResult = result.results?.[0];
    expect(seededResult).toMatchObject({
      fixtureId: "ci-runner-fastq-checksum-smoke",
      orderNumber: "CI-RUNNER-SMOKE-001",
      samples: 2,
    });
    if (!seededResult || !("logPath" in seededResult)) {
      throw new Error("Expected downloaded FASTQ seed result to include a log path");
    }
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
    expect(
      createHash("sha256")
        .update(await fs.readFile(cachedArchivePath))
        .digest("hex")
    ).toBe(bundle.sha256);
    expect((await fs.stat(cachedArchivePath)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(seededResult.logPath)).mode & 0o777).toBe(
      0o600
    );
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
              runAccessionNumber: "ERR123456",
              experimentAccessionNumber: "ERX123456",
              sequencingRun: {
                runId: "ERR123456",
                runName: "Public provenance run",
                platform: "OXFORD_NANOPORE",
                instrument: "MinION Mk1D",
                totalReads: 51644,
                runParameters: {
                  sourceArchive: "ENA",
                  sourceBiosampleAccession: "SAMEA123456",
                },
              },
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
      instrumentModel: "ONT MinION Mk1D",
    });
    const sequencingRunUpsert = vi.fn().mockResolvedValue({ id: "run-1" });
    const sequencingRunSampleUpsert = vi.fn().mockResolvedValue({ id: "run-sample-1" });
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
      sequencingRun: {
        upsert: sequencingRunUpsert,
      },
      sequencingRunSample: {
        upsert: sequencingRunSampleUpsert,
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
      activity: undefined,
      logger: testLogger,
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
      runAccessionNumber: "ERR123456",
      experimentAccessionNumber: "ERX123456",
      sequencingRunId: "run-1",
      dataClass: "cleaned",
      dataClassSource: "provider_human_decontaminated",
    });
    expect(sequencingRunUpsert).toHaveBeenCalledWith({
      where: {
        orderId_runId: { orderId: "order-1", runId: "ERR123456" },
      },
      update: expect.objectContaining({
        runName: "Public provenance run",
        platform: "OXFORD_NANOPORE",
        instrument: "MinION Mk1D",
        totalReads: 51644,
        runParameters: JSON.stringify({
          sourceArchive: "ENA",
          sourceBiosampleAccession: "SAMEA123456",
        }),
      }),
      create: expect.objectContaining({
        orderId: "order-1",
        runId: "ERR123456",
      }),
    });
    expect(sequencingRunSampleUpsert).toHaveBeenCalledWith({
      where: {
        sequencingRunId_sampleId: {
          sequencingRunId: "run-1",
          sampleId: "sample-1",
        },
      },
      update: {},
      create: {
        sequencingRunId: "run-1",
        sampleId: "sample-1",
      },
    });
  });

  it("fails a required downloaded FASTQ fixture when the SHA256 does not match", async () => {
    const bundle = await createDownloadedFastqBundle({ corruptSha: true });
    const cachedArchivePath = path.join(
      tempDir,
      "fixtures",
      "ci-runner",
      ".downloads",
      "ci-runner-fastq-checksum-smoke.tar.gz"
    );
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
        activity: undefined,
        logger: testLogger,
      })
    ).rejects.toThrow("SHA256 mismatch");
    await expect(fs.stat(cachedArchivePath)).rejects.toThrow();
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
      activity: undefined,
      logger: testLogger,
    });

    expect(readUpdate.mock.calls[0][0].data).toMatchObject({
      checksum1: "existing-md5",
      pipelineSources: JSON.stringify({ "fastq-checksum": "run-1" }),
    });
  });
});
