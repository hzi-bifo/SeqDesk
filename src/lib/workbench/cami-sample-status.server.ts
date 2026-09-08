import { db } from "@/lib/db";
import { scientificRecordId } from "./scientific-publication";
import { camiCatalog } from "./importers/cami-catalog";
import { type CamiSampleQuery, type CamiSampleStatus } from "./cami-sample-types";

/** Read records are authoritative; job history is only transfer/retry status. */
export async function getCamiSampleStatuses(userId: string, query: CamiSampleQuery): Promise<CamiSampleStatus[]> {
  const orderId = scientificRecordId("data", userId, "collection", query.collection);
  const readIds = Array.from({ length: camiCatalog[query.dataset].samples }, (_, sample) => scientificRecordId("read", userId, "collection", query.collection, "cami-benchmark", query.dataset, `sample_${sample}`, query.technology));
  const [reads, active, failed] = await Promise.all([
    db.read.findMany({ where: { id: { in: readIds }, sample: { orderId, order: { userId, dataOrigin: "import" } } }, select: { id: true } }),
    db.workbenchImportJob.findMany({ where: { createdById: userId, workspace: { ownerId: userId }, providerId: "cami-benchmark", request: { contains: query.collection }, status: { in: ["queued", "running"] } }, orderBy: { createdAt: "desc" }, select: { id: true, request: true, status: true, progress: true, phase: true, error: true } }),
    db.workbenchImportJob.findMany({ where: { createdById: userId, workspace: { ownerId: userId }, providerId: "cami-benchmark", request: { contains: query.collection }, status: { in: ["error", "cancelled"] } }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, request: true, status: true, progress: true, phase: true, error: true } }),
  ]);
  const imported = new Set(reads.map(read => read.id));
  const statuses: CamiSampleStatus[] = readIds.map((id, sample) => imported.has(id) ? { sample, status: "imported", orderId } : { sample, status: "available" });
  // Active jobs take precedence over failures; the latest matching attempt wins.
  for (const job of [...active, ...failed]) {
    let input;
    try { input = JSON.parse(job.request); } catch { continue; }
    if (input?.collection?.key !== query.collection || input.dataset !== query.dataset || input.technology !== query.technology || !Number.isInteger(input.sample)) continue;
    const sample = statuses[input.sample];
    if (!sample || sample.status !== "available") continue;
    if (!["queued", "running", "error", "cancelled"].includes(job.status)) continue;
    statuses[input.sample] = { sample: input.sample, status: job.status as CamiSampleStatus["status"], jobId: job.id, progress: job.progress, phase: job.phase, error: job.error };
  }
  return statuses;
}
