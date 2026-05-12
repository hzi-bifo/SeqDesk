import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveDataBasePathFromStoredValue } from "@/lib/files/data-base-path";
import { ensureWithinBase } from "@/lib/files";
import {
  getSeedDummyOrderNumberPrefix,
  SEED_DUMMY_FOLDER_ROOT,
  SEED_DUMMY_MARKER,
} from "@/lib/seed/dummy-orders";
import {
  getDummyDataEnabledFlag,
  setDummyDataEnabledFlag,
} from "@/lib/seed/extra-settings-flag";
import {
  DummySeedAlreadyExistsError,
  runDummySeed,
} from "@/lib/seed/run-seed";
import { updateAdminActivityJob } from "@/lib/admin/activity";
import * as fs from "fs/promises";
import * as path from "path";

interface ResolvedContext {
  resolvedBase: string;
  userId: string;
  userEmail: string | null;
  userDisplayName: string;
}

async function resolveContext(): Promise<
  | { ok: true; context: ResolvedContext }
  | { ok: false; status: number; body: { error: string; dataBasePath?: string } }
> {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return { ok: false, status: 401, body: { error: "Unauthorized" } };
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
  if (!resolved.dataBasePath) {
    return {
      ok: false,
      status: 400,
      body: { error: "Data base path not configured" },
    };
  }

  const resolvedBase = path.resolve(resolved.dataBasePath);

  try {
    const stats = await fs.stat(resolvedBase);
    if (!stats.isDirectory()) {
      return {
        ok: false,
        status: 400,
        body: {
          error: `Data base path is not a directory: ${resolvedBase}`,
          dataBasePath: resolvedBase,
        },
      };
    }
    await fs.access(resolvedBase, fs.constants.W_OK);
  } catch {
    return {
      ok: false,
      status: 400,
      body: {
        error: `Data base path is not writable by the SeqDesk server process: ${resolvedBase}`,
        dataBasePath: resolvedBase,
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

  const orderPrefix = getSeedDummyOrderNumberPrefix(ctx.context.userId);
  const [orders, persistedFlag] = await Promise.all([
    db.order.findMany({
      where: {
        userId: ctx.context.userId,
        orderNumber: { startsWith: orderPrefix },
      },
      select: { id: true, orderNumber: true, status: true },
    }),
    getDummyDataEnabledFlag(),
  ]);

  return NextResponse.json({
    seeded: orders.length > 0,
    ordersCount: orders.length,
    ordersByStatus: orders.reduce<Record<string, number>>((acc, order) => {
      acc[order.status] = (acc[order.status] ?? 0) + 1;
      return acc;
    }, {}),
    dummyDataEnabled: persistedFlag,
  });
}

export async function POST() {
  const ctx = await resolveContext();
  if (!ctx.ok) {
    return NextResponse.json(ctx.body, { status: ctx.status });
  }
  const { resolvedBase, userId, userEmail, userDisplayName } = ctx.context;
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
  const ctx = await resolveContext();
  if (!ctx.ok) {
    return NextResponse.json(ctx.body, { status: ctx.status });
  }
  const { resolvedBase, userId } = ctx.context;

  const orderPrefix = getSeedDummyOrderNumberPrefix(userId);
  const orders = await db.order.findMany({
    where: { userId, orderNumber: { startsWith: orderPrefix } },
    select: { id: true },
  });

  const ordersDeleted = await db.$transaction(async (tx) => {
    if (orders.length > 0) {
      const orderIds = orders.map((order) => order.id);
      // Pipeline runs reference orders without cascade — clear them first.
      await tx.pipelineRun.deleteMany({
        where: { orderId: { in: orderIds } },
      });
      await tx.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    // Remove seeded studies (no FK from Order; owned-by-user + marker scope).
    await tx.study.deleteMany({
      where: {
        userId,
        studyMetadata: { contains: `"seedSource":"${SEED_DUMMY_MARKER}"` },
      },
    });
    return orders.length;
  });

  let filesRemoved = false;
  const seedFolder = path.resolve(
    resolvedBase,
    SEED_DUMMY_FOLDER_ROOT,
    userId
  );
  try {
    ensureWithinBase(resolvedBase, path.posix.join(SEED_DUMMY_FOLDER_ROOT, userId));
    await fs.rm(seedFolder, { recursive: true, force: true });
    filesRemoved = true;
  } catch (error) {
    console.error("[Seed Dummy Data] Failed to remove seeded folder:", error);
  }

  await setDummyDataEnabledFlag(false).catch((error) => {
    console.warn(
      "[Seed Dummy Data] Failed to clear dummyDataEnabled flag:",
      error
    );
  });

  return NextResponse.json({
    success: true,
    ordersDeleted,
    filesRemoved,
  });
}
