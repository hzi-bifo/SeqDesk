import { NextResponse } from "next/server";
import { checkDatabaseStatus } from "@/lib/db-status";

export async function GET() {
  const status = await checkDatabaseStatus();
  return NextResponse.json(status);
}
