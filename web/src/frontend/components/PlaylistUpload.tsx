import { useEffect, useRef, useState } from 'react';
import { Check, FileMusic, Upload, X } from 'lucide-react';
import type { Song } from '@/lib/types';
import { searchSongs } from '../api';
import { MAX_MATCH_ROWS, matchQuery, parsePlaylist, pickMatch } from '../playlist';
import type { PlaylistRow } from '../playlist';
import { Modal } from './Modal';

type Match = { row: PlaylistRow; song?: Song; status: 'waiting' | 'matched' | 'missing' | 'failed' };
const SAMPLE = 'vampire — Olivia Rodrigo\nAnti-Hero — Taylor Swift\nKill Bill — SZA\nNot a real song — Nobody';

export function PlaylistUpload({ onClose, onImport }: { onClose: () => void; onImport: (songs: Song[]) => void }) {
  const [provider, setProvider] = useState('Spotify');
  const [matches, setMatches] = useState<Match[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const run = useRef<AbortController | null>(null);
  useEffect(() => () => run.current?.abort(), []);

  // One MusicBrainz search per row, in order, so the server's rate limit isn't flooded.
  const start = async (rows: PlaylistRow[], label: string) => {
    run.current?.abort();
    const controller = new AbortController();
    run.current = controller;
    const queue = rows.slice(0, MAX_MATCH_ROWS);
    setName(label); setError(''); setSkipped(rows.length - queue.length);
    setMatches(queue.map(row => ({ row, status: 'waiting' })));
    for (let i = 0; i < queue.length; i++) {
      let next: Match;
      try {
        const song = pickMatch(queue[i], await searchSongs(matchQuery(queue[i]), controller.signal, 10));
        next = { row: queue[i], song, status: song ? 'matched' : 'missing' };
      } catch (e) {
        if (controller.signal.aborted) return;
        next = { row: queue[i], status: 'failed' };
        setError(e instanceof Error ? e.message : 'MusicBrainz search failed.');
      }
      setMatches(current => current.map((m, j) => (j === i ? next : m)));
    }
  };

  const load = async (file?: File) => {
    if (!file) return;
    setMatches([]); setError('');
    try {
      if (file.size > 2_000_000) throw new Error('Please choose a file under 2 MB.');
      if (!/\.(csv|json|txt)$/i.test(file.name)) throw new Error('Please choose a CSV, JSON, or TXT file.');
      void start(parsePlaylist(file.name, await file.text()), file.name);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read this file.'); }
    if (input.current) input.current.value = '';
  };

  const matched = [...new Map(matches.flatMap(m => (m.song ? [[m.song.id, m.song] as const] : []))).values()];
  const pending = matches.filter(m => m.status === 'waiting').length;
  const done = matches.length - pending;
  return <Modal onClose={onClose} label="Upload playlist"><div className="modal-heading"><span className="overline">BRING YOUR MUSIC</span><button className="icon-button" onClick={onClose} aria-label="Close upload"><X size={20}/></button></div>
    <h2>Start with a playlist.</h2><p>Import an exported playlist file or try our sample. We’ll look up each song on MusicBrainz.</p>
    <div className="provider-pills" role="group" aria-label="Playlist source">{['Spotify', 'YouTube Music', 'Apple Music'].map(p => <button key={p} aria-pressed={p === provider} className={p === provider ? 'active' : ''} onClick={() => setProvider(p)}>{p}</button>)}</div>
    <div className="drop-zone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void load(e.dataTransfer.files[0]); }}>
      <span className="upload-symbol"><FileMusic size={28}/></span><h3>Drop a playlist file here</h3><p>CSV, JSON, or TXT · Up to 2 MB · first {MAX_MATCH_ROWS} songs are matched</p>
      <input ref={input} hidden type="file" accept=".csv,.json,.txt" onChange={e => void load(e.target.files?.[0])}/>
      <button className="secondary-button" onClick={() => input.current?.click()}><Upload size={16}/> Choose file</button>
      <button className="link-button" onClick={() => void start(parsePlaylist('sample.txt', SAMPLE), 'Sample playlist')}>Load Sample Playlist</button>
    </div>
    <p className="fine-print">Source labels describe where your playlist came from. Song Nexus reads the file in your browser and doesn’t connect to streaming accounts. Matching takes about a second per song.</p>
    {error && <p className="error-text" role="alert">{error}</p>}
    {!!matches.length && <div className="upload-preview"><div><strong>{name}</strong><span>{pending ? `Matching ${done + 1} of ${matches.length}…` : `${matched.length} unique matches`}</span></div>
      <div className="playlist-rows">{matches.map((m, i) => <p key={i}><span>{m.row.title}<small>{m.row.artist}</small></span><span className={m.status === 'matched' ? 'match-yes' : 'match-no'}>{m.status === 'matched' ? <><Check size={13}/> Matched</> : m.status === 'waiting' ? 'Searching…' : m.status === 'failed' ? 'Search failed' : 'Not found'}</span></p>)}</div>
      <p className="fine-print">{matches.filter(m => m.status === 'missing' || m.status === 'failed').length} unmatched entries will be skipped{skipped ? `, plus ${skipped} rows past the first ${MAX_MATCH_ROWS}` : ''}. A match needs the exact title and, when the file has one, the artist.</p>
      <button className="primary-button" disabled={!matched.length || pending > 0} onClick={() => onImport(matched)}>Import {matched.length} songs & their artists <Check size={16}/></button>
    </div>}
  </Modal>;
}
