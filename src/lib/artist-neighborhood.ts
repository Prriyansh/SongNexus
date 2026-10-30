import type { Artist, ArtistDetails, ArtistNeighborhood, DiscoveryReason, RelatedArtist } from './types';
import { lookupMusicBrainz, mapArtist, mapArtistDetails, musicBrainzContext, searchMusicBrainz } from './musicbrainz';
import type { RequestOptions } from './musicbrainz';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: unknown) => typeof v === 'string' ? v : '';
const quote = (v: string) => `"${v.replace(/["\\]/g, '')}"`;
const source = (type: string, id: string) => `https://musicbrainz.org/${type}/${id}`;
const realArtist = (a: Artist) => UUID.test(a.id) && !/^(various artists|\[unknown\]|\[no artist\])$/i.test(a.name)
  && !a.tags.some(tag => tag.includes('special purpose'));
type Credit = { artist?: Parameters<typeof mapArtist>[0] };
type Release = { id?: unknown; date?: unknown; 'first-release-date'?: unknown; 'artist-credit'?: Credit[]; 'label-info'?: { label?: { id?: unknown; name?: unknown } }[] };
type Releases = { releases?: Release[]; 'release-groups'?: Release[] };

export function neighborhoodEra(artist: ArtistDetails): [number, number] | null {
  // A person's life-span begins at birth. Only album dates or a group's formation count.
  const year = Number(artist.discography?.firstYear || (artist.type === 'Group' ? artist.lifeSpan.begin?.slice(0, 4) : ''));
  if (year < 1850 || year > new Date().getUTCFullYear() || !Number.isInteger(year)) return null;
  const start = Math.floor(year / 10) * 10;
  return [start, Math.min(start + 9, new Date().getUTCFullYear())];
}

export function mergeRelatedArtists(artists: RelatedArtist[]): RelatedArtist[] {
  const merged = new Map<string, RelatedArtist>();
  for (const artist of artists) {
    const old = merged.get(artist.id);
    const reasons = [...(old?.reasons ?? []), ...artist.reasons];
    merged.set(artist.id, { ...old, ...artist, country: artist.country || old?.country || '',
      tags: [...new Set([...(old?.tags ?? []), ...artist.tags])],
      reasons: reasons.filter((r, i) => reasons.findIndex(x => x.kind === r.kind && x.text === r.text && x.relatedTo === r.relatedTo) === i),
    });
  }
  const weights: Record<DiscoveryReason['kind'], number> = { genre: 2, country: 1, era: 1.5, label: 3, member: 8, band: 8, 'shared-member': 7, collaborator: 6 };
  // Several albums or several genre captions must not outweigh independent evidence.
  const score = (a: RelatedArtist) => [...new Set(a.reasons.map(r => r.kind))].reduce((sum, kind) => sum + weights[kind] + 2, 0);
  return [...merged.values()].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
}

/** Bounded discovery facets. Every reason carries the catalog evidence used to include it. */
export async function artistNeighborhood(id: string, options: RequestOptions = {}): Promise<ArtistNeighborhood> {
  const artist = await lookupMusicBrainz({ type: 'artist', id }, options) as ArtistDetails;
  const tags = [...new Set(artist.genres.map(g => g.name))].slice(0, 3);
  const genre = tags[0];
  const reason = (kind: DiscoveryReason['kind'], caption: string, url = source('artist', id)): DiscoveryReason => ({ kind, text: caption, sourceUrl: url, relatedTo: id });
  const wrap = (a: Artist, reasons: DiscoveryReason[]): RelatedArtist => ({ ...a, reasons });
  const jobs: { name: string; run: () => Promise<RelatedArtist[]> }[] = [];
  const queryArtists = async (query: string) => (await searchMusicBrainz({ type: 'artist', query, limit: 25 }, options)) as Artist[];
  if (genre) {
    jobs.push({ name: 'genre', run: async () => (await queryArtists(`tag:${quote(genre)}`)).map(a => wrap(a, [reason('genre', `Similar style: ${genre}`)])) });
    if (tags[1]) jobs.push({ name: 'subgenre', run: async () => (await queryArtists(`tag:${quote(genre)} AND tag:${quote(tags[1])}`))
      .map(a => wrap(a, [reason('genre', `Shared styles: ${genre}, ${tags[1]}`)])) });
  }
  if (/^[A-Z]{2}$/.test(artist.country) && !['XW', 'XE'].includes(artist.country)) jobs.push({ name: 'country', run: async () =>
    (await queryArtists(`country:${artist.country}${genre ? ` AND tag:${quote(genre)}` : ''}`)).filter(a => a.country === artist.country)
      .map(a => wrap(a, [reason('country', `Also from ${artist.country}`), ...(genre ? [reason('genre', `Similar style: ${genre}`)] : [])])) });
  const era = neighborhoodEra(artist);
  if (era) jobs.push({ name: 'era', run: async () => {
    const query = `firstreleasedate:[${era[0]} TO ${era[1]}] AND primarytype:album${genre ? ` AND tag:${quote(genre)}` : ''}`;
    const data = await musicBrainzContext<Releases>('release-group', { query, limit: '20' }, options);
    return (data['release-groups'] ?? []).flatMap(release => {
      const year = Number(text(release['first-release-date']).slice(0, 4));
      if (year < era[0] || year > era[1] || !Number.isInteger(year) || !UUID.test(text(release.id))) return [];
      return (release['artist-credit'] ?? []).flatMap(c => c.artist ? [wrap(mapArtist(c.artist), [reason('era', `Album released in ${year}`, source('release-group', text(release.id))),
        ...(genre ? [reason('genre', `Similar style: ${genre}`, source('release-group', text(release.id)))] : [])])] : []);
    });
  } });
  // Release label-info is evidence of an issued record, not current signing status.
  jobs.push({ name: 'labels', run: async () => {
    const data = await musicBrainzContext<Releases>('release', { artist: id, status: 'official', inc: 'labels', limit: '25' }, options);
    const labels = new Map<string, { id: string; name: string; count: number }>();
    for (const release of data.releases ?? []) for (const info of release['label-info'] ?? []) {
      const label = info.label;
      if (!UUID.test(text(label?.id)) || !text(label?.name) || /^\[/.test(text(label?.name))) continue;
      const old = labels.get(text(label?.id));
      labels.set(text(label?.id), { id: text(label?.id), name: text(label?.name), count: (old?.count ?? 0) + 1 });
    }
    const label = [...labels.values()].sort((a, b) => b.count - a.count)[0];
    if (!label) return [];
    const peers = await musicBrainzContext<Releases>('release', { label: label.id, status: 'official', inc: 'artist-credits+labels', limit: '25' }, options);
    return (peers.releases ?? []).filter(release => UUID.test(text(release.id))).flatMap(release => (release['artist-credit'] ?? []).flatMap(c => c.artist
      ? [wrap(mapArtist(c.artist), [reason('label', `Release on ${label.name}`, source('release', text(release.id)))])] : []));
  } });
  const musical = (artist.relationships ?? []).filter(r => ['member of band', 'collaboration', 'supporting musician', 'conductor', 'founder'].includes(r.type));
  const direct = musical.map(r => wrap(r.artist, [reason(r.type === 'member of band' ? artist.type === 'Group' ? 'member' : 'band' : 'collaborator',
    r.type === 'member of band' ? artist.type === 'Group' ? `${r.ended || r.end ? 'Former member' : 'Member'} of ${artist.name}` : `${r.ended || r.end ? 'Former band' : 'Band'}: ${r.artist.name}` : `${r.type} · ${artist.name}`)]));
  if (artist.type === 'Group') for (const member of musical.filter(r => r.type === 'member of band').slice(0, 2)) jobs.push({ name: `member:${member.artist.id}`, run: async () => {
    const raw = await musicBrainzContext<Parameters<typeof mapArtistDetails>[0]>(`artist/${member.artist.id}`, { inc: 'artist-rels' }, options);
    return (mapArtistDetails(raw).relationships ?? []).filter(r => r.type === 'member of band' && r.artist.id !== id)
      .map(r => wrap(r.artist, [reason('shared-member', `Shared member: ${member.artist.name}`, source('artist', member.artist.id))]));
  } });
  const results = await Promise.allSettled(jobs.map(job => job.run()));
  return { artist, artists: mergeRelatedArtists([...direct, ...results.flatMap(r => r.status === 'fulfilled' ? r.value : [])])
    .filter(a => a.id !== id && realArtist(a)).slice(0, 80),
    failed: results.flatMap((r, i) => r.status === 'rejected' ? [jobs[i].name] : []),
  };
}
