import { useEffect, useState } from 'react';
import type { CSSProperties, Dispatch, ReactNode, SetStateAction } from 'react';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Disc3, Music2, Plus, Search, Upload, Users, X } from 'lucide-react';
import type { Artist, Song } from '@/lib/types';
import { artistDetails, searchArtists, searchSongs } from '../api';
import { allGenres, familyOf } from '../genres';
import { artistSubtitle, capitalize, colorFor, recentAlbums, songArtists, yearOf, firstRelease } from '../model';
import { albumSnapshot, artistSnapshot, songSnapshot } from '../profile';
import type { MusicProfile, SavedAlbum, SavedArtist, SavedSong } from '../profile';
import type { Selection } from '../types';
import { useAsync } from '../useAsync';
import { ArtistAvatar, ArtistPicture, AlbumCover } from './Artwork';
import { PlaylistUpload } from './PlaylistUpload';

type Category = 'artist' | 'genre' | 'album' | 'song';
type Entry = { id: string; title: string; subtitle: string; visual: ReactNode; added: boolean; toggle: () => void };
const PAGE_SIZE = 12;
const plural = (c: Category) => (c === 'genre' ? 'genres' : `${c}s`);

function PreferenceSection({ title, count, icon, children, onAdd }: { title: string; count: number; icon: ReactNode; children: ReactNode; onAdd?: () => void }) {
  return <section className="panel taste-panel"><div className="taste-heading"><span>{icon}<h2>{title}</h2><small>{count}</small></span>{onAdd && <button className="icon-button" onClick={onAdd} aria-label={`Add ${title.toLowerCase()}`}><Plus size={19}/></button>}</div>{children}</section>;
}

/** Toggles favourites in the profile; shared with the details drawer's "Add to your taste". */
export function useTaste(profile: MusicProfile, onProfileChange: Dispatch<SetStateAction<MusicProfile>>, notify: (text: string) => void) {
  const toggleIn = <K extends 'artists' | 'songs' | 'albums'>(key: K, item: MusicProfile[K][number], title: string) => {
    const has = profile[key].some(x => x.id === item.id);
    onProfileChange(current => ({ ...current, [key]: has ? current[key].filter(x => x.id !== item.id) : [...current[key].filter(x => x.id !== item.id), item] }));
    notify(`${title} ${has ? 'removed from' : 'added to'} your music taste.`);
  };
  return {
    artist: (item: SavedArtist) => toggleIn('artists', item, item.name),
    song: (item: SavedSong) => toggleIn('songs', item, item.title),
    album: (item: SavedAlbum) => toggleIn('albums', item, item.title),
    genre: (genre: string) => {
      const has = profile.genres.includes(genre);
      onProfileChange(current => ({ ...current, genres: has ? current.genres.filter(g => g !== genre) : [...current.genres, genre] }));
      notify(`${capitalize(genre)} ${has ? 'removed from' : 'added to'} your music taste.`);
    },
  };
}

export function AboutMe({ onSelect, profile, onProfileChange, readOnly = false, manual, onManual }: { onSelect: (s: Selection) => void; profile: MusicProfile; onProfileChange: Dispatch<SetStateAction<MusicProfile>>; readOnly?: boolean; manual: boolean; onManual: (open: boolean) => void }) {
  const [category, setCategory] = useState<Category>('artist');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [upload, setUpload] = useState(false);
  const [notice, setNotice] = useState('');
  const [found, setFound] = useState<{ key: string; items?: (Artist | Song)[]; error?: string }>({ key: '' });
  const [albumArtist, setAlbumArtist] = useState<{ id: string; name: string } | null>(null);
  const toggle = useTaste(profile, onProfileChange, setNotice);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 3500); return () => clearTimeout(timer); }, [notice]);

  // Debounced MusicBrainz search; albums search artists first, then list their studio albums.
  const q = query.trim();
  const searchKey = `${category}:${q}`;
  useEffect(() => {
    if (q.length < 2 || category === 'genre') return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const request = category === 'song' ? searchSongs(q, controller.signal) : searchArtists(q, controller.signal, category === 'album' ? 5 : undefined);
      request.then(
        (items: (Artist | Song)[]) => setFound({ key: searchKey, items }),
        error => { if (!controller.signal.aborted) setFound({ key: searchKey, error: error instanceof Error ? error.message : 'Search failed.' }); }
      );
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [category, q, searchKey]);
  const searching = q.length >= 2 && category !== 'genre' && found.key !== searchKey;
  const results = found.key === searchKey ? found.items ?? [] : [];
  const pickedArtist = category === 'album' ? albumArtist ?? (results[0] ? { id: results[0].id, name: (results[0] as Artist).name } : null) : null;
  const albums = useAsync(pickedArtist ? `artist:${pickedArtist.id}` : null, () => artistDetails(pickedArtist!.id));

  const openManual = (c: Category = 'artist') => { setCategory(c); setQuery(''); setPage(0); setAlbumArtist(null); onManual(true); window.scrollTo(0, 0); };
  const back = () => { onManual(false); window.scrollTo(0, 0); };
  const has = (key: 'artists' | 'songs' | 'albums', id: string) => profile[key].some(x => x.id === id);

  const savedEntries = (c: Category): Entry[] =>
    c === 'artist' ? profile.artists.map(a => ({ id: a.id, title: a.name, subtitle: a.subtitle, visual: <ArtistPicture artist={a} size="lg"/>, added: true, toggle: () => toggle.artist(a) }))
    : c === 'song' ? profile.songs.map(s => ({ id: s.id, title: s.title, subtitle: `${s.artist}${s.year ? ` · ${s.year}` : ''}`, visual: <AlbumCover cover={s} size="lg"/>, added: true, toggle: () => toggle.song(s) }))
    : profile.albums.map(al => ({ id: al.id, title: al.title, subtitle: `${al.artist}${al.year ? ` · ${al.year}` : ''}`, visual: <AlbumCover cover={al} size="lg"/>, added: true, toggle: () => toggle.album(al) }));

  let entries: Entry[];
  if (category === 'genre') {
    entries = allGenres.filter(g => g.includes(q.toLowerCase())).map(g => ({ id: g, title: capitalize(g), subtitle: familyOf(g), visual: null, added: profile.genres.includes(g), toggle: () => toggle.genre(g) }));
  } else if (q.length < 2) {
    entries = savedEntries(category);
  } else if (category === 'artist') {
    entries = (results as Artist[]).map(a => { const snap = artistSnapshot(a); return { id: a.id, title: a.name, subtitle: a.disambiguation || artistSubtitle(a), visual: <ArtistAvatar artist={a} size="lg"/>, added: has('artists', a.id), toggle: () => toggle.artist(snap) }; });
  } else if (category === 'song') {
    entries = (results as Song[]).map(s => { const snap = songSnapshot(s); return { id: s.id, title: s.title, subtitle: `${songArtists(s)}${yearOf(firstRelease(s)?.date) ? ` · ${yearOf(firstRelease(s)?.date)}` : ''}`, visual: <AlbumCover cover={snap} size="lg"/>, added: has('songs', s.id), toggle: () => toggle.song(snap) }; });
  } else {
    entries = pickedArtist && albums.data ? recentAlbums(albums.data.discography?.representative ?? []).map(album => { const snap = albumSnapshot(album, pickedArtist); return { id: album.id, title: album.title, subtitle: `${pickedArtist.name}${album.year ? ` · ${album.year}` : ''}`, visual: <AlbumCover cover={snap} size="lg"/>, added: has('albums', album.id), toggle: () => toggle.album(snap) }; }) : [];
  }
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const loading = searching || (category === 'album' && albums.loading);
  const failure = found.key === searchKey ? found.error : category === 'album' ? albums.error?.message : undefined;
  const selectedCount = category === 'genre' ? profile.genres.length : profile[`${category}s` as 'artists' | 'songs' | 'albums'].length;

  const importSongs = (matched: Song[]) => {
    const songs = matched.map(songSnapshot);
    const artists = matched.flatMap(s => s.artists.filter(a => a.id).slice(0, 1).map(a => ({ id: a.id!, name: a.name, subtitle: 'Artist', artUrl: null })));
    onProfileChange(current => ({
      ...current,
      songs: [...current.songs, ...songs.filter(s => !current.songs.some(x => x.id === s.id))],
      artists: [...current.artists, ...artists.filter((a, i) => !current.artists.some(x => x.id === a.id) && artists.findIndex(x => x.id === a.id) === i)],
    }));
    setUpload(false); setNotice(`Imported ${songs.length} songs and their artists.`);
  };
  const empty = (c: Category) => <div className="taste-empty"><Music2 size={24}/>{readOnly ? <p>No {plural(c)} shared.</p> : <><p>Add your first {c} to get started.</p><button className="text-cta" onClick={() => openManual(c)}>Browse {plural(c)} <Plus size={14}/></button></>}</div>;
  const hint = category === 'genre' ? '' : q.length < 2
    ? (entries.length ? `Your ${plural(category)}. Search MusicBrainz to add more.` : `Search MusicBrainz for any ${category === 'album' ? 'artist to see their studio albums' : category}.`)
    : category === 'album' && pickedArtist ? `Studio albums by ${pickedArtist.name}, newest first.` : '';

  return <div className="about-page">
    {manual && !readOnly ? <>
      <button className="back-link" onClick={back}><ArrowLeft size={17}/> Back to About Me</button>
      <div className="page-heading"><div><div className="eyebrow">MAKE IT YOURS</div><h1>Add to your music taste.</h1><p>A favorite artist, an album on repeat, a sound you love. Start anywhere.</p></div><button className="primary-button" onClick={back}><Check size={17}/> Done</button></div>
      <label className="input-search catalog-search"><Search size={20}/><input aria-label="Search music" placeholder={category === 'genre' ? 'Filter genres…' : category === 'album' ? 'Search an artist to see their albums…' : `Search ${plural(category)} on MusicBrainz…`} value={query} onChange={e => { setQuery(e.target.value); setPage(0); setAlbumArtist(null); }}/>{query && <button aria-label="Clear search" onClick={() => { setQuery(''); setPage(0); setAlbumArtist(null); }}><X size={17}/></button>}</label>
      <div className="catalog-toolbar"><div className="catalog-tabs" role="group" aria-label="Category">{(['artist', 'genre', 'album', 'song'] as Category[]).map(c => <button key={c} aria-pressed={category === c} className={category === c ? 'active' : ''} onClick={() => { setCategory(c); setPage(0); setAlbumArtist(null); }}>{c === 'artist' ? <Users size={16}/> : c === 'genre' ? <Disc3 size={16}/> : <Music2 size={16}/>} {c[0].toUpperCase() + c.slice(1)}s</button>)}</div><span>{loading ? 'Searching MusicBrainz…' : `${entries.length} entries`} · {selectedCount} selected</span></div>
      {category === 'album' && q.length >= 2 && results.length > 1 && <div className="artist-picker" role="group" aria-label="Choose an artist">{(results as Artist[]).map(a => <button key={a.id} aria-pressed={pickedArtist?.id === a.id} className={pickedArtist?.id === a.id ? 'active' : ''} onClick={() => { setAlbumArtist({ id: a.id, name: a.name }); setPage(0); }}>{a.name}{a.disambiguation ? <small>{a.disambiguation}</small> : null}</button>)}</div>}
      {hint && <p className="catalog-hint">{hint}</p>}
      {failure && <p className="error-text" role="alert">{failure}</p>}
      <div className="manual-grid" aria-busy={loading}>{entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(e => <button key={e.id} aria-pressed={e.added} className={`catalog-card ${e.added ? 'is-added' : ''} ${category === 'genre' ? 'genre-catalog-card' : ''}`} onClick={e.toggle} style={{ '--art': colorFor(e.id) } as CSSProperties}>
        <span className="catalog-art">{e.visual || <span className="genre-art-label">{e.title}</span>}<span className="selection-badge">{e.added ? <Check size={16}/> : <Plus size={16}/>}</span></span><strong>{e.title}</strong><small>{e.subtitle}</small><span className="catalog-card-action">{e.added ? 'Added to your taste' : 'Add to your taste'}</span>
      </button>)}</div>
      {!loading && !failure && q.length >= 2 && !entries.length && <div className="catalog-empty"><Search size={28}/><h3>No matches for “{query}”</h3><p>Try another spelling or switch categories.</p><button className="secondary-button" onClick={() => setQuery('')}>Clear search</button></div>}
      {pages > 1 && <div className="pagination"><span>Page {page + 1} of {pages}</span><button className="secondary-button" disabled={!page} onClick={() => setPage(p => p - 1)}><ChevronLeft size={16}/> Previous</button><button className="secondary-button" disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}>Next <ChevronRight size={16}/></button></div>}
    </> : <>
      <div className="page-heading about-heading"><div><h1>{readOnly ? 'A taste worth sharing.' : 'Your taste. Your starting point.'}</h1><p>{readOnly ? 'Favorite artists, genres, albums, and songs from this shared profile.' : 'Here’s what we know about your music taste so far.'}</p></div></div>
      {!readOnly && <div className="taste-actions"><button className="add-music-search" onClick={() => openManual()}><Search size={19}/><span>Add an artist, genre, album, or song</span><kbd>+</kbd></button><button className="secondary-button upload-cta" onClick={() => setUpload(true)}><Upload size={17}/> Upload Playlist</button></div>}
      <div className="taste-grid">
        <PreferenceSection title="Artists" count={profile.artists.length} icon={<Users size={18}/>} onAdd={readOnly ? undefined : () => openManual('artist')}><div className="favorite-grid">{profile.artists.map(a => <div className="preference-card" key={a.id}><button className="favorite-item" onClick={() => onSelect({ type: 'artist', id: a.id })}><ArtistPicture artist={a} size="lg"/><strong>{a.name}</strong><small>{a.subtitle}</small></button>{!readOnly && <button className="remove-preference" aria-label={`Remove ${a.name}`} onClick={() => toggle.artist(a)}><X size={13}/></button>}</div>)}{!profile.artists.length && empty('artist')}</div></PreferenceSection>
        <PreferenceSection title="Genres" count={profile.genres.length} icon={<Disc3 size={18}/>} onAdd={readOnly ? undefined : () => openManual('genre')}><div className="genre-favorites">{profile.genres.map((g, i) => <div className={`genre-square square-${i % 4}`} key={g}><span className="genre-family">{familyOf(g)}</span><strong>{capitalize(g)}</strong><Disc3 size={27} strokeWidth={1}/>{!readOnly && <button className="remove-preference" aria-label={`Remove ${g}`} onClick={() => toggle.genre(g)}><X size={13}/></button>}</div>)}{!profile.genres.length && empty('genre')}</div></PreferenceSection>
        <PreferenceSection title="Albums" count={profile.albums.length} icon={<Music2 size={18}/>} onAdd={readOnly ? undefined : () => openManual('album')}><div className="favorite-grid">{profile.albums.map(al => <div className="preference-card" key={al.id}><button className="favorite-item" onClick={() => onSelect({ type: 'album', id: al.id, album: al })}><AlbumCover cover={al} size="lg"/><strong>{al.title}</strong><small>{al.artist}</small></button>{!readOnly && <button className="remove-preference" aria-label={`Remove ${al.title}`} onClick={() => toggle.album(al)}><X size={13}/></button>}</div>)}{!profile.albums.length && empty('album')}</div></PreferenceSection>
      </div>
      <section className="selected-songs-section"><div className="taste-heading"><span><Music2 size={18}/><h2>Selected songs</h2><small>{profile.songs.length}</small></span>{!readOnly && <button className="text-cta" onClick={() => openManual('song')}>Add songs <Plus size={15}/></button>}</div><div className="saved-song-list">{profile.songs.map(s => <div className="saved-song" key={s.id}><button className="mini-entity" onClick={() => onSelect({ type: 'song', id: s.id })}><AlbumCover cover={s} size="sm"/><span><strong>{s.title}</strong><small>{s.artist}</small></span></button><small>{s.duration}</small>{!readOnly && <button className="icon-button" aria-label={`Remove ${s.title}`} onClick={() => toggle.song(s)}><X size={15}/></button>}</div>)}{!profile.songs.length && empty('song')}</div></section>
    </>}
    <div className={`toast ${notice ? 'visible' : ''}`} role="status" aria-live="polite">{notice && <><Check size={16}/>{notice}</>}</div>
    {upload && !readOnly && <PlaylistUpload onClose={() => setUpload(false)} onImport={importSongs}/>}
  </div>;
}
