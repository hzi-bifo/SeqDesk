import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { ZodError } from "zod";
import { authOptions } from "@/lib/auth";
import { getWorkbenchImporter } from "@/lib/workbench/importers/registry";
import { createWorkbenchImportJob, runWorkbenchImportJob } from "@/lib/workbench/import-jobs";
import { resolveWorkbenchStorageBase } from "@/lib/workbench/storage";
import { listWorkbenchImportJobs } from "@/lib/workbench/workspaces";
import { authorizeWorkbenchRequest } from "@/lib/workbench/server";
import { importPreviewFingerprint } from "@/lib/workbench/import-preview-fingerprint";
import { requireRawReadImporter } from "@/lib/modules/input-modules.server";
import { importCollectionSchema } from "@/lib/workbench/import-collection";
import { ImportSelectionConflict } from "@/lib/workbench/import-conflict";
import { scientificRecordId } from "@/lib/workbench/scientific-publication";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const access = authorizeWorkbenchRequest(session);
  if (!access.allowed) return access.response;

  const collection = request.nextUrl.searchParams.get("collection") ?? undefined;
  if (collection && !/^[a-f0-9-]{36}$/i.test(collection)) return NextResponse.json({ error: "Invalid collection" }, { status: 400 });
  return NextResponse.json({ jobs: await (collection ? listWorkbenchImportJobs(access.userId, collection) : listWorkbenchImportJobs(access.userId)) });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const access = authorizeWorkbenchRequest(session, "workbench.import");
  if (!access.allowed) return access.response;

  try {
    const body = await request.json();
    const idempotencyKey = request.headers.get("idempotency-key");
    if (idempotencyKey && !/^[a-zA-Z0-9_-]{16,128}$/.test(idempotencyKey)) {
      return NextResponse.json({ error: "Invalid import request key" }, { status: 400 });
    }
    const providerId = typeof body?.providerId === "string" ? body.providerId : "";
    try { await requireRawReadImporter(providerId); }
    catch { return NextResponse.json({ error: "Input module is disabled or unsupported" }, { status: 403 }); }
    const provider = getWorkbenchImporter(providerId);
    if (!provider) {
      return NextResponse.json({ error: "Workbench importer not found" }, { status: 404 });
    }

    const preflight = await provider.preflight();
    if (!preflight.ok) {
      return NextResponse.json(
        { error: preflight.message, details: preflight.details },
        { status: 400 }
      );
    }

    try {
      await resolveWorkbenchStorageBase();
    } catch (storageError) {
      return NextResponse.json(
        {
          error:
            storageError instanceof Error
              ? storageError.message
              : "Workbench storage is not configured",
        },
        { status: 400 }
      );
    }

    const input = provider.inputSchema.parse(body.input ?? {});
    const collection = importCollectionSchema.safeParse((input as { collection?: unknown }).collection);
    if (!collection.success) {
      return NextResponse.json({ error: "Name your sequencing data before starting an import (1–500 characters)." }, { status: 400 });
    }
    const preview = await provider.preview(input);
    if (body.previewFingerprint !== importPreviewFingerprint(providerId, input, preview)) {
      return NextResponse.json({ error: "Import selection changed or was not reviewed. Preview and confirm it again." }, { status: 409 });
    }
    if (preview.summary.selectedCount === 0) {
      return NextResponse.json(
        { error: "Preview did not return any data to import." },
        { status: 400 }
      );
    }

    const { job } = await createWorkbenchImportJob({
      userId: access.userId,
      providerId,
      input,
      preview,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
    void runWorkbenchImportJob(job.id).catch(() => {
      console.error("[workbench] Immediate import dispatch failed; queued work will be retried by the worker.");
    });

    return NextResponse.json({ success: true, started: true, job, collectionOrderId: scientificRecordId("data", access.userId, "collection", collection.data.key) }, { status: 202 });
  } catch (error) {
    if (error instanceof ImportSelectionConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid importer input", issues: error.issues },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start Workbench import" },
      { status: 500 }
    );
  }
}
