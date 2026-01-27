import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEFAULT_FORM_SCHEMA, DEFAULT_GROUPS } from "@/types/form-config";

// GET form schema for order creation (public to authenticated users)
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const config = await db.orderFormConfig.findUnique({
      where: { id: "singleton" },
    });

    // If no config exists, return default system fields and groups
    if (!config) {
      const perSampleFields = DEFAULT_FORM_SCHEMA.fields.filter(
        (field) => field.perSample && field.visible
      );
      return NextResponse.json({
        fields: DEFAULT_FORM_SCHEMA.fields,
        groups: DEFAULT_FORM_SCHEMA.groups,
        version: 1,
        enabledMixsChecklists: [],
        perSampleFields,
      });
    }

    // Parse JSON fields and return
    const parsed = JSON.parse(config.schema);
    // Handle both formats: { fields: [...] } or just [...]
    const fields = Array.isArray(parsed) ? parsed : parsed.fields || [];
    const groups = parsed.groups || DEFAULT_GROUPS;
    const enabledMixsChecklists = parsed.enabledMixsChecklists || [];
    const perSampleFields = fields.filter((field: { perSample?: boolean; visible?: boolean }) =>
      field.perSample && field.visible
    );
    return NextResponse.json({
      fields,
      groups,
      version: config.version,
      enabledMixsChecklists,
      perSampleFields,
    });
  } catch (error) {
    console.error("Error fetching form schema:", error);
    return NextResponse.json(
      { error: "Failed to fetch form schema" },
      { status: 500 }
    );
  }
}
