import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@/lib/db';
import { createSession } from '@/lib/accounts/users';
import { freshDb, makeUser, connect } from '@/lib/integrations/__tests__/helpers';
import { POST as register } from '../api/auth/register/route';
import { POST as login } from '../api/auth/login/route';
import { POST as logout } from '../api/auth/logout/route';
import { GET as me } from '../api/auth/me/route';
import { GET as connections } from '../api/integrations/connections/route';
import { DELETE as disconnect } from '../api/integrations/connections/[id]/route';
import { POST as sync } from '../api/integrations/connections/[id]/sync/route';
import { POST as importFile } from '../api/imports/route';
import { POST as rows } from '../api/imports/[id]/rows/route';
import { POST as commit } from '../api/imports/[id]/commit/route';
import { GET as library } from '../api/library/route';
import { GET as cron } from '../api/integrations/cron/route';

let db: Db;
beforeAll(async () => { db = await freshDb(); });
afterAll(async () => { await db.close(); });
const request = (path: string, method = 'GET', body?: unknown, cookie = '') => new Request(`http://localhost${path}`, { method, headers: { 'x-requested-with': 'SongNexus', origin: 'http://localhost', cookie, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe('authenticated music API', () => {
  it('registers, signs in and out using protected cookies and rejects cross-site writes', async () => {
    const credentials = { username: 'ApiUser', password: 'very secure password' };
    const created = await register(request('/api/auth/register', 'POST', credentials));
    expect(created.status).toBe(201);
    const cookie = created.headers.get('set-cookie')!.split(';')[0];
    expect((await (await me(request('/api/auth/me', 'GET', undefined, cookie))).json()).user.username).toBe('ApiUser');
    expect((await register(new Request('http://localhost/api/auth/register', { method: 'POST', body: JSON.stringify(credentials) }))).status).toBe(403);
    expect((await login(request('/api/auth/login', 'POST', { ...credentials, password: 'incorrect' }))).status).toBe(401);
    expect((await login(request('/api/auth/login', 'POST', credentials))).status).toBe(200);
    expect((await logout(request('/api/auth/logout', 'POST', undefined, cookie))).status).toBe(200);
    expect((await (await me(request('/api/auth/me', 'GET', undefined, cookie))).json()).user).toBeNull();
  });
  it('hides other users’ connections from reads, sync and deletion', async () => {
    const user = await makeUser(db), other = await makeUser(db);
    const id = await connect(db, user, 'spotify', fetch);
    const cookie = `sn_session=${await createSession(db, other)}`;
    expect((await connections(request('/api/integrations/connections'))).status).toBe(401);
    expect((await (await connections(request('/api/integrations/connections', 'GET', undefined, cookie))).json()).connections).toEqual([]);
    expect((await sync(request(`/api/integrations/connections/${id}/sync`, 'POST', undefined, cookie), ctx(id))).status).toBe(404);
    expect((await disconnect(request(`/api/integrations/connections/${id}`, 'DELETE', undefined, cookie), ctx(id))).status).toBe(404);
    expect(await db.query('SELECT 1 FROM connections WHERE id = $1', [id])).toHaveLength(1);
  });
  it('imports through actual routes and exposes only committed, user-owned data', async () => {
    const user = await makeUser(db), cookie = `sn_session=${await createSession(db, user)}`;
    const created = await importFile(request('/api/imports', 'POST', { format: 'generic', filename: 'songs.csv', sha256: 'a'.repeat(64) }, cookie));
    expect(created.status).toBe(201);
    const id = (await created.json()).import.id;
    const body = { batch: 0, rows: [{ t: 'library', kind: 'track', relation: 'saved', title: 'API Song', artist: 'Band' }] };
    expect((await rows(request(`/api/imports/${id}/rows`, 'POST', body, cookie), ctx(id))).status).toBe(200);
    expect((await rows(request(`/api/imports/${id}/rows`, 'POST', body, cookie), ctx(id))).status).toBe(200);
    const read = () => library(request('/api/library?source=import:generic', 'GET', undefined, cookie));
    expect((await (await read()).json()).total).toBe(0);
    expect((await commit(request(`/api/imports/${id}/commit`, 'POST', undefined, cookie), ctx(id))).status).toBe(200);
    expect((await (await read()).json()).items[0].entity.title).toBe('API Song');
    expect((await library(request('/api/library?source=combined', 'GET', undefined, cookie))).status).toBe(403);
    expect((await cron(request('/api/integrations/cron'))).status).toBe(401);
  });
});
