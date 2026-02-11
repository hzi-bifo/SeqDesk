import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getExecutionSettings } from "@/lib/pipelines/execution-settings";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function parseLimit(value: string | null): number {
  if (!value) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function parsePayload(payload: string | null): unknown {
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}

// GET - Return raw weblog events for a run (including stored payload JSON)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const limit = parseLimit(request.nextUrl.searchParams.get("limit"));

    const run = await db.pipelineRun.findUnique({
      where: { id },
      select: {
        id: true,
        runNumber: true,
        pipelineId: true,
        study: {
          select: {
            userId: true,
          },
        },
      },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    if (
      session.user.role !== "FACILITY_ADMIN" &&
      run.study?.userId !== session.user.id
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const events = await db.pipelineRunEvent.findMany({
      where: { pipelineRunId: id },
      orderBy: { occurredAt: "desc" },
      take: limit,
      select: {
        id: true,
        eventType: true,
        processName: true,
        stepId: true,
        status: true,
        message: true,
        payload: true,
        source: true,
        occurredAt: true,
      },
    });

    const execSettings = await getExecutionSettings();
    const webhookEndpoint = new URL("/api/pipelines/weblog", request.nextUrl.origin);
    webhookEndpoint.searchParams.set("runId", id);
    if (execSettings.weblogSecret) {
      webhookEndpoint.searchParams.set("token", "<your-weblog-secret>");
    }

    return NextResponse.json({
      run: {
        id: run.id,
        runNumber: run.runNumber,
        pipelineId: run.pipelineId,
      },
      webhook: {
        method: "POST",
        endpoint: webhookEndpoint.toString(),
        tokenRequired: Boolean(execSettings.weblogSecret),
      },
      count: events.length,
      events: events.map((event) => ({
        ...event,
        payloadRaw: event.payload,
        payload: parsePayload(event.payload),
      })),
    });
  } catch (error) {
    console.error("[Pipeline Run Weblog API] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch raw weblog events" },
      { status: 500 }
    );
  }
}
