import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  authorizationErrorResponse,
  decideServerCapability,
} from "@/lib/authorization/api";
import { applyOntRunPlanPreset } from "@/lib/sequencing/run-plan";

export async function POST() {
  const session = await getServerSession(authOptions);
  const access = decideServerCapability(session, "system.sequencing.manage");
  if (!access.allowed) {
    return authorizationErrorResponse(access);
  }

  const result = await applyOntRunPlanPreset();
  return NextResponse.json({
    success: true,
    preset: "ont-metagenomics-metatranscriptomics-run-plan",
    ...result,
  });
}
