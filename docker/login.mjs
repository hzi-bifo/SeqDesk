import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

export function printLogin(file, { showPassword = false } = {}) {
  const env = parseEnv(readFileSync(file, 'utf8'));
  if (!env.SEQDESK_DOCKER_ADMIN_PASSWORD) {
    throw new Error(`No initial administrator password found in ${file}`);
  }
  const port = env.SEQDESK_DOCKER_PORT || '8000';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('SEQDESK_DOCKER_PORT must be a port from 1 to 65535');
  }
  console.log('\nSeqDesk Docker login');
  console.log(`Open:     http://localhost:${port}`);
  console.log('Email:    reviewer@example.org');
  console.log(showPassword
    ? `Password: ${env.SEQDESK_DOCKER_ADMIN_PASSWORD}`
    : `Password: saved in ${file} as SEQDESK_DOCKER_ADMIN_PASSWORD`);
  console.log('This is the initial password. Existing accounts keep their current password.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  printLogin(args.find(arg => arg !== '--show-password') ?? '.env.docker', {
    showPassword: args.includes('--show-password'),
  });
}
