import { resolveDeploymentProfile } from "@/lib/deployment-profile";

export type SeqDeskAppSurface = "lab" | "workbench";

function normalizeSurface(value: string | undefined): SeqDeskAppSurface | null {
  if (value === "lab" || value === "workbench") {
    return value;
  }

  return null;
}

export function getSeqDeskAppSurface(): SeqDeskAppSurface {
  const legacySurface =
    normalizeSurface(process.env.NEXT_PUBLIC_SEQDESK_APP_SURFACE) ??
    normalizeSurface(process.env.SEQDESK_APP_SURFACE);
  const profile = resolveDeploymentProfile({
    configuredProfile:
      process.env.NEXT_PUBLIC_SEQDESK_DEPLOYMENT_PROFILE ??
      process.env.SEQDESK_DEPLOYMENT_PROFILE,
    legacyPublicSurface: legacySurface,
    legacyWorkbenchOnly: process.env.NEXT_PUBLIC_SEQDESK_WORKBENCH_ONLY,
  });

  return profile.experience === "workbench" ? "workbench" : "lab";
}

export function isWorkbenchAppSurface(): boolean {
  return getSeqDeskAppSurface() === "workbench";
}

export function isLabAppSurface(): boolean {
  return getSeqDeskAppSurface() === "lab";
}
