// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MusicAccounts from '../components/MusicAccounts';
import { accountApi } from '../accounts-api';
import { parseRoute, buildPath, comparisonFor } from '../routing';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
let signedIn = false, linked = false, failure = false;
const calls: { path: string; method: string; body: Record<string, unknown> }[] = [];
const provider = { id: 'listenbrainz', name: 'ListenBrainz', auth: 'token', availability: 'available', availabilityNote: 'Link your own user token.', capabilities: { recent_history: { supported: true, note: 'Recent submitted listens only.' } }, policy: { attribution: 'From ListenBrainz', termsUrl: 'https://listenbrainz.org/terms-of-service/', rules: ['Open listening data.'] }, tokenHelp: { label: 'ListenBrainz user token', url: 'https://listenbrainz.org/settings/' }, importFormats: [] };
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = String(input), method = init?.method || 'GET', body = JSON.parse(String(init?.body || '{}'));
  calls.push({ path, method, body });
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
  if (failure) return reply({ error: 'Please sign in again.' }, 401);
  if (path === '/api/auth/me') return reply({ available: true, user: signedIn ? { id: 'u1', username: 'Ada' } : null, consents: [] });
  if (path === '/api/integrations/providers') return reply({ accounts: true, providers: [provider, { ...provider, id: 'amazon-music', name: 'Amazon Music', availability: 'partner_access_required', availabilityNote: 'Requires partner approval.' }], scheduler: { note: 'Background checks follow provider limits.' } });
  if (path === '/api/auth/login' || path === '/api/auth/register') { signedIn = true; return reply({ user: { id: 'u1', username: 'Ada' } }); }
  if (path === '/api/auth/logout') { signedIn = false; return reply({ ok: true }); }
  if (path === '/api/integrations/connections') return reply({ connections: linked ? [{ id: 'c1', provider: 'listenbrainz', displayName: 'AdaLB', status: 'connected', capabilities: provider.capabilities, scopes: [], lastSuccessAt: null, resources: [], job: null }] : [] });
  if (path === '/api/library/overview') return reply({ coverage: [], imports: [], consents: [] });
  if (path === '/api/integrations/listenbrainz/connect') { linked = true; return reply({ connection: { id: 'c1' } }, 201); }
  if (path === '/api/integrations/connections/c1' && method === 'DELETE') { linked = false; return reply({ ok: true }); }
  if (path.endsWith('/sync')) return reply({ job: { id: 'j1' } }, 202);
  return reply({ error: 'Unexpected request' }, 404);
});
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); };
const click = async (text: string) => {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === text);
  expect(button, `button ${text}`).toBeTruthy();
  await act(async () => { button!.click(); }); await settle();
};
const fill = (name: string, value: string) => { host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!.value = value; };
const submit = async (form: HTMLFormElement) => { await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await settle(); };
beforeEach(async () => {
  signedIn = false; linked = false; failure = false; calls.length = 0;
  vi.stubGlobal('fetch', fetchMock); window.history.replaceState(null, '', '/accounts');
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root.render(<MusicAccounts />)); await settle();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe('Connected Music Accounts browser workflows', () => {
  it('routes accounts deep links', () => {
    expect(parseRoute('/accounts', '?connected=spotify').page).toBe('accounts');
    expect(buildPath('accounts', comparisonFor('artist'))).toBe('/accounts');
  });
  it('signs in, connects with a token, queues sync, confirms disconnect, and signs out', async () => {
    fill('username', 'Ada'); fill('password', 'secure password'); await submit(host.querySelector('form')!);
    expect(host.textContent).toContain('Signed in as Ada');
    expect([...host.querySelectorAll('button')].filter(b => b.textContent?.trim() === 'Connect')).toHaveLength(1);
    await click('Connect'); fill('token', 'listenbrainz-user-token'); await submit(host.querySelector('form')!);
    expect(host.textContent).toContain('AdaLB');
    expect(calls.find(c => c.path.endsWith('/connect'))?.body).toEqual({ token: 'listenbrainz-user-token' });
    expect(localStorage.getItem('listenbrainz-user-token')).toBeNull();
    await click('Sync Now'); expect(calls.some(c => c.path.endsWith('/sync') && c.method === 'POST')).toBe(true);
    await click('Disconnect'); expect(host.querySelector('[role="alertdialog"]')).toBeTruthy();
    await click('Disconnect and delete data'); expect(host.textContent).not.toContain('AdaLB');
    await click('Sign out'); expect(host.textContent).toContain('Sign in to Song Nexus');
  });
  it('adds CSRF headers and displays rejected requests', async () => {
    failure = true;
    await expect(accountApi('/api/auth/login', 'POST', { username: 'Ada' })).rejects.toMatchObject({ status: 401 });
    expect(fetchMock.mock.calls.at(-1)?.[1]?.headers).toMatchObject({ 'x-requested-with': 'SongNexus' });
    fill('username', 'Ada'); fill('password', 'wrong password'); await submit(host.querySelector('form')!);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Please sign in again.');
  });
});
