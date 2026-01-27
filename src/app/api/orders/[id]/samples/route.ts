import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET samples for an order (also returns sampleset config)
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
    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";

    // Check order exists and user has access, include sampleset
    const order = await db.order.findUnique({
      where: { id },
      select: {
        userId: true,
        sampleset: {
          select: {
            checklists: true,
            selectedFields: true,
          },
        },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (!isFacilityAdmin && order.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const samples = await db.sample.findMany({
      where: { orderId: id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        sampleId: true,
        sampleAlias: true,
        sampleTitle: true,
        sampleDescription: true,
        scientificName: true,
        taxId: true,
        checklistData: true,
        checklistUnits: true,
        customFields: true,
      },
    });

    // Parse JSON fields for each sample
    const samplesWithParsedData = samples.map((sample) => ({
      ...sample,
      checklistData: sample.checklistData
        ? JSON.parse(sample.checklistData)
        : {},
      checklistUnits: sample.checklistUnits
        ? JSON.parse(sample.checklistUnits)
        : {},
      customFields: sample.customFields
        ? JSON.parse(sample.customFields)
        : {},
    }));

    // Parse sampleset checklists
    const checklist = order.sampleset?.checklists
      ? JSON.parse(order.sampleset.checklists)
      : null;

    return NextResponse.json({
      samples: samplesWithParsedData,
      checklist: Array.isArray(checklist) ? checklist[0] : checklist,
    });
  } catch (error) {
    console.error("Error fetching samples:", error);
    return NextResponse.json(
      { error: "Failed to fetch samples" },
      { status: 500 }
    );
  }
}

// POST create/update/delete samples (bulk operation)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";

    // Check order exists and user has access
    const order = await db.order.findUnique({
      where: { id },
      select: { userId: true, status: true },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (!isFacilityAdmin && order.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Only allow editing in DRAFT status
    if (order.status !== "DRAFT") {
      return NextResponse.json(
        { error: "Cannot modify samples after order submission" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { samples, checklist } = body;

    if (!Array.isArray(samples)) {
      return NextResponse.json(
        { error: "Samples must be an array" },
        { status: 400 }
      );
    }

    // Update or create Sampleset with selected checklist
    if (checklist) {
      await db.sampleset.upsert({
        where: { orderId: id },
        update: {
          checklists: JSON.stringify([checklist]),
        },
        create: {
          orderId: id,
          checklists: JSON.stringify([checklist]),
        },
      });
    }

    // Process samples
    const results = [];

    for (const sample of samples) {
      // Prepare JSON fields
      const checklistDataJson = sample.checklistData
        ? JSON.stringify(sample.checklistData)
        : null;
      const checklistUnitsJson = sample.checklistUnits
        ? JSON.stringify(sample.checklistUnits)
        : null;
      const customFieldsJson = sample.customFields
        ? JSON.stringify(sample.customFields)
        : null;

      if (sample.isDeleted && sample.id) {
        // Delete existing sample
        await db.sample.delete({
          where: { id: sample.id },
        });
      } else if (sample.isNew) {
        // Create new sample
        const newSample = await db.sample.create({
          data: {
            sampleId: sample.sampleId.trim(),
            sampleAlias: sample.sampleAlias?.trim() || null,
            sampleTitle: sample.sampleTitle?.trim() || null,
            sampleDescription: sample.sampleDescription?.trim() || null,
            scientificName: sample.scientificName?.trim() || null,
            taxId: sample.taxId?.trim() || null,
            checklistData: checklistDataJson,
            checklistUnits: checklistUnitsJson,
            customFields: customFieldsJson,
            orderId: id,
          },
          select: {
            id: true,
            sampleId: true,
            sampleAlias: true,
            sampleTitle: true,
            sampleDescription: true,
            scientificName: true,
            taxId: true,
            checklistData: true,
            checklistUnits: true,
            customFields: true,
          },
        });
        results.push(newSample);
      } else if (sample.id) {
        // Update existing sample
        const updatedSample = await db.sample.update({
          where: { id: sample.id },
          data: {
            sampleId: sample.sampleId.trim(),
            sampleAlias: sample.sampleAlias?.trim() || null,
            sampleTitle: sample.sampleTitle?.trim() || null,
            sampleDescription: sample.sampleDescription?.trim() || null,
            scientificName: sample.scientificName?.trim() || null,
            taxId: sample.taxId?.trim() || null,
            checklistData: checklistDataJson,
            checklistUnits: checklistUnitsJson,
            customFields: customFieldsJson,
          },
          select: {
            id: true,
            sampleId: true,
            sampleAlias: true,
            sampleTitle: true,
            sampleDescription: true,
            scientificName: true,
            taxId: true,
            checklistData: true,
            checklistUnits: true,
            customFields: true,
          },
        });
        results.push(updatedSample);
      }
    }

    // Return all current samples with parsed JSON fields
    const allSamples = await db.sample.findMany({
      where: { orderId: id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        sampleId: true,
        sampleAlias: true,
        sampleTitle: true,
        sampleDescription: true,
        scientificName: true,
        taxId: true,
        checklistData: true,
        checklistUnits: true,
        customFields: true,
      },
    });

    // Parse JSON fields for response
    const samplesWithParsedData = allSamples.map((sample) => ({
      ...sample,
      checklistData: sample.checklistData
        ? JSON.parse(sample.checklistData)
        : {},
      checklistUnits: sample.checklistUnits
        ? JSON.parse(sample.checklistUnits)
        : {},
      customFields: sample.customFields
        ? JSON.parse(sample.customFields)
        : {},
    }));

    // Update order's numberOfSamples to match actual count
    await db.order.update({
      where: { id },
      data: { numberOfSamples: allSamples.length },
    });

    return NextResponse.json({ samples: samplesWithParsedData });
  } catch (error) {
    console.error("Error saving samples:", error);
    return NextResponse.json(
      { error: "Failed to save samples" },
      { status: 500 }
    );
  }
}
