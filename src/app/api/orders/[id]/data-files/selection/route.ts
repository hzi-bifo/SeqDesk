import fs from "node:fs/promises";
import path from "node:path";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getResolvedDataBasePath } from "@/lib/files/data-base-path";
import { ensureWithinBase } from "@/lib/files/paths";
import { authorizeDataFiles, DataFilesError } from "@/lib/orders/data-files.server";
import { inputModuleEnabled } from "@/lib/modules/input-modules.server";
import { FILES_ASSIGNABLE_STATUSES } from "@/lib/sequencing/constants";
import { dataFilesErrorResponse } from "../_shared";

export const runtime = "nodejs";

const selectionSchema = z.object({
  sampleId: z.string().min(1).max(200),
  readId: z.string().min(1).max(200),
}).strict();

function assertSelectableOrder(order: {
  dataOrigin: string;
  status: string;
  sequencingFilesPublishedAt: Date | null;
}) {
  if (order.dataOrigin === "import") {
    throw new DataFilesError(403, "Choose imported analysis input reads in Pipelines");
  }
  if (order.sequencingFilesPublishedAt) {
    throw new DataFilesError(409, "Unpublish the delivery in Facility processing before changing selected files");
  }
  if (!FILES_ASSIGNABLE_STATUSES.includes(order.status as typeof FILES_ASSIGNABLE_STATUSES[number])) {
    throw new DataFilesError(409, "Submit the sequencing order before selecting files for facility processing");
  }
}

async function requireExistingReadFile(base: string, filePath: string) {
  let resolved: string;
  try {
    const requested = ensureWithinBase(base, filePath);
    resolved = await fs.realpath(requested);
    ensureWithinBase(base, resolved);
  } catch {
    throw new DataFilesError(409, "Selected read files are missing or outside server storage. Relink the files before selecting them");
  }
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isFile() || !/\.(fastq|fq)(\.gz)?$/i.test(path.basename(filePath))) {
    throw new DataFilesError(409, "Selected read files are unavailable. Relink the files before selecting them");
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const access = await authorizeDataFiles(await getServerSession(authOptions), id, true);
    if (!access.canManageFacility) {
      throw new DataFilesError(403, "You do not have permission to select files for facility processing");
    }
    if (!await inputModuleEnabled("sequencing-management")) {
      throw new DataFilesError(403, "Facility sequencing management is disabled for this installation");
    }
    assertSelectableOrder(access.order);
    let input: unknown;
    try { input = await request.json(); } catch { throw new DataFilesError(400, "Invalid read selection"); }
    const parsed = selectionSchema.safeParse(input);
    if (!parsed.success) throw new DataFilesError(400, "Choose a sample and an existing read set");
    const { sampleId, readId } = parsed.data;
    const { dataBasePath } = await getResolvedDataBasePath();
    if (!dataBasePath) throw new DataFilesError(400, "Server data storage is not configured");
    const base = await fs.realpath(dataBasePath).catch(() => null);
    if (!base) throw new DataFilesError(400, "Server data storage is unavailable");

    await db.$transaction(async tx => {
      // Serialize with delivery publication and recheck its visibility boundary.
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id} FOR UPDATE`;
      const order = await tx.order.findUnique({ where: { id }, select: {
        userId: true, dataOrigin: true, status: true, sequencingFilesPublishedAt: true,
      } });
      if (!order || order.userId !== access.order.userId || order.dataOrigin !== access.order.dataOrigin) {
        throw new DataFilesError(409, "Collection ownership changed. Refresh and retry");
      }
      assertSelectableOrder(order);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${sampleId}))::text`;
      const read = await tx.read.findFirst({
        where: { id: readId, sampleId, sample: { orderId: id }, supersededByReadId: null },
        select: { id: true, file1: true, file2: true },
      });
      if (!read?.file1) throw new DataFilesError(404, "Read set is unavailable for this sample");
      await requireExistingReadFile(base, read.file1);
      if (read.file2) await requireExistingReadFile(base, read.file2);
      // Selection changes only the active set; source evidence and processing
      // classification remain attached to both the old and the new read set.
      await tx.read.updateMany({ where: { sampleId, isActive: true }, data: { isActive: false } });
      await tx.read.update({ where: { id: readId }, data: { isActive: true } });
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return dataFilesErrorResponse(error);
  }
}
