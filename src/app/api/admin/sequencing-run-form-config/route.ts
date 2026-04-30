import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import type { FormFieldDefinition, FormFieldGroup } from "@/types/form-config";
import {
  loadRunAssignmentFormSchema,
  saveRunAssignmentFormSchema,
} from "@/lib/sequencing/run-plan";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const schema = await loadRunAssignmentFormSchema({
    isFacilityAdmin: true,
    applyRoleFilter: false,
  });
  return NextResponse.json(schema);
}

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
