import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  NOTE_MENTION_GROUPS,
  makeNoteMentionHref,
  parseNoteMentionHref,
  type NoteMentionGroup,
  type NoteMentionItem,
} from "@/lib/notes/mentions";

const MAX_ITEMS_PER_GROUP = 50;

type NotesMentionSession = {
  user?: {
    id?: string | null;
    role?: string | null;
  };
} | null;

function canAccessOwner(session: NotesMentionSession, userId: string): boolean {
  return session?.user?.role === "FACILITY_ADMIN" || session?.user?.id === userId;
}

function basename(value: string | null | undefined): string {
  if (!value) return "";
  const parts = value.split(/[\\/]/);
  return parts.at(-1) || value;
}

function compactDetail(...parts: Array<string | null | undefined>): string | null {
  const detail = parts.filter((part): part is string => Boolean(part && part.trim())).join(" · ");
  return detail || null;
}

function formatTaxon(scientificName: string | null | undefined, taxId: string | null | undefined): string | null {
  if (scientificName && taxId) {
    return `${scientificName} (tax ${taxId})`;
  }

  return scientificName || (taxId ? `Tax ${taxId}` : null);
}

function formatSampleLabel(sample: {
  sampleId: string;
  sampleAlias?: string | null;
}): string {
  return sample.sampleAlias || sample.sampleId;
}

function formatSampleDetail(
  sample: {
    sampleId: string;
    sampleAlias?: string | null;
    sampleTitle?: string | null;
    scientificName?: string | null;
    taxId?: string | null;
  },
  context: string | null | undefined
): string | null {
  const idDetail = sample.sampleAlias ? `ID ${sample.sampleId}` : null;
  const titleDetail = sample.sampleTitle && sample.sampleTitle !== sample.sampleAlias ? sample.sampleTitle : null;
  return compactDetail(idDetail, titleDetail, formatTaxon(sample.scientificName, sample.taxId), context);
}

function matchesQuery(item: NoteMentionItem, query: string): boolean {
  if (!query) return true;
  const haystack = [item.label, item.detail, item.type].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(query);
}

function addUnique(items: NoteMentionItem[], seen: Set<string>, item: NoteMentionItem) {
  const key = `${item.type}:${item.id}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  items.push(item);
}

function groupItems(items: NoteMentionItem[], query: string, requestedKeys: Set<string>): NoteMentionGroup[] {
  return NOTE_MENTION_GROUPS.map((group) => {
    const groupItems = items
      .filter((item) => item.group === group.key)
      .filter((item) => matchesQuery(item, query) || requestedKeys.has(`${item.type}:${item.id}`))
      .slice(0, MAX_ITEMS_PER_GROUP);

    return {
      key: group.key,
      label: group.label,
      items: groupItems,
    };
  }).filter((group) => group.items.length > 0);
}

function requestedKeysFromParams(request: NextRequest): Set<string> {
  const refs = request.nextUrl.searchParams.get("refs");
  if (!refs) {
    return new Set();
  }

  return new Set(
    refs
      .split(",")
      .map((ref) => parseNoteMentionHref(ref.trim()))
      .filter((ref): ref is NonNullable<ReturnType<typeof parseNoteMentionHref>> => Boolean(ref))
      .map((ref) => `${ref.type}:${ref.id}`)
  );
}

async function getOrderMentionItems(orderId: string, session: NotesMentionSession): Promise<NoteMentionItem[] | null> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      name: true,
      userId: true,
      samples: {
        select: {
          id: true,
          sampleId: true,
          sampleAlias: true,
          sampleTitle: true,
          scientificName: true,
          taxId: true,
          reads: {
            select: {
              id: true,
              file1: true,
              file2: true,
            },
          },
          study: {
            select: {
              id: true,
              title: true,
              alias: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!order || !canAccessOwner(session, order.userId)) {
    return null;
  }

  const sampleIds = order.samples.map((sample) => sample.id);
  const studyIds = Array.from(
    new Set(order.samples.map((sample) => sample.study?.id).filter((id): id is string => Boolean(id)))
  );

  const [assemblies, bins, pipelineRuns, sequencingArtifacts, pipelineArtifacts] = await Promise.all([
    sampleIds.length
      ? db.assembly.findMany({
          where: { sampleId: { in: sampleIds } },
          select: { id: true, assemblyName: true, assemblyFile: true, sampleId: true },
        })
      : [],
    sampleIds.length
      ? db.bin.findMany({
          where: { sampleId: { in: sampleIds } },
          select: { id: true, binName: true, binFile: true, sampleId: true },
        })
      : [],
    db.pipelineRun.findMany({
      where: {
        OR: [
          { orderId },
          ...(studyIds.length ? [{ studyId: { in: studyIds } }] : []),
        ],
      },
      select: { id: true, runNumber: true, pipelineId: true, status: true, studyId: true, orderId: true },
      orderBy: { createdAt: "desc" },
    }),
    db.sequencingArtifact.findMany({
      where: {
        OR: [
          { orderId },
          ...(sampleIds.length ? [{ sampleId: { in: sampleIds } }] : []),
        ],
      },
      select: { id: true, originalName: true, path: true, artifactType: true, stage: true, sampleId: true },
      orderBy: { createdAt: "desc" },
    }),
    db.pipelineArtifact.findMany({
      where: {
        OR: [
          ...(studyIds.length ? [{ studyId: { in: studyIds } }] : []),
          ...(sampleIds.length ? [{ sampleId: { in: sampleIds } }] : []),
        ],
      },
      select: { id: true, name: true, path: true, type: true, sampleId: true, studyId: true, pipelineRunId: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const sampleLabelById = new Map(order.samples.map((sample) => [sample.id, formatSampleLabel(sample)]));
  const items: NoteMentionItem[] = [];
  const seen = new Set<string>();

  addUnique(items, seen, {
    type: "order",
    id: order.id,
    label: order.orderNumber || order.name || "Order",
    detail: order.name && order.orderNumber ? order.name : null,
    group: "studies-orders",
    href: `/orders/${order.id}`,
  });

  for (const sample of order.samples) {
    addUnique(items, seen, {
      type: "sample",
      id: sample.id,
      label: formatSampleLabel(sample),
      detail: formatSampleDetail(sample, sample.study?.title),
      group: "samples",
      href: `/orders/${order.id}`,
    });

    if (sample.study) {
      addUnique(items, seen, {
        type: "study",
        id: sample.study.id,
        label: sample.study.title,
        detail: sample.study.alias,
        group: "studies-orders",
        href: `/studies/${sample.study.id}`,
      });
    }

    for (const read of sample.reads) {
      for (const [role, file] of [["R1", read.file1], ["R2", read.file2]] as const) {
        if (!file) continue;
        addUnique(items, seen, {
          type: "file",
          id: file,
          label: basename(file),
          detail: compactDetail(role, sample.sampleId, file),
          group: "files",
          href: null,
          status: "available",
        });
      }
    }
  }

  for (const assembly of assemblies) {
    addUnique(items, seen, {
      type: "assembly",
      id: assembly.id,
      label: assembly.assemblyName || basename(assembly.assemblyFile) || "Assembly",
      detail: compactDetail(sampleLabelById.get(assembly.sampleId), assembly.assemblyFile),
      group: "assemblies",
      href: null,
    });
    if (assembly.assemblyFile) {
      addUnique(items, seen, {
        type: "file",
        id: assembly.assemblyFile,
        label: basename(assembly.assemblyFile),
        detail: compactDetail("Assembly", sampleLabelById.get(assembly.sampleId), assembly.assemblyFile),
        group: "files",
        href: null,
        status: "available",
      });
    }
  }

  for (const bin of bins) {
    addUnique(items, seen, {
      type: "bin",
      id: bin.id,
      label: bin.binName || basename(bin.binFile) || "Bin",
      detail: compactDetail(sampleLabelById.get(bin.sampleId), bin.binFile),
      group: "bins",
      href: null,
    });
    if (bin.binFile) {
      addUnique(items, seen, {
        type: "file",
        id: bin.binFile,
        label: basename(bin.binFile),
        detail: compactDetail("Bin", sampleLabelById.get(bin.sampleId), bin.binFile),
        group: "files",
        href: null,
        status: "available",
      });
    }
  }

  for (const run of pipelineRuns) {
    addUnique(items, seen, {
      type: "pipeline-run",
      id: run.id,
      label: run.runNumber,
      detail: compactDetail(run.pipelineId, run.status),
      group: "pipeline-runs",
      href: run.orderId ? `/orders/${run.orderId}/pipelines` : run.studyId ? `/studies/${run.studyId}?tab=pipelines` : null,
    });
  }

  for (const artifact of sequencingArtifacts) {
    addUnique(items, seen, {
      type: "sequencing-artifact",
      id: artifact.id,
      label: artifact.originalName || basename(artifact.path) || "Sequencing artifact",
      detail: compactDetail(artifact.artifactType, artifact.stage, sampleLabelById.get(artifact.sampleId ?? "")),
      group: "artifacts",
      href: null,
    });
  }

  for (const artifact of pipelineArtifacts) {
    addUnique(items, seen, {
      type: "pipeline-artifact",
      id: artifact.id,
      label: artifact.name || basename(artifact.path) || "Pipeline artifact",
      detail: compactDetail(artifact.type, sampleLabelById.get(artifact.sampleId ?? ""), artifact.path),
      group: "artifacts",
      href: null,
    });
    addUnique(items, seen, {
      type: "file",
      id: artifact.path,
      label: basename(artifact.path),
      detail: compactDetail("Pipeline output", artifact.type, artifact.path),
      group: "files",
      href: null,
      status: "available",
    });
  }

  return items;
}

async function getStudyMentionItems(studyId: string, session: NotesMentionSession): Promise<NoteMentionItem[] | null> {
  const study = await db.study.findUnique({
    where: { id: studyId },
    select: {
      id: true,
      title: true,
      alias: true,
      userId: true,
      samples: {
        select: {
          id: true,
          sampleId: true,
          sampleAlias: true,
          sampleTitle: true,
          scientificName: true,
          taxId: true,
          reads: {
            select: {
              id: true,
              file1: true,
              file2: true,
            },
          },
          order: {
            select: {
              id: true,
              orderNumber: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!study || !canAccessOwner(session, study.userId)) {
    return null;
  }

  const sampleIds = study.samples.map((sample) => sample.id);
  const orderIds = Array.from(new Set(study.samples.map((sample) => sample.order.id)));

  const [assemblies, bins, pipelineRuns, sequencingArtifacts, pipelineArtifacts] = await Promise.all([
    sampleIds.length
      ? db.assembly.findMany({
          where: { sampleId: { in: sampleIds } },
          select: { id: true, assemblyName: true, assemblyFile: true, sampleId: true },
        })
      : [],
    sampleIds.length
      ? db.bin.findMany({
          where: { sampleId: { in: sampleIds } },
          select: { id: true, binName: true, binFile: true, sampleId: true },
        })
      : [],
    db.pipelineRun.findMany({
      where: {
        OR: [
          { studyId },
          ...(orderIds.length ? [{ orderId: { in: orderIds } }] : []),
        ],
      },
      select: { id: true, runNumber: true, pipelineId: true, status: true, studyId: true, orderId: true },
      orderBy: { createdAt: "desc" },
    }),
    orderIds.length || sampleIds.length
      ? db.sequencingArtifact.findMany({
          where: {
            OR: [
              ...(orderIds.length ? [{ orderId: { in: orderIds } }] : []),
              ...(sampleIds.length ? [{ sampleId: { in: sampleIds } }] : []),
            ],
          },
          select: { id: true, originalName: true, path: true, artifactType: true, stage: true, sampleId: true },
          orderBy: { createdAt: "desc" },
        })
      : [],
    db.pipelineArtifact.findMany({
      where: {
        OR: [
          { studyId },
          ...(sampleIds.length ? [{ sampleId: { in: sampleIds } }] : []),
        ],
      },
      select: { id: true, name: true, path: true, type: true, sampleId: true, studyId: true, pipelineRunId: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const sampleLabelById = new Map(study.samples.map((sample) => [sample.id, formatSampleLabel(sample)]));
  const items: NoteMentionItem[] = [];
  const seen = new Set<string>();

  addUnique(items, seen, {
    type: "study",
    id: study.id,
    label: study.title,
    detail: study.alias,
    group: "studies-orders",
    href: `/studies/${study.id}`,
  });

  for (const sample of study.samples) {
    addUnique(items, seen, {
      type: "sample",
      id: sample.id,
      label: formatSampleLabel(sample),
      detail: formatSampleDetail(sample, sample.order.orderNumber),
      group: "samples",
      href: `/studies/${study.id}?tab=samples`,
    });

    addUnique(items, seen, {
      type: "order",
      id: sample.order.id,
      label: sample.order.orderNumber || sample.order.name || "Order",
      detail: sample.order.name && sample.order.orderNumber ? sample.order.name : null,
      group: "studies-orders",
      href: `/orders/${sample.order.id}`,
    });

    for (const read of sample.reads) {
      for (const [role, file] of [["R1", read.file1], ["R2", read.file2]] as const) {
        if (!file) continue;
        addUnique(items, seen, {
          type: "file",
          id: file,
          label: basename(file),
          detail: compactDetail(role, sample.sampleId, file),
          group: "files",
          href: null,
          status: "available",
        });
      }
    }
  }

  for (const assembly of assemblies) {
    addUnique(items, seen, {
      type: "assembly",
      id: assembly.id,
      label: assembly.assemblyName || basename(assembly.assemblyFile) || "Assembly",
      detail: compactDetail(sampleLabelById.get(assembly.sampleId), assembly.assemblyFile),
      group: "assemblies",
      href: null,
    });
  }

  for (const bin of bins) {
    addUnique(items, seen, {
      type: "bin",
      id: bin.id,
      label: bin.binName || basename(bin.binFile) || "Bin",
      detail: compactDetail(sampleLabelById.get(bin.sampleId), bin.binFile),
      group: "bins",
      href: null,
    });
  }

  for (const run of pipelineRuns) {
    addUnique(items, seen, {
      type: "pipeline-run",
      id: run.id,
      label: run.runNumber,
      detail: compactDetail(run.pipelineId, run.status),
      group: "pipeline-runs",
      href: run.studyId ? `/studies/${run.studyId}?tab=pipelines` : run.orderId ? `/orders/${run.orderId}/pipelines` : null,
    });
  }

  for (const artifact of sequencingArtifacts) {
    addUnique(items, seen, {
      type: "sequencing-artifact",
      id: artifact.id,
      label: artifact.originalName || basename(artifact.path) || "Sequencing artifact",
      detail: compactDetail(artifact.artifactType, artifact.stage, sampleLabelById.get(artifact.sampleId ?? "")),
      group: "artifacts",
      href: null,
    });
  }

  for (const artifact of pipelineArtifacts) {
    addUnique(items, seen, {
      type: "pipeline-artifact",
      id: artifact.id,
      label: artifact.name || basename(artifact.path) || "Pipeline artifact",
      detail: compactDetail(artifact.type, sampleLabelById.get(artifact.sampleId ?? ""), artifact.path),
      group: "artifacts",
      href: null,
    });
    addUnique(items, seen, {
      type: "file",
      id: artifact.path,
      label: basename(artifact.path),
      detail: compactDetail("Pipeline output", artifact.type, artifact.path),
      group: "files",
      href: null,
      status: "available",
    });
  }

  return items;
}

export async function GET(request: NextRequest) {
  try {
    const session = (await getServerSession(authOptions)) as NotesMentionSession;
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const entityType = request.nextUrl.searchParams.get("entityType");
    const entityId = request.nextUrl.searchParams.get("entityId");
    const query = (request.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
    const requestedKeys = requestedKeysFromParams(request);

    if ((entityType !== "order" && entityType !== "study") || !entityId) {
      return NextResponse.json({ error: "Invalid mention context" }, { status: 400 });
    }

    const items =
      entityType === "order"
        ? await getOrderMentionItems(entityId, session)
        : await getStudyMentionItems(entityId, session);

    if (!items) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      groups: groupItems(items, query, requestedKeys),
      mentions: items.map((item) => ({
        ...item,
        mentionHref: makeNoteMentionHref(item.type, item.id),
      })),
    });
  } catch (error) {
    console.error("Error fetching note mentions:", error);
    return NextResponse.json({ error: "Failed to fetch note mentions" }, { status: 500 });
  }
}
