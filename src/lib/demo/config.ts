export const DEMO_WORKSPACE_COOKIE = "seqdesk-demo-workspace";
// Demo workspaces expire this many hours after their last activity; each visit
// refreshes the window. Expired workspaces are reaped by the /api/demo/cleanup
// cron and lazily on next access.
export const DEMO_SESSION_TTL_HOURS = 6;
export const DEMO_SEED_VERSION = 5;
export const PUBLIC_DEMO_FLAG =
  process.env.SEQDESK_ENABLE_PUBLIC_DEMO === "true" ||
  process.env.NEXT_PUBLIC_SEQDESK_ENABLE_PUBLIC_DEMO === "true";

export function isPublicDemoEnabled(): boolean {
  return PUBLIC_DEMO_FLAG;
}
