import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import * as path from "path";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSequencingFilesConfig } from "@/lib/files/sequencing-config";
import {
  checkFileExists,
  ensureWithinBase,
  hasAllowedExtension,
  toRelativePath,
  validateFilePair,
} from "@/lib/files";

import { checkAndCompleteOrder } from "@/lib/orders/auto-complete";
import { isDemoSession } from "@/lib/demo/server";

// Status after which files can be assigned
const FILES_ASSIGNABLE_STATUSES = ["SUBMITTED", "COMPLETED"];

interface SampleFileInfo {
  sampleId: string;
  sampleAlias: string | null;
  sampleTitle: string | null;
  // Current assignment
  read1: string | null;
  read2: string | null;
  read1Exists: boolean;
  read2Exists: boolean;
  // Suggestion info
  suggestedRead1: string | null;
  suggestedRead2: string | null;
  suggestionStatus: "exact" | "partial" | "ambiguous" | "none" | "assigned";
  suggestionConfidence: number;
}

// GET - list samples with file assignments and suggestions
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (isDemoSession(session)) {
      return NextResponse.json(
        { error: "File management is disabled in the public demo." },
        { status: 403 }
      );
    }

    const { id } = await params;
    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";

    // Get order with samples and reads
    const order = await db.order.findUnique({
      where: { id },
      include: {
        samples: {
          include: {
            reads: true,
          },
          orderBy: { sampleId: "asc" },
        },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Check permission
    if (!isFacilityAdmin && order.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Get config
    const { dataBasePath, config } = await getSequencingFilesConfig();

    // Check if files are assignable based on order status
    const canAssign = isFacilityAdmin && FILES_ASSIGNABLE_STATUSES.includes(order.status);

    // Build sample info with current assignments
    const sampleInfos: SampleFileInfo[] = [];

    for (const sample of order.samples) {
      const read = sample.reads[0] || null; // MVP: one read per sample

      const info: SampleFileInfo = {
        sampleId: sample.sampleId,
        sampleAlias: sample.sampleAlias,
        sampleTitle: sample.sampleTitle,
        read1: read?.file1 || null,
        read2: read?.file2 || null,
        read1Exists: false,
        read2Exists: false,
        suggestedRead1: null,
        suggestedRead2: null,
        suggestionStatus: "none",
        suggestionConfidence: 0,
      };

      // Check if assigned files exist
      if (dataBasePath && read?.file1) {
        const exists = await checkFileExists(dataBasePath, read.file1);
        info.read1Exists = !!exists;
      }
      if (dataBasePath && read?.file2) {
        const exists = await checkFileExists(dataBasePath, read.file2);
        info.read2Exists = !!exists;
      }

      // If already assigned, mark as such
      if (info.read1) {
        info.suggestionStatus = "assigned";
      }

      sampleInfos.push(info);
    }

    return NextResponse.json({
      orderId: order.id,
      orderName: order.name,
      orderStatus: order.status,
      canAssign,
      dataBasePath: dataBasePath || null,
      config,
      samples: sampleInfos,
    });
  } catch (error) {
    console.error("[Order Files] GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch order files" },
      { status: 500 }
    );
  }
}

// PUT - update file assignments
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (isDemoSession(session)) {
      return NextResponse.json(
        { error: "File management is disabled in the public demo." },
        { status: 403 }
      );
    }

    const { id } = await params;
    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";

    if (!isFacilityAdmin) {
      return NextResponse.json(
        { error: "Only facility admins can assign files" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { assignments } = body as {
      assignments: Array<{
        sampleId: string;
        read1: string | null;
        read2: string | null;
      }>;
    };

    if (!assignments || !Array.isArray(assignments)) {
      return NextResponse.json(
        { error: "Invalid assignments data" },
        { status: 400 }
      );
    }

    // Get order
    const order = await db.order.findUnique({
      where: { id },
      include: {
        samples: {
          include: { reads: true },
        },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (!FILES_ASSIGNABLE_STATUSES.includes(order.status)) {
      return NextResponse.json(
        { error: "Files cannot be assigned in this order status" },
        { status: 400 }
      );
    }

    const { dataBasePath, config } = await getSequencingFilesConfig();

    const normalizePath = (value: string | null): string | null => {
      if (!value) return null;
      const trimmed = value.trim();
      if (!trimmed) return null;
      if (!dataBasePath) {
        throw new Error("Data base path not configured");
      }
      if (trimmed.includes("..")) {
        throw new Error("Path traversal not allowed");
      }

      let relativePath = trimmed;
      if (path.isAbsolute(trimmed)) {
        relativePath = toRelativePath(dataBasePath, trimmed);
      } else {
        ensureWithinBase(dataBasePath, trimmed);
      }

      if (!relativePath || relativePath === ".") {
        throw new Error("Invalid file path");
      }

      if (!hasAllowedExtension(relativePath, config.allowedExtensions)) {
        throw new Error("File extension not allowed");
      }

      return relativePath;
    };

    // Process each assignment
    const results: Array<{ sampleId: string; success: boolean; error?: string }> = [];

    for (const assignment of assignments) {
      const sample = order.samples.find(
        (s) => s.sampleId === assignment.sampleId
      );

      if (!sample) {
        results.push({
          sampleId: assignment.sampleId,
          success: false,
          error: "Sample not found",
        });
        continue;
      }

      const existingRead = sample.reads[0];

      const inputRead1 = assignment.read1?.trim() || null;
      const inputRead2 = assignment.read2?.trim() || null;

      if (!inputRead1 && !inputRead2) {
        try {
          if (existingRead) {
            await db.read.update({
              where: { id: existingRead.id },
              data: { file1: null, file2: null },
            });
          }
          results.push({ sampleId: assignment.sampleId, success: true });
        } catch (error) {
          console.error(`[Order Files] Error clearing files for ${assignment.sampleId}:`, error);
          results.push({
            sampleId: assignment.sampleId,
            success: false,
            error: "Database error",
          });
        }
        continue;
      }

      let normalizedRead1: string | null;
      let normalizedRead2: string | null;

      try {
        normalizedRead1 = normalizePath(inputRead1);
        normalizedRead2 = normalizePath(inputRead2);
      } catch (error) {
        results.push({
          sampleId: assignment.sampleId,
          success: false,
          error: error instanceof Error ? error.message : "Invalid file path",
        });
        continue;
      }

      const validation = validateFilePair(
        normalizedRead1,
        normalizedRead2,
        config.allowSingleEnd
      );

      if (!validation.valid) {
        results.push({
          sampleId: assignment.sampleId,
          success: false,
          error: validation.errors.join(" "),
        });
        continue;
      }

      try {
        if (existingRead) {
          // Update existing read
          await db.read.update({
            where: { id: existingRead.id },
            data: {
              file1: normalizedRead1,
              file2: normalizedRead2,
            },
          });
        } else if (normalizedRead1 || normalizedRead2) {
          // Create new read
          await db.read.create({
            data: {
              sampleId: sample.id,
              file1: normalizedRead1,
              file2: normalizedRead2,
            },
          });
        }

        results.push({ sampleId: assignment.sampleId, success: true });
      } catch (error) {
        console.error(`[Order Files] Error assigning files to ${assignment.sampleId}:`, error);
        results.push({
          sampleId: assignment.sampleId,
          success: false,
          error: "Database error",
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    // Check if order should be auto-completed
    if (successCount > 0) {
      await checkAndCompleteOrder(id);
    }

    return NextResponse.json({
      success: failCount === 0,
      message: `Updated ${successCount} sample(s)${failCount > 0 ? `, ${failCount} failed` : ""}`,
      results,
    });
  } catch (error) {
    console.error("[Order Files] PUT error:", error);
    return NextResponse.json(
      { error: "Failed to update file assignments" },
      { status: 500 }
    );
  }
}
