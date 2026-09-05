import type { Session } from "next-auth";
import { db } from "@/lib/db";
import { parseTargetKey, type ExploreTargetKey } from "./target-key";
import type { ExploreScope } from "./types";

export type ExploreAccessLevel = "none" | "read" | "write";

export class ExploreAuthorizationError extends Error {
  status: 401 | 403 | 404;

  constructor(status: 401 | 403 | 404, message: string) {
    super(message);
    this.name = "ExploreAuthorizationError";
    this.status = status;
  }
}

export type SessionLike = Pick<Session, "user"> | null | undefined;

export function isFacilityAdminSession(session: SessionLike): boolean {
  return session?.user?.role === "FACILITY_ADMIN";
}

/**
 * Resolve what a session may do on one Explore scope.
 *
 * Facility admins may read and write every scope. Everyone else may read and
 * write the studies and orders they own and their own workbench workspace.
 * Unknown targets resolve to "none" so a caller can answer 404 without
 * revealing whether the id exists.
 */
export async function resolveTargetAccess(
  session: SessionLike,
  targetKey: string
): Promise<{ level: ExploreAccessLevel; target: ExploreTargetKey | null }> {
  const target = parseTargetKey(targetKey);
  if (!target) return { level: "none", target: null };
  if (!session?.user?.id) return { level: "none", target };

  const userId = session.user.id;
  const admin = isFacilityAdminSession(session);

  if (target.type === "study") {
    const study = await db.study.findUnique({
      where: { id: target.id },
      select: { userId: true },
    });
    if (!study) return { level: "none", target };
    return { level: admin || study.userId === userId ? "write" : "none", target };
  }

  if (target.type === "order") {
    const order = await db.order.findUnique({
      where: { id: target.id },
      select: { userId: true },
    });
    if (!order) return { level: "none", target };
    return { level: admin || order.userId === userId ? "write" : "none", target };
  }

  const workspace = await db.workbenchWorkspace.findUnique({
    where: { id: target.id },
    select: { ownerId: true },
  });
  if (!workspace) return { level: "none", target };
  return { level: admin || workspace.ownerId === userId ? "write" : "none", target };
}

export async function requireTargetAccess(
  session: SessionLike,
  targetKey: string,
  level: "read" | "write"
): Promise<ExploreTargetKey> {
  if (!session?.user?.id) {
    throw new ExploreAuthorizationError(401, "Unauthorized");
  }
  const access = await resolveTargetAccess(session, targetKey);
  if (!access.target || access.level === "none") {
    throw new ExploreAuthorizationError(404, "Not found");
  }
  if (level === "write" && access.level !== "write") {
    throw new ExploreAuthorizationError(403, "Forbidden");
  }
  return access.target;
}

/**
 * Every scope a session can open in Explore: studies and orders the user owns
 * (all of them for facility admins) plus the user's workbench workspace.
 */
export async function listExploreScopes(session: SessionLike): Promise<ExploreScope[]> {
  if (!session?.user?.id) return [];
  const userId = session.user.id;
  const admin = isFacilityAdminSession(session);
  const ownerFilter = admin ? {} : { userId };

  const [studies, orders, workspace] = await Promise.all([
    db.study.findMany({
      where: ownerFilter,
      select: { id: true, title: true, alias: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    db.order.findMany({
      where: ownerFilter,
      select: { id: true, orderNumber: true, name: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    db.workbenchWorkspace.findUnique({
      where: { ownerId: userId },
      select: { id: true, name: true },
    }),
  ]);

  const scopes: ExploreScope[] = [];
  for (const study of studies) {
    scopes.push({
      targetKey: `study:${study.id}`,
      type: "study",
      label: study.title,
      detail: study.alias ?? undefined,
      access: "write",
    });
  }
  for (const order of orders) {
    scopes.push({
      targetKey: `order:${order.id}`,
      type: "order",
      label: order.name ?? order.orderNumber,
      detail: order.name ? order.orderNumber : undefined,
      access: "write",
    });
  }
  if (workspace) {
    scopes.push({
      targetKey: `workspace:${workspace.id}`,
      type: "workspace",
      label: workspace.name,
      access: "write",
    });
  }
  return scopes;
}
