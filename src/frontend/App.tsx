'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import {
  ArrowUpRight, Check, ChevronDown, ChevronRight, Network,
  CircleUserRound, Compass, Copy, Filter, GitCompareArrows,
  Heart, Info, Link2, Menu, Music2, Share2,
  Sparkles, Users, X
} from 'lucide-react';
import type { ArtistDetails, RecordingDetails, TrackRef } from '@/lib/types';
import { formatDuration, partitionGenres } from '@/lib/types';
import { artistDetails, artistInsights, collaborators, moreCredits, songDetails, soundComparison, topTrack } from './api';
import type { SimilarSong } from '@/lib/sound';
import { findRecording } from './resolve';
import { SearchChooser } from './components/SearchChooser';
import { SongAnalysis } from './components/SongAnalysis';
import { buildGraph, songArtistPair } from './graph';
import type { GraphInput } from './graph';
import { albumSampleNote, artistCover, artistSubtitle, capitalize, lifeSpanLabels, linkLabel, uniqueLinks, musicBrainzUrl, recentAlbums, ROLE_LABELS, roleText, songArtists, studioAlbumText, yearOf } from './model';
import { albumSnapshot, artistSnapshot, readStoredProfile, songSnapshot, storeProfile } from './profile';
import type { MusicProfile } from './profile';
import { buildPath, buildProfileShareUrl, buildShareUrl, comparisonFor, defaultWeb, parseRoute, ROLE_FILTERS } from './routing';
import type { Comparison, Route } from './routing';
import type { EntityType, Selection } from './types';
import { useAsync } from './useAsync';
import { ArtistAvatar, ArtistPicture, AlbumCover } from './components/Artwork';
import { AboutMe, useTaste } from './components/AboutMe';
import { ConnectionGraph } from './components/ConnectionGraph';
import { ConnectionWeb } from './components/ConnectionWeb';
import { Friends } from './components/TasteWeb';
import { ComparisonDetails } from './components/ComparisonDetails';
import { ArtistInsightsPanel } from './components/ArtistInsightsPanel';
import { Modal } from './components/Modal';

type Details = ArtistDetails | RecordingDetails;
const loadDetails = (kind: EntityType, id: string): Promise<Details> => (kind === 'artist' ? artistDetails(id) : songDetails(id));
const nameOf = (d?: Details) => (d ? ('title' in d ? d.title : d.name) : '');

// `picture` loads the artist's details for a cover; leave it off for long or speculative lists.
function MiniArtist({ artist, onClick, subtitle, picture = true }: { artist: { id: string; name: string }; onClick: () => void; subtitle?: string; picture?: boolean }) {
  return <button className="mini-entity" onClick={onClick}>{picture ? <ArtistPicture artist={artist} size="sm" /> : <ArtistAvatar artist={artist} size="sm" />}<span><strong>{artist.name}</strong>{subtitle && <small>{subtitle}</small>}</span><ArrowUpRight size={15} /></button>;
}
function Segment({ value, onChange }: { value: EntityType; onChange: (v: EntityType) => void }) {
  return <div className="compare-switch" role="group" aria-label="Comparison type"><button aria-pressed={value === 'song'} className={value === 'song' ? 'selected' : ''} onClick={() => onChange('song')}><Music2 size={17} /> 2 Songs</button><button aria-pressed={value === 'artist'} className={value === 'artist' ? 'selected' : ''} onClick={() => onChange('artist')}><Users size={17} /> 2 Artists</button></div>;
}
// Helen's genre filter, repurposed: collaborators carry credited roles, not genres.
function RoleSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label className="filter-field"><Filter size={16} /><select aria-label="Filter collaborators by role" value={value} onChange={e => onChange(e.target.value)}>{ROLE_FILTERS.map(role => <option key={role} value={role}>{role === 'all' ? 'All roles' : ROLE_LABELS[role]}</option>)}</select><ChevronDown size={15} /></label>;
}
const LoadError = ({ error, retry }: { error: Error; retry: () => void }) =>
  <div className="load-error" role="alert"><p className="error-text">{error.message}</p><button className="secondary-button" onClick={retry}>Try again</button></div>;

function DetailDrawer({ selected, onClose, onSelect, profile, onProfileChange, onCompare }: { selected: Selection; onClose: () => void; onSelect: (s: Selection) => void; profile: MusicProfile; onProfileChange: Dispatch<SetStateAction<MusicProfile>>; onCompare: (kind: EntityType, id: string) => void }) {
  const [notice, setNotice] = useState('');
  const toggle = useTaste(profile, onProfileChange, setNotice);
  const state = useAsync(selected.type === 'album' ? null : `${selected.type}:${selected.id}`, () => loadDetails(selected.type as EntityType, selected.id));
  const top = <div className="drawer-top"><span className="overline">SONG NEXUS / DETAILS</span><button className="icon-button" onClick={onClose} aria-label="Close details"><X size={19} /></button></div>;
  const tip = notice ? <div className="drawer-tip" role="status"><Check size={16} /> {notice}</div> : <div className="drawer-tip"><Info size={16} /> Select any artist above to keep exploring without leaving the comparison.</div>;
  const heart = (added: boolean, onClick: () => void) => <button className={`secondary-button ${added ? 'is-saved' : ''}`} onClick={onClick}><Heart size={15} fill={added ? 'currentColor' : 'none'} /> {added ? 'In your taste' : 'Add to your taste'}</button>;

  if (selected.type === 'album') {
    const al = selected.album;
    return <Modal drawer onClose={onClose} label="Album details">{top}
      <div className="drawer-hero"><AlbumCover cover={al} size="lg" /><h2>{al.title}</h2><p>{al.artist}{al.year ? ` · ${al.year}` : ''}</p></div>
      <div className="drawer-actions">{heart(profile.albums.some(x => x.id === al.id), () => toggle.album(al))}<a className="secondary-button" href={musicBrainzUrl('release-group', al.id)} target="_blank" rel="noreferrer">View on MusicBrainz <ArrowUpRight size={14} /></a></div>
      {al.artistId && <section className="drawer-section"><div className="drawer-section-heading"><h3>Artist</h3></div><MiniArtist artist={{ id: al.artistId, name: al.artist }} onClick={() => onSelect({ type: 'artist', id: al.artistId! })} /></section>}
      {tip}
    </Modal>;
  }

  const body = () => {
    if (state.error) return <LoadError error={state.error} retry={state.retry} />;
    if (!state.data) return <div className="drawer-hero" aria-busy="true"><div className="skeleton-lines"><span /><span /><span /></div><p className="loading-text">Loading from MusicBrainz…</p></div>;
    if (selected.type === 'artist') {
      const a = state.data as ArtistDetails;
      const labels = lifeSpanLabels(a.type);
      const albums = recentAlbums(a.discography?.representative ?? []);
      return <>
        <div className="drawer-hero"><ArtistAvatar artist={{ ...a, artUrl: artistCover(a) }} size="lg" /><h2>{a.name}</h2><p>{artistSubtitle(a)}</p><div className="chip-row">{a.genres.slice(0, 5).map(g => <span className="chip" key={g.name}>{capitalize(g.name)}</span>)}</div></div>
        {a.disambiguation && <p className="drawer-description">{a.disambiguation}</p>}
        <div className="drawer-actions">{heart(profile.artists.some(x => x.id === a.id), () => toggle.artist(artistSnapshot(a)))}<button className="secondary-button" onClick={() => onCompare('artist', a.id)}><GitCompareArrows size={15} /> Compare</button></div>
        <div className="drawer-stats"><div><small>{labels.begin}</small><strong>{a.lifeSpan.begin || '—'}</strong></div><div><small>From</small><strong>{a.area || a.country || '—'}</strong></div><div><small>Studio albums</small><strong>{studioAlbumText(a)}</strong></div><div><small>Rating</small><strong>{a.rating ? `${a.rating.value.toFixed(1)} / 5 (${a.rating.votes})` : '—'}</strong></div></div>
        <section className="drawer-section"><div className="drawer-section-heading"><h3>Studio albums</h3><span>{albumSampleNote(a) || 'newest first'}</span></div>{albums.length ? albums.map(al => { const snap = albumSnapshot(al, a); const added = profile.albums.some(x => x.id === al.id); return <div className="album-row" key={al.id}><a className="mini-entity" href={musicBrainzUrl('release-group', al.id)} target="_blank" rel="noreferrer"><AlbumCover cover={al} size="sm" /><span><strong>{al.title}</strong><small>{al.year || 'Year unknown'}</small></span><ArrowUpRight size={15} /></a><button className="icon-button" aria-pressed={added} aria-label={`${added ? 'Remove' : 'Add'} ${al.title} ${added ? 'from' : 'to'} your taste`} onClick={() => toggle.album(snap)}><Heart size={15} fill={added ? 'currentColor' : 'none'} /></button></div>; }) : <p>No studio albums listed on MusicBrainz.</p>}</section>
        {!!a.links.length && <section className="drawer-section"><div className="drawer-section-heading"><h3>Listen & learn more</h3></div><div className="link-pills">{uniqueLinks(a.links).map(link => <a key={link.url} href={link.url} target="_blank" rel="noreferrer">{linkLabel(link)} ↗</a>)}</div></section>}
      </>;
    }
    const s = state.data as RecordingDetails;
    return <>
      <div className="drawer-hero"><AlbumCover cover={{ id: s.id, artUrl: s.representative?.artUrl }} size="lg" /><h2>{s.title}</h2><p>{songArtists(s)}{s.representative ? ` · ${s.representative.title}` : ''}</p><div className="chip-row">{(s.genres.length ? s.genres.map(g => g.name) : s.tags).slice(0, 5).map(g => <span className="chip" key={g}>{capitalize(g)}</span>)}</div></div>
      {s.disambiguation && <p className="drawer-description">{s.disambiguation}</p>}
      <div className="drawer-actions">{heart(profile.songs.some(x => x.id === s.id), () => toggle.song(songSnapshot(s)))}<button className="secondary-button" onClick={() => onCompare('song', s.id)}><GitCompareArrows size={15} /> Compare</button></div>
      <div className="drawer-stats three"><div><small>Released</small><strong>{s.firstReleaseDate || '—'}</strong></div><div><small>Length</small><strong>{s.durationMs == null ? '—' : formatDuration(s.durationMs)}</strong></div><div><small>Rating</small><strong>{s.rating ? `${s.rating.value.toFixed(1)} / 5` : '—'}</strong></div></div>
      <section className="drawer-section"><div className="drawer-section-heading"><h3>Credited artists</h3><span>{s.artists.length}</span></div>{s.artists.map(artist => artist.id ? <div className="relation" key={artist.id}><span className="relation-type">Artist</span><MiniArtist artist={{ id: artist.id, name: artist.name }} onClick={() => onSelect({ type: 'artist', id: artist.id! })} /></div> : <p key={artist.name}>{artist.name}</p>)}</section>
      {!!s.releases.length && <section className="drawer-section"><div className="drawer-section-heading"><h3>Appears on</h3></div>{s.releases.map(r => <a className="mini-entity" key={r.id} href={musicBrainzUrl('release', r.id)} target="_blank" rel="noreferrer"><span><strong>{r.title}</strong><small>{r.date || 'Date unknown'}</small></span><ArrowUpRight size={15} /></a>)}</section>}
      {!!s.links.length && <section className="drawer-section"><div className="drawer-section-heading"><h3>Listen</h3></div><div className="link-pills">{uniqueLinks(s.links).map(link => <a key={link.url} href={link.url} target="_blank" rel="noreferrer">{linkLabel(link)} ↗</a>)}</div></section>}
    </>;
  };
  return <Modal drawer onClose={onClose} label={selected.type === 'artist' ? 'Artist details' : 'Song details'}>{top}{body()}{tip}</Modal>;
}

function SelectedCard({ kind, index, state, onDetails }: { kind: EntityType; index: number; state: ReturnType<typeof useAsync<Details>>; onDetails: (s: Selection) => void }) {
  const tag = <span className="selected-index">{index === 0 ? '01 / LEFT' : '02 / RIGHT'}</span>;
  if (state.error) return <div className="selected-card"><span className="selected-card-info">{tag}<LoadError error={state.error} retry={state.retry} /></span></div>;
  const d = state.data;
  if (!d) return <div className="selected-card is-loading" aria-busy="true"><span className="skeleton-art" /><span className="selected-card-info">{tag}<span className="skeleton-lines"><span /><span /></span></span></div>;
  const song = 'title' in d ? d : null, artist = song ? null : (d as ArtistDetails);
  const subtitle = song ? [songArtists(song), song.representative?.title, yearOf(song.firstReleaseDate)].filter(Boolean).join(' · ') : [artist!.genres.slice(0, 3).map(g => capitalize(g.name)).join(' · '), artist!.area || artist!.country].filter(Boolean).join(' · ') || artistSubtitle(artist!);
  return <button className="selected-card" onClick={() => onDetails({ type: kind, id: d.id })}>{song ? <AlbumCover cover={{ id: song.id, artUrl: song.representative?.artUrl }} size="lg" /> : <ArtistAvatar artist={{ ...artist!, artUrl: artistCover(artist!) }} size="lg" />}<span className="selected-card-info">{tag}<strong>{nameOf(d)}</strong><small>{subtitle}</small><span className="selected-details">View {kind === 'artist' ? 'details & albums' : 'song details'} <ArrowUpRight size={14} /></span></span></button>;
}

function Explore({ comparison, onComparison, onRole, onDetails, note, onDismissNote }: { comparison: Comparison; onComparison: (c: Comparison) => void; onRole: (role: string) => void; onDetails: (s: Selection) => void; note: string; onDismissNote: () => void }) {
  const { kind, left, right } = comparison;
  const role = comparison.role || 'all';
  const da = useAsync<Details>(`${kind}:${left}`, () => loadDetails(kind, left));
  const db = useAsync<Details>(`${kind}:${right}`, () => loadDetails(kind, right));
  const a = da.data, b = db.data;
  // Artist pairs scan both artists' albums; song pairs scan the two songs' lead artists (when different).
  const pair = kind === 'artist' ? [left, right] : a && b ? songArtistPair(a as RecordingDetails, b as RecordingDetails)?.map(x => x.id) ?? null : null;
  const collab = useAsync(pair ? `collab:${pair[0]}:${pair[1]}` : null, () => collaborators(pair![0], pair![1]));
  const collabData = collab.data;
  // Artist pairs also get other sources: credits from Genius and Discogs, then facts about each artist.
  const more = useAsync(kind === 'artist' ? `credits:${left}:${right}` : null, () => moreCredits(left, right));
  const insights = useAsync(kind === 'artist' ? `insights:${left}:${right}` : null, () => artistInsights(left, right));
  const input = useMemo(() => (a && b ? ({ kind, a, b, collab: collabData, role } as GraphInput) : null), [kind, a, b, collabData, role]);
  const base = useMemo(() => (input ? buildGraph(input, [], false) : null), [input]);
  const [top, setTop] = useState<{ busy: boolean; error?: string }>({ busy: false });
  // Song pairs also get sound and lyrics: tempo, key, mood, a match score and similar-sounding songs.
  const songs = kind === 'song' && a && b ? [a as RecordingDetails, b as RecordingDetails] as [RecordingDetails, RecordingDetails] : null;
  const sound = useAsync(songs ? `sound:${songs[0].id}:${songs[1].id}` : null, () => soundComparison(songs![0], songs![1]));
  const soundResult = sound.data?.status === 'ok' ? sound.data.comparison : null;
  const [pick, setPick] = useState<{ id?: string; error?: string }>({});
  // A similar-sounding song comes from the Spotify dataset; find it on MusicBrainz to compare it.
  const compareWithSimilar = async (song: SimilarSong) => {
    const row = { title: song.title, artist: song.artists[0] ?? '' };
    setPick({ id: song.id });
    try {
      const found = await findRecording(row.title, row.artist);
      if (!found) { setPick({ error: `Couldn’t find “${song.title}” on MusicBrainz.` }); return; }
      setPick({});
      onComparison(comparisonFor('song', left, found.id));
    } catch (e) { setPick({ error: e instanceof Error ? e.message : 'Search failed.' }); }
  };

  const compareSongs = (ta: TrackRef, tb: TrackRef) => onComparison(comparisonFor('song', ta.id, tb.id));
  const compareTopSongs = async () => {
    if (!a || !b || kind !== 'artist') return;
    setTop({ busy: true });
    try {
      const [ta, tb] = await Promise.all([topTrack(a.id, nameOf(a)), topTrack(b.id, nameOf(b))]);
      if (!ta || !tb) { setTop({ busy: false, error: `Couldn’t match a top song for ${!ta ? nameOf(a) : nameOf(b)} on MusicBrainz.` }); return; }
      setTop({ busy: false });
      onComparison(comparisonFor('song', ta.id, tb.id));
    } catch (e) { setTop({ busy: false, error: e instanceof Error ? e.message : 'Could not find top songs.' }); }
  };

  const sharedGenres = a && b ? partitionGenres(a.genres, b.genres).shared.map(capitalize) : [];
  const mutual = (collabData?.mutual ?? []).filter(c => role === 'all' || c.roles.a.includes(role) || c.roles.b.includes(role));
  const pathText = base && base.path.length ? base.path.map(id => base.nodes.find(n => n.id === id)?.label).join(' → ') : '';
  const collabPending = !!pair && collab.loading;
  const graphStatus = collabPending ? 'Finding people credited on both artists’ albums… (up to a minute the first time)' : collab.error ? `Couldn’t load collaborators: ${collab.error.message}` : '';
  const people = kind === 'artist' ? [a, b].filter(Boolean).map(x => ({ id: x!.id, name: nameOf(x) }))
    : [a, b].flatMap(s => (s as RecordingDetails | undefined)?.artists.filter(x => x.id).slice(0, 1).map(x => ({ id: x.id!, name: x.name })) ?? []).filter((v, i, arr) => arr.findIndex(x => x.id === v.id) === i);
  const insight = (n: string, title: string, body: ReactNode) => <div className="insight-block"><span className="insight-number">{n}</span><div><strong>{title}</strong><p>{body}</p></div></div>;
  const mutualLinks = mutual.length ? mutual.slice(0, 4).map(c => <button className="inline-link" key={c.id} onClick={() => onDetails({ type: 'artist', id: c.id })}>{c.name} · {roleText([...new Set([...c.roles.a, ...c.roles.b])])} ↗</button>) : null;

  return <div className="explore-page">
    <div className="page-heading"><div><div className="eyebrow"><Sparkles size={14} /> EXPLORE THE MUSIC BEHIND THE MUSIC</div><h1>Find the connection.</h1><p>Compare two tracks or artists, follow their shared connections, and discover the people behind the sound.</p></div><Segment value={kind} onChange={next => onComparison(comparisonFor(next))} /></div>
    {note && <div className="shared-note"><Link2 size={17} /><div><strong>Shared with a note</strong><p>{note}</p></div><button className="icon-button" onClick={onDismissNote} aria-label="Dismiss shared note"><X size={17} /></button></div>}
    <section className="panel selection-panel"><div className="selection-heading"><div><span className="overline">01 / SELECT MUSIC</span><h2>Choose {kind === 'song' ? 'two songs' : 'two artists'} to compare</h2></div>{kind === 'artist' ? <button className="secondary-button" disabled={!a || !b || top.busy} onClick={() => void compareTopSongs()}><Music2 size={15} /> {top.busy ? 'Finding top songs…' : 'Compare their top songs'}</button> : <span className="mini-caption">Search the song library for the full sound and lyrics analysis</span>}</div>
      {top.error && <p className="error-text" role="alert">{top.error}</p>}
      <div className="select-grid"><SearchChooser type={kind} value={left} display={a} other={right} label={kind === 'song' ? 'SONG ONE' : 'ARTIST ONE'} onChange={v => onComparison({ ...comparison, left: v })} /><span className="vs">VS</span><SearchChooser type={kind} value={right} display={b} other={left} label={kind === 'song' ? 'SONG TWO' : 'ARTIST TWO'} onChange={v => onComparison({ ...comparison, right: v })} /></div>
      <div className="selected-cards"><SelectedCard kind={kind} index={0} state={da} onDetails={onDetails} /><SelectedCard kind={kind} index={1} state={db} onDetails={onDetails} /></div>
    </section>
    {/* Songs: the sound and lyrics analysis is the comparison; release details and credits follow. */}
    {kind === 'song' && (songs ? <SongAnalysis sound={sound} songs={songs} onPickSimilar={song => void compareWithSimilar(song)} busyId={pick.id} pickError={pick.error} /> : <section className="panel match-panel" aria-busy="true"><p className="loading-text">Loading the songs…</p><div className="skeleton-lines"><span /><span /></div></section>)}
    {kind === 'artist' && <ArtistInsightsPanel state={insights} names={[a ? nameOf(a) : 'Artist one', b ? nameOf(b) : 'Artist two']} />}
    <ComparisonDetails kind={kind} a={a} b={b} collab={pair ? collab : null} more={kind === 'artist' ? more : undefined} role={role} onSelect={onDetails} onCompareSongs={compareSongs} />
    <div className="content-columns"><section className="panel graph-panel"><div className="graph-heading"><div><span className="overline">{kind === 'song' ? '08' : '02'} / CONNECTION WEB</span><h2>How they’re connected</h2><p>Solid lines are credits on MusicBrainz; dotted is a songwriting credit alone; dashed is shared genre tags. Select a person to see the songs that connect them.</p></div><RoleSelect value={role} onChange={onRole} /></div>
      {input ? <ConnectionGraph key={`${kind}:${left}:${right}:${role}`} input={input} status={graphStatus} onSelect={onDetails} /> : da.error || db.error ? <LoadError error={(da.error || db.error)!} retry={() => { da.retry(); db.retry(); }} /> : <div className="graph-canvas graph-loading" aria-busy="true"><div className="graph-grid" /><p className="loading-text">Loading from MusicBrainz…</p></div>}
    </section>
      <aside className="right-column"><section className="panel insights"><div className="section-title"><div><span className="overline">{kind === 'song' ? '09' : '03'} / DISCOVER INSIGHTS</span><h3>What connects them?</h3></div><GitCompareArrows size={20} /></div>
        {kind === 'artist' ? <>
          {insight('01', 'Direct connection', collabPending ? 'Checking album credits…' : collabData && (collabData.direct.bOnA.length || collabData.direct.aOnB.length)
            ? [collabData.direct.bOnA.length ? `${nameOf(b)} is credited on ${nameOf(a)}’s “${collabData.direct.bOnA[0].title}”.` : '', collabData.direct.aOnB.length ? `${nameOf(a)} is credited on ${nameOf(b)}’s “${collabData.direct.aOnB[0].title}”.` : ''].filter(Boolean).join(' ')
            : collabData?.writing && (collabData.writing.bOnA.length || collabData.writing.aOnB.length)
              ? [collabData.writing.bOnA.length ? `${nameOf(b)} has a songwriting credit on ${nameOf(a)}’s “${collabData.writing.bOnA[0].title}”.` : '', collabData.writing.aOnB.length ? `${nameOf(a)} has a songwriting credit on ${nameOf(b)}’s “${collabData.writing.aOnB[0].title}”.` : '', 'Writing credits can come from a sample or interpolation, so this doesn’t by itself mean they worked together.'].filter(Boolean).join(' ')
            : 'Neither is credited on the other’s scanned albums.')}
          {insight('02', 'Mutual collaborators', collabPending ? 'Reading album credits…' : mutualLinks || 'No one is credited on both artists’ scanned albums.')}
          {insight('03', 'Genre overlap', sharedGenres.length ? sharedGenres.slice(0, 5).join(', ') : 'Their MusicBrainz genre tags don’t overlap. Follow the web to see where they meet.')}
        </> : <>
          {insight('01', 'Shared credited artists', a && b ? ((a as RecordingDetails).artists.filter(x => x.id && (b as RecordingDetails).artists.some(y => y.id === x.id)).map(x => x.name).join(', ') || 'Different artists. The web shows who worked with both.') : 'Loading…')}
          {insight('02', 'Musical similarity · calculated', soundResult
            ? `${Math.round(soundResult.overall * 100)}% overall match: sound ${Math.round(soundResult.audio.score * 100)}%, lyrics ${soundResult.lyrics ? `${Math.round(soundResult.lyrics.score * 100)}%` : 'not matched'}.${sharedGenres.length ? ` Shared genres: ${sharedGenres.slice(0, 3).join(', ')}.` : ''}`
            : sound.loading ? 'Measuring their sound and lyrics…'
            : sharedGenres.length ? `Shared genres: ${sharedGenres.slice(0, 5).join(', ')}.` : 'No genre tags in common on MusicBrainz.')}
          {insight('03', 'Factual connection path', pathText || (collabPending ? 'Reading album credits…' : 'No documented path between these two songs in the albums we scanned.'))}
        </>}
      </section>
        <section className="panel quick-peek"><span className="overline">GO DEEPER</span><h3>The people behind the music</h3><p>Click an artist in the web or choose one below to see their albums, links, and genres.</p>{people.map(p => <MiniArtist key={p.id} artist={p} onClick={() => onDetails({ type: 'artist', id: p.id })} />)}{mutual.slice(0, 3).map(c => <MiniArtist key={c.id} artist={c} picture={false} subtitle={`Worked with both · ${roleText([...new Set([...c.roles.a, ...c.roles.b])])}`} onClick={() => onDetails({ type: 'artist', id: c.id })} />)}</section>
      </aside></div>
  </div>;
}

function ShareModal({ route, profile, onClose }: { route: Route; profile: MusicProfile; onClose: () => void }) {
  const [note, setNote] = useState(''); const [copied, setCopied] = useState(false); const [copyError, setCopyError] = useState(false);
  const sharingProfile = route.page === 'about';
  const { comparison } = route;
  const web = route.web ?? defaultWeb();
  const onWeb = route.page === 'connections';
  const onFriends = route.page === 'friends';
  const onTaste = onFriends || (onWeb && web.mode === 'playlist');
  const kind: EntityType = onWeb ? (web.mode === 'song' ? 'song' : 'artist') : comparison.kind;
  const first = onWeb ? (web.mode === 'song' ? web.song : web.artist) : comparison.left;
  const second = comparison.right;
  const left = useAsync<Details>(sharingProfile || onTaste ? null : `${kind}:${first}`, () => loadDetails(kind, first));
  const right = useAsync<Details>(sharingProfile || onWeb ? null : `${kind}:${second}`, () => loadDetails(kind, second));
  const url = sharingProfile ? buildProfileShareUrl(window.location.origin, profile, note) : onFriends ? window.location.href : route.page === 'connections' ? new URL(buildPath('connections', comparison, note, false, web) + window.location.hash, window.location.origin).href : buildShareUrl(window.location.origin, comparison, note);
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { const el = document.createElement('textarea'); el.value = url; document.body.appendChild(el); el.select(); const success = document.execCommand('copy'); setCopied(success); setCopyError(!success); el.remove(); } };
  return <Modal onClose={onClose} label={sharingProfile ? 'Share music profile' : 'Share music comparison'}>
    <div className="modal-heading"><div className="overline">{sharingProfile ? 'SHARE YOUR MUSIC TASTE' : 'SHARE A DISCOVERY'}</div><button className="icon-button" onClick={onClose} aria-label="Close share"><X size={19} /></button></div>
    <div className="share-emblem"><Share2 size={23} /></div>
    <h2>{sharingProfile ? 'Share your About Me.' : 'Pass the connection along.'}</h2>
    <p className="share-pair">{sharingProfile ? `${profile.artists.length} artists · ${profile.genres.length} genres · ${profile.albums.length} albums · ${profile.songs.length} songs` : onFriends ? 'Friends' : onTaste ? 'Connection Web' : onWeb ? `${nameOf(left.data) || '…'} · Connection Web` : `${nameOf(left.data) || '…'} ↔ ${nameOf(right.data) || '…'}`}</p>
    <p>{sharingProfile ? 'Copy a snapshot of your favorite artists, genres, albums, and songs. Anyone with the link can view it.' : route.page === 'connections' ? 'Copy a link to this Connection Web and its selected music.' : 'Copy a link to this comparison and its role filter.'}</p>
    <label className="field-label" htmlFor="share-note">OPTIONAL MESSAGE</label><textarea id="share-note" maxLength={300} value={note} onChange={e => { setNote(e.target.value); setCopied(false); }} placeholder={sharingProfile ? 'A little about my music taste...' : 'This is why these two sound so familiar...'} />
    <label className="field-label" htmlFor="share-url">LINK</label><input id="share-url" readOnly value={url} onFocus={e => e.currentTarget.select()} />
    {copyError && <p className="error-text" role="alert">Copy was unavailable. Select the link above and copy it manually.</p>}
    <div className="share-actions"><button className="primary-button" onClick={() => void copy()}>{copied ? <Check size={17} /> : <Copy size={17} />} {copied ? 'Copied!' : 'Copy link'}</button>{typeof navigator.share === 'function' && <button className="secondary-button" onClick={() => void navigator.share({ title: sharingProfile ? 'Song Nexus music profile' : 'Song Nexus comparison', url, text: note }).catch(() => { })}><Share2 size={16} /> Share via...</button>}</div>
    <p className="fine-print"><Info size={15} />{sharingProfile ? 'The link carries the snapshot itself, so it opens the same About Me for anyone.' : 'The link opens this comparison for anyone, on any device.'}</p>
  </Modal>;
}

function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname, window.location.search));
  const [web, setWeb] = useState(() => route.web ?? defaultWeb());
  const [profile, setProfile] = useState(readStoredProfile);
  useEffect(() => { storeProfile(profile); }, [profile]);
  const [detail, setDetail] = useState<Selection | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { page, comparison, note } = route;
  useEffect(() => {
    if (!menuOpen) return;
    const handle = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [menuOpen]);
  // A bare /compare/artists link gets the default pair written into the URL, so it can be shared.
  useEffect(() => {
    if (route.page === 'about' || route.page === 'friends') return; // Friends links carry a code or playlist to read.
    const path = buildPath(route.page, route.comparison, route.note, false, route.web);
    // The hash holds a friend's playlist on the Connection Web, so it's kept.
    if (window.location.pathname + window.location.search !== path) window.history.replaceState(null, '', path + window.location.hash);
    // Only on first load; later changes go through go().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Back/forward restore the page and comparison from the URL.
  useEffect(() => {
    const handle = () => {
      const next = parseRoute(window.location.pathname, window.location.search);
      setRoute(current => next.page === 'about' || next.page === 'connections' ? { ...next, comparison: current.comparison } : next);
      if (next.web) setWeb(next.web);
      setDetail(null); setShareOpen(false); setMenuOpen(false);
    };
    window.addEventListener('popstate', handle);
    return () => window.removeEventListener('popstate', handle);
  }, []);
  const go = (next: Route, { replace = false, scroll = true } = {}) => {
    const path = buildPath(next.page, next.comparison, next.note, next.manual, next.web ?? web);
    if (replace) window.history.replaceState(null, '', path); else window.history.pushState(null, '', path);
    setRoute(next); if (next.web) setWeb(next.web); setDetail(null); setShareOpen(false); setMenuOpen(false);
    if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const navigate = (p: Route['page']) => go({ page: p, manual: false, comparison, web, note: '' });
  const updateComparison = (next: Comparison) => go({ page: 'explore', manual: false, comparison: next, note: '' }, { scroll: false });
  const compareFrom = (kind: EntityType, id: string) => {
    const keep = comparison.kind === kind ? (comparison.left !== id ? comparison.left : comparison.right) : undefined;
    go({ page: 'explore', manual: false, comparison: comparisonFor(kind, id, keep), note: '' });
  };
  const shared = page === 'about' ? route.profile : undefined;

  return <div className={`app-shell ${page === 'connections' || page === 'friends' ? 'is-connection-web' : ''}`}><div className={`sidebar-backdrop ${menuOpen ? 'visible' : ''}`} onClick={() => setMenuOpen(false)} /><aside className={`sidebar ${menuOpen ? 'open' : ''}`}><button className="brand" onClick={() => navigate('about')} aria-label="Song Nexus home"><span className="brand-mark"><Music2 size={28} strokeWidth={2.5} /></span><span><strong>SONG NEXUS</strong></span></button><div className="sidebar-navigation"><span className="nav-caption">YOUR WORKSPACE</span><nav aria-label="Main navigation"><button className={`nav-option ${page === 'about' ? 'active' : ''}`} aria-label="About Me" aria-current={page === 'about' ? 'page' : undefined} onClick={() => navigate('about')}><CircleUserRound size={22} /><span>About Me</span>{page === 'about' && <span className="nav-track" />}</button><button className={`nav-option ${page === 'connections' ? 'active' : ''}`} aria-label="Connection Web" aria-current={page === 'connections' ? 'page' : undefined} onClick={() => navigate('connections')}><Network size={22} /><span>Connection Web</span>{page === 'connections' && <span className="nav-track" />}</button><button className={`nav-option ${page === 'friends' ? 'active' : ''}`} aria-label="Friends" aria-current={page === 'friends' ? 'page' : undefined} onClick={() => navigate('friends')}><Users size={22} /><span>Friends</span>{page === 'friends' && <span className="nav-track" />}</button><button className={`nav-option ${page === 'explore' ? 'active' : ''}`} aria-label="Explore" aria-current={page === 'explore' ? 'page' : undefined} onClick={() => navigate('explore')}><Compass size={22} /><span>Explore</span>{page === 'explore' && <span className="nav-track" />}</button></nav></div><div className="sidebar-bottom"><div className="sidebar-status"><span className="status-dot" />MUSICBRAINZ<span>v2.0</span></div></div></aside>
    <div className="page-column"><header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu size={23} /></button><button className="header-wordmark" onClick={() => navigate('about')} aria-label="Song Nexus home"><Music2 size={21} /> SONG NEXUS<span></span></button><ChevronRight size={15} /><strong>{page === 'about' ? 'About Me' : page === 'connections' ? 'Connection Web' : page === 'friends' ? 'Friends' : 'Explore'}</strong></div><div className="topbar-right"><button className="top-share" aria-label="Share" onClick={() => setShareOpen(true)}><Share2 size={17} /><span>Share</span></button></div></header>
      <main className={`main-content ${page === 'connections' || page === 'friends' ? 'web-main-content' : ''}`}>{page === 'about' ? <>{shared && <div className="shared-note"><CircleUserRound size={20} /><div><strong>Shared About Me</strong><p>{note || 'You’re viewing a shared music taste profile.'}</p></div><button className="secondary-button" onClick={() => navigate('about')}>View my About Me</button></div>}<AboutMe key={shared ? 'shared' : 'own'} onSelect={setDetail} profile={shared || profile} onProfileChange={setProfile} readOnly={!!shared} manual={route.manual} onManual={open => go({ ...route, manual: open, profile: undefined, note: '' }, { scroll: false })} /></>
        : page === 'friends' ? <Friends onExploreArtist={artist => go({ page: 'connections', manual: false, comparison, web: { ...web, mode: 'artist', artist }, note: '' })} onExploreSong={song => go({ page: 'connections', manual: false, comparison, web: { ...web, mode: 'song', song }, note: '' })} onDetails={setDetail} />
        : page === 'connections' ? <ConnectionWeb selection={web} onChange={next => go({ ...route, web: next, note: '' }, { scroll: false })} onSelect={setDetail} onCompare={(kind, a, b) => go({ page: 'explore', manual: false, comparison: comparisonFor(kind, a, b), note: '' })} note={note} /> : <Explore comparison={comparison} onComparison={updateComparison} onRole={role => go({ ...route, comparison: { ...comparison, role } }, { replace: true, scroll: false })} onDetails={setDetail} note={note} onDismissNote={() => go({ ...route, note: '' }, { replace: true, scroll: false })} />}
        {page !== 'connections' && page !== 'friends' && <footer><span>SONG NEXUS</span><span>Data from <a href="https://musicbrainz.org" target="_blank" rel="noreferrer">MusicBrainz</a> and the <a href="https://coverartarchive.org" target="_blank" rel="noreferrer">Cover Art Archive</a>; top songs, related artists and artist photos from <a href="https://www.deezer.com" target="_blank" rel="noreferrer">Deezer</a>; artist facts from <a href="https://www.wikidata.org" target="_blank" rel="noreferrer">Wikidata</a>, <a href="https://en.wikipedia.org" target="_blank" rel="noreferrer">Wikipedia</a> (CC BY-SA), <a href="https://listenbrainz.org" target="_blank" rel="noreferrer">ListenBrainz</a> and <a href="https://www.last.fm" target="_blank" rel="noreferrer">Last.fm</a>; more credits from <a href="https://genius.com" target="_blank" rel="noreferrer">Genius</a> and <a href="https://www.discogs.com" target="_blank" rel="noreferrer">Discogs</a>; sound from the <a href="https://huggingface.co/datasets/maharshipandya/spotify-tracks-dataset" target="_blank" rel="noreferrer">Spotify tracks dataset</a> and Genius lyrics.</span></footer>}</main>
    </div>{detail && <DetailDrawer selected={detail} onClose={() => setDetail(null)} onSelect={setDetail} profile={profile} onProfileChange={setProfile} onCompare={compareFrom} />}{shareOpen && <ShareModal route={{ ...route, web }} profile={shared || profile} onClose={() => setShareOpen(false)} />}</div>;
}
export default App;
