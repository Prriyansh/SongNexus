import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Music2, Search } from 'lucide-react';
import type { Artist, ArtistDetails, RecordingDetails, Song } from '@/lib/types';
import type { SoundTrackBrief } from '@/lib/sound';
import { searchArtists, searchSongs, searchSoundSongs } from '../api';
import { findRecording } from '../resolve';
import { artistCover, artistSubtitle, capitalize, coverForRelease, firstRelease, songArtists, yearOf } from '../model';
import type { EntityType } from '../types';
import { ArtistAvatar, AlbumCover } from './Artwork';

type Details = ArtistDetails | RecordingDetails;
const nameOf = (d: Details) => 'title' in d ? d.title : d.name;

type ChooserItem = Artist | Song | SoundTrackBrief;
type ChooserResults = { key: string; items?: ChooserItem[]; source?: 'dataset' | 'musicbrainz'; error?: string };
const isDatasetSong = (item: ChooserItem): item is SoundTrackBrief => 'has_lyrics' in item;

// Song pickers search the sound dataset first, so picked songs have the full sound and lyrics
// analysis; a pick is then matched to its MusicBrainz recording. Without the sound service they
// search MusicBrainz directly. Artist pickers always search MusicBrainz.
export function SearchChooser({ type, value, display, other, label, onChange }: { type: EntityType; value: string; display?: Details; other: string; label: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<ChooserResults>({ key: '' });
  const [resolving, setResolving] = useState<{ id?: string; error?: string }>({});
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const handler = (e: MouseEvent) => { if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', handler); return () => document.removeEventListener('mousedown', handler); }, [open]);
  const q = query.trim();
  const key = `${type}:${q}`;
  // 300 ms debounce; typing again cancels the request in flight.
  useEffect(() => {
    if (!open || q.length < 2) return;
    const controller = new AbortController();
    const fail = (error: unknown) => { if (!controller.signal.aborted) setFound({ key, error: error instanceof Error ? error.message : 'Search failed.' }); };
    const timer = window.setTimeout(() => {
      if (type === 'artist') {
        searchArtists(q, controller.signal, 10).then(items => setFound({ key, items, source: 'musicbrainz' }), fail);
        return;
      }
      searchSoundSongs(q, controller.signal)
        .catch(() => ({ status: 'unavailable' }) as const) // any failure: fall back to MusicBrainz
        .then(result => result.status === 'ok'
          ? setFound({ key, items: result.results, source: 'dataset' })
          : searchSongs(q, controller.signal, 10).then(items => setFound({ key, items, source: 'musicbrainz' })))
        .catch(fail);
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, q, key, type]);
  const items = found.key === key ? (found.items ?? []).filter(x => x.id !== other) : [];
  const searching = q.length >= 2 && found.key !== key;
  const where = type === 'song' && found.source !== 'musicbrainz' ? 'the song library' : 'MusicBrainz';

  const pick = async (item: ChooserItem) => {
    if (!isDatasetSong(item)) { onChange(item.id); setOpen(false); return; }
    setResolving({ id: item.id });
    try {
      const recording = await findRecording(item.title, item.artists[0] ?? '');
      if (!recording) { setResolving({ error: `Couldn’t find “${item.title}” on MusicBrainz.` }); return; }
      setResolving({});
      onChange(recording.id);
      setOpen(false);
    } catch (e) { setResolving({ error: e instanceof Error ? e.message : 'Search failed.' }); }
  };
  const option = (item: ChooserItem) => {
    if (isDatasetSong(item)) return <><AlbumCover cover={{ id: item.id }} size="sm" /><span><strong>{item.title}</strong><small>{[item.artists.join(', '), item.album, item.genre && capitalize(item.genre)].filter(Boolean).join(' · ')}</small></span>{resolving.id === item.id && <small className="chooser-busy">Opening…</small>}</>;
    if ('title' in item) { const release = firstRelease(item); return <><AlbumCover cover={{ id: item.id, artUrl: coverForRelease(release?.id) }} size="sm" /><span><strong>{item.title}</strong><small>{[songArtists(item), release?.title, yearOf(release?.date)].filter(Boolean).join(' · ')}</small></span>{value === item.id && <Check size={16} />}</>; }
    return <><ArtistAvatar artist={item} size="sm" /><span><strong>{item.name}</strong><small>{item.disambiguation || artistSubtitle(item)}</small></span>{value === item.id && <Check size={16} />}</>;
  };
  const visual = display ? ('title' in display ? <AlbumCover cover={{ id: display.id, artUrl: display.representative?.artUrl }} size="sm" /> : <ArtistAvatar artist={{ ...display, artUrl: artistCover(display) }} size="sm" />) : <Music2 />;
  return <div className="chooser" ref={popRef} onKeyDown={e => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); popRef.current?.querySelector('button')?.focus(); } }}><span className="field-label">{label}</span><button className={`chooser-button ${open ? 'open' : ''}`} aria-expanded={open} onClick={() => { setOpen(!open); setQuery(''); setResolving({}); }}>{visual}<strong>{display ? nameOf(display) : 'Loading…'}</strong><ChevronDown size={16} /></button>
    {open && <div className="chooser-popover"><label className="chooser-search"><Search size={17} /><input aria-label={`Search ${type}s`} autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder={type === 'song' ? 'Search songs or artists…' : 'Search artists on MusicBrainz…'} /></label><div className="chooser-results">
      {items.map(item => <button key={item.id} className="chooser-option" disabled={!!resolving.id} onClick={() => void pick(item)}>{option(item)}</button>)}
      {q.length < 2 && <p className="no-match">Type at least 2 letters.</p>}
      {searching && <p className="no-match">Searching {where}…</p>}
      {found.key === key && found.error && <p className="no-match error-text">{found.error}</p>}
      {resolving.error && <p className="no-match error-text" role="alert">{resolving.error}</p>}
      {found.key === key && !found.error && !items.length && <p className="no-match">No matches in {where}.</p>}
      {type === 'song' && found.key === key && !!items.length && <p className="chooser-note">{found.source === 'dataset' ? 'Songs with full sound and lyrics analysis (Spotify tracks up to 2022).' : 'From MusicBrainz. Sound and lyrics analysis isn’t available right now.'}</p>}
    </div></div>}
  </div>;
}

