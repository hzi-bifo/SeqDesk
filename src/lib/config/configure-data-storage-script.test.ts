import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DataStorageCommandError,
  configureDataStorage,
  getDataStorageStatus,
  inspectStoragePath,
  parseDataStorageArgs,
  runDataStorageCommand,
} from "../../../scripts/configure-data-storage.mjs";

const tempDirectories: string[] = [];

async function makeTempDirectory() {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "seqdesk-storage-cli-")
  );
  tempDirectories.push(directory);
  return directory;
}

function makePrisma(
  initial: { dataBasePath: string | null; extraSettings?: string | null } | null,
  options: { failUpsert?: boolean } = {}
) {
  let row = initial ? { id: "singleton", ...initial } : null;
  const findUnique = vi.fn(async () => row);
  const upsert = vi.fn(
    async (args: {
      update: { dataBasePath: string };
      create: { id: string; dataBasePath: string };
    }) => {
      if (options.failUpsert) {
        throw new Error("database unavailable with secret connection details");
      }
      row = row
        ? { ...row, ...args.update }
        : { ...args.create, extraSettings: null };
      return row;
    }
  );

  return {
    siteSettings: { findUnique, upsert },
    current: () => row,
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true })
    )
  );
});

describe("configure-data-storage worker", () => {
  it("atomically preserves unrelated config and synchronizes only the database path", async () => {
    const root = await makeTempDirectory();
    const storagePath = path.join(root, "sequencing");
    const configPath = path.join(root, "settings.json");
    await fs.mkdir(storagePath);
    await fs.writeFile(
      configPath,
      JSON.stringify(
        {
          runtime: {
            databaseUrl: "postgresql://user:secret@localhost/seqdesk",
            nextAuthSecret: "do-not-print",
          },
          site: { name: "Facility", dataBasePath: "/old/data" },
          unrelated: { keep: true },
        },
        null,
        2
      )
    );
    await fs.chmod(configPath, 0o640);
    const originalOwner = await fs.stat(configPath);
    const prisma = makePrisma({
      dataBasePath: "/old/data",
      extraSettings: JSON.stringify({ preserve: true }),
    });

    const result = await configureDataStorage({
      storagePath,
      configPath,
      prisma,
      environment: {},
    });

    expect(result).toMatchObject({
      ok: true,
      action: "configure",
      path: storagePath,
      configPath,
      source: "file",
      created: false,
      databaseUpdated: true,
    });
    expect(JSON.stringify(result)).not.toContain("do-not-print");
    expect(JSON.stringify(result)).not.toContain("postgresql://");

    const saved = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(saved).toEqual({
      runtime: {
        databaseUrl: "postgresql://user:secret@localhost/seqdesk",
        nextAuthSecret: "do-not-print",
      },
      site: { name: "Facility", dataBasePath: storagePath },
      unrelated: { keep: true },
    });
    const savedStat = await fs.stat(configPath);
    expect(savedStat.uid).toBe(originalOwner.uid);
    expect(savedStat.gid).toBe(originalOwner.gid);
    expect(savedStat.mode & 0o777).toBe(0o600);

    expect(prisma.siteSettings.upsert).toHaveBeenCalledWith({
      where: { id: "singleton" },
      update: { dataBasePath: storagePath },
      create: { id: "singleton", dataBasePath: storagePath },
    });
    expect(prisma.current()).toEqual({
      id: "singleton",
      dataBasePath: storagePath,
      extraSettings: JSON.stringify({ preserve: true }),
    });
  });

  it("requires --create before creating a missing directory", async () => {
    const root = await makeTempDirectory();
    const storagePath = path.join(root, "new-storage");
    const configPath = path.join(root, "settings.json");
    await fs.writeFile(configPath, "{}");
    const prisma = makePrisma(null);

    await expect(
      configureDataStorage({
        storagePath,
        configPath,
        prisma,
        environment: {},
      })
    ).rejects.toMatchObject({ code: "PATH_NOT_FOUND" });
    await expect(fs.access(storagePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(prisma.siteSettings.upsert).not.toHaveBeenCalled();

    const created = await configureDataStorage({
      storagePath,
      configPath,
      create: true,
      prisma,
      environment: {},
    });
    expect(created).toMatchObject({
      ok: true,
      created: true,
      path: storagePath,
    });
    expect((await fs.stat(storagePath)).isDirectory()).toBe(true);
  });

  it.each([
    ["relative/storage", "PATH_NOT_ABSOLUTE"],
    [path.parse(process.cwd()).root, "PATH_IS_FILESYSTEM_ROOT"],
  ])("rejects unsafe storage path %s", async (storagePath, code) => {
    const result = await inspectStoragePath(storagePath, { strict: true }).catch(
      (error) => error
    );
    expect(result).toBeInstanceOf(DataStorageCommandError);
    expect(result).toMatchObject({ code });
  });

  it("refuses a different active SEQDESK_DATA_PATH override without changing state", async () => {
    const root = await makeTempDirectory();
    const requestedPath = path.join(root, "requested");
    const overridePath = path.join(root, "override");
    const configPath = path.join(root, "settings.json");
    await fs.mkdir(requestedPath);
    await fs.mkdir(overridePath);
    const original = JSON.stringify({
      site: { dataBasePath: overridePath },
      runtime: { nextAuthSecret: "secret" },
    });
    await fs.writeFile(configPath, original);
    const prisma = makePrisma({ dataBasePath: overridePath });

    await expect(
      configureDataStorage({
        storagePath: requestedPath,
        configPath,
        prisma,
        environment: { SEQDESK_DATA_PATH: overridePath },
      })
    ).rejects.toMatchObject({ code: "ENV_OVERRIDE_CONFLICT" });

    expect(await fs.readFile(configPath, "utf8")).toBe(original);
    expect(prisma.current()?.dataBasePath).toBe(overridePath);
    expect(prisma.siteSettings.upsert).not.toHaveBeenCalled();
  });

  it("restores the exact config and mode when the database write fails", async () => {
    const root = await makeTempDirectory();
    const storagePath = path.join(root, "sequencing");
    const configPath = path.join(root, "settings.json");
    await fs.mkdir(storagePath);
    const original = '{\n  "site": {"dataBasePath": "/old"},\n  "token": "keep-me"\n}';
    await fs.writeFile(configPath, original);
    await fs.chmod(configPath, 0o640);
    const prisma = makePrisma(
      { dataBasePath: "/old", extraSettings: '{"keep":true}' },
      { failUpsert: true }
    );

    await expect(
      configureDataStorage({
        storagePath,
        configPath,
        prisma,
        environment: {},
      })
    ).rejects.toMatchObject({
      code: "DATABASE_WRITE_FAILED",
      message:
        "The database update failed. The configuration file change was rolled back.",
    });

    expect(await fs.readFile(configPath, "utf8")).toBe(original);
    expect((await fs.stat(configPath)).mode & 0o777).toBe(0o640);
    expect(prisma.current()).toEqual({
      id: "singleton",
      dataBasePath: "/old",
      extraSettings: '{"keep":true}',
    });
  });

  it("reports environment, config-file, and database sources without exposing config secrets", async () => {
    const root = await makeTempDirectory();
    const environmentPath = path.join(root, "environment");
    const filePath = path.join(root, "file");
    const databasePath = path.join(root, "database");
    await Promise.all(
      [environmentPath, filePath, databasePath].map((directory) =>
        fs.mkdir(directory)
      )
    );
    const configPath = path.join(root, "settings.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        site: { dataBasePath: filePath },
        runtime: { databaseUrl: "postgresql://secret", nextAuthSecret: "secret" },
      })
    );
    const prisma = makePrisma({ dataBasePath: databasePath });

    const status = await getDataStorageStatus({
      configPath,
      prisma,
      environment: { SEQDESK_DATA_PATH: environmentPath },
    });

    expect(status).toMatchObject({
      ok: true,
      action: "status",
      source: "env",
      path: environmentPath,
      ready: true,
      sources: {
        env: environmentPath,
        file: filePath,
        database: databasePath,
      },
      inspection: {
        requestedPath: environmentPath,
        exists: true,
        directory: true,
        readable: true,
        searchable: true,
        ready: true,
      },
    });
    expect(status.warnings.join(" ")).toMatch(/overrides a different path/i);
    expect(JSON.stringify(status)).not.toContain("postgresql://");
    expect(JSON.stringify(status)).not.toContain("nextAuthSecret");
  });

  it("parses the strict installed-worker contract", () => {
    expect(
      parseDataStorageArgs([
        "configure",
        "--path",
        "/data/sequencing",
        "--config",
        "/srv/seqdesk/settings.json",
        "--create",
        "--json",
      ])
    ).toEqual({
      action: "configure",
      storagePath: "/data/sequencing",
      configPath: "/srv/seqdesk/settings.json",
      create: true,
      json: true,
    });
    expect(() =>
      parseDataStorageArgs([
        "status",
        "--config",
        "/srv/seqdesk/settings.json",
        "--create",
        "--json",
      ])
    ).toThrow(/only valid with configure/i);
  });

  it("returns the stable failure envelope and disconnects its injected client", async () => {
    const disconnect = vi.fn(async () => {});
    const result = await runDataStorageCommand(
      [
        "configure",
        "--path",
        "relative",
        "--config",
        "/tmp/settings.json",
        "--json",
      ],
      {
        environment: { DATABASE_URL: "postgresql://not-printed" },
        createPrismaClient: async () => ({
          ...makePrisma(null),
          $disconnect: disconnect,
        }),
      }
    );

    expect(result).toEqual({
      ok: false,
      code: "PATH_NOT_ABSOLUTE",
      error: "The data storage path must be absolute.",
    });
    expect(JSON.stringify(result)).not.toContain("not-printed");
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("prints exactly one JSON failure result when invoked directly through a release symlink", async () => {
    const root = await makeTempDirectory();
    const currentPath = path.join(root, "current");
    await fs.symlink(process.cwd(), currentPath, "dir");
    const scriptPath = path.join(
      currentPath,
      "scripts",
      "configure-data-storage.mjs"
    );
    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: "" },
    });

    expect(result.status).toBe(1);
    const lines = result.stdout.trim().split(/\r?\n/);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      ok: false,
      code: "USAGE",
    });
    expect(result.stderr).toBe("");
  });
});
