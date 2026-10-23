import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction, CSSProperties, ReactNode } from 'react';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Disc3, Heart, Music2, Plus, Search, Upload, Users, X } from 'lucide-react';
import { artists, songs, genres, subgenres, getArtist, getSong } from '../data';
import type { Song } from '../data';
import type { Selection } from '../types';
import { albumSongs, allGenres } from '../profile';
import type { MusicProfile } from '../profile';
import { ArtistAvatar, AlbumCover } from './Artwork';
import { PlaylistUpload } from './PlaylistUpload';

type Category = 'artist' | 'genre' | 'album' | 'song';
const albumSongId = (song: Song) => albumSongs.find(candidate => candidate.albumId === song.albumId)!.id;

function PreferenceSection({ title, count, icon, children, onAdd }: { title: string; count: number; icon: ReactNode; children: ReactNode; onAdd?: () => void }) {
  return <section className="panel taste-panel"><div className="taste-heading"><span>{icon}<h2>{title}</h2><small>{count}</small></span>{onAdd && <button className="icon-button" onClick={onAdd} aria-label={`Add ${title.toLowerCase()}`}><Plus size={19}/></button>}</div>{children}</section>;
}

export function AboutMe({ onSelect, profile, onProfileChange, readOnly = false }: { onSelect: (s: Selection) => void; profile: MusicProfile; onProfileChange: Dispatch<SetStateAction<MusicProfile>>; readOnly?: boolean }) {
  const { artists: favoriteArtists, songs: favoriteSongs, albums: favoriteAlbums, genres: favoriteGenres } = profile;
  const setter = (key: keyof MusicProfile): Dispatch<SetStateAction<string[]>> => next => { if (!readOnly) onProfileChange(current => ({ ...current, [key]: typeof next === 'function' ? next(current[key]) : next })); };
  const setFavoriteArtists = setter('artists'), setFavoriteSongs = setter('songs'), setFavoriteAlbums = setter('albums'), setFavoriteGenres = setter('genres');
  const [manual, setManual] = useState(window.location.hash.startsWith('#about/manual'));
  const [category, setCategory] = useState<Category>('artist');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [upload, setUpload] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => { const change = () => setManual(window.location.hash.startsWith('#about/manual')); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 3500); return () => clearTimeout(timer); }, [notice]);
  const openManual = (c: Category = 'artist') => { setCategory(c); setQuery(''); setPage(0); setManual(true); window.location.hash = 'about/manual'; window.scrollTo(0,0); };
  const back = () => { setManual(false); window.location.hash = 'about'; window.scrollTo(0,0); };
  const values: Record<Category,string[]> = { artist: favoriteArtists, album: favoriteAlbums, song: favoriteSongs, genre: favoriteGenres };
  const setters: Record<Category,Dispatch<SetStateAction<string[]>>> = { artist: setFavoriteArtists, album: setFavoriteAlbums, song: setFavoriteSongs, genre: setFavoriteGenres };
  const toggle = (c: Category, id: string, title: string) => { const remove = values[c].includes(id); setters[c](prev => remove ? prev.filter(v => v !== id) : [...prev,id]); setNotice(`${title} ${remove ? 'removed from' : 'added to'} your music taste.`); };
  const entries = category === 'artist' ? artists.map(a => ({ id: a.id, title: a.name, subtitle: a.subgenres.join(' · '), color: a.color, visual: <ArtistAvatar artist={a} size="lg"/> }))
    : category === 'genre' ? allGenres.map((g,i) => ({ id: g, title: g, subtitle: genres.includes(g as typeof genres[number]) ? 'Genre family' : `${genres.find(k => subgenres[k].includes(g))} / Subgenre`, color: artists[i % artists.length].color, visual: null }))
    : (category === 'album' ? albumSongs : songs).map(s => ({ id: s.id, title: category === 'album' ? s.album : s.title, subtitle: `${getArtist(s.artistId)?.name} · ${s.year}`, color: s.color, visual: <AlbumCover song={s} size="lg"/> }));
  const searchText = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const results = entries.filter(e => searchText(`${e.title} ${e.subtitle} ${(category === 'artist' ? getArtist(e.id)?.aliases : category === 'song' ? getSong(e.id)?.aliases : [])?.join(' ') || ''}`).includes(searchText(query)));
  const pages = Math.max(1, Math.ceil(results.length / 12));
  const importSongs = (matched: Song[]) => {
    setFavoriteSongs(p => [...new Set([...p,...matched.map(s => s.id)])]);
    setFavoriteAlbums(p => [...new Set([...p,...matched.map(albumSongId)])]);
    setFavoriteArtists(p => [...new Set([...p,...matched.map(s => s.artistId)])]);
    setFavoriteGenres(p => [...new Set([...p,...matched.flatMap(s => [s.genre,s.subgenre])])]);
    setUpload(false); setNotice(`Imported ${matched.length} songs and their artists, albums, and genres.`);
  };
  const empty = (c: Category) => <div className="taste-empty"><Music2 size={24}/>{readOnly ? <p>No {c === 'genre' ? 'genres' : c + 's'} shared.</p> : <><p>A little more you.<br/>Add your first {c} to get started.</p><button className="text-cta" onClick={() => openManual(c)}>Browse {c === 'genre' ? 'genres' : c + 's'} <Plus size={14}/></button></>}</div>;
  return <div className="about-page">
    {manual && !readOnly ? <>
      <button className="back-link" onClick={back}><ArrowLeft size={17}/> Back to About Me</button>
      <div className="page-heading"><div><div className="eyebrow">MAKE IT YOURS</div><h1>Add to your music taste.</h1><p>A favorite artist, an album on repeat, a sound you love. Start anywhere.</p></div><button className="primary-button" onClick={back}><Check size={17}/> Done</button></div>
      <label className="input-search catalog-search"><Search size={20}/><input aria-label="Search music catalog" placeholder={`Search ${category === 'artist' ? 'artists' : category === 'genre' ? 'genres' : category === 'album' ? 'albums' : 'songs'} in the demo catalog…`} value={query} onChange={e => { setQuery(e.target.value); setPage(0); }}/>{query && <button aria-label="Clear search" onClick={() => { setQuery(''); setPage(0); }}><X size={17}/></button>}</label>
      <div className="catalog-toolbar"><div className="catalog-tabs" role="group" aria-label="Catalog category">{(['artist','genre','album','song'] as Category[]).map(c => <button key={c} aria-pressed={category === c} className={category === c ? 'active' : ''} onClick={() => { setCategory(c); setPage(0); setQuery(''); }}>{c === 'artist' ? <Users size={16}/> : c === 'genre' ? <Disc3 size={16}/> : <Music2 size={16}/>} {c[0].toUpperCase()+c.slice(1)}s</button>)}</div><span>{results.length} entries · {values[category].length} selected</span></div>
      <div className="manual-grid">{results.slice(page * 12, (page + 1) * 12).map(e => <button key={e.id} aria-pressed={values[category].includes(e.id)} className={`catalog-card ${values[category].includes(e.id) ? 'is-added' : ''} ${category === 'genre' ? 'genre-catalog-card' : ''}`} onClick={() => toggle(category,e.id,e.title)} style={{'--art':e.color} as CSSProperties}>
        <span className="catalog-art">{e.visual || <span className="genre-art-label">{e.title}</span>}<span className="selection-badge">{values[category].includes(e.id) ? <Check size={16}/> : <Plus size={16}/>}</span></span><strong>{e.title}</strong><small>{e.subtitle}</small><span className="catalog-card-action">{values[category].includes(e.id) ? 'Added to your taste' : 'Add to your taste'}</span>
      </button>)}</div>
      {!results.length && <div className="catalog-empty"><Search size={28}/><h3>No matches for “{query}”</h3><p>Try another name or switch categories.</p><button className="secondary-button" onClick={() => setQuery('')}>Clear search</button></div>}
      <div className="pagination"><span>Page {page + 1} of {pages}</span><button className="secondary-button" disabled={!page} onClick={() => setPage(p => p - 1)}><ChevronLeft size={16}/> Previous</button><button className="secondary-button" disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}>Next <ChevronRight size={16}/></button></div>
    </> : <>
      <div className="page-heading about-heading"><div><div className="eyebrow"><Heart size={14}/> A LITTLE MORE YOU</div><h1>{readOnly ? 'A taste worth sharing.' : 'Your taste. Your starting point.'}</h1><p>{readOnly ? 'Favorite artists, genres, albums, and songs from this shared profile.' : 'Here’s what we know about your music taste so far.'}</p></div></div>
      {!readOnly && <div className="taste-actions"><button className="add-music-search" onClick={() => openManual()}><Search size={19}/><span>Add an artist, genre, album, or song</span><kbd>+</kbd></button><button className="secondary-button upload-cta" onClick={() => setUpload(true)}><Upload size={17}/> Upload Playlist</button></div>}
      <div className="taste-grid">
        <PreferenceSection title="Artists" count={favoriteArtists.length} icon={<Users size={18}/>} onAdd={readOnly ? undefined : () => openManual('artist')}><div className="favorite-grid">{favoriteArtists.map(id => { const a = getArtist(id)!; return <div className="preference-card" key={id}><button className="favorite-item" onClick={() => onSelect({ type: 'artist', id })}><ArtistAvatar artist={a} size="lg"/><strong>{a.name}</strong><small>{a.subgenres[0]}</small></button>{!readOnly && <button className="remove-preference" aria-label={`Remove ${a.name}`} onClick={() => toggle('artist',id,a.name)}><X size={13}/></button>}</div>; })}{!favoriteArtists.length && empty('artist')}</div></PreferenceSection>
        <PreferenceSection title="Genres" count={favoriteGenres.length} icon={<Disc3 size={18}/>} onAdd={readOnly ? undefined : () => openManual('genre')}><div className="genre-favorites">{favoriteGenres.map((g,i) => <div className={`genre-square square-${i%4}`} key={g}><span className="genre-family">{genres.find(k => subgenres[k].includes(g)) || 'Genre'}</span><strong>{g}</strong><Disc3 size={27} strokeWidth={1}/>{!readOnly && <button className="remove-preference" aria-label={`Remove ${g}`} onClick={() => toggle('genre',g,g)}><X size={13}/></button>}</div>)}{!favoriteGenres.length && empty('genre')}</div></PreferenceSection>
        <PreferenceSection title="Albums" count={favoriteAlbums.length} icon={<Music2 size={18}/>} onAdd={readOnly ? undefined : () => openManual('album')}><div className="favorite-grid">{favoriteAlbums.map(id => { const s = getSong(id)!; return <div className="preference-card" key={id}><button className="favorite-item" onClick={() => onSelect({ type: 'album', id })}><AlbumCover song={s} size="lg"/><strong>{s.album}</strong><small>{getArtist(s.artistId)?.name}</small></button>{!readOnly && <button className="remove-preference" aria-label={`Remove ${s.album}`} onClick={() => toggle('album',id,s.album)}><X size={13}/></button>}</div>; })}{!favoriteAlbums.length && empty('album')}</div></PreferenceSection>
      </div>
      <section className="selected-songs-section"><div className="taste-heading"><span><Music2 size={18}/><h2>Selected songs</h2><small>{favoriteSongs.length}</small></span>{!readOnly && <button className="text-cta" onClick={() => openManual('song')}>Add songs <Plus size={15}/></button>}</div><div className="saved-song-list">{favoriteSongs.map(id => { const s = getSong(id)!; return <div className="saved-song" key={id}><button className="mini-entity" onClick={() => onSelect({type:'song',id})}><AlbumCover song={s} size="sm"/><span><strong>{s.title}</strong><small>{getArtist(s.artistId)?.name}</small></span></button><small>{s.duration}</small>{!readOnly && <button className="icon-button" aria-label={`Remove ${s.title}`} onClick={() => toggle('song',id,s.title)}><X size={15}/></button>}</div>; })}{!favoriteSongs.length && empty('song')}</div></section>
      
      
    </>}
    <div className={`toast ${notice ? 'visible' : ''}`} role="status" aria-live="polite">{notice && <><Check size={16}/>{notice}</>}</div>
    {upload && !readOnly && <PlaylistUpload onClose={() => setUpload(false)} onImport={importSongs}/>}
  </div>;
}
