import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { decideCapability } from "@/lib/authorization";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
import { encryptSecret } from "@/lib/security/secret-store";
import { isValidNcbiApiKey, ncbiApiKey, ncbiRequestsPerSecond, resetNcbiApiKeyCache } from "@/lib/workbench/importers/ncbi-client";

/**
 * The NCBI API key the SRA and genome connectors send to NCBI (3 → 10 requests a second). Stored encrypted in the
 * site settings like the ENA password; never returned, only whether one is set and where it comes from.
 */

function parseExtraSettings(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function authorize() {
  const session = await getServerSession(authOptions);
  const decision = decideCapability(session, "system.settings.manage", getServerDeploymentProfile());
  if (decision.allowed) return null;
  return NextResponse.json({ error: decision.status === 401 ? "Unauthorized" : decision.status === 404 ? "Not found" : "Forbidden" }, { status: decision.status });
}

async function state() {
  resetNcbiApiKeyCache();
  const key = await ncbiApiKey();
  return { hasKey: Boolean(key.value), source: key.source, requestsPerSecond: ncbiRequestsPerSecond(Boolean(key.value)) };
}

// GET /api/admin/settings/ncbi — whether a key is set (never the key)
export async function GET() {
  const denied = await authorize();
  if (denied) return denied;
  return NextResponse.json(await state());
}

// PUT /api/admin/settings/ncbi — { apiKey: "…" } sets it, { apiKey: "" } removes the stored one
export async function PUT(request: Request) {
  const denied = await authorize();
  if (denied) return denied;
  const body = await request.json().catch(() => null) as { apiKey?: unknown } | null;
  if (!body || typeof body.apiKey !== "string") return NextResponse.json({ error: "Send the NCBI API key as apiKey (an empty text removes it)." }, { status: 400 });
  const apiKey = body.apiKey.trim();
  if (apiKey && !isValidNcbiApiKey(apiKey)) return NextResponse.json({ error: "That does not look like an NCBI API key (20 to 64 letters and digits, from your NCBI account settings)." }, { status: 400 });
  try {
    const existing = await db.siteSettings.findUnique({ where: { id: "singleton" }, select: { extraSettings: true } });
    const extra = parseExtraSettings(existing?.extraSettings);
    const ncbi = extra.ncbi && typeof extra.ncbi === "object" && !Array.isArray(extra.ncbi) ? { ...(extra.ncbi as Record<string, unknown>) } : {};
    if (apiKey) ncbi.apiKey = encryptSecret(apiKey);
    else delete ncbi.apiKey;
    const extraSettings = JSON.stringify({ ...extra, ncbi });
    await db.siteSettings.upsert({ where: { id: "singleton" }, update: { extraSettings }, create: { id: "singleton", extraSettings } });
    return NextResponse.json(await state());
  } catch {
    // Never log the request: it carries the key.
    return NextResponse.json({ error: "The NCBI settings could not be saved." }, { status: 500 });
  }
}
