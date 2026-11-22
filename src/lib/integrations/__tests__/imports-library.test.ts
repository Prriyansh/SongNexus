import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../db';
import { setConsent } from '../../accounts/users';
import { sha256 } from '../../accounts/crypto';
import { createImport, addImportRows, commitImport, deleteImport } from '../imports';
import { parseImport, readCsv, toIso } from '../import-formats';
import { coverage, discoveryPlaylist, listLibrary, listPlays, listPlaylists, playlistTracks } from '../library';
import { applyMutations, upsertEntities } from '../store';
import { claim, enqueue, requeue } from '../jobs';
import { runJob } from '../sync';
import { connect, freshDb, makeUser } from './helpers';

let db: Db;
beforeAll(async () => { db = await freshDb(); });
afterAll(async () => { await db.close(); });
const openImport = (user: string, format = 'generic', file = Math.random().toString()) => createImport(db, user, { format, filename: `${file}.json`, sha256: sha256(file) });
const song = { t: 'library', kind: 'track', relation: 'saved', title: 'One', artist: 'Band' };

describe('secure import lifecycle', () => {
  it('isolates private export metadata even when different users supply the same item ID', async () => {
    const first = await makeUser(db), second = await makeUser(db);
    for (const [user, title] of [[first, 'Private first title'], [second, 'Private second title']]) {
      const job = await openImport(user);
      await addImportRows(db, user, job.id, [{ ...song, id: 'shared-export-id', title }]);
      await commitImport(db, user, job.id);
    }
    expect((await listLibrary(db, first, { source: 'import:generic' })).items[0].entity.title).toBe('Private first title');
    expect((await listLibrary(db, second, { source: 'import:generic' })).items[0].entity.title).toBe('Private second title');
  });
  it('hides staged rows, commits idempotently, rejects duplicate files, and rolls back only the selected import', async () => {
    const user = await makeUser(db), other = await makeUser(db);
    const job = await openImport(user, 'generic', 'stable-file');
    await addImportRows(db, user, job.id, [song]);
    expect((await listLibrary(db, user, { source: 'import:generic' })).total).toBe(0);
    await expect(addImportRows(db, other, job.id, [song])).rejects.toMatchObject({ status: 404 });
    await expect(commitImport(db, other, job.id)).rejects.toMatchObject({ status: 404 });
    const committed = await commitImport(db, user, job.id);
    expect((await commitImport(db, user, job.id)).committedAt).toBe(committed.committedAt);
    expect((await listLibrary(db, user, { source: 'import:generic' })).total).toBe(1);
    expect((await listLibrary(db, other, { source: 'import:generic' })).total).toBe(0);
    await expect(openImport(user, 'generic', 'stable-file')).rejects.toMatchObject({ status: 409 });
    const keep = await openImport(user);
    await addImportRows(db, user, keep.id, [{ ...song, title: 'Keep' }]); await commitImport(db, user, keep.id);
    await expect(deleteImport(db, other, job.id)).rejects.toMatchObject({ status: 404 });
    await deleteImport(db, user, job.id);
    expect((await listLibrary(db, user, { source: 'import:generic' })).items.map(i => i.entity.title)).toEqual(['Keep']);
  });

  it('makes retried playlist batches idempotent while preserving deliberate repeated tracks in later batches', async () => {
    const user = await makeUser(db), job = await openImport(user);
    const rows = [{ t: 'playlist_track', playlist: 'Set', title: 'Again', artist: 'Band' }];
    const first = await addImportRows(db, user, job.id, rows, 0);
    expect((await addImportRows(db, user, job.id, rows, 0)).stats).toEqual(first.stats);
    await expect(addImportRows(db, user, job.id, [{ ...rows[0], title: 'Altered' }], 0)).rejects.toMatchObject({ status: 409 });
    await addImportRows(db, user, job.id, rows, 1);
    await commitImport(db, user, job.id);
    const [playlist] = await listPlaylists(db, user, 'import:generic');
    expect((await playlistTracks(db, user, playlist.id, {})).tracks.map(t => t.entity.title)).toEqual(['Again', 'Again']);
    await expect(playlistTracks(db, await makeUser(db), playlist.id, {})).rejects.toMatchObject({ status: 404 });
  });

  it('rejects malformed inputs, records rejected rows, and keeps repeated plays at different timestamps', async () => {
    const user = await makeUser(db), job = await openImport(user);
    await expect(createImport(db, user, { format: '__proto__', sha256: 'a'.repeat(64) })).rejects.toMatchObject({ status: 400 });
    await expect(createImport(db, user, { format: 'generic', sha256: 'bad' })).rejects.toMatchObject({ status: 400 });
    await expect(addImportRows(db, user, job.id, new Array(2501).fill(song))).rejects.toMatchObject({ status: 413 });
    await expect(addImportRows(db, user, job.id, [])).rejects.toMatchObject({ status: 400 });
    await expect(commitImport(db, user, job.id)).rejects.toMatchObject({ status: 409 });
    const play = { t: 'play', title: 'Again', artist: 'Band', playedAt: '2024-01-01T00:00:00Z' };
    const result = await addImportRows(db, user, job.id, [null, {}, { ...play, playedAt: 'invalid' }, play, play, { ...play, playedAt: '2024-01-01T00:05:00Z' }]);
    expect(result.stats).toMatchObject({ rejected: 3, plays: 2, duplicates: 1 });
    await commitImport(db, user, job.id);
    expect((await listPlays(db, user, { source: 'import:generic' })).plays).toHaveLength(2);
    const overlapping = await openImport(user);
    expect((await addImportRows(db, user, overlapping.id, [play])).stats).toMatchObject({ plays: 0, duplicates: 1 });
  });
});

describe('source policy and matching', () => {
  it('pages tied listening timestamps without skipping legitimate events', async () => {
    const user = await makeUser(db), job = await openImport(user);
    await addImportRows(db, user, job.id, ['One', 'Two', 'Three'].map(title => ({ t: 'play', title, artist: 'Band', playedAt: '2024-01-01T00:00:00Z' })));
    await commitImport(db, user, job.id);
    const first = await listPlays(db, user, { source: 'import:generic', limit: 2 });
    const second = await listPlays(db, user, { source: 'import:generic', limit: 2, before: first.next });
    expect(first.plays).toHaveLength(2); expect(second.plays).toHaveLength(1);
    expect(new Set([...first.plays, ...second.plays].map(p => p.entity.id)).size).toBe(3);
  });
  it('requires consent for the combined view and excludes restricted providers and imports from discovery', async () => {
    const user = await makeUser(db);
    for (const format of ['generic', 'spotify-library', 'youtube-music-library']) {
      const job = await openImport(user, format);
      await addImportRows(db, user, job.id, [{ ...song, title: format }]); await commitImport(db, user, job.id);
    }
    const spotify = await connect(db, user, 'spotify', fetch);
    await applyMutations(db, { userId: user, source: 'spotify', connectionId: spotify }, [{ type: 'library', relation: 'saved', entity: { kind: 'track', providerId: 's', title: 'Restricted', artists: ['Band'], mbid: 'b1a9c0e9-d987-4042-ae91-78d6a3267d69' } }], 1);
    await expect(listLibrary(db, user, { source: 'combined' })).rejects.toMatchObject({ status: 403 });
    await expect(discoveryPlaylist(db, user)).rejects.toMatchObject({ status: 403 });
    await setConsent(db, user, 'combine_sources', true);
    expect((await listLibrary(db, user, { source: 'combined' })).items.map(i => i.entity.title)).toEqual(['generic']);
    expect(await discoveryPlaylist(db, user)).toEqual([{ title: 'generic', artist: 'Band' }]);
    const restricted = await db.query<{ canonical_id: string | null; mbid: string | null }>("SELECT canonical_id, mbid FROM provider_entities WHERE provider = 'spotify' AND provider_id = 's'");
    expect(restricted).toEqual([{ canonical_id: null, mbid: null }]);
    await setConsent(db, user, 'combine_sources', false);
    await expect(listLibrary(db, user, { source: 'combined' })).rejects.toMatchObject({ status: 403 });
    expect(await coverage(db, await makeUser(db))).toEqual([]);
  });

  it('does not merge names alone or recordings with conflicting MBIDs despite a shared ISRC', async () => {
    const entities = [
      { kind: 'track' as const, providerId: 'a', title: 'Same', artists: ['Band'] },
      { kind: 'track' as const, providerId: 'b', title: 'Same', artists: ['Band'] },
      { kind: 'track' as const, providerId: 'c', title: 'Recording', mbid: '11111111-1111-4111-8111-111111111111', isrc: 'GBAYE0601498' },
      { kind: 'track' as const, providerId: 'd', title: 'Recording', mbid: '22222222-2222-4222-8222-222222222222', isrc: 'GBAYE0601498' },
    ];
    await db.tx(async sql => { await upsertEntities(sql, 'lastfm', entities.slice(0, 3)); });
    await db.tx(async sql => { await upsertEntities(sql, 'lastfm', entities.slice(3)); });
    const rows = await db.query<{ provider_id: string; canonical_id: string | null }>("SELECT provider_id, canonical_id FROM provider_entities WHERE provider = 'lastfm' AND provider_id IN ('a','b','c','d') ORDER BY provider_id");
    expect(rows.slice(0, 2).map(r => r.canonical_id)).toEqual([null, null]);
    expect(rows[2].canonical_id).toBeTruthy(); expect(rows[3].canonical_id).toBeTruthy();
    expect(rows[2].canonical_id).not.toBe(rows[3].canonical_id);
  });

  it('preserves a provider retry deadline when the user asks to sync again', async () => {
    const user = await makeUser(db), connection = await connect(db, user, 'spotify', fetch);
    const { job } = await enqueue(db, { id: connection, userId: user }, 'initial');
    await requeue(db, job.id, 3600, 'Rate limited');
    const again = await enqueue(db, { id: connection, userId: user }, 'manual');
    expect(again.created).toBe(false);
    expect(Date.parse(String(again.job.run_after)) - Date.now()).toBeGreaterThan(3500_000);
    expect(await claim(db, user)).toBeNull();
  });
  it('prevents a stale worker from resuming after another worker reclaimed its lease', async () => {
    const user = await makeUser(db), connection = await connect(db, user, 'spotify', fetch);
    await enqueue(db, { id: connection, userId: user }, 'initial');
    const old = (await claim(db, user))!;
    await db.query("UPDATE sync_jobs SET lease_until = now() - interval '1 second' WHERE id = $1", [old.id]);
    const current = (await claim(db, user))!;
    expect(current.lease_token).not.toBe(old.lease_token);
    await runJob(db, old);
    const [row] = await db.query<{ status: string; lease_token: string }>('SELECT status, lease_token FROM sync_jobs WHERE id = $1', [old.id]);
    expect(row).toEqual({ status: 'running', lease_token: current.lease_token });
    expect(await db.query('SELECT 1 FROM sync_state WHERE connection_id = $1', [connection])).toEqual([]);
  });
});

describe('export parsers', () => {
  it('reads quoted CSV and rejects malformed, oversized dates and empty files', () => {
    expect(readCsv('title,artist\n"One, Two","A ""B"""')).toEqual([['title', 'artist'], ['One, Two', 'A "B"']]);
    expect(() => readCsv('title,artist\n"unclosed,x')).toThrow();
    for (const text of ['', '{bad', 'nope']) expect(() => parseImport('x.json', text)).toThrow();
    expect(toIso(Infinity)).toBeUndefined(); expect(toIso(0)).toBeUndefined();
  });
  it('preserves provider provenance and treats Shazams as saved recognitions rather than plays', () => {
    const spotify = parseImport('history.json', JSON.stringify([{ ts: '2024-01-01T00:00:00Z', master_metadata_track_name: 'Song', master_metadata_album_artist_name: 'Band', ms_played: 90000 }, { ts: '2024-01-01T00:01:00Z', master_metadata_track_name: 'Skip', master_metadata_album_artist_name: 'Band', ms_played: 1000 }]));
    expect(spotify.format).toBe('spotify-history'); expect(spotify.rows).toHaveLength(1); expect(spotify.skipped[0].count).toBe(1);
    const shazam = parseImport('shazamlibrary.csv', 'Shazam Library\nTitle,Artist,TagTime,TrackKey\nSong,Band,2024-01-01T00:00:00Z,123');
    expect(shazam.format).toBe('shazam-library'); expect(shazam.rows[0].t).toBe('library');
    const youtube = parseImport('watch-history.json', JSON.stringify([{ header: 'YouTube Music', title: 'Watched Song', titleUrl: 'https://music.youtube.com/watch?v=abcdefghijk', time: '2024-01-01T00:00:00Z', subtitles: [{ name: 'Band - Topic' }] }, { header: 'YouTube', title: 'Watched video', time: '2024-01-01T00:00:00Z' }]));
    expect(youtube.format).toBe('youtube-music-history'); expect(youtube.rows).toHaveLength(1);
  });
});
