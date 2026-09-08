import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  getAvailableAssemblies,
  resolveAssemblySelection,
} from "@/lib/pipelines/assembly-selection";
import { isDemoSession } from "@/lib/demo/server";
import {
  authorizationErrorResponse,
  decideServerCapability,
} from "@/lib/authorization/api";

function fileNameFromPath(filePath: string | null): string | null {
  if (!filePath) return null;
  const trimmed = filePath.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || null;
}

// GET /api/assemblies - list assemblies visible to the current user
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const readAccess = decideServerCapability(session, "studies.read");
    if (!readAccess.allowed) {
      return authorizationErrorResponse(readAccess);
    }

    if (isDemoSession(session!)) {
      return NextResponse.json(
        { error: "Assemblies are disabled in the public demo." },
        { status: 403 }
      );
    }

    const userId = readAccess.principal!.id;
    const canReadAllStudies = decideServerCapability(
      session,
      "studies.read_all"
    ).allowed;
    const siteSettings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { extraSettings: true },
    });
    let extraSettings: Record<string, unknown> = {};
    if (siteSettings?.extraSettings) {
      try {
        extraSettings = JSON.parse(siteSettings.extraSettings);
      } catch {
        extraSettings = {};
      }
    }
    const allowUserAssemblyDownload =
      extraSettings.allowUserAssemblyDownload === true;

    if (!canReadAllStudies && !allowUserAssemblyDownload) {
      return NextResponse.json(
        { error: "Assembly downloads are disabled by the facility administrator." },
        { status: 403 }
      );
    }

    const samples = await db.sample.findMany({
      where: {
        studyId: { not: null },
        assemblies: {
          some: {
            assemblyFile: { not: null },
          },
        },
        ...(canReadAllStudies
          ? {}
          : {
              study: { userId },
              order: { status: "COMPLETED" },
            }),
      },
      select: {
        id: true,
        sampleId: true,
        preferredAssemblyId: true,
        study: {
          select: {
            id: true,
            title: true,
            alias: true,
          },
        },
        order: {
          select: {
            id: true,
            orderNumber: true,
            name: true,
            status: true,
          },
        },
        assemblies: {
          select: {
            id: true,
            assemblyName: true,
            assemblyFile: true,
            createdByPipelineRunId: true,
            createdByPipelineRun: {
              select: {
                id: true,
                runNumber: true,
                status: true,
                createdAt: true,
                completedAt: true,
              },
            },
          },
        },
      },
    });

    const items = samples
      .map((sample) => {
        const availableAssemblies = getAvailableAssemblies(sample);
        const selection = resolveAssemblySelection(sample, {
          strictPreferred: true,
        });
        const finalAssembly = selection.assembly;

        return {
          sample: {
            id: sample.id,
            sampleId: sample.sampleId,
          },
          study: sample.study
            ? {
                id: sample.study.id,
                title: sample.study.title,
                alias: sample.study.alias,
              }
            : null,
          order: sample.order ? {
            id: sample.order.id,
            orderNumber: sample.order.orderNumber,
            name: sample.order.name,
            status: sample.order.status,
          } : null,
          selection: {
            mode:
              selection.source === "preferred"
                ? "explicit"
                : selection.source === "auto"
                  ? "automatic"
                  : selection.source,
            preferredAssemblyId: sample.preferredAssemblyId,
            preferredMissing: selection.preferredMissing,
          },
          finalAssembly: finalAssembly
            ? {
                id: finalAssembly.id,
                assemblyName: finalAssembly.assemblyName,
                assemblyFile: finalAssembly.assemblyFile,
                fileName: fileNameFromPath(finalAssembly.assemblyFile),
                createdByPipelineRunId: finalAssembly.createdByPipelineRunId,
                createdByPipelineRun: finalAssembly.createdByPipelineRun
                  ? {
                      id: finalAssembly.createdByPipelineRun.id,
                      runNumber: finalAssembly.createdByPipelineRun.runNumber,
                      createdAt: finalAssembly.createdByPipelineRun.createdAt,
                    }
                  : null,
              }
            : null,
          availableAssembliesCount: availableAssemblies.length,
        };
      })
      .filter((item) => item.finalAssembly);

    items.sort((left, right) => {
      const leftStudy = left.study?.title?.toLowerCase() || "";
      const rightStudy = right.study?.title?.toLowerCase() || "";
      if (leftStudy !== rightStudy) return leftStudy.localeCompare(rightStudy);
      return left.sample.sampleId.localeCompare(right.sample.sampleId);
    });

    return NextResponse.json({
      assemblies: items,
      total: items.length,
    });
  } catch (error) {
    console.error("Error fetching assemblies:", error);
    return NextResponse.json(
      { error: "Failed to fetch assemblies" },
      { status: 500 }
    );
  }
}
