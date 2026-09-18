#!/usr/bin/env node
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  origin: { type: 'string' }, collaboration: { type: 'string' }, web: { type: 'string', multiple: true },
  name: { type: 'string', default: 'SeqDesk Compute' }, output: { type: 'string' },
  accounts: { type: 'string' }, help: { type: 'boolean' },
} });
function origin(raw) {
  const value = new URL(raw);
  if (value.username || value.password || value.search || value.hash || value.pathname !== '/' ||
    (value.protocol !== 'https:' && !(value.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(value.hostname)))) {
    throw new Error('Use HTTPS origins without paths or credentials; HTTP is allowed only on loopback.');
  }
  return value.origin;
}
async function main() {
  if (values.help) {
    console.log('node scripts/configure-analysis.mjs --origin https://compute.example --collaboration https://collaboration.example --web https://desk.example --output /secure/seqdesk-integration [--accounts /secure/account-mappings.json]');
    return;
  }
  if (!values.origin || !values.collaboration || !values.web?.length || !values.output) throw new Error('Provide --origin, --collaboration, --web and --output. Use --help for an example.');
  const accounts = values.accounts ? JSON.parse(await readFile(values.accounts, 'utf8')) : [];
  if (!Array.isArray(accounts) || !accounts.every(account => account &&
    typeof account.workspaceId === 'string' && account.workspaceId && typeof account.memberId === 'string' && account.memberId &&
    typeof account.userId === 'string' && account.userId)) throw new Error('The accounts file must contain workspaceId, memberId and userId mappings.');
  const directory = resolve(values.output);
  const installationId = randomUUID(), secret = randomBytes(32).toString('hex');
  const config = { installationId, name: values.name, collaborationOrigin: origin(values.collaboration), secret,
    webOrigins: values.web.map(origin), accounts, provisionAccounts: true };
  const pairing = { installationId, name: values.name, origin: origin(values.origin), secret };
  await mkdir(directory, { mode: 0o700 }); // Existing installations must not be overwritten.
  await writeFile(resolve(directory, 'compute.json'), JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await writeFile(resolve(directory, 'connection.json'), JSON.stringify(pairing, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  console.log(`Set SEQDESK_INTEGRATION_CONFIG_FILE to ${resolve(directory, 'compute.json')} and restart SeqDesk.\nIn the Web app, open Analysis → Connect server and paste ${resolve(directory, 'connection.json')}.\nKeep both files private. Existing Compute account mappings belong in compute.json.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
