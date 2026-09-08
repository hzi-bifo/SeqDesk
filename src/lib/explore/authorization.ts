import type { Session } from "next-auth";
import { db } from "@/lib/db";
import { decideServerCapability } from "@/lib/authorization/api";
import type { BuildContext } from "./builders/types";
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

export function requireExplorePrincipal(session: SessionLike) {
  const decision = decideServerCapability(session, "analysis.read_own");
  if (!decision.allowed || !decision.principal) {
    const status = decision.status === 200 ? 403 : decision.status;
    throw new ExploreAuthorizationError(status, status === 401 ? "Unauthorized" : status === 404 ? "Not found" : "Forbidden");
  }
  return decision.principal;
}

export function canManageExplore(session: SessionLike): boolean {
  return decideServerCapability(session, "system.pipelines.manage").allowed;
}

export function canReadAllExploreData(session: SessionLike): boolean {
  const decision = decideServerCapability(session, "analysis.read_all");
  return decision.allowed && decision.grant?.scope === "installation";
}

/** Server-derived builder identity. Call only after authorizing the target. */
export function exploreBuildContext(session: SessionLike, target: ExploreTargetKey, targetKey: string): BuildContext {
  const principal = requireExplorePrincipal(session);
  return {
    target, targetKey, userId: principal.id, installation: canReadAllExploreData(session),
    // Historical form-schema option name; this means operational field access,
    // not system-administrator status or access to private workspaces.
    isFacilityAdmin: decideServerCapability(session, "orders.process").allowed,
  };
}

/**
 * Resolve what a session may do on one Explore scope.
 *
 * Study/order access follows the same scientific-data grants as pipelines.
 * System configuration rights do not grant scientific-data access. Private
 * projects and workspaces remain owner-only, including in shared labs.
 * Unknown targets resolve to "none" so a caller can answer 404 without
 * revealing whether the id exists.
 */
export async function resolveTargetAccess(
  session: SessionLike,
  targetKey: string
): Promise<{ level: ExploreAccessLevel; target: ExploreTargetKey | null }> {
  const target = parseTargetKey(targetKey);
  if (!target) return { level: "none", target: null };
  const decision = decideServerCapability(session, "analysis.read_own");
  if (!decision.allowed || !decision.principal) return { level: "none", target };

  const userId = decision.principal.id;
  const installation = canReadAllExploreData(session);
  const level = decideServerCapability(session, "analysis.run").allowed ? "write" : "read";

  if (target.type === "study") {
    const study = await db.study.findUnique({
      where: { id: target.id },
      select: { userId: true },
    });
    if (!study) return { level: "none", target };
    return { level: installation || study.userId === userId ? level : "none", target };
  }

  if (target.type === "order") {
    const order = await db.order.findUnique({
      where: { id: target.id },
      select: { userId: true },
    });
    if (!order) return { level: "none", target };
    return { level: installation || order.userId === userId ? level : "none", target };
  }

  if (target.type === "project") {
    const project = await db.exploreProject.findUnique({ where: { id: target.id }, select: { ownerId: true } });
    if (!project) return { level: "none", target };
    return { level: project.ownerId === userId ? level : "none", target };
  }

  const workspace = await db.workbenchWorkspace.findUnique({
    where: { id: target.id },
    select: { ownerId: true },
  });
  if (!workspace) return { level: "none", target };
  return { level: workspace.ownerId === userId ? level : "none", target };
}

export async function requireTargetAccess(
  session: SessionLike,
  targetKey: string,
  level: "read" | "write"
): Promise<ExploreTargetKey> {
  requireExplorePrincipal(session);
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
 * Every scope a session can open in Explore, using the same access policy as
 * resolveTargetAccess (including owner-only projects and workspaces).
 */
export async function listExploreScopes(session: SessionLike): Promise<ExploreScope[]> {
  const decision = decideServerCapability(session, "analysis.read_own");
  if (!decision.allowed || !decision.principal) return [];
  const userId = decision.principal.id;
  const ownerFilter = canReadAllExploreData(session) ? {} : { userId };
  const access = decideServerCapability(session, "analysis.run").allowed ? "write" : "read";

  const [studies, orders, workspace, projects] = await Promise.all([
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
    db.exploreProject.findMany({
      where: { ownerId: userId },
      select: { id: true, name: true, description: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
  ]);

  const scopes: ExploreScope[] = [];
  for (const project of projects) {
    scopes.push({
      targetKey: `project:${project.id}`,
      type: "project",
      label: project.name,
      detail: project.description ?? undefined,
      access,
    });
  }
  for (const study of studies) {
    scopes.push({
      targetKey: `study:${study.id}`,
      type: "study",
      label: study.title,
      detail: study.alias ?? undefined,
      access,
    });
  }
  for (const order of orders) {
    scopes.push({
      targetKey: `order:${order.id}`,
      type: "order",
      label: order.name ?? order.orderNumber,
      detail: order.name ? order.orderNumber : undefined,
      access,
    });
  }
  if (workspace) {
    scopes.push({
      targetKey: `workspace:${workspace.id}`,
      type: "workspace",
      label: workspace.name,
      access,
    });
  }
  return scopes;
}
