import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { WorkbenchImportResult } from "./importers/types";
import { importCollectionSchema } from "./import-collection";
import { resolveImportProcessing, sourceProcessing } from "./import-processing";

export function scientificRecordId(kind: string, userId: string, ...parts: string[]) {
  return `imported-${kind}-${createHash("sha256").update(JSON.stringify([userId, ...parts])).digest("hex").slice(0, 40)}`;
}

/** Runs inside the same transaction as dataset publication and job success. */
export interface ScientificRecords { orderId: string; orderTitle: string; studyId: string | null; sampleId: string; readId: string; studyTitle: string | null; sampleTitle: string; entries?: ScientificRecords[] }
export async function publishScientificImport(tx: Prisma.TransactionClient, userId: string, result: WorkbenchImportResult): Promise<ScientificRecords | null> {
  if (result.scientificImports?.length) {
    const entries: ScientificRecords[] = [];
    // Stable order avoids deadlocks when a project import spans several studies.
    for (const spec of [...result.scientificImports].sort((a, b) => a.studyKey.localeCompare(b.studyKey))) {
      const record = await publishScientificImport(tx, userId, { ...result, scientificImports: undefined, scientificImport: spec });
      if (record) entries.push(record);
    }
    return entries[0] ? { ...entries[0], entries } : null;
  }
  const spec = result.scientificImport;
  if (!spec) return null;
  if (spec.reads.length !== (spec.technology === "short" ? 2 : 1)) throw new Error("Invalid scientific read collection");
  const collection = importCollectionSchema.optional().parse(result.collection);
  // Source study keys are provenance, not instructions to create a SeqDesk study.
  // Explicit study targets remain supported for jobs queued before this change.
  const studyId = spec.targetStudyId ?? null;
  const scope = collection ? ["collection", collection.key] : [];
  const sampleId = scientificRecordId("sample", userId, ...scope, result.sourceType, spec.studyKey, spec.sampleKey);
  const readId = scientificRecordId("read", userId, ...scope, result.sourceType, spec.studyKey, spec.sampleKey, spec.readKey ?? spec.technology);
  const orderId = collection ? scientificRecordId("data", userId, ...scope) : scientificRecordId("data", userId, result.sourceType, spec.studyKey);
  const provenance = result.sourceMetadata as { sourcePage?: string; citation?: string };
  // Serialize additions to this owner's collection across independent workers.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${orderId}))::text`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${readId}))::text`;
  if (await tx.read.findUnique({ where: { id: readId }, select: { id: true } })) {
    throw new Error("This sample and read technology have already been imported; existing reads were not overwritten");
  }
  const study = studyId ? await tx.study.findFirst({ where: { id: studyId, userId, user: { isActive: true }, submitted: false } }) : null;
  if (studyId && (!study || study.userId !== userId)) throw new Error("Destination study is unavailable, submitted, or belongs to another user");
  // Collection-level source index; complete original metadata stays on the
  // sample/read and job dataset, including every project in multi-run imports.
  const source = { sourceType: result.sourceType, sourceKey: spec.studyKey, title: spec.studyTitle,
    sourcePage: provenance.sourcePage, citation: provenance.citation, synthetic: spec.synthetic };
  const container = await tx.order.upsert({ where: { id: orderId }, update: {}, create: {
    id: orderId, orderNumber: `IMP-${orderId.slice(-40)}`, name: collection?.name ?? spec.studyTitle, userId,
    dataOrigin: "import", status: "COMPLETED", sourceMetadata: JSON.stringify({ sourceType: result.sourceType, sourceKey: spec.studyKey, imported: true, sources: [source] }),
  } });
  if (container.userId !== userId || container.dataOrigin !== "import") throw new Error("Imported data container ownership changed");
  const containerMetadata = container.sourceMetadata ? JSON.parse(container.sourceMetadata) : {};
  const sources: Array<{ sourceType: string; sourceKey: string }> = Array.isArray(containerMetadata.sources) ? containerMetadata.sources : [];
  if (!sources.some(prior => prior.sourceType === source.sourceType && prior.sourceKey === source.sourceKey)) {
    await tx.order.update({ where: { id: orderId }, data: { sourceMetadata: JSON.stringify({ ...containerMetadata, ...(collection ? { collectionKey: collection.key } : {}), sources: [...sources, source] }) } });
  }
  const sample = await tx.sample.upsert({ where: { id: sampleId }, update: {}, create: {
    id: sampleId, studyId, orderId, sampleId: spec.sampleKey, sampleTitle: spec.sampleTitle,
    sampleDescription: "Imported sample; original identifiers retained in provenance.",
    sampleAccessionNumber: typeof spec.metadata?.sampleAccession === "string" ? spec.metadata.sampleAccession : undefined,
    scientificName: typeof spec.metadata?.scientificName === "string" ? spec.metadata.scientificName : undefined,
    facilityStatus: "NOT_APPLICABLE", customFields: JSON.stringify({ sourceType: result.sourceType, dataset: spec.studyKey, sourceKey: spec.sampleKey, sourcePage: provenance.sourcePage, synthetic: spec.synthetic,
      originalMetadata: spec.metadata,
      // Technology-specific details are on each Read, not frozen on the sample.
      environment: spec.metadata?.environment, subjectId: spec.metadata?.subjectId,
    }),
  } });
  if (sample.orderId !== orderId && sample.orderId !== null) throw new Error("Imported sample was moved; refusing to change its ownership");
  if (!sample.orderId) {
    const owner = await tx.study.findFirst({ where: { id: sample.studyId ?? "", userId }, select: { id: true } });
    if (!owner) throw new Error("Imported sample ownership changed");
    await tx.sample.update({ where: { id: sampleId }, data: { orderId } });
  }
  if (studyId) await tx.studySample.upsert({ where: { studyId_sampleId: { studyId, sampleId } }, update: {}, create: { studyId, sampleId } });
  const priorMetadata = sample.customFields ? JSON.parse(sample.customFields) : {};
  const processing = resolveImportProcessing(spec.processing ?? sourceProcessing(result.sourceType), result.processingDeclaration, userId);
  if (priorMetadata.subjectId && spec.metadata?.subjectId && priorMetadata.subjectId !== spec.metadata.subjectId) throw new Error("CAMI subject mapping changed for an existing sample; review its provenance before importing another technology");
  await tx.read.create({ data: {
    id: readId, sampleId, file1: spec.reads[0].path, file2: spec.reads[1]?.path,
    // Read.isActive means the facility pipeline's selected input set, not file
    // availability. Do not choose one technology implicitly or violate its
    // one-active-read-per-sample database invariant.
    isActive: false,
    checksum1: spec.reads[0].md5, checksum2: spec.reads[1]?.md5,
    readCount1: spec.reads[0].records !== undefined && spec.reads[0].records <= 2_147_483_647 ? spec.reads[0].records : undefined,
    readCount2: spec.reads[1]?.records !== undefined && spec.reads[1].records <= 2_147_483_647 ? spec.reads[1].records : undefined,
    dataClass: processing.effectiveState === "unprocessed" ? "raw" : processing.effectiveState,
    dataClassSource: result.processingDeclaration ? "manual" : "external_import",
    classifiedById: processing.userDeclaration?.userId,
    classifiedAt: processing.userDeclaration ? new Date(processing.userDeclaration.recordedAt) : undefined,
    classificationNote: result.processingDeclaration ? "User-declared processing state: " + result.processingDeclaration.details : processing.source.details,
    runAccessionNumber: typeof spec.metadata?.runAccession === "string" ? spec.metadata.runAccession : undefined,
    experimentAccessionNumber: typeof spec.metadata?.experimentAccession === "string" ? spec.metadata.experimentAccession : undefined,
    pipelineSources: JSON.stringify({ ...(result.sourceType === "ena-fastq-accession"
      ? { sourceType: result.sourceType, ...spec.metadata, technology: spec.technology, reads: spec.reads }
      : { ...result.sourceMetadata as object, technology: spec.technology }), sourceType: result.sourceType, processing, synthetic: spec.synthetic }),
  } });
  return { orderId, orderTitle: container.name ?? collection?.name ?? spec.studyTitle, studyId, sampleId, readId, studyTitle: study?.title ?? null, sampleTitle: sample.sampleTitle ?? sample.sampleId };
}
