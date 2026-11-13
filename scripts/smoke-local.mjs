// Real HTTP smoke test. Creates and deletes its own temporary user; never connects a provider.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

const origin = new URL(process.argv[2] || 'http://127.0.0.1:3000');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('This smoke test is limited to a local server.');
const password = randomBytes(24).toString('base64url');
const username = `smoke-${randomBytes(8).toString('hex')}`;
let cookie = '';
const call = async (path, method = 'GET', body, expected = 200) => {
  const response = await fetch(new URL(path, origin), {
    method, headers: { cookie, origin: origin.origin, 'x-requested-with': 'SongNexus', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(response.status, expected, `${method} ${path} status`);
  const data = await response.json();
  return { response, data };
};

for (const path of ['/accounts', '/privacy']) {
  assert.equal((await fetch(new URL(path, origin))).status, 200, `${path} loads`);
}
const providers = (await call('/api/integrations/providers')).data;
assert.equal(providers.providers.length, 10);
assert.equal((await call('/api/auth/me')).data.user, null);
await call('/api/integrations/connections', 'GET', undefined, 401);
try {
  const registered = await call('/api/auth/register', 'POST', { username, password }, 201);
  cookie = registered.response.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('/api/auth/me')).data.user.username, username);
  const created = await call('/api/imports', 'POST', { format: 'generic', filename: 'smoke.json', sha256: createHash('sha256').update(username).digest('hex') }, 201);
  const id = created.data.import.id;
  const batch = { batch: 0, rows: [{ t: 'library', kind: 'track', relation: 'saved', title: 'Readiness smoke song', artist: 'Smoke artist' }] };
  await call(`/api/imports/${id}/rows`, 'POST', batch);
  await call(`/api/imports/${id}/rows`, 'POST', batch);
  assert.equal((await call('/api/library?source=import:generic')).data.total, 0);
  await call(`/api/imports/${id}/commit`, 'POST');
  assert.equal((await call('/api/library?source=import:generic')).data.total, 1);
  await call('/api/library?source=combined', 'GET', undefined, 403);
  await call('/api/auth/consents', 'PUT', { kind: 'combine_sources', granted: true });
  assert.equal((await call('/api/library/discovery')).data.songs[0].title, 'Readiness smoke song');
  await call(`/api/imports/${id}`, 'DELETE');
  assert.equal((await call('/api/library?source=import:generic')).data.total, 0);
  console.log('HTTP smoke passed: pages, registration, sessions, ownership gates, import staging/commit/retry/deletion, consent and discovery.');
} finally {
  if (cookie) {
    await call('/api/auth/me', 'DELETE', { password });
    console.log('Temporary smoke account and its data deleted.');
  }
}
