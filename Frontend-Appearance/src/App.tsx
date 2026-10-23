import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight, Check, ChevronDown, ChevronRight,
  CircleUserRound, Compass, Copy, Filter, GitCompareArrows,
  Info, Link2, Menu, Music2, Search, Share2,
  Sparkles, Users, X
} from 'lucide-react';
import {
  artistSongs,
  compareMusic,
  connectedSongs,
  connectedTo,
  connectionBetween,
  genres,
  getAlbum,
  getArtist,
  getSong,
  mutualCollaborators,
  searchArtists,
  searchSongs,
  shortestPath,
  songs
} from './data';
import type { Credit, Song, EntityType, GenreFilter } from './data';
import type { Selection } from './types';
import { buildRoute, buildShareUrl, buildProfileShareUrl, examples, parseRoute } from './routing';
import type { Comparison, Page } from './routing';
import { readStoredProfile, storeProfile } from './profile';
import type { MusicProfile } from './profile';
import { ArtistAvatar, AlbumCover } from './components/Artwork';
import { AboutMe } from './components/AboutMe';
import { ConnectionGraph } from './components/ConnectionGraph';
import { ComparisonDetails } from './components/ComparisonDetails';
import { Modal } from './components/Modal';
import './styles.css';
import './product.css';

function getInitialRoute(fallback?: Comparison) {
  return parseRoute(window.location.hash, fallback);
}
function updateRoute(page: Page, comparison: Comparison, note = '') {
  window.location.hash = buildRoute(page, comparison, note);
}
function MiniArtist({ id, onClick, subtitle }: { id: string; onClick: () => void; subtitle?: string }) {
  const a = getArtist(id); if (!a) return null;
  return <button className="mini-entity" onClick={onClick}><ArtistAvatar artist={a} size="sm" /><span><strong>{a.name}</strong><small>{subtitle || a.subgenres[0]}</small></span><ArrowUpRight size={15} /></button>;
}
function MiniSong({ song, onClick }: { song: Song; onClick: () => void }) {
  return <button className="mini-entity" onClick={onClick}><AlbumCover song={song} size="sm" /><span><strong>{song.title}</strong><small>{song.album} · {song.year}</small></span><ArrowUpRight size={15} /></button>;
}
function CreditRows({ credits, onSelect }: { credits: Credit[]; onSelect: (selection: Selection) => void }) {
  return <>{credits.map(credit => (
    <div className="relation" key={`${credit.role}-${credit.artistId}`}>
      <span className="relation-type">{credit.role}{credit.viaSample ? ' (sample composition)' : ''}</span>
      <MiniArtist
        id={credit.artistId!}
        onClick={() => onSelect({ type: 'artist', id: credit.artistId! })}
      />
    </div>
  ))}</>;
}
function Segment({ value, onChange }: { value: EntityType; onChange: (v: EntityType) => void }) {
  return <div className="compare-switch" role="group" aria-label="Comparison type"><button aria-pressed={value === 'song'} className={value === 'song' ? 'selected' : ''} onClick={() => onChange('song')}><Music2 size={17} /> 2 Songs</button><button aria-pressed={value === 'artist'} className={value === 'artist' ? 'selected' : ''} onClick={() => onChange('artist')}><Users size={17} /> 2 Artists</button></div>;
}
function GenreSelect({ value, onChange }: { value: GenreFilter; onChange: (value: GenreFilter) => void }) {
  return <label className="filter-field"><Filter size={16} /><select aria-label="Filter graph by genre" value={value} onChange={e => onChange(e.target.value as GenreFilter)}><option>All genres</option>{genres.map(g => <option key={g}>{g}</option>)}</select><ChevronDown size={15} /></label>;
}
function DetailDrawer({ selected, onClose, onSelect }: { selected: Selection; onClose: () => void; onSelect: (s: Selection) => void }) {
  const a = selected.type === 'artist' ? getArtist(selected.id) : undefined;
  const s = selected.type !== 'artist' ? getSong(selected.id) : undefined;
  const album = selected.type === 'album';
  if (!a && !s) return null;
  const tracks = a ? artistSongs(a.id) : [];
  const related = a ? connectedTo(a.id) : [];
  return <Modal drawer onClose={onClose} label="Credits and collaborations">
    <div className="drawer-top"><span className="overline">SONG NEXUS / DETAILS</span><button className="icon-button" onClick={onClose} aria-label="Close details"><X size={19} /></button></div>
    <div className="drawer-hero">{a ? <ArtistAvatar artist={a} size="lg" /> : <AlbumCover song={s!} size="lg" />}<h2>{a ? a.name : album ? s!.album : s!.title}</h2><p>{a ? a.subgenres.join(' · ') : `${getArtist(s!.artistId)?.name} · ${s!.album}`}</p><div className="chip-row">{(a ? a.genres : [s!.genre]).map(g => <span className="chip" key={g}>{g}</span>)}</div></div>
    {a ? <>
      <p className="drawer-description">{a.description}</p>
      <div className="drawer-stats"><div><small>Location</small><strong>{a.location}</strong></div><div><small>Role</small><strong>{a.kind === 'contributor' ? 'Credited contributor' : 'Recording artist'}</strong></div></div>
      <section className="drawer-section"><div className="drawer-section-heading"><h3>Recording credits</h3><span>{tracks.length} tracks</span></div><p>Selected recordings and documented performance, production, or composition credits in the local catalog.</p>{tracks.length ? tracks.map(song => <MiniSong key={song.id} song={song} onClick={() => onSelect({ type: 'song', id: song.id })} />) : <p className="muted">No recording credits listed.</p>}</section>
      <section className="drawer-section"><div className="drawer-section-heading"><h3>Collaborations & connections</h3><span>{related.length} links</span></div>{related.length ? related.map(c => { const other = c.from === a.id ? c.to : c.from; return <div className="relation" key={c.id}><span className="relation-type">{c.type}</span><MiniArtist id={other} subtitle={c.detail} onClick={() => onSelect({ type: 'artist', id: other })} /></div>; }) : <p className="muted">No connections listed.</p>}</section>
    </> : <>
      <p className="drawer-description">{s!.subgenre} · {s!.duration} · Released {s!.year}. Credits shown are documented selections; contributor coverage is incomplete.</p>
      <div className={`drawer-stats ${s!.bpm === null ? '' : 'three'}`}><div><small>Album</small><strong>{s!.album}</strong></div>{s!.bpm !== null && <div><small>Tempo</small><strong>{s!.bpm} BPM</strong></div>}<div><small>Duration</small><strong>{s!.duration}</strong></div></div>
      <section className="drawer-section"><div className="drawer-section-heading"><h3>Recording credits</h3><span>{s!.credits.length + 1} credits</span></div><div className="relation"><span className="relation-type">Lead artist</span><MiniArtist id={s!.artistId} onClick={() => onSelect({ type: 'artist', id: s!.artistId })} /></div><CreditRows credits={s!.credits} onSelect={onSelect} /></section>
      {album && !!getAlbum(s!.albumId)?.credits?.length && <section className="drawer-section"><h3>Album contributions</h3><p>Album-level credits; individual track contributions are not inferred.</p><CreditRows credits={getAlbum(s!.albumId)!.credits!} onSelect={onSelect} /></section>}
      {album && <section className="drawer-section"><h3>Tracks in this album</h3>{songs.filter(track => track.albumId === s!.albumId).map(track => <MiniSong key={track.id} song={track} onClick={() => onSelect({ type: 'song', id: track.id })} />)}</section>}
    </>}
    <div className="drawer-tip"><Info size={16} /> Select any artist or song above to keep exploring without leaving the comparison.</div>
  </Modal>;
}

function SearchChooser({ type, value, other, label, onChange }: { type: EntityType; value: string; other: string; label: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const handler = (e: MouseEvent) => { if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', handler); return () => document.removeEventListener('mousedown', handler); }, [open]);
  const items = (type === 'song' ? searchSongs(query) : searchArtists(query)).filter(x => x.id !== other);
  const display = type === 'song' ? getSong(value)?.title : getArtist(value)?.name;
  return <div className="chooser" ref={popRef}><span className="field-label">{label}</span><button className={`chooser-button ${open ? 'open' : ''}`} aria-expanded={open} onClick={() => { setOpen(!open); setQuery(''); }}>{type === 'song' && getSong(value) ? <AlbumCover song={getSong(value)!} size="sm" /> : type === 'artist' && getArtist(value) ? <ArtistAvatar artist={getArtist(value)!} size="sm" /> : <Music2 />}<strong>{display}</strong><ChevronDown size={16} /></button>
    {open && <div className="chooser-popover"><label className="chooser-search"><Search size={17} /><input aria-label={`Search comparison ${type}s`} autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder={`Search ${type === 'song' ? 'songs or artists' : 'artists'}...`} /></label><div className="chooser-results">{items.map(item => { const title = 'title' in item ? item.title : item.name; return <button key={item.id} className="chooser-option" onClick={() => { onChange(item.id); setOpen(false); }}>{'title' in item ? <AlbumCover song={item} size="sm" /> : <ArtistAvatar artist={item} size="sm" />}<span><strong>{title}</strong><small>{'title' in item ? getArtist(item.artistId)?.name : item.subgenres.join(' · ')}</small></span>{value === item.id && <Check size={16} />}</button>; })}{!items.length && <p className="no-match">No matches in the local catalog.</p>}</div></div>}
  </div>;
}
function AudioBars({ a, b }: { a: Song; b: Song }) {
  const rows = [{ key: 'energy', label: 'Energy' }, { key: 'danceability', label: 'Danceability' }, { key: 'acousticness', label: 'Acousticness' }, { key: 'valence', label: 'Positivity' }] as const;
  const hasMeasurements = rows.some(row => a[row.key] !== null || b[row.key] !== null);
  if (!hasMeasurements) return null;
  return <section className="panel audio-panel"><div className="section-title"><div><span className="overline">SOUND PROFILE</span><h3>Beyond the credits</h3></div></div><div className="bar-key"><span><i className="key-a" />{a.title}</span><span><i className="key-b" />{b.title}</span></div>{rows.map(row => <div className="audio-row" key={row.key}><div className="audio-label"><span>{row.label}</span><strong>{a[row.key] ?? '—'} <em>/</em> {b[row.key] ?? '—'}</strong></div><div className="audio-bar">{a[row.key] !== null && <span className="bar-a" style={{ width: `${a[row.key]}%` }} />}{b[row.key] !== null && <span className="bar-b" style={{ width: `${b[row.key]}%` }} />}</div></div>)}</section>;
}
function Explore({ comparison, onComparison, onDetails, note }: { comparison: Comparison; onComparison: (c: Comparison) => void; onDetails: (s: Selection) => void; note: string }) {
  const { kind, left, right } = comparison;
  const filter = comparison.filter || 'All genres';
  const setFilter = (value: GenreFilter) => onComparison({ ...comparison, filter: value });
  const a = kind === 'song' ? getSong(left) : getArtist(left);
  const b = kind === 'song' ? getSong(right) : getArtist(right);
  const first = a ? left : examples[kind][0];
  const second = b ? right : examples[kind][1];
  const sa = kind === 'song' ? getSong(first)! : null;
  const sb = kind === 'song' ? getSong(second)! : null;
  const aa = kind === 'artist' ? getArtist(first)! : null;
  const ab = kind === 'artist' ? getArtist(second)! : null;
  const creditIds = (song: Song) => [song.artistId, ...song.credits.filter(c => c.role !== 'Sample source' && !c.viaSample && c.scope !== 'album').map(c => c.artistId!)];
  const sharedCredits = sa && sb ? [...new Set(creditIds(sa).filter(id => creditIds(sb).includes(id)))] : [];
  const sharedGenres = aa && ab ? aa.genres.filter(g => ab.genres.includes(g)) : [];
  const mutuals = aa && ab ? mutualCollaborators(aa.id, ab.id) : [];
  const direct = aa && ab ? connectionBetween(aa.id, ab.id) : null;
  const musical = compareMusic(kind,first,second);
  const musicalReasons = musical.signals.filter(s => s.shared.length && s.score > 0 && !['Genre','Era'].includes(s.attribute)).map(s => `${s.attribute}: ${s.shared.join(', ')}`);
  const songPath = sa && sb ? shortestPath('song',sa.id,sb.id) : [];
  const directSong = sa && sb ? connectedSongs(sa.id).find(c => c.song.id === sb.id) : null;
  return <div className="explore-page">
    <div className="page-heading"><div><div className="eyebrow"><Sparkles size={14} /> EXPLORE THE MUSIC BEHIND THE MUSIC</div><h1>Find the connection.</h1><p>Compare two tracks or artists, follow their shared connections, and discover the people behind the sound.</p></div><Segment value={kind} onChange={next => onComparison({ kind: next, left: examples[next][0], right: examples[next][1] })} /></div>
    {note && <div className="shared-note"><Link2 size={17} /><div><strong>Shared with a note</strong><p>{note}</p></div><button className="icon-button" onClick={() => updateRoute('explore', comparison)} aria-label="Dismiss shared note"><X size={17} /></button></div>}
    <section className="panel selection-panel"><div className="selection-heading"><div><span className="overline">01 / SELECT MUSIC</span><h2>Choose {kind === 'song' ? 'two songs' : 'two artists'} to compare</h2></div>{kind === 'artist' && <span className="mini-caption">Search our sample music library</span>}</div><div className="select-grid"><SearchChooser type={kind} value={first} other={second} label={kind === 'song' ? 'SONG ONE' : 'ARTIST ONE'} onChange={v => onComparison({ ...comparison, left: v })} /><span className="vs">VS</span><SearchChooser type={kind} value={second} other={first} label={kind === 'song' ? 'SONG TWO' : 'ARTIST TWO'} onChange={v => onComparison({ ...comparison, right: v })} /></div>
      <div className="selected-cards">{[first, second].map((id, i) => { const song = kind === 'song' ? getSong(id) : null; const artist = kind === 'artist' ? getArtist(id) : null; return <button className="selected-card" key={`${kind}-${id}`} onClick={() => onDetails({ type: kind, id })}>{song ? <AlbumCover song={song} size="lg" /> : <ArtistAvatar artist={artist!} size="lg" />}<span className="selected-card-info"><span className="selected-index">{i === 0 ? '01 / LEFT' : '02 / RIGHT'}</span><strong>{song ? song.title : artist!.name}</strong><small>{song ? `${getArtist(song.artistId)?.name} · ${song.album} · ${song.year}` : artist!.subgenres.join(' · ')}</small><span className="selected-details">View {kind === 'artist' ? 'credits & collaborations' : 'track credits'} <ArrowUpRight size={14} /></span></span></button>; })}</div>
    </section>
    <ComparisonDetails kind={kind} left={first} right={second} onSelect={onDetails} />
    <div className="content-columns"><section className="panel graph-panel"><div className="graph-heading"><div><span className="overline">02 / CONNECTION WEB</span><h2>How they're connected</h2><p>{kind === 'song' ? 'Select a song to see its credits or expand related songs.' : 'Select an artist to see credits, collaborators, and related music.'}</p></div><GenreSelect value={filter} onChange={setFilter} /></div><ConnectionGraph kind={kind} left={first} right={second} filter={filter} onSelect={onDetails} /></section>
      <aside className="right-column"><section className="panel insights"><div className="section-title"><div><span className="overline">03 / DISCOVER INSIGHTS</span><h3>What connects them?</h3></div><GitCompareArrows size={20} /></div>
        {sa && sb ? <><div className="insight-block"><span className="insight-number">01</span><div><strong>Shared credited contributors</strong><p>{sharedCredits.length ? sharedCredits.map(id => <button className="inline-link" key={id} onClick={() => onDetails({ type: 'artist', id })}>{getArtist(id)?.name} ↗</button>) : 'No identical contributors documented for these two tracks.'}</p></div></div><div className="insight-block"><span className="insight-number">02</span><div><strong>Musical similarity · calculated</strong><p>{musicalReasons.length ? musicalReasons.join('; ') : 'No specific musical overlap supported by available metadata.'}</p></div></div><div className="insight-block"><span className="insight-number">03</span><div><strong>Factual recording path</strong><p>{directSong ? `${directSong.label}: ${directSong.detail}` : songPath.length ? songPath.map(id => getSong(id)!.title).join(' → ') : 'No verified recording path in this catalog.'}</p></div></div></>
          : <><div className="insight-block"><span className="insight-number">01</span><div><strong>Direct connection</strong><p>{direct ? `${direct.type} — ${direct.detail}` : 'No direct relationship in our sample data.'}</p></div></div><div className="insight-block"><span className="insight-number">02</span><div><strong>Mutual collaborators</strong><p>{mutuals.length ? mutuals.map(id => <button className="inline-link" key={id} onClick={() => onDetails({ type: 'artist', id })}>{getArtist(id)?.name} ↗</button>) : 'No shared collaborators in the sample network.'}</p></div></div><div className="insight-block"><span className="insight-number">03</span><div><strong>Genre overlap</strong><p>{sharedGenres.length ? sharedGenres.join(', ') : 'Their main styles differ—follow the network to see where they meet.'}</p></div></div></>}
      </section>
        <section className="panel quick-peek"><span className="overline">GO DEEPER</span><h3>The people behind the music</h3><p>Click an artist in the web or choose one below to see their featured tracks, credits, and collaborators.</p>{(kind === 'artist' ? [first, second] : [sa!.artistId, sb!.artistId]).filter((v, i, arr) => arr.indexOf(v) === i).map(id => <MiniArtist key={id} id={id} onClick={() => onDetails({ type: 'artist', id })} />)}</section>
      </aside></div>
    {sa && sb && <AudioBars a={sa} b={sb} />}
  </div>;
}

function ShareModal({ page, comparison, profile, onClose }: { page: Page; comparison: Comparison; profile: MusicProfile; onClose: () => void }) {
  const [note, setNote] = useState(''); const [copied, setCopied] = useState(false); const [copyError, setCopyError] = useState(false);
  const sharingProfile = page === 'about';
  const url = sharingProfile ? buildProfileShareUrl(window.location.href, profile, note) : buildShareUrl(window.location.href, comparison, note);
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { const el = document.createElement('textarea'); el.value = url; document.body.appendChild(el); el.select(); const success = document.execCommand('copy'); setCopied(success); setCopyError(!success); el.remove(); } };
  return <Modal onClose={onClose} label={sharingProfile ? 'Share music profile' : 'Share music comparison'}>
    <div className="modal-heading"><div className="overline">{sharingProfile ? 'SHARE YOUR MUSIC TASTE' : 'SHARE A DISCOVERY'}</div><button className="icon-button" onClick={onClose} aria-label="Close share"><X size={19} /></button></div>
    <div className="share-emblem"><Share2 size={23} /></div>
    <h2>{sharingProfile ? 'Share your About Me.' : 'Pass the connection along.'}</h2>
    <p className="share-pair">{sharingProfile ? `${profile.artists.length} artists · ${profile.genres.length} genres · ${profile.albums.length} albums · ${profile.songs.length} songs` : <>{comparison.kind === 'song' ? getSong(comparison.left)?.title : getArtist(comparison.left)?.name} ↔ {comparison.kind === 'song' ? getSong(comparison.right)?.title : getArtist(comparison.right)?.name}</>}</p>
    <p>{sharingProfile ? 'Copy a snapshot of your favorite artists, genres, albums, and songs. Anyone with the link can view it.' : 'Copy a link to these selections and their genre filter.'}</p>
    <label className="field-label" htmlFor="share-note">OPTIONAL MESSAGE</label><textarea id="share-note" maxLength={300} value={note} onChange={e => { setNote(e.target.value); setCopied(false); }} placeholder={sharingProfile ? 'A little about my music taste...' : 'This is why these two sound so familiar...'} />
    <label className="field-label" htmlFor="share-url">LINK</label><input id="share-url" readOnly value={url} onFocus={e => e.currentTarget.select()} />
    {copyError && <p className="error-text" role="alert">Copy was unavailable. Select the link above and copy it manually.</p>}
    <div className="share-actions"><button className="primary-button" onClick={() => void copy()}>{copied ? <Check size={17} /> : <Copy size={17} />} {copied ? 'Copied!' : 'Copy link'}</button>{typeof navigator.share === 'function' && <button className="secondary-button" onClick={() => void navigator.share({ title: sharingProfile ? 'Song Nexus music profile' : 'Song Nexus comparison', url, text: note }).catch(() => { })}><Share2 size={16} /> Share via...</button>}</div>
    <p className="fine-print"><Info size={15} />{sharingProfile ? 'Links open this shared About Me snapshot when this website is hosted.' : 'Links open the same comparison when this website is hosted.'}</p>
  </Modal>;
}
function App() {
  const [initial] = useState(getInitialRoute);
  const [page, setPage] = useState<Page>(initial.page);
  const [comparison, setComparison] = useState<Comparison>(initial.comparison);
  const [note, setNote] = useState(initial.note);
  const [profile, setProfile] = useState(readStoredProfile);
  const [sharedProfile, setSharedProfile] = useState(initial.profile);
  useEffect(() => { storeProfile(profile); }, [profile]);
  const [detail, setDetail] = useState<Selection | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const handle = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [menuOpen]);
  useEffect(() => { const handle = () => { const next = getInitialRoute(comparison); setPage(next.page); setComparison(next.comparison); setNote(next.note); setSharedProfile(next.profile); setDetail(null); setShareOpen(false); setMenuOpen(false); }; window.addEventListener('hashchange', handle); return () => window.removeEventListener('hashchange', handle); }, [comparison]);
  const navigate = (p: Page) => { setPage(p); setSharedProfile(undefined); setNote(''); setDetail(null); setShareOpen(false); setMenuOpen(false); updateRoute(p, comparison); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const updateComparison = (next: Comparison) => { setComparison(next); setNote(''); updateRoute('explore', next); };
  return <div className="app-shell"><div className={`sidebar-backdrop ${menuOpen ? 'visible' : ''}`} onClick={() => setMenuOpen(false)} /><aside className={`sidebar ${menuOpen ? 'open' : ''}`}><button className="brand" onClick={() => navigate('about')} aria-label="Song Nexus home"><span className="brand-mark"><Music2 size={28} strokeWidth={2.5} /></span><span><strong>SONG NEXUS</strong></span></button><div className="sidebar-navigation"><span className="nav-caption">YOUR WORKSPACE</span><nav aria-label="Main navigation"><button className={`nav-option ${page === 'about' ? 'active' : ''}`} aria-label="About Me" aria-current={page === 'about' ? 'page' : undefined} onClick={() => navigate('about')}><CircleUserRound size={22} /><span>About Me</span>{page === 'about' && <span className="nav-track" />}</button><button className={`nav-option ${page === 'explore' ? 'active' : ''}`} aria-label="Explore" aria-current={page === 'explore' ? 'page' : undefined} onClick={() => navigate('explore')}><Compass size={22} /><span>Explore</span>{page === 'explore' && <span className="nav-track" />}</button></nav></div><div className="sidebar-bottom"><div className="sidebar-status"><span className="status-dot" />#<span>v2.0</span></div></div></aside>
    <div className="page-column"><header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu size={23} /></button><button className="header-wordmark" onClick={() => navigate('about')} aria-label="Song Nexus home"><Music2 size={21} /> SONG NEXUS<span></span></button><ChevronRight size={15} /><strong>{page === 'about' ? 'About Me' : 'Explore'}</strong></div><div className="topbar-right"><button className="top-share" aria-label="Share" onClick={() => setShareOpen(true)}><Share2 size={17} /><span>Share</span></button></div></header>
      <main className="main-content">{page === 'about' ? <>{sharedProfile && <div className="shared-note"><CircleUserRound size={20} /><div><strong>Shared About Me</strong><p>{note || 'You’re viewing a shared music taste profile.'}</p></div><button className="secondary-button" onClick={() => navigate('about')}>View my About Me</button></div>}<AboutMe key={sharedProfile ? 'shared' : 'own'} onSelect={setDetail} profile={sharedProfile || profile} onProfileChange={setProfile} readOnly={!!sharedProfile} /></> : <Explore comparison={comparison} onComparison={updateComparison} onDetails={setDetail} note={note} />}<footer><span>SONG NEXUS</span></footer></main>
    </div>{detail && <DetailDrawer selected={detail} onClose={() => setDetail(null)} onSelect={setDetail} />}{shareOpen && <ShareModal page={page} comparison={comparison} profile={sharedProfile || profile} onClose={() => setShareOpen(false)} />}</div>;
}
export default App;
