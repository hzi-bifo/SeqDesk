/** Opt-in integration check; only accepts a disposable integration database. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { integrationAccount } from '../src/lib/integration/accounts';
import { projectTargetIDs } from '../src/lib/integration/projects';
import type { IntegrationSession } from '../src/lib/integration/identity';

async function main() {
  const url = new URL(process.env.DATABASE_URL || '');
  assert.match(url.pathname, /^\/seqdesk_analysis_integration_/);
  const workspaceId = randomUUID(), memberId = randomUUID();
  const config = { installationId:'database-check', name:'Database check', collaborationOrigin:'https://analysis-check.invalid',
    secret:'x'.repeat(64), webOrigins:['https://web.analysis-check.invalid'], accounts:[], provisionAccounts:true };
  let userId: string | null = null;
  try {
    const ids = await Promise.all(Array.from({length:8}, () => integrationAccount(config, {workspaceId,memberId})));
    assert.equal(new Set(ids).size, 1); userId = ids[0]; assert.ok(userId);
    const users = await db.user.findMany({where:{id:userId},select:{systemRole:true,facilityWorkflowRole:true}});
    assert.deepEqual(users, [{systemRole:'MEMBER',facilityWorkflowRole:'REQUESTER'}]);
    const mappings = await db.$queryRaw<Array<{userId:string}>>`SELECT "userId" FROM "IntegrationAccount" WHERE "workspaceId"=${workspaceId}`;
    assert.equal(mappings.length,1);
    const projectId=randomUUID(), targetId=randomUUID(), linkId=randomUUID();
    await db.$executeRaw`INSERT INTO "IntegrationProjectLink" ("id","authority","workspaceId","projectId","targetKind","targetId","createdBy") VALUES (${linkId},${config.collaborationOrigin},${workspaceId},${projectId},'study',${targetId},${userId})`;
    const session = {integration:{authority:config.collaborationOrigin,workspaceId,memberId,projectId}} as IntegrationSession;
    assert.deepEqual(await projectTargetIDs(session,'study'),[targetId]);
    assert.deepEqual(await projectTargetIDs(session,'order'),[]);
    assert.deepEqual(await projectTargetIDs({...session,integration:{...session.integration,workspaceId:'another-team'}},'study'),[]);
    assert.deepEqual(await projectTargetIDs({...session,integration:{...session.integration,projectId:'another-project'}},'study'),[]);
    console.log('PASS: eight concurrent identity requests resolve one MEMBER/REQUESTER account; real database project/team/target isolation.');
  } finally {
    await db.$executeRaw`DELETE FROM "IntegrationProjectLink" WHERE "workspaceId"=${workspaceId}`;
    const mappings = await db.$queryRaw<Array<{userId:string}>>`SELECT "userId" FROM "IntegrationAccount" WHERE "workspaceId"=${workspaceId}`;
    if (mappings.length) await db.user.deleteMany({where:{id:{in:mappings.map(row=>row.userId)}}});
    await db.$disconnect();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
