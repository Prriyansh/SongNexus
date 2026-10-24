import type { ReactNode } from 'react';
import type { ArtistDetails, Collaborator, CollaboratorComparison, Coverage, RecordingDetails, TrackRef } from '@/lib/types';
import { formatDuration, partitionGenres } from '@/lib/types';
import { capitalize, lifeSpanLabels, linkLabel, uniqueLinks, musicBrainzUrl, recentAlbums, roleText, songArtists, studioAlbumText, yearOf } from '../model';
import { matchesRole } from '../graph';
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
    ? `${name}’s ${c.scanned === 1 ? 'latest studio album' : `${c.scanned} most recent studio albums`}`
    : `${c.scanned} of ${name}’s recordings`;
  return `Scanned ${one(coverage.a, names[0])} and ${one(coverage.b, names[1])}.`;
}

/** Mutual collaborators with the songs that connect them; a song pair opens a song comparison. */
export function Collaborators({ state, names, role, current, onSelect, onCompareSongs }: { state: Loadable<CollaboratorComparison>; names: [string, string]; role: string; current?: string[]; onSelect: (s: Selection) => void; onCompareSongs: (a: TrackRef, b: TrackRef) => void }) {
  if (state.loading) return <div className="artist-overlap"><strong>Mutual collaborators · factual credits</strong><p className="loading-text">Reading album credits on MusicBrainz. The first scan of two artists takes about ten seconds.</p><div className="skeleton-lines"><span/><span/><span/></div></div>;
  if (state.error || !state.data) return <div className="artist-overlap"><strong>Mutual collaborators · factual credits</strong><p className="error-text" role="alert">{state.error?.message || 'Could not load collaborators.'}</p><button className="secondary-button" onClick={state.retry}>Try again</button></div>;
  const mutual = state.data.mutual.filter((c: Collaborator) => matchesRole(c, role));
  return <div className="artist-overlap"><strong>Mutual collaborators · factual credits</strong>
    {mutual.length ? <div className="collab-list">{mutual.map(c => <div className="collab-row" key={c.id}>
      <button className="inline-link" onClick={() => onSelect({ type: 'artist', id: c.id })}>{c.name} ↗</button>
      <small>{names[0]}: {roleText(c.roles.a)} · {names[1]}: {roleText(c.roles.b)}</small>
      {c.tracks.a[0] && c.tracks.b[0] && !(current?.includes(c.tracks.a[0].id) && current.includes(c.tracks.b[0].id)) && <button className="text-cta" onClick={() => onCompareSongs(c.tracks.a[0], c.tracks.b[0])}>Compare “{c.tracks.a[0].title}” and “{c.tracks.b[0].title}” →</button>}
    </div>)}</div> : <p>{role === 'all' ? 'No one is credited on both artists’ scanned albums.' : 'No shared collaborators in this role.'}</p>}
    <small className="coverage-note">{coverageText(state.data.coverage, names)}</small>
  </div>;
}

export function ComparisonDetails({ kind, a, b, collab, role, onSelect, onCompareSongs }: {
  kind: 'artist' | 'song';
  a?: ArtistDetails | RecordingDetails;
  b?: ArtistDetails | RecordingDetails;
  collab: Loadable<CollaboratorComparison> | null;
  role: string;
  onSelect: (s: Selection) => void;
  onCompareSongs: (a: TrackRef, b: TrackRef) => void;
}) {
  if (!a || !b) return <section className="panel comparison-details" aria-busy="true"><div className="section-title"><div><span className="overline">SIDE BY SIDE</span><h3>Loading from MusicBrainz…</h3></div></div><div className="skeleton-lines"><span/><span/><span/><span/></div></section>;

  if (kind === 'song') {
    const sa = a as RecordingDetails, sb = b as RecordingDetails;
    const pair = [sa, sb] as const;
    const two = <T,>(f: (s: RecordingDetails) => T) => [f(sa), f(sb)] as [T, T];
    return <section className="panel comparison-details"><div className="section-title"><div><span className="overline">SIDE BY SIDE</span><h3>Listen for the similarities.</h3></div></div>
      <div className="comparison-row comparison-row-heading"><span/>{pair.map(s => <strong key={s.id}>{s.title}</strong>)}</div>
      <Row name="Artist" values={two(s => <div className="inline-credit-list">{s.artists.map(artist => artist.id
        ? <button className="inline-link" key={artist.id} onClick={() => onSelect({ type: 'artist', id: artist.id! })}>{artist.name} ↗</button>
        : <p key={artist.name}>{artist.name}</p>)}</div>)}/>
      <Row name="Released" values={two(s => s.firstReleaseDate ? <p>{yearOf(s.firstReleaseDate)}<small>{s.firstReleaseDate}</small></p> : null)}/>
      <Row name="Album" values={two(s => s.representative ? <a className="inline-link" href={musicBrainzUrl('release', s.representative.id)} target="_blank" rel="noreferrer">{s.representative.title} ↗</a> : null)}/>
      <Row name="Length" values={two(s => <p>{s.durationMs == null ? '—' : formatDuration(s.durationMs)}</p>)}/>
      <Row name="Genre / style" values={two(s => { const text = genreText(s.genres, s.tags); return text ? <p>{text}<small>MusicBrainz community tags</small></p> : null; })}/>
      {pair.some(s => s.rating) && <Row name="Rating" values={two(s => s.rating ? <p>{s.rating.value.toFixed(1)} / 5<small>{s.rating.votes} votes</small></p> : null)}/>}
      {pair.some(s => s.links.length) && <Row name="Listen" values={two(s => <Links links={s.links}/>)}/>}
      <p className="metadata-note">Tempo, key and audio measurements aren’t shown: there’s no open source for them. People credited on each artist’s albums are below.</p>
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
    <Row name="Recent albums" values={two(x => x.discography?.representative.length ? <div className="inline-credit-list">{recentAlbums(x.discography.representative).slice(0, 3).map(album => <a className="inline-link" key={album.id} href={musicBrainzUrl('release-group', album.id)} target="_blank" rel="noreferrer">{album.title}{album.year ? ` (${album.year})` : ''} ↗</a>)}</div> : null)}/>
    {pair.some(x => x.rating) && <Row name="Rating" values={two(x => x.rating ? <p>{x.rating.value.toFixed(1)} / 5<small>{x.rating.votes} votes</small></p> : null)}/>}
    {pair.some(x => x.links.length) && <Row name="Links" values={two(x => <Links links={x.links}/>)}/>}
    <SharedGenres a={aa} b={ab}/>
    {collab && <Collaborators state={collab} names={[aa.name, ab.name]} role={role} onSelect={onSelect} onCompareSongs={onCompareSongs}/>}
  </section>;
}
