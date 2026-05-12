import * as fs from "fs/promises";
import * as path from "path";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveDataBasePathFromStoredValue } from "@/lib/files/data-base-path";
import {
  getGemmaMetaxPathExampleStatus,
  seedGemmaMetaxPathExampleDataset,
} from "@/lib/seed/gemma-metaxpath-example";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function requireFacilityAdmin() {
  const session = await getServerSession(authOptions);
  return session?.user?.role === "FACILITY_ADMIN";
}

async function ensureWritableDataBasePath(): Promise<
  | { ok: true; resolvedBase: string }
  | { ok: false; status: number; body: { error: string } }
> {
  const settings = await db.siteSettings.findUnique({
    where: { id: "singleton" },
    select: { dataBasePath: true },
  });
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
        body: { error: "Data base path is not a directory" },
      };
    }
    await fs.access(resolvedBase, fs.constants.W_OK);
  } catch {
    return {
      ok: false,
      status: 400,
      body: { error: "Data base path is not writable" },
    };
  }

  return { ok: true, resolvedBase };
}

export async function GET() {
  if (!(await requireFacilityAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await getGemmaMetaxPathExampleStatus());
}

export async function POST() {
  if (!(await requireFacilityAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dataPath = await ensureWritableDataBasePath();
  if (!dataPath.ok) {
    return NextResponse.json(dataPath.body, { status: dataPath.status });
  }

  try {
    const result = await seedGemmaMetaxPathExampleDataset();
    const status = await getGemmaMetaxPathExampleStatus();
    return NextResponse.json({
      success: true,
      seededFixtures: result.seeded,
      ...status,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to seed Gemma MetaxPath example dataset";
    console.error("[Gemma MetaxPath Example Seed] Failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
