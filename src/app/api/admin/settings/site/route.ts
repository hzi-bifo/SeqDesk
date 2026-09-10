import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { authorizationErrorResponse, decideServerCapability } from "@/lib/authorization/api";
import { db } from "@/lib/db";
import { clearConfigCache, getEffectiveConfig } from "@/lib/config";
import { installationDetailsUpdateSchema, type InstallationDetails } from "@/lib/settings/site-settings";

const selectedFields = { siteName: true, contactEmail: true, updatedAt: true } as const;
const managed = (source: string) => source === "file" || source === "env";
const conflict = () => NextResponse.json({
  error: "Settings changed since you opened this page. Reload the saved values before trying again.",
  code: "settings-conflict",
}, { status: 409 });

async function readDetails(demo = false): Promise<InstallationDetails> {
  // Never hide a failed database read behind the effective-config fallback.
  const stored = await db.siteSettings.findUnique({ where: { id: "singleton" }, select: selectedFields });
  clearConfigCache();
  const resolved = await getEffectiveConfig();
  const sources = {
    name: resolved.sources["site.name"] ?? "default",
    contactEmail: resolved.sources["site.contactEmail"] ?? "default",
  };
  const settings = {
    name: resolved.config.site?.name ?? "SeqDesk",
    contactEmail: resolved.config.site?.contactEmail ?? "",
  };
  // The shared resolver deliberately falls back on errors. Do not allow a
  // stale/default identity to become an editable snapshot in that situation.
  if ((!managed(sources.name) && settings.name !== (stored?.siteName || "SeqDesk")) ||
      (!managed(sources.contactEmail) && settings.contactEmail !== (stored?.contactEmail || ""))) {
    throw new Error("Installation settings changed or could not be resolved consistently");
  }
  return {
    settings,
    sources,
    editable: { name: !demo && !managed(sources.name), contactEmail: !demo && !managed(sources.contactEmail) },
    revision: stored?.updatedAt.toISOString() ?? null,
    readOnlyReason: demo ? "Installation details are read-only in the demo." : null,
  };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const access = decideServerCapability(session, "system.settings.manage");
  if (!access.allowed) return authorizationErrorResponse(access);
  try {
    return NextResponse.json(await readDetails(Boolean(access.principal?.isDemo)), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Installation details could not be loaded. Try again." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const session = await getServerSession(authOptions);
  const access = decideServerCapability(session, "system.settings.manage");
  if (!access.allowed) return authorizationErrorResponse(access);
  if (access.principal?.isDemo) {
    return NextResponse.json({ error: "Installation details cannot be changed in the demo." }, { status: 403 });
  }
  const parsed = installationDetailsUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid installation details." }, { status: 400 });
  }
  let saved = false;
  try {
    const current = await readDetails();
    const input = parsed.data;
    for (const field of ["name", "contactEmail"] as const) {
      if (input[field] !== undefined && !current.editable[field]) {
        return NextResponse.json({
          error: `${field === "name" ? "Installation name" : "Contact email"} is managed by ${current.sources[field] === "env" ? "the service environment" : "the installed settings file"}. Ask the server operator to change it there.`,
          code: "settings-managed",
        }, { status: 409 });
      }
    }
    if (input.expectedRevision !== current.revision) return conflict();
    const data = {
      ...(input.name !== undefined ? { siteName: input.name } : {}),
      ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail || null } : {}),
    };
    // Only these columns are written. Do not round-trip unrelated JSON settings
    // or call the infrastructure importer just to change a contact address.
    if (current.revision === null) {
      await db.siteSettings.create({ data: { id: "singleton", ...data }, select: selectedFields });
    } else {
      await db.siteSettings.update({
        where: { id: "singleton", updatedAt: new Date(current.revision) },
        data,
        select: selectedFields,
      });
    }
    saved = true;
    clearConfigCache();
    return NextResponse.json(await readDetails(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (!saved && (code === "P2025" || code === "P2002")) return conflict();
    return NextResponse.json({
      error: saved
        ? "Your changes were saved, but the updated details could not be loaded. Reload the saved values to confirm them."
        : "Installation details could not be saved. Your changes are still in the form; try again.",
      ...(saved ? { code: "saved-refresh-failed" } : {}),
    }, { status: 500 });
  }
}
