'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowUpRight, Link2, RefreshCw, ShieldCheck, Upload } from 'lucide-react';
import type { ConnectionView, ImportView, LibraryItem, NowPlayingView, PlaylistTrack, PlaylistView, PlayView, ProviderDescriptor, SourceCoverage } from '@/lib/integrations/types';
import { IMPORT_FORMATS, parseImport, summarize } from '@/lib/integrations/import-formats';
import type { ParsedImport } from '@/lib/integrations/import-formats';
import { accountApi, authorizeAppleMusic } from '../accounts-api';
import { storePlaylist } from '../taste';

type Session = { available: boolean; user: { id: string; username: string } | null; consents: string[] };
type Providers = { accounts: boolean; providers: ProviderDescriptor[]; scheduler: { note: string } };
type Overview = { coverage: SourceCoverage[]; imports: ImportView[]; consents: string[]; nowPlaying?: NowPlayingView[] };
const date = (value: string | null) => value ? new Date(value).toLocaleString() : 'Not yet';
const label = (text: string) => text.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
const statuses: Record<string, string> = { connected: 'Connected', syncing: 'Syncing', partial_access: 'Partial Access', reauth_required: 'Reauthorization Required', error: 'Sync Error', available: 'Ready to connect', not_configured: 'Setup Required', import_only: 'Import Only', partner_access_required: 'Partner Access Required', native_only: 'Native Only', unsupported: 'Unsupported' };

export default function MusicAccounts({ onDiscovery }: { onDiscovery?: () => void } = {}) {
  const [session, setSession] = useState<Session>();
  const [providers, setProviders] = useState<Providers>();
  const [connections, setConnections] = useState<ConnectionView[]>([]);
  const [overview, setOverview] = useState<Overview>({ coverage: [], imports: [], consents: [] });
  const [error, setError] = useState(() => typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('error') || '');
  const [notice, setNotice] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('connected') ? 'Account connected. The initial sync has been queued.' : '');
  const [busy, setBusy] = useState('');
  const [register, setRegister] = useState(false);
  const [tokenFor, setTokenFor] = useState<ProviderDescriptor>();
  const [confirm, setConfirm] = useState<ConnectionView>();
  const [deleteAccount, setDeleteAccount] = useState(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const [next, catalog] = await Promise.all([accountApi<Session>('/api/auth/me', 'GET', undefined, signal), accountApi<Providers>('/api/integrations/providers', 'GET', undefined, signal)]);
    setSession(next); setProviders(catalog);
    if (next.user) {
      const [linked, library] = await Promise.all([accountApi<{ connections: ConnectionView[] }>('/api/integrations/connections', 'GET', undefined, signal), accountApi<Overview>('/api/library/overview', 'GET', undefined, signal)]);
      setConnections(linked.connections); setOverview(library);
    } else { setConnections([]); setOverview({ coverage: [], imports: [], consents: [] }); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => refresh(controller.signal)).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    const q = new URLSearchParams(window.location.search);
    if (q.has('error') || q.has('connected')) window.history.replaceState(null, '', '/accounts');
    return () => controller.abort();
  }, [refresh]);
  const userId = session?.user?.id;
  useEffect(() => {
    if (!userId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => { if (!timer) timer = setTimeout(() => { timer = undefined; void refresh().catch(e => setError(e.message)); }, 500); };
    const stream = typeof EventSource !== 'undefined' ? new EventSource('/api/integrations/events') : null;
    for (const name of ['sync', 'connection', 'library', 'import']) stream?.addEventListener(name, update);
    const fallback = setInterval(update, 30_000);
    return () => { stream?.close(); clearInterval(fallback); clearTimeout(timer); };
  }, [userId, refresh]);
  const act = async (key: string, work: () => Promise<void>) => {
    if (busy) return;
    setBusy(key); setError(''); setNotice('');
    try { await work(); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Please try again.'); } finally { setBusy(''); }
  };
  const signIn = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void act('auth', async () => { await accountApi(`/api/auth/${register ? 'register' : 'login'}`, 'POST', { username: data.get('username'), password: data.get('password') }); });
  };
  const connect = (provider: ProviderDescriptor, token?: string) => act(provider.id, async () => {
    const body = provider.auth === 'musickit' ? { musicUserToken: await authorizeAppleMusic() } : { token };
    const result = await accountApi<{ authorizeUrl?: string }>(`/api/integrations/${provider.id}/connect`, 'POST', body);
    if (result.authorizeUrl) { window.location.assign(result.authorizeUrl); return; }
    setTokenFor(undefined); setNotice(`${provider.name} connected. Initial sync queued.`);
  });
  return <div className="music-accounts">
    <div className="page-heading"><div><h1>Connected Music Accounts</h1><p>Your music, with clear permissions and a source for every song.</p></div><ShieldCheck size={30} /></div>
    {error && <div className="account-message error-text" role="alert">{error}<button className="inline-link" onClick={() => void act('retry', () => refresh())}>Retry</button></div>}
    {notice && <p className="account-message" role="status">{notice}</p>}
    <p className="account-muted"><a href="/privacy">Music account privacy and deletion controls</a></p>
    {!session ? <p role="status">Loading your accounts…</p> : !session.available ? <section className="panel account-section"><h2>Accounts need server setup</h2><p>The operator must configure a database before accounts can be used.</p></section> : !session.user ? <section className="panel account-section account-signin"><h2>{register ? 'Create your Song Nexus account' : 'Sign in to Song Nexus'}</h2><p>This account keeps your connected services private and separate from other users.</p><form onSubmit={signIn}><label>Username<input name="username" required minLength={3} maxLength={32} autoComplete="username" /></label><label>Password<input name="password" type="password" required minLength={register ? 10 : undefined} maxLength={200} autoComplete={register ? 'new-password' : 'current-password'} /></label><button className="primary-button" disabled={!!busy}>{busy === 'auth' ? 'Please wait…' : register ? 'Create account' : 'Sign in'}</button></form><button className="inline-link" onClick={() => setRegister(!register)}>{register ? 'Already have an account? Sign in' : 'Create an account'}</button></section> : <>
      <section className="panel account-section account-toolbar"><span>Signed in as <strong>{session.user.username}</strong></span><button className="secondary-button" disabled={!!busy} onClick={() => void act('logout', async () => { await accountApi('/api/auth/logout', 'POST'); })}>Sign out</button><button className="inline-link" onClick={() => setDeleteAccount(!deleteAccount)}>Delete account</button></section>
      {deleteAccount && <section className="panel account-section"><h2>Delete account and all stored music</h2><p>This permanently removes your connections, imports, history and Song Nexus account.</p><form onSubmit={event => { event.preventDefault(); const password = new FormData(event.currentTarget).get('password'); void act('delete', async () => { await accountApi('/api/auth/me', 'DELETE', { password }); setDeleteAccount(false); }); }}><label>Confirm with your password<input name="password" type="password" autoComplete="current-password" required /></label><button className="secondary-button" disabled={!!busy}>Permanently delete account</button></form></section>}
      <p className="account-muted">{providers?.scheduler.note} Stored updates appear here immediately; provider checks follow each service’s limits.</p>
      {confirm && <section className="panel account-section" role="alertdialog" aria-label="Confirm disconnect"><h2>Disconnect {confirm.displayName}?</h2><p>This deletes its credentials and all music synced through this connection. Your account on the music service is unaffected.</p><button className="primary-button" disabled={!!busy} onClick={() => void act('disconnect', async () => { await accountApi(`/api/integrations/connections/${confirm.id}`, 'DELETE'); setConfirm(undefined); })}>Disconnect and delete data</button><button className="secondary-button" onClick={() => setConfirm(undefined)}>Cancel</button></section>}
    </>}
    <div className="provider-grid">{providers?.providers.map(provider => {
      const connection = connections.find(c => c.provider === provider.id);
      const capabilities = connection?.capabilities ?? provider.capabilities;
      const working = connection?.job?.status === 'queued' || connection?.job?.status === 'running';
      return <section className="panel provider-card" key={provider.id}><div className="provider-heading"><span className={`provider-icon provider-${provider.id}`} aria-hidden="true">{provider.name.slice(0, 1)}</span><div><h2>{provider.name}</h2><span className={`account-status status-${connection?.status ?? provider.availability}`}>{statuses[connection?.status ?? provider.availability]}</span></div></div>
        {connection && <p><strong>{connection.profileUrl ? <a href={connection.profileUrl} target="_blank" rel="noreferrer">{connection.displayName}</a> : connection.displayName}</strong><br /><small>Last successful sync: {date(connection.lastSuccessAt)}</small></p>}
        <p>{provider.availabilityNote}</p><div className="capability-list">{Object.entries(capabilities).filter(([, c]) => c.supported).map(([key, c]) => <span key={key} title={c.note}>{label(key)}{c.missingScope ? ' (permission needed)' : ''}</span>)}</div>
        <details><summary>Permissions and limitations</summary><ul>{Object.entries(capabilities).filter(([, c]) => c.note).map(([key, c]) => <li key={key}><strong>{label(key)}:</strong> {c.note}</li>)}</ul><p>{provider.policy.attribution}</p><ul>{provider.policy.rules.map(rule => <li key={rule}>{rule}</li>)}</ul><a href={provider.policy.termsUrl} target="_blank" rel="noreferrer">Provider terms <ArrowUpRight size={12} /></a>{provider.id === 'youtube' && <p><a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">YouTube Terms of Service</a> · <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Google Privacy Policy</a></p>}</details>
        {connection?.lastError && <p className="error-text">{connection.lastError}</p>}
        {working && <div role="status"><progress max={connection!.job!.progress.total || 1} value={connection!.job!.progress.done || 0} /><p>{connection!.job!.status === 'queued' ? 'Queued' : connection!.job!.progress.label || 'Syncing'} · {connection!.job!.progress.stored || 0} items stored{connection!.job!.runAfter ? ` · next attempt ${date(connection!.job!.runAfter)}` : ''}</p></div>}
        {connection && <details><summary>Resource sync status</summary><ul>{connection.resources.map(r => <li key={r.key}>{r.label}: {r.skipped || r.error || `updated ${date(r.lastSuccessAt)}`}</li>)}</ul></details>}
        {session?.user && <div className="account-actions">{(!connection || connection.status === 'reauth_required' || connection.status === 'partial_access') && provider.availability === 'available' && <button className="primary-button" disabled={!!busy} onClick={() => provider.auth === 'token' ? setTokenFor(provider) : void connect(provider)}><Link2 size={15} /> {busy === provider.id ? 'Connecting…' : connection ? 'Reconnect' : 'Connect'}</button>}{connection && <><button className="secondary-button" disabled={!!busy || working || connection.status === 'reauth_required'} onClick={() => void act('sync', async () => { await accountApi(`/api/integrations/connections/${connection.id}/sync`, 'POST'); setNotice('Sync queued.'); })}><RefreshCw size={14} /> Sync Now</button><button className="inline-link" disabled={!!busy} onClick={() => setConfirm(connection)}>Disconnect</button></>}</div>}
        {tokenFor?.id === provider.id && <form onSubmit={event => { event.preventDefault(); const token = String(new FormData(event.currentTarget).get('token')); void connect(provider, token); }}><label>{provider.tokenHelp?.label}<input name="token" type="password" required autoComplete="off" /></label><a href={provider.tokenHelp?.url} target="_blank" rel="noreferrer">Find your token</a><button className="primary-button" disabled={!!busy}>Link account</button><button type="button" className="inline-link" onClick={() => setTokenFor(undefined)}>Cancel</button></form>}
      </section>;
    })}</div>
    {session?.user && <>
      <section className="panel account-section"><h2>Data permissions</h2><label className="consent-label"><input type="checkbox" checked={overview.consents.includes('combine_sources')} disabled={!!busy} onChange={event => { const granted = event.target.checked; void act('consent', async () => { await accountApi('/api/auth/consents', 'PUT', { kind: 'combine_sources', granted }); }); }} /> Combine my open sources for discovery</label><p>Allows Last.fm, ListenBrainz and permitted imports to be viewed together. Spotify, YouTube, Apple Music, SoundCloud and TIDAL stay in separate source views. No account data is sent to AI models.</p></section>
      {onDiscovery && overview.consents.includes('combine_sources') && <button className="secondary-button" disabled={!!busy} onClick={() => void act('discovery', async () => {
        const { songs } = await accountApi<{ songs: { title: string; artist: string }[] }>('/api/library/discovery');
        if (!songs.length) throw new Error('No songs are available from your permitted open sources yet.');
        storePlaylist({ name: 'Connected open sources', songs }); onDiscovery();
      })}>Copy open-source songs to my browser playlist and explore</button>}
      <ImportMusic imports={overview.imports} onChange={() => refresh()} />
      <AccountLibrary overview={overview} />
    </>}
  </div>;
}

function ImportMusic({ imports, onChange }: { imports: ImportView[]; onChange(): Promise<void> }) {
  const [preview, setPreview] = useState<{ parsed: ParsedImport; filename: string; sha256: string }>();
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [remove, setRemove] = useState<string>();
  const staged = useRef<string | undefined>(undefined);
  const pick = async (file?: File) => {
    setPreview(undefined); setConsent(false); setError(''); setStatus('');
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error('Choose a file under 25 MB. Unzip archives first and split larger exports.');
      const buffer = await file.arrayBuffer();
      const hash = await crypto.subtle.digest('SHA-256', buffer);
      const sha256 = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
      setPreview({ parsed: parseImport(file.name, new TextDecoder().decode(buffer)), filename: file.name, sha256 });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const upload = async () => {
    if (!preview || !consent || busy) return;
    setBusy(true); setError('');
    try {
      const { import: job } = await accountApi<{ import: ImportView }>('/api/imports', 'POST', { format: preview.parsed.format, filename: preview.filename, sha256: preview.sha256 });
      staged.current = job.id;
      let last = job;
      for (let i = 0; i < preview.parsed.rows.length; i += 1000) {
        setStatus(`Importing ${Math.min(i + 1000, preview.parsed.rows.length)} of ${preview.parsed.rows.length} rows…`);
        last = (await accountApi<{ import: ImportView }>(`/api/imports/${job.id}/rows`, 'POST', { rows: preview.parsed.rows.slice(i, i + 1000), batch: i / 1000 })).import;
      }
      await accountApi(`/api/imports/${job.id}/commit`, 'POST');
      staged.current = undefined; setPreview(undefined);
      setStatus(`Import complete. ${last.stats.duplicates || 0} duplicate plays and ${last.stats.rejected || 0} invalid rows skipped.`);
      await onChange();
    } catch (e) {
      setError((e as Error).message); setStatus('');
      if (staged.current) await accountApi(`/api/imports/${staged.current}`, 'DELETE').then(() => { staged.current = undefined; }).catch(() => {});
    } finally { setBusy(false); }
  };
  const summary = preview && summarize(preview.parsed);
  return <section className="panel account-section"><h2><Upload size={20} /> Import your music export</h2><p>Choose an unzipped JSON, JSONL or CSV export. Preview it before uploading. Imports are snapshots and never update automatically.</p><details><summary>Supported files and export instructions</summary><ul>{Object.entries(IMPORT_FORMATS).map(([key, format]) => <li key={key}><strong>{format.label}</strong>: {format.files}. {format.how}</li>)}</ul></details><label>Export file<input type="file" accept=".json,.jsonl,.csv" disabled={busy} onChange={e => void pick(e.target.files?.[0])} /></label>
    {preview && <div className="import-preview"><h3>{preview.filename}</h3><p>{IMPORT_FORMATS[preview.parsed.format].label} · {summary!.plays} plays · {summary!.library} library entries · {summary!.playlistTracks} playlist tracks · {summary!.repeatsInFile} duplicates in file</p>{summary!.oldest && <p>{date(summary!.oldest)} to {date(summary!.newest)}</p>}<ul>{preview.parsed.rows.slice(0, 5).map((row, i) => <li key={i}>{row.title} {'artist' in row && row.artist ? `— ${row.artist}` : ''}</li>)}</ul>{preview.parsed.skipped.map(s => <p key={s.reason}>{s.count} {s.reason} skipped</p>)}<label className="consent-label"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={busy} /> I authorize storing this export. I have selected the original provider format and am not using a generic import to bypass provider restrictions.</label><button className="primary-button" disabled={!consent || busy} onClick={() => void upload()}>Confirm import</button><button className="secondary-button" disabled={busy} onClick={() => setPreview(undefined)}>Cancel preview</button></div>}
    {status && <p role="status">{status}</p>}{error && <p role="alert" className="error-text">{error}</p>}
    {imports.length > 0 && <div className="import-history"><h3>Imported files</h3>{imports.map(job => <div className="import-history-row" key={job.id}><span><strong>{job.filename}</strong><small>{job.formatLabel} · imported {date(job.committedAt)} · snapshot</small></span>{remove === job.id ? <><button className="secondary-button" disabled={busy} onClick={() => { setBusy(true); void accountApi(`/api/imports/${job.id}`, 'DELETE').then(onChange).then(() => setRemove(undefined)).catch(e => setError(e.message)).finally(() => setBusy(false)); }}>Confirm deletion</button><button className="inline-link" onClick={() => setRemove(undefined)}>Cancel</button></> : <button className="inline-link" disabled={busy} onClick={() => setRemove(job.id)}>Delete imported data</button>}</div>)}</div>}
  </section>;
}

function AccountLibrary({ overview }: { overview: Overview }) {
  const [source, setSource] = useState('');
  const [tab, setTab] = useState('library');
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [plays, setPlays] = useState<PlayView[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistView[]>([]);
  const [selected, setSelected] = useState<PlaylistView>();
  const [tracks, setTracks] = useState<PlaylistTrack[]>([]);
  const [total, setTotal] = useState(0);
  const [before, setBefore] = useState<string>();
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const sources = [...new Map(overview.coverage.map(c => [c.source.provider, c.source])).values()];
  const active = sources.some(s => s.provider === source) || source === 'combined' && overview.consents.includes('combine_sources') ? source : sources[0]?.provider || '';
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const q = new URLSearchParams({ source: active, limit: '50', offset: String(offset) });
    if (before) q.set('before', before);
    const path = selected ? `/api/library/playlists/${selected.id}?${q}` : `/api/library${tab === 'activity' ? '/activity' : tab === 'playlists' ? '/playlists' : ''}?${q}`;
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      setLoading(true); setError('');
      return accountApi<{ items?: LibraryItem[]; plays?: PlayView[]; playlists?: PlaylistView[]; tracks?: PlaylistTrack[]; total?: number; next?: string | null }>(path, 'GET', undefined, controller.signal);
    }).then(data => {
      if (!data || controller.signal.aborted) return;
      setItems(data.items || []); setPlays(data.plays || []); setPlaylists(data.playlists || []); setTracks(data.tracks || []); setTotal(data.total || 0); setNext(data.next || null);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [active, tab, offset, before, selected, overview]);
  const reset = () => { setOffset(0); setBefore(undefined); setSelected(undefined); };
  return <section className="panel account-section"><h2>Your music library</h2><p>Each service is shown separately. History covers only the data that source supplied.</p>{!sources.length ? <p>Connect a service or import an export to see your music here.</p> : <>
    <div className="account-toolbar"><label>Source<select value={active} onChange={e => { setSource(e.target.value); reset(); }}>{sources.map(s => <option value={s.provider} key={s.provider}>{s.label}</option>)}{overview.consents.includes('combine_sources') && <option value="combined">Combined open sources</option>}</select></label><label>Show<select value={tab} onChange={e => { setTab(e.target.value); reset(); }}><option value="library">Library, favorites and provider rankings</option><option value="activity">Listening history</option><option value="playlists">Playlists</option></select></label></div>
    {active !== 'combined' && overview.coverage.filter(c => c.source.provider === active).map((c, i) => <p className="account-muted" key={i}>{c.source.label} · {c.source.via === 'import' ? 'Imported snapshot' : `Last synced ${date(c.lastSuccessAt)}`}{c.oldestPlay ? ` · plays from ${date(c.oldestPlay)} to ${date(c.newestPlay)}` : ''}</p>)}
    {active !== 'combined' && overview.nowPlaying?.filter(p => p.source.provider === active).map(p => <p key={p.source.provider}><strong>Last reported playing:</strong> {p.entity.title} — {p.entity.artists.join(', ')} · checked {date(p.checkedAt)}. This may have changed since the last provider check.</p>)}
    {selected && <><button className="inline-link" onClick={() => { setSelected(undefined); setOffset(0); }}>Back to playlists</button><h3>{selected.name}</h3></>}
    {loading ? <p role="status">Loading music…</p> : error ? <p role="alert" className="error-text">{error}</p> : <>
      {tab === 'playlists' && !selected ? <div className="account-playlists">{playlists.map(p => <button className="secondary-button" key={p.id} onClick={() => { setSelected(p); setOffset(0); }}>{p.name} · {p.source.label} · {p.itemsSynced ? `${p.trackCount ?? ''} tracks` : 'Contents unavailable or awaiting sync'}</button>)}{!playlists.length && <p>No playlists from this source.</p>}</div> : <div className="account-table-wrap"><table className="account-table"><thead><tr><th>Title</th><th>Artist</th><th>{tab === 'activity' ? 'Played at' : 'List'}</th><th>Source</th></tr></thead><tbody>{(selected ? tracks.map(t => ({ entity: t.entity, detail: `Track ${t.position + 1}`, source: selected.source })) : tab === 'activity' ? plays.map(p => ({ entity: p.entity, detail: date(p.playedAt), source: p.source })) : items.map(item => ({ entity: item.entity, detail: `${label(item.relation)} ${item.period}`, source: item.source }))).map((row, i) => <tr key={`${row.entity.id}:${i}`}><td>{row.entity.url ? <a href={row.entity.url} target="_blank" rel="noreferrer">{row.entity.title} ↗</a> : row.entity.title}</td><td>{row.entity.artists.join(', ')}</td><td>{row.detail}</td><td>{row.source.label}</td></tr>)}</tbody></table>{!(selected ? tracks.length : tab === 'activity' ? plays.length : items.length) && <p>No items available in this list. Check the source’s supported capabilities and sync status above.</p>}</div>}
      <div className="account-actions">{tab === 'activity' ? <>{before && <button className="secondary-button" onClick={() => setBefore(undefined)}>Newest plays</button>}{next && <button className="secondary-button" onClick={() => setBefore(next)}>Older plays</button>}</> : (tab === 'library' || selected) && <><button className="secondary-button" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button><span>{total ? `${offset + 1}–${Math.min(offset + 50, total)} of ${total}` : '0 items'}</span><button className="secondary-button" disabled={offset + 50 >= total} onClick={() => setOffset(offset + 50)}>Next</button></>}</div>
    </>}
  </>}</section>;
}
