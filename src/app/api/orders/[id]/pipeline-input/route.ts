import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireOrderPipelineAccess } from "@/lib/pipelines/order-access";
import { getOrderSequencingSummary } from "@/lib/sequencing/workspace";
import { SequencingApiError } from "@/lib/sequencing/server";
import { getSequencingIntegrityStatus } from "@/lib/sequencing/constants";
import { z } from "zod";
const selection = z.object({ sampleId: z.string().min(1), readId: z.string().min(1) }).strict();
function fail(e: unknown) { return NextResponse.json({ error: e instanceof SequencingApiError ? e.message : e instanceof z.ZodError || e instanceof SyntaxError ? "Invalid read selection" : "Pipeline input failed" }, { status: e instanceof SequencingApiError ? e.status : e instanceof z.ZodError || e instanceof SyntaxError ? 400 : 500 }); }
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params; await requireOrderPipelineAccess(id);
    const summary = await getOrderSequencingSummary(id);
    // The legacy summary falls back to inactive reads. Pipeline readiness must not.
    const samples = summary.samples.map(sample => {
      const read = sample.read?.isActive === false || sample.read?.supersededByReadId
        ? null
        : sample.read;
      return {
        ...sample,
        read,
        hasReads: Boolean(read?.file1 || read?.file2),
        integrityStatus: getSequencingIntegrityStatus(read ?? {}),
        sequencingRun: read ? sample.sequencingRun : null,
      };
    });
    return NextResponse.json({
      ...summary,
      canManage: false,
      samples,
      summary: {
        ...summary.summary,
        readsLinkedSamples: samples.filter(sample => sample.hasReads).length,
        missingChecksumSamples: samples.filter(sample =>
          sample.integrityStatus === "missing" || sample.integrityStatus === "partial"
        ).length,
        qcArtifactSamples: samples.filter(sample =>
          sample.qcArtifactCount > 0 || Boolean(sample.read?.fastqcReport1 || sample.read?.fastqcReport2)
        ).length,
      },
    });
  } catch (e) { return fail(e); }
}
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params; const { order, where } = await requireOrderPipelineAccess(id, true);
    if (order.dataOrigin !== "import") throw new SequencingApiError(403, "Facility read selection remains in sequencing management");
    const { sampleId, readId } = selection.parse(await request.json());
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id} FOR UPDATE`;
      const current = await tx.order.findFirst({ where, select: { dataOrigin: true } });
      if (current?.dataOrigin !== "import") throw new SequencingApiError(404, "Imported sequencing data not found");
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${sampleId}))::text`;
      const read = await tx.read.findFirst({ where: { id: readId, sampleId, sample: { orderId: id }, supersededByReadId: null } });
      if (!read?.file1) throw new SequencingApiError(404, "Validated read set not found");
      await tx.read.updateMany({ where: { sampleId, isActive: true }, data: { isActive: false } });
      await tx.read.update({ where: { id: readId }, data: { isActive: true } });
    });
    return NextResponse.json({ success: true });
  } catch (e) { return fail(e); }
}
