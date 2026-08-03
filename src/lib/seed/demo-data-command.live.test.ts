import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { buildSync } from "esbuild";
import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";

const SEED_MARKER = '"seedSource":"admin-dummy"';

interface DemoDataResult {
  ok?: boolean;
  action?: string;
  owner?: { email?: string };
  seeded?: boolean;
  databasePresent?: boolean;
  incomplete?: boolean;
  ordersCount?: number;
  studiesCount?: number;
  filesPresent?: boolean;
  cleanupPending?: boolean;
  alreadyInstalled?: boolean;
  ordersCreated?: number;
  samplesCreated?: number;
  readsCreated?: number;
  filesCreated?: number;
  ordersDeleted?: number;
  filesRemoved?: boolean;
}

interface SiteSettingsSnapshot {
  dataBasePath: string | null;
  extraSettings: string | null;
  updatedAt: Date;
}

function runDemoDataCommand(options: {
  launcherPath: string;
  installDir: string;
  userEmail: string;
  action: "install" | "status" | "remove";
}): DemoDataResult {
  const args = [
    options.launcherPath,
    "demo-data",
    options.action,
    "--dir",
    options.installDir,
    "--user-email",
    options.userEmail,
    "--json",
  ];
  if (options.action !== "status") {
    args.push("--yes");
  }

  const result = spawnSync(process.execPath, args, {
    cwd: options.installDir,
    encoding: "utf8",
    env: { ...process.env },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      [
        `seqdesk demo-data ${options.action} exited with ${result.status}.`,
        result.stdout.trim() ? `stdout: ${result.stdout.trim()}` : "",
        result.stderr.trim() ? `stderr: ${result.stderr.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  try {
    return JSON.parse(result.stdout) as DemoDataResult;
  } catch (error) {
    throw new Error(
      `seqdesk demo-data ${options.action} did not return JSON: ${result.stdout}`,
      { cause: error }
    );
  }
}

function validateFastq(fileName: string, compressed: Buffer): void {
  let text: string;
  try {
    text = gunzipSync(compressed).toString("utf8");
  } catch (error) {
    throw new Error(`${fileName} is not a valid gzip file`, { cause: error });
  }

  if (!text.endsWith("\n")) {
    throw new Error(`${fileName} does not end with a FASTQ newline`);
  }
  const lines = text.trimEnd().split("\n");
  if (lines.length === 0 || lines.length % 4 !== 0) {
    throw new Error(`${fileName} does not contain complete FASTQ records`);
  }

  for (let index = 0; index < lines.length; index += 4) {
    const header = lines[index];
    const sequence = lines[index + 1];
    const separator = lines[index + 2];
    const quality = lines[index + 3];
    if (!header.startsWith("@SIM:")) {
      throw new Error(`${fileName} has an invalid synthetic-read header`);
    }
    if (!sequence || !/^[ACGTN]+$/.test(sequence)) {
      throw new Error(`${fileName} has an invalid sequence`);
    }
    if (separator !== "+") {
      throw new Error(`${fileName} has an invalid FASTQ separator`);
    }
    if (quality.length !== sequence.length) {
      throw new Error(`${fileName} has mismatched sequence and quality lengths`);
    }
  }
}

describe("installed demo-data command (live PostgreSQL)", () => {
  it(
    "runs the packaged status, install, idempotence, and removal lifecycle",
    async () => {
      const repositoryRoot = process.cwd();
      const databaseUrl = process.env.DATABASE_URL;
      const directUrl = process.env.DIRECT_URL || databaseUrl;
      if (!databaseUrl || !directUrl) {
        throw new Error("DATABASE_URL and DIRECT_URL are required for this live test");
      }

      const tempRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), "seqdesk-demo-data-live-")
      );
      const installDir = path.join(tempRoot, "install");
      const appDir = path.join(installDir, "current");
      const workerPath = path.join(appDir, "scripts", "demo-data.js");
      const storageDir = path.join(tempRoot, "sequencing-data");
      const launcherPath = path.join(
        repositoryRoot,
        "npm",
        "seqdesk",
        "bin",
        "seqdesk.js"
      );
      const userEmail = `demo-data-live-${randomUUID()}@example.invalid`;

      let userId: string | null = null;
      let originalSettings: SiteSettingsSnapshot | null = null;
      let settingsSnapshotTaken = false;
      let settingsMutated = false;

      try {
        await fs.mkdir(path.dirname(workerPath), { recursive: true });
        await fs.mkdir(storageDir, { recursive: true });
        await fs.mkdir(path.join(appDir, "node_modules", "@prisma"), {
          recursive: true,
        });
        await fs.mkdir(path.join(appDir, "node_modules", ".prisma"), {
          recursive: true,
        });

        // Match scripts/build-release.sh exactly: the installed launcher must
        // exercise the same CommonJS bundle and external Prisma runtime.
        buildSync({
          entryPoints: [path.join(repositoryRoot, "scripts", "demo-data.ts")],
          bundle: true,
          platform: "node",
          target: "node22",
          format: "cjs",
          outfile: workerPath,
          external: ["@prisma/client", ".prisma/client", "fsevents"],
          logLevel: "warning",
        });
        await fs.cp(
          path.join(repositoryRoot, "node_modules", "@prisma", "client"),
          path.join(appDir, "node_modules", "@prisma", "client"),
          { recursive: true }
        );
        await fs.cp(
          path.join(repositoryRoot, "node_modules", ".prisma", "client"),
          path.join(appDir, "node_modules", ".prisma", "client"),
          { recursive: true }
        );
        await fs.copyFile(
          path.join(repositoryRoot, "package.json"),
          path.join(appDir, "package.json")
        );
        await fs.writeFile(
          path.join(installDir, "settings.json"),
          `${JSON.stringify(
            {
              runtime: { databaseUrl, directUrl },
              bootstrap: { users: { admin: { email: userEmail } } },
            },
            null,
            2
          )}\n`
        );

        originalSettings = await db.siteSettings.findUnique({
          where: { id: "singleton" },
          select: {
            dataBasePath: true,
            extraSettings: true,
            updatedAt: true,
          },
        });
        settingsSnapshotTaken = true;

        const owner = await db.user.create({
          data: {
            email: userEmail,
            password: "unused-live-test-password",
            firstName: "Demo Data",
            lastName: "Live Test",
            role: "FACILITY_ADMIN",
          },
          select: { id: true },
        });
        userId = owner.id;

        await db.siteSettings.upsert({
          where: { id: "singleton" },
          create: { id: "singleton", dataBasePath: storageDir },
          update: { dataBasePath: storageDir },
        });
        settingsMutated = true;

        const command = (action: "install" | "status" | "remove") =>
          runDemoDataCommand({
            launcherPath,
            installDir,
            userEmail,
            action,
          });

        expect(command("status")).toMatchObject({
          ok: true,
          action: "status",
          owner: { email: userEmail },
          seeded: false,
          databasePresent: false,
          ordersCount: 0,
          studiesCount: 0,
          filesPresent: false,
          cleanupPending: false,
        });

        const installed = command("install");
        expect(installed).toMatchObject({
          ok: true,
          action: "install",
          owner: { email: userEmail },
          seeded: true,
          databasePresent: true,
          incomplete: false,
          ordersCount: 4,
          studiesCount: 2,
          ordersCreated: 4,
          samplesCreated: 10,
          readsCreated: 12,
          filesPresent: true,
          cleanupPending: false,
        });

        const [orders, studies] = await Promise.all([
          db.order.findMany({
            where: {
              userId,
              customFields: { contains: SEED_MARKER },
            },
            include: { samples: { include: { reads: true } } },
          }),
          db.study.findMany({
            where: {
              userId,
              studyMetadata: { contains: SEED_MARKER },
            },
          }),
        ]);
        const samples = orders.flatMap((order) => order.samples);
        const reads = samples.flatMap((sample) => sample.reads);
        expect(orders).toHaveLength(4);
        expect(studies).toHaveLength(2);
        expect(samples).toHaveLength(10);
        expect(reads).toHaveLength(12);
        expect(
          orders.every((order) => order.customFields?.includes(SEED_MARKER))
        ).toBe(true);
        expect(
          studies.every((study) => study.studyMetadata?.includes(SEED_MARKER))
        ).toBe(true);
        expect(samples.every((sample) => Boolean(sample.checklistData))).toBe(
          true
        );
        expect(
          samples.every((sample) => sample.customFields?.includes(SEED_MARKER))
        ).toBe(true);

        const relativeFilePaths = new Set<string>();
        for (const read of reads) {
          expect(read.file1).toBeTruthy();
          if (read.file1) relativeFilePaths.add(read.file1);
          if (read.file2) relativeFilePaths.add(read.file2);
        }
        expect(relativeFilePaths.size).toBeGreaterThan(0);
        expect(installed.filesCreated).toBe(relativeFilePaths.size);

        const hashes = new Map<string, string>();
        const normalizedStorage = `${path.resolve(storageDir)}${path.sep}`;
        for (const relativeFilePath of relativeFilePaths) {
          expect(relativeFilePath.endsWith(".fastq.gz")).toBe(true);
          const absoluteFilePath = path.resolve(storageDir, relativeFilePath);
          expect(absoluteFilePath.startsWith(normalizedStorage)).toBe(true);
          const compressed = await fs.readFile(absoluteFilePath);
          validateFastq(relativeFilePath, compressed);
          hashes.set(
            relativeFilePath,
            createHash("sha256").update(compressed).digest("hex")
          );
        }

        const fixtureDir = path.join(storageDir, "seed-dummy", userId);
        const fixtureEntries = await fs.readdir(fixtureDir, {
          withFileTypes: true,
        });
        expect(fixtureEntries.every((entry) => entry.isFile())).toBe(true);
        expect(fixtureEntries).toHaveLength(relativeFilePaths.size);

        expect(command("status")).toMatchObject({
          ok: true,
          action: "status",
          seeded: true,
          databasePresent: true,
          incomplete: false,
          ordersCount: 4,
          studiesCount: 2,
          filesPresent: true,
          cleanupPending: false,
        });

        expect(command("install")).toMatchObject({
          ok: true,
          action: "install",
          seeded: true,
          ordersCount: 4,
          studiesCount: 2,
          alreadyInstalled: true,
          filesPresent: true,
          cleanupPending: false,
        });
        await expect(
          Promise.all(
            [...hashes].map(async ([relativeFilePath, expectedHash]) => {
              const contents = await fs.readFile(
                path.resolve(storageDir, relativeFilePath)
              );
              expect(
                createHash("sha256").update(contents).digest("hex")
              ).toBe(expectedHash);
            })
          )
        ).resolves.toBeDefined();

        expect(command("remove")).toMatchObject({
          ok: true,
          action: "remove",
          seeded: false,
          databasePresent: false,
          ordersCount: 0,
          studiesCount: 0,
          ordersDeleted: 4,
          filesPresent: false,
          cleanupPending: false,
          filesRemoved: true,
        });
        await expect(fs.stat(fixtureDir)).rejects.toMatchObject({
          code: "ENOENT",
        });
        await expect(
          db.order.count({
            where: { userId, customFields: { contains: SEED_MARKER } },
          })
        ).resolves.toBe(0);
        await expect(
          db.study.count({
            where: { userId, studyMetadata: { contains: SEED_MARKER } },
          })
        ).resolves.toBe(0);
        expect(command("status")).toMatchObject({
          ok: true,
          action: "status",
          seeded: false,
          databasePresent: false,
          ordersCount: 0,
          studiesCount: 0,
          filesPresent: false,
          cleanupPending: false,
        });
      } finally {
        const cleanupErrors: unknown[] = [];
        if (userId) {
          await db.order
            .deleteMany({
              where: { userId, customFields: { contains: SEED_MARKER } },
            })
            .catch((error) => cleanupErrors.push(error));
          await db.study
            .deleteMany({
              where: { userId, studyMetadata: { contains: SEED_MARKER } },
            })
            .catch((error) => cleanupErrors.push(error));
          await db.user
            .deleteMany({ where: { id: userId } })
            .catch((error) => cleanupErrors.push(error));
        }

        if (settingsSnapshotTaken && settingsMutated) {
          if (originalSettings) {
            await db.siteSettings
              .update({
                where: { id: "singleton" },
                data: {
                  dataBasePath: originalSettings.dataBasePath,
                  extraSettings: originalSettings.extraSettings,
                  updatedAt: originalSettings.updatedAt,
                },
              })
              .catch((error) => cleanupErrors.push(error));
          } else {
            await db.siteSettings
              .deleteMany({ where: { id: "singleton" } })
              .catch((error) => cleanupErrors.push(error));
          }
        }
        await fs
          .rm(tempRoot, { recursive: true, force: true })
          .catch((error) => cleanupErrors.push(error));

        if (cleanupErrors.length > 0) {
          throw new AggregateError(
            cleanupErrors,
            "Failed to clean up the live demo-data fixture"
          );
        }
      }
    },
    60_000
  );
});
