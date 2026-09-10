import { NextResponse } from "next/server";
import { DataFilesError } from "@/lib/orders/data-files.server";

export function dataFilesErrorResponse(error: unknown) {
  if (error instanceof DataFilesError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[Data files] Request failed", error instanceof Error ? error.name : "Unknown error");
  return NextResponse.json({ error: "Could not complete the file operation" }, { status: 500 });
}
