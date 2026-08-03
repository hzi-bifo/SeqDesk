import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

import { clearConfigCache } from "@/lib/config/loader";
import { db } from "@/lib/db";
import {
  SEED_DUMMY_FOLDER_ROOT,
  SEED_DUMMY_MARKER,
} from "@/lib/seed/dummy-orders";
import { removeDummySeed } from "@/lib/seed/run-seed";
import { DELETE, GET, POST } from "./route";

const SEED_MARKER = `"seedSource":"${SEED_DUMMY_MARKER}"`;

interface SiteSettingsSnapshot {
  dataBasePath: string | null;
  extraSettings: string | null;
  updatedAt: Date;
}

interface DummyDataRouteBody {
  success?: boolean;
  error?: string;
  seeded?: boolean;
  databaseComplete?: boolean;
  databasePresent?: boolean;
  integrityComplete?: boolean;
  ordersCount?: number;
  studiesCount?: number;
  samplesCount?: number;
  readsCount?: number;
  ordersCreated?: number;
  samplesCreated?: number;
  readsCreated?: number;
  filesCreated?: number;
  ordersDeleted?: number;
  filesRemoved?: boolean;
  filesPresent?: boolean;
  filesComplete?: boolean;
  referencedFilesCount?: number;
  validFilesCount?: number;
  invalidFilesCount?: number;
  cleanupPending?: boolean;
  dummyDataEnabled?: boolean | null;
  storageReady?: boolean;
  dataBasePath?: string | null;
  fixtureDataBasePath?: string | null;
}

function restoreEnvironmentVariable(
  name: string,
  originalValue: string | undefined
): void {
  if (originalValue === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = originalValue;
  }
}

async function readBody(response: Response): Promise<DummyDataRouteBody> {
  return (await response.json()) as DummyDataRouteBody;
}

describe("/api/admin/seed/dummy-data (live PostgreSQL)", () => {
  it(
    "runs the real admin status, install, conflict, and removal lifecycle",
    async () => {
      const tempRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), "seqdesk-dummy-route-live-")
      );
      const storageDir = path.join(tempRoot, "sequencing-data");
      const pipelinesDir = path.join(tempRoot, "pipelines");
      const userEmail = `dummy-route-live-${randomUUID()}@example.invalid`;
      const originalDataPath = process.env.SEQDESK_DATA_PATH;
      const originalPipelinesDir = process.env.SEQDESK_PIPELINES_DIR;

      let userId: string | null = null;
      let originalSettings: SiteSettingsSnapshot | null = null;
      let settingsSnapshotTaken = false;
      let settingsMutated = false;

      try {
        await fs.mkdir(storageDir, { recursive: true });
        await fs.mkdir(pipelinesDir, { recursive: true });
        process.env.SEQDESK_DATA_PATH = storageDir;
        process.env.SEQDESK_PIPELINES_DIR = pipelinesDir;
        clearConfigCache();

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
            firstName: "Demo Route",
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

        mocks.getServerSession.mockResolvedValue({
          user: {
            id: userId,
            email: userEmail,
            name: "Demo Route Live Test",
            role: "FACILITY_ADMIN",
            isDemo: false,
          },
        });

        const initialResponse = await GET();
        expect(initialResponse.status).toBe(200);
        await expect(readBody(initialResponse)).resolves.toMatchObject({
          seeded: false,
          databaseComplete: false,
          databasePresent: false,
          integrityComplete: false,
          ordersCount: 0,
          studiesCount: 0,
          samplesCount: 0,
          readsCount: 0,
          filesPresent: false,
          filesComplete: false,
          cleanupPending: false,
          storageReady: true,
          dataBasePath: storageDir,
        });

        const installResponse = await POST();
        expect(installResponse.status).toBe(200);
        const installed = await readBody(installResponse);
        expect(installed).toMatchObject({
          success: true,
          ordersCreated: 4,
          samplesCreated: 10,
          readsCreated: 12,
        });
        expect(installed.filesCreated).toBeGreaterThan(0);

        const activityStore = JSON.parse(
          await fs.readFile(
            path.join(pipelinesDir, ".admin-activity-status.json"),
            "utf8"
          )
        ) as {
          jobs?: Record<string, { state?: string; phase?: string }>;
        };
        expect(activityStore.jobs?.[`seed:dummy-data:${userId}`]).toMatchObject({
          state: "success",
          phase: "complete",
        });

        const installedStatusResponse = await GET();
        expect(installedStatusResponse.status).toBe(200);
        const installedStatus = await readBody(installedStatusResponse);
        expect(installedStatus).toMatchObject({
          seeded: true,
          databaseComplete: true,
          databasePresent: true,
          integrityComplete: true,
          ordersCount: 4,
          studiesCount: 2,
          samplesCount: 10,
          readsCount: 12,
          filesPresent: true,
          filesComplete: true,
          invalidFilesCount: 0,
          cleanupPending: false,
          dummyDataEnabled: true,
          storageReady: true,
          dataBasePath: storageDir,
          fixtureDataBasePath: storageDir,
        });
        expect(installedStatus.referencedFilesCount).toBe(
          installed.filesCreated
        );
        expect(installedStatus.validFilesCount).toBe(installed.filesCreated);

        const conflictResponse = await POST();
        expect(conflictResponse.status).toBe(409);
        await expect(readBody(conflictResponse)).resolves.toMatchObject({
          error:
            "Dummy seed data already exists for this admin. Wipe it first to re-seed.",
          ordersCount: 4,
        });

        const removeResponse = await DELETE();
        expect(removeResponse.status).toBe(200);
        await expect(readBody(removeResponse)).resolves.toMatchObject({
          success: true,
          ordersDeleted: 4,
          filesRemoved: true,
        });

        const fixtureDir = path.join(
          storageDir,
          SEED_DUMMY_FOLDER_ROOT,
          userId
        );
        await expect(fs.stat(fixtureDir)).rejects.toMatchObject({
          code: "ENOENT",
        });

        const finalResponse = await GET();
        expect(finalResponse.status).toBe(200);
        await expect(readBody(finalResponse)).resolves.toMatchObject({
          seeded: false,
          databaseComplete: false,
          databasePresent: false,
          integrityComplete: false,
          ordersCount: 0,
          studiesCount: 0,
          samplesCount: 0,
          readsCount: 0,
          filesPresent: false,
          filesComplete: false,
          cleanupPending: false,
          dummyDataEnabled: false,
        });
      } finally {
        const cleanupErrors: unknown[] = [];

        if (userId) {
          await removeDummySeed({
            ownerUserId: userId,
            resolvedBase: storageDir,
          }).catch((error) => cleanupErrors.push(error));
          await db.order
            .deleteMany({
              where: {
                userId,
                customFields: { contains: SEED_MARKER },
              },
            })
            .catch((error) => cleanupErrors.push(error));
          await db.study
            .deleteMany({
              where: {
                userId,
                studyMetadata: { contains: SEED_MARKER },
              },
            })
            .catch((error) => cleanupErrors.push(error));
          await fs
            .rm(path.join(storageDir, SEED_DUMMY_FOLDER_ROOT, userId), {
              recursive: true,
              force: true,
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

        restoreEnvironmentVariable("SEQDESK_DATA_PATH", originalDataPath);
        restoreEnvironmentVariable(
          "SEQDESK_PIPELINES_DIR",
          originalPipelinesDir
        );
        clearConfigCache();
        await fs
          .rm(tempRoot, { recursive: true, force: true })
          .catch((error) => cleanupErrors.push(error));

        if (cleanupErrors.length > 0) {
          throw new AggregateError(
            cleanupErrors,
            "Failed to clean up the live dummy-data route fixture"
          );
        }
      }
    },
    60_000
  );
});
