import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

function parseExtraSettings(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybe = error as { code?: string; message?: string };
  if (maybe.code === "P2022") return true;
  const message = String(maybe.message ?? "");
  return /no such column|unknown column/i.test(message);
}

function isOrderNotesSchemaMismatchError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybe = error as { message?: string };
  const message = String(maybe.message ?? "");

  return (
    /Unknown (field|argument)/i.test(message) &&
    /(notes|notesEditedAt|notesEditedById|notesEditedBy)/.test(message)
  );
}

const notesEditorSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
} as const;

async function fetchOrderWithNotes(orderId: string) {
  return db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      userId: true,
      notes: true,
      notesEditedAt: true,
      notesEditedById: true,
      notesEditedBy: {
        select: notesEditorSelect,
      },
    },
  });
}

async function fetchOrderWithoutNotes(orderId: string) {
  return db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      userId: true,
    },
  });
}

type OrderWithNotes = NonNullable<Awaited<ReturnType<typeof fetchOrderWithNotes>>>;
type OrderWithoutNotes = NonNullable<Awaited<ReturnType<typeof fetchOrderWithoutNotes>>>;
type OrderAccessSession = {
  user?: {
    id?: string | null;
    role?: string | null;
  };
} | null;

async function resolveOrderWithNotesState(orderId: string): Promise<{
  order: OrderWithNotes | OrderWithoutNotes | null;
  notesSupported: boolean;
}> {
  try {
    const order = await fetchOrderWithNotes(orderId);
    return { order, notesSupported: true };
  } catch (error) {
    if (!isMissingColumnError(error) && !isOrderNotesSchemaMismatchError(error)) {
      throw error;
    }

    const order = await fetchOrderWithoutNotes(orderId);
    return { order, notesSupported: false };
  }
}

function canAccessOrder(session: OrderAccessSession, orderUserId: string) {
  return session?.user?.role === "FACILITY_ADMIN" || session?.user?.id === orderUserId;
}

async function getOrderNotesEnabled(): Promise<boolean> {
  const settings = await db.siteSettings.findUnique({
    where: { id: "singleton" },
    select: { extraSettings: true },
  });

  const extraSettings = parseExtraSettings(settings?.extraSettings);
  return extraSettings.orderNotesEnabled !== false;
}

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
    const [{ order, notesSupported }, notesEnabled] = await Promise.all([
      resolveOrderWithNotesState(id),
      getOrderNotesEnabled(),
    ]);

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (!canAccessOrder(session, order.userId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const orderRecord = order as Partial<OrderWithNotes>;

    return NextResponse.json({
      notes: notesSupported && notesEnabled ? orderRecord.notes ?? null : null,
      notesEditedAt:
        notesSupported && notesEnabled ? orderRecord.notesEditedAt ?? null : null,
      notesEditedById:
        notesSupported && notesEnabled ? orderRecord.notesEditedById ?? null : null,
      notesEditedBy:
        notesSupported && notesEnabled ? orderRecord.notesEditedBy ?? null : null,
      notesSupported,
      notesEnabled,
    });
  } catch (error) {
    console.error("Error fetching order notes:", error);
    return NextResponse.json(
      { error: "Failed to fetch order notes" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { notes } = body as { notes?: unknown };
    const notesEnabled = await getOrderNotesEnabled();

    if (notes !== undefined && notes !== null && typeof notes !== "string") {
      return NextResponse.json(
        { error: "Notes must be a string or null" },
        { status: 400 }
      );
    }

    const { order, notesSupported } = await resolveOrderWithNotesState(id);

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (!canAccessOrder(session, order.userId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!notesEnabled) {
      return NextResponse.json(
        {
          error: "Order notes are disabled in admin settings.",
          notesSupported,
          notesEnabled: false,
        },
        { status: 403 }
      );
    }

    if (!notesSupported) {
      return NextResponse.json(
        {
          error: "Order notes are unavailable until the database is updated.",
          notesSupported: false,
          notesEnabled: true,
        },
        { status: 400 }
      );
    }

    const normalizedNotes = typeof notes === "string" && notes.length > 0 ? notes : null;
    const existingOrder = order as OrderWithNotes;

    if ((existingOrder.notes ?? null) === normalizedNotes) {
      return NextResponse.json({
        notes: existingOrder.notes ?? null,
        notesEditedAt: existingOrder.notesEditedAt ?? null,
        notesEditedById: existingOrder.notesEditedById ?? null,
        notesEditedBy: existingOrder.notesEditedBy ?? null,
        notesSupported: true,
        notesEnabled: true,
      });
    }

    const updatedOrder = await db.order.update({
      where: { id },
      data: {
        notes: normalizedNotes,
        notesEditedAt: new Date(),
        notesEditedById: session.user.id,
      },
      select: {
        notes: true,
        notesEditedAt: true,
        notesEditedById: true,
        notesEditedBy: {
          select: notesEditorSelect,
        },
      },
    });

    return NextResponse.json({
      ...updatedOrder,
      notesSupported: true,
      notesEnabled: true,
    });
  } catch (error) {
    console.error("Error updating order notes:", error);

    if (isMissingColumnError(error) || isOrderNotesSchemaMismatchError(error)) {
      return NextResponse.json(
        {
          error: "Order notes are unavailable until the database is updated.",
          notesSupported: false,
          notesEnabled: true,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to update order notes" },
      { status: 500 }
    );
  }
}
