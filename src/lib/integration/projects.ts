import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { decideCapability } from '@/lib/authorization';
import { getServerDeploymentProfile } from '@/lib/deployment-profile/server';
import { IntegrationAccessError, type IntegrationSession } from './identity';

export async function projectTargetIDs(session: IntegrationSession, kind: 'study' | 'order'): Promise<string[] | null> {
  const context = session.integration;
  if (!context?.projectId) return null;
  const rows = await db.$queryRaw<{ targetId: string }[]>`SELECT "targetId" FROM "IntegrationProjectLink"
    WHERE "authority"=${context.authority} AND "workspaceId"=${context.workspaceId} AND "projectId"=${context.projectId} AND "targetKind"=${kind}`;
  return rows.map(row => row.targetId);
}
export async function assertProjectRun(session: IntegrationSession, runId: string): Promise<void> {
  if (!session.integration?.projectId) return;
  const run = await db.pipelineRun.findUnique({ where: { id: runId }, select: { studyId: true, orderId: true } });
  if (!run) throw new IntegrationAccessError(404, 'Run not found in this project.');
  const kind = run.orderId ? 'order' : 'study';
  const ids = await projectTargetIDs(session, kind);
  if (!ids?.includes((run.orderId || run.studyId)!)) throw new IntegrationAccessError(404, 'Run not found in this project.');
}
export async function assertProjectTarget(session: IntegrationSession, kind: 'study' | 'order', id: string): Promise<void> {
  const ids = await projectTargetIDs(session, kind);
  if (ids !== null && !ids.includes(id)) throw new IntegrationAccessError(404, 'This data is not linked to the selected project.');
}
export async function changeProjectLink(session: IntegrationSession, value: unknown): Promise<void> {
  const context = session.integration;
  if (!context?.projectId) throw new IntegrationAccessError(400, 'Select a team project first.');
  const body = value as { kind?: unknown; id?: unknown; linked?: unknown } | null;
  if (!body || (body.kind !== 'study' && body.kind !== 'order') || typeof body.id !== 'string' || !body.id || typeof body.linked !== 'boolean') {
    throw new IntegrationAccessError(400, 'Invalid project link.');
  }
  const kind = body.kind as 'study' | 'order';
  const prefix = kind === 'study' ? 'studies' : 'orders';
  const profile = getServerDeploymentProfile();
  const all = decideCapability(session, `${prefix}.read_all`, profile);
  const own = decideCapability(session, `${prefix}.read`, profile);
  const grant = all.allowed ? all.grant : own.grant;
  if (!grant) throw new IntegrationAccessError(403, 'Scientific data access is required.');
  const where = { id: body.id, ...(grant.scope === 'installation' ? {} : { userId: session.user.id }) };
  const target = kind === 'study' ? await db.study.findFirst({ where, select: { id: true } }) : await db.order.findFirst({ where, select: { id: true } });
  if (!target) throw new IntegrationAccessError(404, 'Scientific data not found.');
  if (body.linked) {
    await db.$executeRaw`INSERT INTO "IntegrationProjectLink" ("id","authority","workspaceId","projectId","targetKind","targetId","createdBy")
      VALUES (${randomUUID()},${context.authority},${context.workspaceId},${context.projectId},${kind},${body.id},${session.user.id})
      ON CONFLICT ("authority","workspaceId","projectId","targetKind","targetId") DO NOTHING`;
  } else {
    await db.$executeRaw`DELETE FROM "IntegrationProjectLink" WHERE "authority"=${context.authority}
      AND "workspaceId"=${context.workspaceId} AND "projectId"=${context.projectId} AND "targetKind"=${kind} AND "targetId"=${body.id}`;
  }
}
