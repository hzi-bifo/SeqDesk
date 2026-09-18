import type { Session } from 'next-auth';
import { db } from '@/lib/db';
import type { IntegrationConfig } from './config';
import { integrationAccount } from './accounts';

export class IntegrationAccessError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type IntegrationSession = Session & { integration: {
  authority: string; workspaceId: string; memberId: string; projectId: string;
} };

export async function integrationSession(request: Request, config: IntegrationConfig): Promise<IntegrationSession> {
  const bearer = request.headers.get('authorization');
  if (!bearer || !/^Bearer [a-f0-9]{64}$/.test(bearer)) {
    throw new IntegrationAccessError(401, 'SeqDesk access is required.');
  }
  // The browser token is an installation-specific short-lived handle. Only the
  // configured collaboration service can redeem it; redirects are forbidden.
  const response = await fetch(`${config.collaborationOrigin}/api/compute/identity`, {
    method: 'POST', redirect: 'error', cache: 'no-store',
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(10000)]),
    headers: { Authorization: `Bearer ${config.secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ installationId: config.installationId, accessToken: bearer.slice(7) }),
  });
  if (!response.ok) throw new IntegrationAccessError(response.status === 401 || response.status === 403 ? response.status : 503,
    'Could not verify collaboration access.');
  const identity = await response.json();
  if (identity.installationId !== config.installationId || typeof identity.workspaceId !== 'string' ||
    typeof identity.memberId !== 'string' || (identity.projectId !== undefined && typeof identity.projectId !== 'string') ||
    !Number.isFinite(identity.expiresAt) || identity.expiresAt <= Date.now()) {
    throw new IntegrationAccessError(401, 'Invalid collaboration identity.');
  }
  const userId = await integrationAccount(config, identity);
  if (!userId) throw new IntegrationAccessError(403, 'Your collaboration identity has no SeqDesk account mapping.');
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive || user.isDemo) throw new IntegrationAccessError(403, 'Your SeqDesk account is unavailable.');
  // Roles come from the live Compute database, never from client claims or the
  // collaboration role. Existing scientific authorization remains authoritative.
  return { integration: { authority: config.collaborationOrigin, workspaceId: identity.workspaceId,
    memberId: identity.memberId, projectId: identity.projectId || '' },
    expires: new Date(identity.expiresAt).toISOString(), user: {
    id: user.id, name: `${user.firstName} ${user.lastName}`, email: user.email,
    role: user.role, systemRole: user.systemRole, facilityWorkflowRole: user.facilityWorkflowRole,
    isDemo: false, authorizationValid: true,
  } };
}
