import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { PIPELINE_REGISTRY } from "@/lib/pipelines";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";
    const userId = session.user.id;
    const isDemoUser = session.user.isDemo === true;

    const [runs, submissions] = await Promise.all([
      isDemoUser
        ? Promise.resolve([])
        : db.pipelineRun.findMany({
            where: isFacilityAdmin ? {} : { study: { userId } },
            select: {
              id: true,
              runNumber: true,
              pipelineId: true,
              status: true,
              createdAt: true,
              study: {
                select: {
                  id: true,
                  title: true,
                },
              },
            },
            orderBy: { createdAt: "desc" },
            take: 3,
          }),
      isFacilityAdmin
        ? db.submission.findMany({
            select: {
              id: true,
              submissionType: true,
              status: true,
              entityType: true,
              entityId: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: 3,
          })
        : Promise.resolve([]),
    ]);

    const archiveUploads = await Promise.all(
      submissions.map(async (submission) => {
        if (submission.entityType === "study") {
          const study = await db.study.findUnique({
            where: { id: submission.entityId },
            select: {
              id: true,
              title: true,
            },
          });

          return {
            id: submission.id,
            submissionType: submission.submissionType,
            status: submission.status,
            entityType: submission.entityType,
            entityLabel: study?.title ?? "Deleted Study",
            createdAt: submission.createdAt,
            study: study
              ? {
                  id: study.id,
                  title: study.title,
                }
              : null,
          };
        }

        const sample = await db.sample.findUnique({
          where: { id: submission.entityId },
          select: {
            sampleId: true,
            sampleTitle: true,
            study: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        });

        return {
          id: submission.id,
          submissionType: submission.submissionType,
          status: submission.status,
          entityType: submission.entityType,
          entityLabel: sample?.sampleTitle || sample?.sampleId || "Deleted Sample",
          createdAt: submission.createdAt,
          study: sample?.study
            ? {
                id: sample.study.id,
                title: sample.study.title,
              }
            : null,
        };
      })
    );

    return NextResponse.json({
      pipelineRuns: runs.map((run) => ({
        id: run.id,
        runNumber: run.runNumber,
        pipelineId: run.pipelineId,
        pipelineName: PIPELINE_REGISTRY[run.pipelineId]?.name || run.pipelineId,
        status: run.status,
        createdAt: run.createdAt,
        study: run.study,
      })),
      archiveUploads,
    });
  } catch (error) {
    console.error("Error fetching sidebar recent activity:", error);
    return NextResponse.json(
      { error: "Failed to fetch recent activity" },
      { status: 500 }
    );
  }
}
