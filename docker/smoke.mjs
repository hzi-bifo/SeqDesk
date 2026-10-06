import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const cookies = new Map();
async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:3000${path}`, {
    ...options, redirect: 'manual',
    headers: { ...options.headers, Cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join('; ') },
  });
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';')[0];
    const index = pair.indexOf('=');
    cookies.set(pair.slice(0, index), pair.slice(index + 1));
  }
  return response;
}
try {
  const csrfResponse = await request('/api/auth/csrf');
  assert.equal(csrfResponse.status, 200);
  const { csrfToken } = await csrfResponse.json();
  assert.ok(csrfToken);
  await request('/api/auth/callback/credentials', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken, email: process.env.SEQDESK_BOOTSTRAP_ADMIN_EMAIL,
      password: process.env.SEQDESK_BOOTSTRAP_ADMIN_PASSWORD, callbackUrl: '/', json: 'true' }),
  });
  const session = await (await request('/api/auth/session')).json();
  assert.equal(session.user?.email, process.env.SEQDESK_BOOTSTRAP_ADMIN_EMAIL, 'Real administrator login must succeed');
  const orders = await request('/api/orders');
  assert.equal(orders.status, 200, 'Authenticated orders API must work');
  assert.equal(await db.user.count(), 1, 'Only the requested administrator should exist');
  const user = await db.user.findUniqueOrThrow({ where: { email: session.user.email } });
  const state = JSON.stringify({ id: user.id, password: user.password });
  if (process.argv[2] === 'after') {
    assert.equal(await readFile('/storage/reviewer-smoke.json', 'utf8'), state,
      'Database identity, password, and storage must survive container recreation');
  } else {
    await writeFile('/storage/reviewer-smoke.json', state, { mode: 0o600 });
  }
  console.log('PASS: real login, authenticated orders, bootstrap account, database and storage persistence');
} finally {
  await db.$disconnect();
}
