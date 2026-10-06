import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('setup generates private, distinct credentials and never replaces existing credentials', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seqdesk-docker-setup-'));
  try {
    const file = join(dir, 'credentials');
    const args = [fileURLToPath(new URL('./setup.mjs', import.meta.url)), file];
    const setup = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(setup.status, 0);
    const contents = readFileSync(file, 'utf8');
    const entries = Object.fromEntries(contents.trim().split('\n').map(line => line.split('=')));
    assert.deepEqual(Object.keys(entries).sort(), [
      'SEQDESK_DOCKER_ADMIN_PASSWORD', 'SEQDESK_DOCKER_AUTH_SECRET', 'SEQDESK_DOCKER_DB_PASSWORD',
    ]);
    assert.equal(new Set(Object.values(entries)).size, 3);
    assert.match(setup.stdout, /http:\/\/localhost:8000/);
    assert.match(setup.stdout, /reviewer@example.org/);
    for (const secret of Object.values(entries)) assert.ok(!setup.stdout.includes(secret));
    for (const secret of Object.values(entries)) assert.match(secret, /^[a-f0-9]{64}$/);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.notEqual(spawnSync(process.execPath, args).status, 0);
    assert.equal(readFileSync(file, 'utf8'), contents);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('explicit login display prints only the initial administrator password and reads the current port', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seqdesk-docker-login-'));
  try {
    const file = join(dir, 'credentials');
    const setup = spawnSync(process.execPath, [fileURLToPath(new URL('./setup.mjs', import.meta.url)), file, '--show-login'], { encoding: 'utf8' });
    assert.equal(setup.status, 0);
    const entries = Object.fromEntries(readFileSync(file, 'utf8').trim().split('\n').map(line => line.split('=')));
    assert.ok(setup.stdout.includes(`Password: ${entries.SEQDESK_DOCKER_ADMIN_PASSWORD}`));
    assert.ok(!setup.stdout.includes(entries.SEQDESK_DOCKER_DB_PASSWORD));
    assert.ok(!setup.stdout.includes(entries.SEQDESK_DOCKER_AUTH_SECRET));
    appendFileSync(file, 'SEQDESK_DOCKER_PORT=8001\n');
    const login = spawnSync(process.execPath, [fileURLToPath(new URL('./login.mjs', import.meta.url)), file, '--show-password'], { encoding: 'utf8' });
    assert.equal(login.status, 0);
    assert.match(login.stdout, /http:\/\/localhost:8001/);
    assert.ok(login.stdout.includes(`Password: ${entries.SEQDESK_DOCKER_ADMIN_PASSWORD}`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
