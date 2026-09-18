/**
 * Named sharing: a reader who is not a member signs in on the collaboration
 * server, which hands the browser a one-minute viewer handle. This server
 * redeems it with the installation secret, checks the invitation or lab
 * membership against the report's scope, and keeps the reader in with a
 * signed cookie bound to that report.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { integrationConfig, type IntegrationConfig } from "./config";

export const VIEWER_COOKIE_HOURS = 12;

export async function redeemViewer(config: IntegrationConfig, token: string, signal?: AbortSignal): Promise<{ reportId: string; invited: boolean; workspaceIds: string[] } | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const response = await fetch(`${config.collaborationOrigin}/api/compute/viewer`, {
    method: "POST", redirect: "error", cache: "no-store",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${config.secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ installationId: config.installationId, token }),
  }).catch(() => null);
  if (!response || !response.ok) return null;
  const value = await response.json().catch(() => null) as { installationId?: unknown; reportId?: unknown; invited?: unknown; workspaceIds?: unknown } | null;
  if (!value || value.installationId !== config.installationId || typeof value.reportId !== "string" || typeof value.invited !== "boolean" || !Array.isArray(value.workspaceIds)) return null;
  return { reportId: value.reportId, invited: value.invited, workspaceIds: value.workspaceIds.filter((id): id is string => typeof id === "string") };
}

/** Whether a viewer may read the report: invited to it, or a member of a lab the report's scope is linked to. */
export async function viewerAllowed(config: IntegrationConfig, viewer: { reportId: string; invited: boolean; workspaceIds: string[] }, report: { id: string; targetKey: string }): Promise<boolean> {
  if (viewer.reportId !== report.id) return false;
  if (viewer.invited) return true;
  if (!viewer.workspaceIds.length) return false;
  const link = await db.integrationExploreScope.findFirst({ where: { authority: config.collaborationOrigin, targetKey: report.targetKey, workspaceId: { in: viewer.workspaceIds } }, select: { id: true } });
  return Boolean(link);
}

const cookieName = (reportId: string) => `seqdesk_report_${reportId}`;
function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}
/** A cookie that keeps an admitted reader in for a while, bound to one report and this installation's secret. */
export function viewerCookie(config: IntegrationConfig, reportId: string): { name: string; value: string; maxAge: number } {
  const expires = Date.now() + VIEWER_COOKIE_HOURS * 3600 * 1000;
  const payload = `${reportId}.${expires}`;
  return { name: cookieName(reportId), value: `${payload}.${sign(config.secret, payload)}`, maxAge: VIEWER_COOKIE_HOURS * 3600 };
}
export function viewerCookieValid(config: IntegrationConfig, reportId: string, value: string | undefined): boolean {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== reportId) return false;
  const expires = Number(parts[1]);
  if (!Number.isFinite(expires) || expires <= Date.now()) return false;
  const expected = sign(config.secret, `${parts[0]}.${parts[1]}`);
  return expected.length === parts[2].length && timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]));
}
export const viewerCookieName = cookieName;
export { integrationConfig };
