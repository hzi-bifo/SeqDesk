import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { applyOntRunPlanPreset } from "@/lib/sequencing/run-plan";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await applyOntRunPlanPreset();
  return NextResponse.json({
    success: true,
    preset: "ont-metagenomics-metatranscriptomics-run-plan",
    ...result,
  });
}
