import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { checkDatabaseStatus } from "@/lib/db-status";
import { readInstallProfileFromConfig } from "@/lib/setup-status";
import {
  defaultProfileRegistryUrl,
  profileCodeEnvName,
  reloadHostedInstallProfile,
  resolveProfileCodeFromEnv,
} from "@/lib/install-profile/reload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  return Boolean(session && session.user.role === "FACILITY_ADMIN");
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function getAppliedProfile() {
  const databaseStatus = await checkDatabaseStatus().catch(() => null);
  return databaseStatus?.installProfile || readInstallProfileFromConfig();
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await getAppliedProfile();
  const profileId = readString(profile?.id);
  const codeEnvName = profileId ? profileCodeEnvName(profileId) : null;

  return NextResponse.json({
    profile: profile || null,
    profileRegistryUrl: defaultProfileRegistryUrl(),
    profileCodeEnvName: codeEnvName,
    profileCodeEnvAvailable: profileId
      ? Boolean(resolveProfileCodeFromEnv(profileId))
      : false,
  });
}

export async function POST(request: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const appliedProfile = await getAppliedProfile();
  const profileId = readString(body.profileId) || readString(appliedProfile?.id);
  if (!profileId) {
    return NextResponse.json(
      { error: "No hosted install profile is recorded for this installation" },
      { status: 400 }
    );
  }

  try {
    const result = await reloadHostedInstallProfile({
      profileId,
      profileCode: readString(body.profileCode),
      profileRegistryUrl: readString(body.profileRegistryUrl),
      includeAssets: body.includeAssets === true,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to reload hosted profile";
    const status =
      message.includes("Profile access code is required") ||
      message.includes("Profile id is required") ||
      message.includes("Invalid hosted profile registry URL")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
