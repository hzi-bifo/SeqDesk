import { db } from "@/lib/db";
import { scientificRecordId } from "@/lib/workbench/scientific-publication";
import { sourceMetadataRecord, type SourceImportSnapshot } from "./source-metadata";

/** Call only after authorizing access to the parent record. No workspace creation or writes. */
export async function getPendingSourceImports(order: {
  id: string; userId: string; dataOrigin?: string; sourceMetadata?: string | null;
}): Promise<SourceImportSnapshot[]> {
  const collectionKey = sourceMetadataRecord(order.sourceMetadata).collectionKey;
  if (order.dataOrigin !== "import" || typeof collectionKey !== "string" ||
    scientificRecordId("data", order.userId, "collection", collectionKey) !== order.id) return [];
  const jobs = await db.workbenchImportJob.findMany({
    where: {
      createdById: order.userId, workspace: { ownerId: order.userId },
      request: { contains: collectionKey }, status: { in: ["queued", "running"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, providerId: true, status: true, request: true, preview: true, createdAt: true },
  });
  return jobs.flatMap(job => {
    const input = sourceMetadataRecord(job.request);
    if (sourceMetadataRecord(input.collection).key !== collectionKey) return [];
    const preview = sourceMetadataRecord(job.preview);
    const summary = sourceMetadataRecord(preview.summary);
    const sourceKey = typeof input.dataset === "string" ? input.dataset : typeof input.accession === "string" ? input.accession : "";
    return [{
      id: job.id, providerId: job.providerId, status: job.status, createdAt: job.createdAt.toISOString(), sourceKey,
      title: typeof summary.label === "string" ? summary.label : sourceKey,
      metadata: {
        sourceType: job.providerId,
        ...(typeof input.dataset === "string" ? { dataset: input.dataset } : {}),
        ...(typeof input.accession === "string" ? { accession: input.accession } : {}),
        ...(typeof input.sample === "number" ? { sourceKey: `sample_${input.sample}` } : {}),
        ...(typeof input.technology === "string" ? { technology: input.technology } : {}),
        sampleMetadata: sourceMetadataRecord(preview.sampleMetadata),
        ...(preview.processing ? { processing: { source: preview.processing } } : {}),
        files: (Array.isArray(preview.assets) ? preview.assets : Array.isArray(preview.files) ? preview.files : []).map(value => {
          const file = sourceMetadataRecord(value);
          return { filename: file.filename, url: file.url, bytes: file.bytes, md5: file.md5 };
        }),
      },
    }];
  });
}
