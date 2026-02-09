import { NextResponse } from "next/server";
import { checkDatabaseStatus } from "@/lib/db-status";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const status = await checkDatabaseStatus();
  return NextResponse.json(status, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
