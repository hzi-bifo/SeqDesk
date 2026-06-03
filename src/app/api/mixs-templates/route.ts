import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  getActiveMixsConfig,
  getChecklistForStudy,
  loadLegacyMixsTemplates,
} from "@/lib/mixs/config";
import type { MixsChecklist } from "@/types/mixs-checklist";

/** Merge registry checklists with legacy flat templates, deduped by name. */
function mergeWithLegacy(registry: MixsChecklist[]): MixsChecklist[] {
  const byName = new Map<string, MixsChecklist>();
  for (const t of registry) byName.set(t.name, t);
  for (const t of loadLegacyMixsTemplates()) {
    if (!byName.has(t.name)) byName.set(t.name, t);
  }
  return Array.from(byName.values());
}

// Normalize template name for fuzzy matching (lowercase, remove spaces/hyphens).
function normalizeTemplateName(name: string): string {
  return name.toLowerCase().replace(/[\s\-_]/g, "");
}

// GET MIxS templates - optionally filter by name (fuzzy), version-aware.
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const checklistName = searchParams.get("name");
    const versionParam = searchParams.get("version");
    const version = versionParam ? parseInt(versionParam, 10) || null : null;

    // Specific template requested.
    if (checklistName) {
      // Try the version-aware resolver first (handles exact name + accession +
      // pinned snapshots).
      const direct = await getChecklistForStudy(db, {
        name: checklistName,
        version,
      });
      if (direct) {
        return NextResponse.json(direct);
      }

      // Fall back to fuzzy matching across active checklists + legacy flat
      // templates (the order wizard / form builder may reference either).
      const config = await getActiveMixsConfig(db);
      const candidates = mergeWithLegacy(config.checklists);
      const normalizedSearch = normalizeTemplateName(checklistName);
      const matches = candidates.filter((t) => {
        const normalizedName = normalizeTemplateName(t.name);
        return (
          t.name === checklistName ||
          normalizedName === normalizedSearch ||
          normalizedName.includes(normalizedSearch) ||
          normalizedSearch.includes(normalizedName.replace("gscmixs", "mixs"))
        );
      });

      if (matches.length === 0) {
        return NextResponse.json({ error: "Template not found" }, { status: 404 });
      }

      // Prefer the most complete template.
      matches.sort((a, b) => b.fields.length - a.fields.length);
      return NextResponse.json(matches[0]);
    }

    // Otherwise return all active MIxS templates (registry + legacy flat).
    const config = await getActiveMixsConfig(db);
    const templates: MixsChecklist[] = mergeWithLegacy(
      config.checklists.filter((c) => c.available !== false)
    );
    return NextResponse.json({ templates });
  } catch (error) {
    console.error("Error fetching MIxS templates:", error);
    return NextResponse.json(
      { error: "Failed to fetch templates" },
      { status: 500 }
    );
  }
}
