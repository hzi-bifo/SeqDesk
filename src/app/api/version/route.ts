import { NextResponse } from "next/server";
import { getCurrentVersion } from "@/lib/updater";

export async function GET() {
  return NextResponse.json({ version: getCurrentVersion() });
}
