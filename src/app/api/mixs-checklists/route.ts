import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getActiveMixsConfig,
  getChecklistForStudy,
} from "@/lib/mixs/config";
import type {
  MixsChecklist,
  MixsChecklistSummary,
} from "@/types/mixs-checklist";

// Re-exported for backwards compatibility with existing importers.
export type { MixsField, MixsChecklist } from "@/types/mixs-checklist";

function summarize(checklist: MixsChecklist): MixsChecklistSummary {
  return {
    name: checklist.name,
    accession: checklist.accession,
    description: checklist.description,
    fieldCount: checklist.fields.length,
    mandatoryCount: checklist.fields.filter((f) => f.required).length,
    deprecated: checklist.deprecated,
  };
}

// GET /api/mixs-checklists - List all available checklists
// GET /api/mixs-checklists?accession=ERC000022 - Get specific checklist by accession
// GET /api/mixs-checklists?name=soil - Get checklist by name (partial match)
// GET /api/mixs-checklists?...&version=5 - Resolve against a pinned study version
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const accession = searchParams.get("accession");
  const name = searchParams.get("name");
  const versionParam = searchParams.get("version");
  const version = versionParam ? parseInt(versionParam, 10) || null : null;

  // Return a specific checklist (version-aware so pinned studies resolve the
  // definition they were authored with).
  if (accession || name) {
    const checklist = await getChecklistForStudy(db, { accession, name, version });
    if (!checklist) {
      return NextResponse.json(
        { error: `Checklist not found: ${accession || name}` },
        { status: 404 }
      );
    }
    return NextResponse.json(checklist);
  }

  // Return the index of active checklists.
  const config = await getActiveMixsConfig(db);
  const checklists = config.checklists
    .filter((c) => c.available !== false)
    .map(summarize);

  return NextResponse.json({
    checklists,
    total: checklists.length,
    version: config.version,
  });
}
