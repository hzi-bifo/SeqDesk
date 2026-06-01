import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { updateAdminActivityJob } from "@/lib/admin/activity";
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
  if (readString(body.profileRegistryUrl)) {
    return NextResponse.json(
      {
        error:
          "Hosted profile registry override is not accepted from the browser; configure SEQDESK_PROFILE_REGISTRY_URL on the server.",
      },
      { status: 400 }
    );
  }

  const jobId = `install-profile-reload:${profileId}`;
  await updateAdminActivityJob(jobId, {
    type: "install-profile-reload",
    label: `Reload hosted profile ${profileId}`,
    state: "running",
    phase: body.includeAssets === true ? "applying-settings-and-assets" : "applying-settings",
  });

  try {
    const result = await reloadHostedInstallProfile({
      profileId,
      profileCode: readString(body.profileCode),
      includeAssets: body.includeAssets === true,
    });
    await updateAdminActivityJob(jobId, {
      type: "install-profile-reload",
      label: `Reload hosted profile ${profileId}`,
      state: "success",
      phase: result.includeAssets ? "settings-and-assets-applied" : "settings-applied",
      finishedAt: new Date().toISOString(),
      logExcerpt: [
        `Applied hosted profile ${result.profile.id || profileId}`,
        ...result.validation.warnings,
      ],
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to reload hosted profile";
    // A concurrent reload of the same profile fails fast on the shared lock.
    // The running reload owns this profile's activity job, so the losing
    // request must not clobber its status to "error" (or its own earlier
    // "running" write). Reject with 409 and leave the running job untouched.
    if (message.includes("already running")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    await updateAdminActivityJob(jobId, {
      type: "install-profile-reload",
      label: `Reload hosted profile ${profileId}`,
      state: "error",
      phase: "failed",
      error: message,
      finishedAt: new Date().toISOString(),
      logExcerpt: [message],
    });
    const status =
      message.includes("Profile access code is required") ||
      message.includes("Profile id is required") ||
      message.includes("Invalid hosted profile registry URL") ||
      message.includes("Hosted profile registry") ||
      message.includes("profile id mismatch") ||
      message.includes("requires SeqDesk") ||
      message.includes("must be a JSON object")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
