import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  authorizationErrorResponse,
  decideServerCapability,
} from "@/lib/authorization/api";
import type { FormFieldDefinition, FormFieldGroup } from "@/types/form-config";
import {
  loadRunAssignmentFormSchema,
  saveRunAssignmentFormSchema,
} from "@/lib/sequencing/run-plan";

export async function GET() {
  const session = await getServerSession(authOptions);
  const access = decideServerCapability(session, "system.sequencing.manage");
  if (!access.allowed) {
    return authorizationErrorResponse(access);
  }

  const schema = await loadRunAssignmentFormSchema({
    isFacilityAdmin: true,
    applyRoleFilter: false,
  });
  return NextResponse.json(schema);
}

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const access = decideServerCapability(session, "system.sequencing.manage");
  if (!access.allowed) {
    return authorizationErrorResponse(access);
  }

  const body = await request.json();
  const { fields, groups } = body as {
    fields?: FormFieldDefinition[];
    groups?: FormFieldGroup[];
  };

  if (!Array.isArray(fields)) {
    return NextResponse.json({ error: "Fields must be an array" }, { status: 400 });
  }
  if (groups !== undefined && !Array.isArray(groups)) {
    return NextResponse.json({ error: "Groups must be an array" }, { status: 400 });
  }

  const schema = await saveRunAssignmentFormSchema({ fields, groups });
  return NextResponse.json(schema);
}
