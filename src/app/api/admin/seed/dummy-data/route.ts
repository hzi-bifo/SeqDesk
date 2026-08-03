import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveDataBasePathFromStoredValue } from "@/lib/files/data-base-path";
import { inspectDataStoragePath } from "@/lib/files/data-storage-path-validation";
import { getDummyDataEnabledFlag } from "@/lib/seed/extra-settings-flag";
import {
  DummySeedAlreadyExistsError,
  DummySeedCleanupPendingError,
  DummySeedInUseError,
  DummySeedReferencesError,
  DummySeedStorageMismatchError,
  DummySeedSubmissionError,
  getDummySeedFilesystemStatus,
  getDummySeedStatus,
  removeDummySeed,
  runDummySeed,
  type DummySeedFilesystemStatus,
} from "@/lib/seed/run-seed";
import { updateAdminActivityJob } from "@/lib/admin/activity";
import * as path from "path";

interface ResolvedContext {
  resolvedBase: string | null;
  storageReady: boolean;
  storageError: string | null;
  userId: string;
  userEmail: string | null;
  userDisplayName: string;
}

const DEMO_MUTATION_ERROR =
  "Demo-data changes are disabled in the public demo.";

const EMPTY_FILESYSTEM_STATUS: DummySeedFilesystemStatus = {
  folderPresent: false,
  referencedFilesCount: 0,
  validFilesCount: 0,
  invalidFilesCount: 0,
  filesComplete: false,
};

async function resolveContext(options: {
  requireWritableStorage?: boolean;
  rejectDemoMutation?: boolean;
} = {}): Promise<
  | { ok: true; context: ResolvedContext }
  | { ok: false; status: number; body: { error: string; dataBasePath?: string } }
> {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return { ok: false, status: 401, body: { error: "Unauthorized" } };
  }
  if (options.rejectDemoMutation && session.user.isDemo) {
    return {
      ok: false,
      status: 403,
      body: { error: DEMO_MUTATION_ERROR },
    };
  }

  const [settings, user] = await Promise.all([
    db.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { dataBasePath: true },
    }),
    db.user.findUnique({
      where: { id: session.user.id },
      select: { email: true, firstName: true, lastName: true },
    }),
  ]);

  const resolved = resolveDataBasePathFromStoredValue(settings?.dataBasePath);
  const resolvedBase = resolved.dataBasePath
    ? path.resolve(resolved.dataBasePath)
    : null;
  let storageReady = false;
  let storageError: string | null = null;
  if (!resolvedBase) {
    storageError = "Data base path not configured";
  } else {
    const inspection = await inspectDataStoragePath(resolvedBase);
    if (!inspection.valid) {
      storageError = inspection.error ?? "Data base path is invalid";
    } else if (!inspection.writable) {
      storageError =
        `Data base path is not writable by the SeqDesk server process: ${resolvedBase}`;
    } else {
      storageReady = true;
    }
  }
  if (options.requireWritableStorage && !storageReady) {
    return {
      ok: false,
      status: 400,
      body: {
        error: storageError ?? "Data base path is not writable",
        ...(resolvedBase ? { dataBasePath: resolvedBase } : {}),
      },
    };
  }

  const userDisplayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() ||
    "Seed Dummy Data";

  return {
    ok: true,
    context: {
      resolvedBase,
      storageReady,
      storageError,
      userId: session.user.id,
      userEmail: user?.email ?? null,
      userDisplayName,
    },
  };
}

export async function GET() {
  const ctx = await resolveContext();
  if (!ctx.ok) {
    return NextResponse.json(ctx.body, { status: ctx.status });
  }

  const [status, persistedFlag] = await Promise.all([
    getDummySeedStatus(ctx.context.userId),
    getDummyDataEnabledFlag(),
  ]);
  const fixtureDataBasePath =
    status.storedDataBasePath ?? ctx.context.resolvedBase;
  const fixtureInspection = fixtureDataBasePath
    ? await inspectDataStoragePath(fixtureDataBasePath)
    : null;
  const fixtureStorageReady = Boolean(
    fixtureInspection?.valid && fixtureInspection.writable
  );
  const filesystem = status.storagePathConflict
    ? EMPTY_FILESYSTEM_STATUS
    : await getDummySeedFilesystemStatus(
        ctx.context.userId,
        fixtureDataBasePath
      );

  const databasePresent = status.databasePresent ?? status.seeded;
  const databaseComplete =
    status.databaseComplete ??
    (status.seeded && !(status.incomplete ?? false));
  const integrityComplete =
    databaseComplete &&
    filesystem.filesComplete &&
    !status.storagePathConflict;
  const cleanupPending =
    Boolean(status.pendingCleanupDataBasePath) ||
    status.incomplete ||
    status.storagePathConflict ||
    (databasePresent
      ? !integrityComplete
      : filesystem.folderPresent);

  return NextResponse.json({
    ...status,
    seeded: integrityComplete,
    databaseComplete,
    filesPresent: filesystem.folderPresent,
    filesComplete: filesystem.filesComplete,
    integrityComplete,
    referencedFilesCount: filesystem.referencedFilesCount,
    validFilesCount: filesystem.validFilesCount,
    invalidFilesCount: filesystem.invalidFilesCount,
    cleanupPending,
    dummyDataEnabled: persistedFlag,
    storageReady: ctx.context.storageReady,
    storageError: ctx.context.storageError,
    dataBasePath: ctx.context.resolvedBase,
    fixtureDataBasePath,
    fixtureStorageReady,
    fixtureStorageError:
      fixtureInspection && !fixtureStorageReady
        ? fixtureInspection.error ??
          "The original demo-data storage path is not writable"
        : null,
  });
}

export async function POST() {
  const ctx = await resolveContext({
    requireWritableStorage: true,
    rejectDemoMutation: true,
  });
  if (!ctx.ok) {
    return NextResponse.json(ctx.body, { status: ctx.status });
  }
  const { userId, userEmail, userDisplayName } = ctx.context;
  // resolveContext(requireWritableStorage) guarantees this.
  const resolvedBase = ctx.context.resolvedBase!;
  const jobId = `seed:dummy-data:${userId}`;

  try {
    await updateAdminActivityJob(jobId, {
      type: "dummy-seed",
      label: "Load dummy data",
      state: "running",
      phase: "seeding",
      targetPath: resolvedBase,
      error: undefined,
      finishedAt: undefined,
    });
    const result = await runDummySeed({
      ownerUserId: userId,
      resolvedBase,
      ownerEmail: userEmail,
      ownerDisplayName: userDisplayName,
    });
    await updateAdminActivityJob(jobId, {
      type: "dummy-seed",
      label: "Load dummy data",
      state: "success",
      phase: "complete",
      targetPath: result.dataPath,
      progressPercent: 100,
      finishedAt: new Date().toISOString(),
      error: undefined,
    });

    return NextResponse.json({
      success: true,
      ordersCreated: result.ordersCreated,
      samplesCreated: result.samplesCreated,
      readsCreated: result.readsCreated,
      filesCreated: result.filesCreated,
      dataPath: result.dataPath,
      platform: result.platform,
    });
  } catch (error) {
    if (error instanceof DummySeedAlreadyExistsError) {
      await updateAdminActivityJob(jobId, {
        type: "dummy-seed",
        label: "Load dummy data",
        state: "error",
        phase: "seeding",
        targetPath: resolvedBase,
        error: "Dummy seed data already exists for this admin. Wipe it first to re-seed.",
        finishedAt: new Date().toISOString(),
      }).catch(() => {});
      return NextResponse.json(
        {
          error:
            "Dummy seed data already exists for this admin. Wipe it first to re-seed.",
          ordersCount: error.ordersCount,
        },
        { status: 409 }
      );
    }
    if (error instanceof DummySeedCleanupPendingError) {
      await updateAdminActivityJob(jobId, {
        type: "dummy-seed",
        label: "Load dummy data",
        state: "error",
        phase: "seeding",
        targetPath: resolvedBase,
        error: error.message,
        finishedAt: new Date().toISOString(),
      }).catch(() => {});
      return NextResponse.json(
        { error: error.message, cleanupPending: true },
        { status: 409 }
      );
    }
    console.error("[Seed Dummy Data] Failed:", error);
    await updateAdminActivityJob(jobId, {
      type: "dummy-seed",
      label: "Load dummy data",
      state: "error",
      phase: "seeding",
      targetPath: resolvedBase,
      error: error instanceof Error ? error.message : "Failed to seed dummy data",
      finishedAt: new Date().toISOString(),
    }).catch(() => {});
    return NextResponse.json(
      { error: "Failed to seed dummy data" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const ctx = await resolveContext({ rejectDemoMutation: true });
  if (!ctx.ok) {
    return NextResponse.json(ctx.body, { status: ctx.status });
  }
  const { resolvedBase, storageReady, userId } = ctx.context;

  try {
    const status = await getDummySeedStatus(userId);
    const databasePresent = status.databasePresent ?? status.seeded;
    const durableCleanupPending = Boolean(
      status.pendingCleanupDataBasePath
    );
    if (databasePresent && status.storagePathConflict) {
      return NextResponse.json(
        {
          error:
            "Demo fixture records disagree about their original storage path. Resolve the fixture metadata before removing it.",
        },
        { status: 409 }
      );
    }

    const fixtureDataBasePath =
      status.storedDataBasePath ?? resolvedBase;
    let removalBase =
      storageReady && fixtureDataBasePath === resolvedBase
        ? resolvedBase
        : null;
    if (fixtureDataBasePath && fixtureDataBasePath !== resolvedBase) {
      const inspection = await inspectDataStoragePath(
        fixtureDataBasePath
      );
      if (
        (databasePresent || durableCleanupPending) &&
        status.storedDataBasePath &&
        (!inspection.valid ||
          !inspection.writable ||
          !inspection.configuredPath)
      ) {
        return NextResponse.json(
          {
            error: `${
              inspection.error ??
              "The original demo-data storage path is unavailable"
            }. ${
              databasePresent
                ? "Database rows were left intact so the original file location remains recoverable."
                : "The cleanup pointer was retained; restore the original path and retry removal."
            }`,
            fixtureDataBasePath,
          },
          { status: 409 }
        );
      }
      if (
        inspection.valid &&
        inspection.writable &&
        inspection.configuredPath
      ) {
        removalBase = inspection.configuredPath;
      }
    } else if (
      (databasePresent || durableCleanupPending) &&
      !storageReady
    ) {
      return NextResponse.json(
        {
          error: `${
            ctx.context.storageError ??
            "The original demo-data storage path is unavailable"
          }. ${
            databasePresent
              ? "Database rows were left intact so the original file location remains recoverable."
              : "The cleanup pointer was retained; restore the original path and retry removal."
          }`,
          fixtureDataBasePath,
        },
        { status: 409 }
      );
    }

    const result = await removeDummySeed({
      ownerUserId: userId,
      resolvedBase: removalBase,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    if (error instanceof DummySeedInUseError) {
      return NextResponse.json(
        {
          error: error.message,
          pipelineRunsCount: error.pipelineRunsCount,
        },
        { status: 409 }
      );
    }
    if (error instanceof DummySeedSubmissionError) {
      return NextResponse.json(
        {
          error: error.message,
          submissionsCount: error.submissionsCount,
        },
        { status: 409 }
      );
    }
    if (error instanceof DummySeedReferencesError) {
      return NextResponse.json(
        {
          error: error.message,
          externalSamplesCount: error.externalSamplesCount,
        },
        { status: 409 }
      );
    }
    if (error instanceof DummySeedStorageMismatchError) {
      return NextResponse.json(
        { error: error.message },
        { status: 409 }
      );
    }
    console.error("[Seed Dummy Data] Failed to remove:", error);
    return NextResponse.json(
      { error: "Failed to remove the demo dataset" },
      { status: 500 }
    );
  }
}
