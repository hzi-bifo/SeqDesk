import { randomBytes, randomUUID } from 'node:crypto';
import { hash } from 'bcryptjs';
import { db } from '@/lib/db';
import type { IntegrationConfig } from './config';

type Identity = { workspaceId: string; memberId: string; displayName?: string };
async function lookup(authority: string, identity: Identity): Promise<string | null> {
  const rows = await db.$queryRaw<{ userId: string }[]>`SELECT "userId" FROM "IntegrationAccount"
    WHERE "authority"=${authority} AND "workspaceId"=${identity.workspaceId} AND "memberId"=${identity.memberId}`;
  return rows[0]?.userId ?? null;
}

/** Explicit legacy mappings take precedence. Automatic accounts are separate
 * from password users; matching an email address never links existing data. */
export async function integrationAccount(config: IntegrationConfig, identity: Identity): Promise<string | null> {
  const explicit = config.accounts.find(item => item.workspaceId === identity.workspaceId && item.memberId === identity.memberId);
  if (explicit) return explicit.userId;
  if (!config.provisionAccounts) return null;
  const existing = await lookup(config.collaborationOrigin, identity);
  if (existing) return existing;
  const password = await hash(randomBytes(48).toString('hex'), 12);
  const displayName = typeof identity.displayName === 'string' ? identity.displayName.trim().slice(0, 200) : '';
  try {
    return await db.$transaction(async tx => {
      const user = await tx.user.create({ data: {
        email: `integration-${randomUUID()}@accounts.seqdesk.invalid`, password,
        firstName: displayName || 'Research Desk user', lastName: '',
        role: 'RESEARCHER', systemRole: 'MEMBER', facilityWorkflowRole: 'REQUESTER', isActive: true, isDemo: false,
      } });
      await tx.$executeRaw`INSERT INTO "IntegrationAccount" ("id","authority","workspaceId","memberId","userId")
        VALUES (${randomUUID()},${config.collaborationOrigin},${identity.workspaceId},${identity.memberId},${user.id})`;
      return user.id;
    });
  } catch (error) {
    // Concurrent first requests can race on the unique identity. The losing
    // transaction rolls back its new user before reading the winning mapping.
    const winner = await lookup(config.collaborationOrigin, identity);
    if (winner) return winner;
    throw error;
  }
}
