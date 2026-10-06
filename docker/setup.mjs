import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { printLogin } from './login.mjs';

const secret = () => randomBytes(32).toString('hex');
const args = process.argv.slice(2);
const file = args.find(arg => arg !== '--show-login') ?? '.env.docker';
// Refuse to replace credentials of an existing persistent database.
writeFileSync(file, [
  `SEQDESK_DOCKER_DB_PASSWORD=${secret()}`,
  `SEQDESK_DOCKER_AUTH_SECRET=${secret()}`,
  `SEQDESK_DOCKER_ADMIN_PASSWORD=${secret()}`,
  '',
].join('\n'), { mode: 0o600, flag: 'wx' });
console.log(`Created ${file}. Keep this file: it stores your installation credentials.`);
printLogin(file, { showPassword: args.includes('--show-login') });
