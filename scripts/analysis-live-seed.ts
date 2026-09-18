import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { db } from '../src/lib/db';
import { integrationAccount } from '../src/lib/integration/accounts';
import type { IntegrationConfig } from '../src/lib/integration/config';

async function main() {
if (!process.env.DATABASE_URL?.includes('/seqdesk_analysis_integration_')) throw new Error('Use a disposable Analysis integration database.');
const fixture = JSON.parse(await readFile('/private/tmp/analysis-live-20260915.json', 'utf8'));
const folder = '/private/tmp/analysis-live-compute';
await mkdir(folder, { recursive: true, mode: 0o700 });
const secret = randomBytes(32).toString('hex');
const config: IntegrationConfig = { installationId: 'analysis-live-compute', name: 'Live Compute test',
  collaborationOrigin: fixture.url, secret, webOrigins: ['http://127.0.0.1:5181'], accounts: [], provisionAccounts: true };
const userId = await integrationAccount(config, fixture.session);
if (!userId) throw new Error('Automatic identity provisioning failed.');
const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
if (user.systemRole !== 'MEMBER') throw new Error('New users must not become administrators.');
// The disposable test actor is promoted explicitly so the real facility
// checksum workflow can run. Production provisioning never grants this role.
await db.user.update({ where: { id: userId }, data: { systemRole: 'ADMIN', role: 'FACILITY_ADMIN', facilityWorkflowRole: 'OPERATOR' } });
const study = await db.study.create({ data: { title: 'Live integration study', userId } });
const order = await db.order.create({ data: { name: 'Live checksum order', orderNumber: `ANALYSIS-${Date.now()}`, userId } });
const file = `${folder}/reads.fastq`;
await writeFile(file, '@S1\nACGTACGT\n+\nIIIIIIII\n');
const sample = await db.sample.create({ data: { sampleId: 'S1', sampleTitle: 'Integration control', scientificName: 'Escherichia coli', studyId: study.id, orderId: order.id } });
await db.read.create({ data: { sampleId: sample.id, file1: file, dataClass: 'raw' } });
await db.pipelineConfig.upsert({ where: { pipelineId: 'fastq-checksum' }, create: { pipelineId: 'fastq-checksum', enabled: true }, update: { enabled: true } });
await writeFile(`${folder}/compute.json`, JSON.stringify(config), { mode: 0o600 });
await writeFile(`${folder}/connection.json`, JSON.stringify({ installationId: config.installationId, name: config.name, origin: 'http://127.0.0.1:3031', secret }), { mode: 0o600 });
await writeFile(`${folder}/fixture.json`, JSON.stringify({ userId, orderId: order.id, studyId: study.id }), { mode: 0o600 });
await db.$disconnect();
console.log('Disposable Compute data and account provisioned; default member role verified before test-only promotion.');

}
void main().catch(async error => { console.error(error); await db.$disconnect(); process.exitCode = 1; });
