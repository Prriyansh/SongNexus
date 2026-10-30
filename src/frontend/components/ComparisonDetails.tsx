import type { ReactNode } from 'react';
import type { ArtistDetails, Collaborator, CollaboratorComparison, Coverage, MoreCredits, RecordingDetails, SourcedCollaborator, TrackRef, YearSpan } from '@/lib/types';
import { formatDuration, partitionGenres } from '@/lib/types';
import { albumSampleNote, capitalize, lifeSpanLabels, linkLabel, uniqueLinks, musicBrainzUrl, recentAlbums, roleText, songArtists, studioAlbumText, yearOf } from '../model';
import { matchesRole } from '../graph';
import { AlbumCover } from './Artwork';
import { mergeSourcedCredits, sourceNote } from '../credits';
import type { Selection } from '../types';

export type Loadable<T> = { data?: T; loading: boolean; error?: Error; retry: () => void };

const Row = ({ name, values }: { name: string; values: [ReactNode, ReactNode] }) =>
  <div className="comparison-row"><span>{name}</span>{values.map((value, i) => <div className="comparison-cell" key={i}>{value || <p>—</p>}</div>)}</div>;

const Links = ({ links }: { links: { type: string; url: string }[] }) => links.length
  ? <div className="inline-credit-list">{uniqueLinks(links).slice(0, 3).map(link => <a className="inline-link" key={link.url} href={link.url} target="_blank" rel="noreferrer">{linkLabel(link)} ↗</a>)}</div>
  : null;

const genreText = (genres: { name: string }[], tags: string[]) =>
  (genres.length ? genres.map(g => g.name) : tags).slice(0, 4).map(capitalize).join(' · ');

function lifeSpan(artist: ArtistDetails) {
  const labels = lifeSpanLabels(artist.type);
  const { begin, end } = artist.lifeSpan;
  if (!begin && !end) return null;
  return <p>{begin ? `${labels.begin} ${begin}` : ''}{end ? `${begin ? ' · ' : ''}${labels.end} ${end}` : ''}</p>;
}

function SharedGenres({ a, b }: { a: { genres: { name: string; count: number }[] }; b: { genres: { name: string; count: number }[] } }) {
  const shared = partitionGenres(a.genres, b.genres).shared;
  return <div className="artist-overlap musical-overlap"><strong>Shared genres</strong>
    <p>{shared.length ? shared.slice(0, 6).map(capitalize).join(' · ') : 'No genre tags in common on MusicBrainz.'}</p>
    <small>From MusicBrainz community genre tags. No audio analysis is involved, and shared tags don’t mean the two worked together.</small>
  </div>;
}

export function coverageText(coverage: { a: Coverage; b: Coverage }, names: [string, string]): string {
  const one = (c: Coverage, name: string) => c.unit === 'albums'
    ? c.scanned === c.total ? `all ${c.total} of ${name}’s studio albums` : `${name}’s ${c.scanned} most recent of ${c.total} studio albums`
    : `${c.scanned} of ${name}’s recordings`;
  return `Scanned ${one(coverage.a, names[0])} and ${one(coverage.b, names[1])}.`;
}

const span = (years?: YearSpan | null) => !years ? '' : years.first === years.last ? years.first : `${years.first}–${years.last}`;
// "Across": someone with several roles didn't necessarily do each of them on every track.
const tally = (count: number, unit: string, years?: YearSpan | null) => `${count === 1 ? 'on 1' : `across ${count}`} ${unit}${count === 1 ? '' : 's'}${span(years) ? `, ${span(years)}` : ''}`;
const quoted = (tracks: { title: string }[]) => tracks.slice(0, 3).map(t => `“${t.title}”`).join(', ');
const SOURCE_NAMES = { genius: 'Genius', discogs: 'Discogs' };

/** Someone only Genius or Discogs credits on both artists; they open that source's page, not the drawer. */
function SourcedRow({ person, names }: { person: SourcedCollaborator; names: [string, string] }) {
  const unit = person.source === 'genius' ? 'song' : 'release';
  const side = (name: string, side: 'a' | 'b') => <small>{name}: {roleText(person.roles[side])} {tally(person.count[side], unit)} · {person.evidence[side].slice(0, 3).map((work, i) => <span key={work.url}>{i > 0 && ', '}<a className="inline-link" href={work.url} target="_blank" rel="noreferrer">{work.title}</a></span>)}</small>;
  return <div className="collab-row"><a className="inline-link" href={person.url} target="_blank" rel="noreferrer">{person.name} ↗</a>{side(names[0], 'a')}{side(names[1], 'b')}<span className="source-chip">{SOURCE_NAMES[person.source]}</span></div>;
}

/** Mutual collaborators with the songs that connect them; a song pair opens a song comparison. */
export function Collaborators({ state, names, role, current, more, onSelect, onCompareSongs }: { state: Loadable<CollaboratorComparison>; names: [string, string]; role: string; current?: string[]; more?: Loadable<MoreCredits>; onSelect: (s: Selection) => void; onCompareSongs: (a: TrackRef, b: TrackRef) => void }) {
  if (state.loading) return <div className="artist-overlap"><strong>Mutual collaborators · factual credits</strong><p className="loading-text">Reading album credits on MusicBrainz. The first scan of two artists can take up to a minute.</p><div className="skeleton-lines"><span/><span/><span/></div></div>;
  if (state.error || !state.data) return <div className="artist-overlap"><strong>Mutual collaborators · factual credits</strong><p className="error-text" role="alert">{state.error?.message || 'Could not load collaborators.'}</p><button className="secondary-button" onClick={state.retry}>Try again</button></div>;
  const mutual = state.data.mutual.filter((c: Collaborator) => matchesRole(c, role));
  const merged = mergeSourcedCredits(state.data.mutual, more?.data);
  const extra = merged.extra.filter(person => role === 'all' || person.roles.a.includes(role) || person.roles.b.includes(role));
  const partial = state.data.coverage.a.partial || state.data.coverage.b.partial;
  return <div className="artist-overlap"><strong>Mutual collaborators · factual credits</strong>
    {mutual.length ? <div className="collab-list">{mutual.map(c => <div className="collab-row" key={c.id}>
      <button className="inline-link" onClick={() => onSelect({ type: 'artist', id: c.id })}>{c.name} ↗</button>
      <small>{names[0]}: {roleText(c.roles.a)} {tally(c.trackCount.a, 'track', c.years?.a)}{c.tracks.a.length > 0 && ` · ${quoted(c.tracks.a)}`}</small>
      <small>{names[1]}: {roleText(c.roles.b)} {tally(c.trackCount.b, 'track', c.years?.b)}{c.tracks.b.length > 0 && ` · ${quoted(c.tracks.b)}`}</small>
      {(merged.confirmed.get(c.id) ?? []).map(source => <a className="source-chip" key={source.source} href={source.url} target="_blank" rel="noreferrer">Also on {SOURCE_NAMES[source.source]} ↗</a>)}
      {c.tracks.a[0] && c.tracks.b[0] && !(current?.includes(c.tracks.a[0].id) && current.includes(c.tracks.b[0].id)) && <button className="text-cta" onClick={() => onCompareSongs(c.tracks.a[0], c.tracks.b[0])}>Compare “{c.tracks.a[0].title}” and “{c.tracks.b[0].title}” →</button>}
    </div>)}</div> : <p>{role === 'all' ? 'No one is credited on both artists’ scanned albums.' : 'No shared collaborators in this role.'}</p>}
    {extra.length > 0 && <div className="more-credits"><strong>Also credited elsewhere</strong><small>Found on Genius or Discogs but not in the MusicBrainz albums above. Check the links: matches between sources go by name.</small><div className="collab-list">{extra.map(person => <SourcedRow key={`${person.source}:${person.id}`} person={person} names={names} />)}</div></div>}
    {!!more?.data?.direct.length && <div className="more-credits"><strong>Credited together</strong><div className="inline-credit-list">{more.data.direct.map(work => <a className="inline-link" key={work.url} href={work.url} target="_blank" rel="noreferrer">{work.title}{work.year && ` (${work.year})`} · {SOURCE_NAMES[work.source]} ↗</a>)}</div></div>}
    {more?.loading && <p className="loading-text">Checking Genius and Discogs for more credits…</p>}
    <small className="coverage-note">{coverageText(state.data.coverage, names)} {sourceNote(more?.data?.sources, more?.error)}</small>
    {partial && <button className="secondary-button scan-more" onClick={state.retry}>Scan more albums</button>}
  </div>;
}

export function ComparisonDetails({ kind, a, b, collab, more, role, onSelect, onCompareSongs }: {
  kind: 'artist' | 'song';
  a?: ArtistDetails | RecordingDetails;
  b?: ArtistDetails | RecordingDetails;
  collab: Loadable<CollaboratorComparison> | null;
  more?: Loadable<MoreCredits>;
  role: string;
  onSelect: (s: Selection) => void;
  onCompareSongs: (a: TrackRef, b: TrackRef) => void;
}) {
  if (!a || !b) return <section className="panel comparison-details" aria-busy="true"><div className="section-title"><div><span className="overline">{kind === 'song' ? '07 / MORE ABOUT THESE SONGS' : 'SIDE BY SIDE'}</span><h3>Loading from MusicBrainz…</h3></div></div><div className="skeleton-lines"><span/><span/><span/><span/></div></section>;

  if (kind === 'song') {
    const sa = a as RecordingDetails, sb = b as RecordingDetails;
    const pair = [sa, sb] as const;
    const two = <T,>(f: (s: RecordingDetails) => T) => [f(sa), f(sb)] as [T, T];
    // Secondary for songs: the sound and lyrics analysis (SongAnalysis) comes first.
    return <section className="panel comparison-details"><div className="section-title"><div><span className="overline">07 / MORE ABOUT THESE SONGS</span><h3>Release details and credits</h3></div></div>
      <div className="comparison-row comparison-row-heading"><span/>{pair.map(s => <strong key={s.id}>{s.title}</strong>)}</div>
      <Row name="Artist" values={two(s => <div className="inline-credit-list">{s.artists.map(artist => artist.id
        ? <button className="inline-link" key={artist.id} onClick={() => onSelect({ type: 'artist', id: artist.id! })}>{artist.name} ↗</button>
        : <p key={artist.name}>{artist.name}</p>)}</div>)}/>
      <Row name="Released" values={two(s => s.firstReleaseDate ? <p>{yearOf(s.firstReleaseDate)}<small>{s.firstReleaseDate}</small></p> : null)}/>
      <Row name="Album" values={two(s => s.representative ? <div className="album-strip"><a className="album-thumb" href={musicBrainzUrl('release', s.representative.id)} target="_blank" rel="noreferrer" title={`${s.representative.title} on MusicBrainz`}><AlbumCover cover={s.representative} size="md" /><span>{s.representative.title}{s.representative.year && <small>{s.representative.year}</small>}</span></a></div> : null)}/>
      <Row name="Length" values={two(s => <p>{s.durationMs == null ? '—' : formatDuration(s.durationMs)}</p>)}/>
      <Row name="Genre / style" values={two(s => { const text = genreText(s.genres, s.tags); return text ? <p>{text}<small>MusicBrainz community tags</small></p> : null; })}/>
      {pair.some(s => s.rating) && <Row name="Rating" values={two(s => s.rating ? <p>{s.rating.value.toFixed(1)} / 5<small>{s.rating.votes} votes</small></p> : null)}/>}
      {pair.some(s => s.links.length) && <Row name="Listen" values={two(s => <Links links={s.links}/>)}/>}
      <SharedGenres a={sa} b={sb}/>
      {collab && <Collaborators state={collab} names={[songArtists(sa), songArtists(sb)]} role={role} current={[sa.id, sb.id]} onSelect={onSelect} onCompareSongs={onCompareSongs}/>}
    </section>;
  }

  const aa = a as ArtistDetails, ab = b as ArtistDetails;
  const pair = [aa, ab] as const;
  const two = <T,>(f: (x: ArtistDetails) => T) => [f(aa), f(ab)] as [T, T];
  return <section className="panel comparison-details"><div className="section-title"><div><span className="overline">SIDE BY SIDE</span><h3>Their sound, their circle.</h3></div></div>
    <div className="comparison-row comparison-row-heading"><span/>{pair.map(x => <strong key={x.id}>{x.name}</strong>)}</div>
    <Row name="Artist" values={two(x => <p>{[x.type, x.area || x.country].filter(Boolean).join(' · ') || 'Artist'}{x.disambiguation && <small>{x.disambiguation}</small>}</p>)}/>
    <Row name="Born / formed" values={two(lifeSpan)}/>
    <Row name="Genres" values={two(x => { const text = genreText(x.genres, x.tags); return text ? <p>{text}<small>MusicBrainz community tags</small></p> : null; })}/>
    <Row name="Studio albums" values={two(x => <p>{studioAlbumText(x)}{x.discography?.firstYear && <small>Debut album {x.discography.firstYear}{x.discography.lastYear && x.discography.lastYear !== x.discography.firstYear ? ` · latest ${x.discography.lastYear}` : ''}</small>}</p>)}/>
    <Row name="Albums" values={two(x => x.discography?.representative.length ? <div><div className="album-strip">{recentAlbums(x.discography.representative).slice(0, 3).map(album => <a className="album-thumb" key={album.id} href={musicBrainzUrl('release-group', album.id)} target="_blank" rel="noreferrer" title={`${album.title} on MusicBrainz`}><AlbumCover cover={album} size="md" /><span>{album.title}{album.year && <small>{album.year}</small>}</span></a>)}</div>{albumSampleNote(x) && <small>{albumSampleNote(x)}</small>}</div> : null)}/>
    {pair.some(x => x.rating) && <Row name="Rating" values={two(x => x.rating ? <p>{x.rating.value.toFixed(1)} / 5<small>{x.rating.votes} votes</small></p> : null)}/>}
    {pair.some(x => x.links.length) && <Row name="Links" values={two(x => <Links links={x.links}/>)}/>}
    <SharedGenres a={aa} b={ab}/>
    {collab && <Collaborators state={collab} names={[aa.name, ab.name]} role={role} more={more} onSelect={onSelect} onCompareSongs={onCompareSongs}/>}
  </section>;
}
