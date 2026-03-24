export const DEMO_WORKSPACE_COOKIE = "seqdesk-demo-workspace";
export const DEMO_SESSION_TTL_HOURS = 12;
export const DEMO_SEED_VERSION = 2;
export const PUBLIC_DEMO_FLAG =
  process.env.SEQDESK_ENABLE_PUBLIC_DEMO === "true" ||
  process.env.NEXT_PUBLIC_SEQDESK_ENABLE_PUBLIC_DEMO === "true";

export function isPublicDemoEnabled(): boolean {
  return PUBLIC_DEMO_FLAG;
}
