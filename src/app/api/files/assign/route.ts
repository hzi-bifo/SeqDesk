import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveDataBasePathFromStoredValue } from "@/lib/files/data-base-path";
import * as fs from "fs/promises";
import * as path from "path";

import { checkAndCompleteOrder } from "@/lib/orders/auto-complete";

// Statuses where files can be assigned
const FILES_ASSIGNABLE_STATUSES = ["SUBMITTED", "COMPLETED"];

// Detect if filename is R1 or R2
function detectReadType(filename: string): "file1" | "file2" | null {
  const lower = filename.toLowerCase();
  // R2 patterns
  if (/_r2[._]/.test(lower) || /\.r2[._]/.test(lower) || /_2\./.test(lower)) {
    return "file2";
  }
  // R1 patterns
  if (/_r1[._]/.test(lower) || /\.r1[._]/.test(lower) || /_1\./.test(lower)) {
    return "file1";
  }
  return null;
}

// POST - assign a file to a sample
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== "FACILITY_ADMIN") {
      return NextResponse.json(
        { error: "Only facility admins can assign files" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { filePath, sampleId, readField, force } = body as {
      filePath: string;
      sampleId: string;
      readField?: "file1" | "file2";
      force?: boolean; // Allow re-assignment of already assigned files
    };

    if (!filePath || !sampleId) {
      return NextResponse.json(
        { error: "filePath and sampleId are required" },
        { status: 400 }
      );
    }

    // Get config
    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { dataBasePath: true, extraSettings: true },
    });

    const resolvedDataBasePath = resolveDataBasePathFromStoredValue(settings?.dataBasePath);

    if (!resolvedDataBasePath.dataBasePath) {
      return NextResponse.json(
        { error: "Data base path not configured" },
        { status: 400 }
      );
    }

    // Verify file exists
    const absolutePath = path.join(resolvedDataBasePath.dataBasePath, filePath);
    try {
      await fs.access(absolutePath);
    } catch {
      return NextResponse.json(
        { error: "File not found" },
        { status: 404 }
      );
    }

    // Get sample with order
    const sample = await db.sample.findUnique({
      where: { id: sampleId },
      include: {
        order: { select: { id: true, status: true, name: true } },
        reads: { select: { id: true, file1: true, file2: true } },
      },
    });

    if (!sample) {
      return NextResponse.json(
        { error: "Sample not found" },
        { status: 404 }
      );
    }

    // Check order status allows file assignment
    if (!FILES_ASSIGNABLE_STATUSES.includes(sample.order.status)) {
      return NextResponse.json(
        { error: `Order status '${sample.order.status}' does not allow file assignment` },
        { status: 400 }
      );
    }

    // Determine read field (auto-detect if not specified)
    let targetField = readField;
    if (!targetField) {
      const detected = detectReadType(filePath);
      if (detected) {
        targetField = detected;
      } else {
        // Default to file1 if can't detect and file1 is empty
        const existingRead = sample.reads[0];
        if (!existingRead?.file1) {
          targetField = "file1";
        } else if (!existingRead?.file2) {
          targetField = "file2";
        } else {
          return NextResponse.json(
            { error: "Could not determine read type. Please specify file1 or file2." },
            { status: 400 }
          );
        }
      }
    }

    // Check if file is already assigned
    const existingAssignment = await db.read.findFirst({
      where: {
        OR: [
          { file1: filePath },
          { file2: filePath },
        ],
      },
      include: {
        sample: { select: { id: true, sampleId: true } },
      },
    });

    if (existingAssignment) {
      // If assigning to the same sample, just return success
      if (existingAssignment.sample.id === sampleId) {
        return NextResponse.json({
          success: true,
          message: `File is already assigned to ${existingAssignment.sample.sampleId}`,
          sampleId: existingAssignment.sample.sampleId,
          readField: existingAssignment.file1 === filePath ? "file1" : "file2",
        });
      }

      // If force is not set, reject
      if (!force) {
        return NextResponse.json(
          {
            error: `File is already assigned to sample ${existingAssignment.sample.sampleId}`,
            assignedTo: existingAssignment.sample.sampleId,
            requiresForce: true,
          },
          { status: 400 }
        );
      }

      // Remove file from old assignment
      const wasFile1 = existingAssignment.file1 === filePath;
      await db.read.update({
        where: { id: existingAssignment.id },
        data: {
          [wasFile1 ? "file1" : "file2"]: null,
        },
      });

      // If both files are now null, delete the Read record
      const updatedRead = await db.read.findUnique({
        where: { id: existingAssignment.id },
      });
      if (updatedRead && !updatedRead.file1 && !updatedRead.file2) {
        await db.read.delete({ where: { id: existingAssignment.id } });
      }
    }

    // Create or update Read record
    const existingRead = sample.reads[0];

    if (existingRead) {
      // Update existing read
      await db.read.update({
        where: { id: existingRead.id },
        data: {
          [targetField]: filePath,
        },
      });
    } else {
      // Create new read
      await db.read.create({
        data: {
          sampleId: sample.id,
          [targetField]: filePath,
        },
      });
    }

    // Check if order should be auto-completed
    await checkAndCompleteOrder(sample.order.id);

    return NextResponse.json({
      success: true,
      message: `File assigned to ${sample.sampleId} as ${targetField === "file1" ? "Read 1" : "Read 2"}`,
      sampleId: sample.sampleId,
      readField: targetField,
    });
  } catch (error) {
    console.error("[Files Assign API] Error:", error);
    return NextResponse.json(
      { error: "Failed to assign file" },
      { status: 500 }
    );
  }
}
