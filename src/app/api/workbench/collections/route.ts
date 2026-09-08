import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { authorizeWorkbenchRequest } from "@/lib/workbench/server";
import { importCollectionSchema } from "@/lib/workbench/import-collection";
import { ensureQueuedCollection } from "@/lib/workbench/import-jobs";

export async function POST(request: NextRequest) {
  const access = authorizeWorkbenchRequest(await getServerSession(authOptions), "workbench.import");
  if (!access.allowed) return access.response;
  let input: unknown;
  try { input = await request.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  const parsed = importCollectionSchema.safeParse(input);
  if (!parsed.success) return NextResponse.json({ error: "Enter a collection name (1–500 characters) and a valid collection key." }, { status: 400 });
  try {
    const order = await db.$transaction(tx => ensureQueuedCollection(tx, access.userId, { collection: parsed.data }));
    return NextResponse.json({ id: order!.id, name: order!.name, collectionKey: parsed.data.key }, { status: 201 });
  } catch { return NextResponse.json({ error: "Could not save this collection. Please retry." }, { status: 500 }); }
}
