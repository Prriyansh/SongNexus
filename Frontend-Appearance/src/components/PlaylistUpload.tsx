import { useRef, useState } from 'react';
import { Check, FileMusic, Upload, X } from 'lucide-react';
import { matchPlaylist, parsePlaylist } from '../playlist';
import type { PlaylistRow } from '../playlist';
import type { Song } from '../data';
import { Modal } from './Modal';

export function PlaylistUpload({ onClose, onImport }: { onClose: () => void; onImport: (songs: Song[]) => void }) {
  const [provider, setProvider] = useState('Spotify');
  const [rows, setRows] = useState<PlaylistRow[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const matches = matchPlaylist(rows);
  const matched = [...new Map(matches.flatMap(m => m.song ? [[m.song.id, m.song] as const] : [])).values()];
  const load = async (file?: File) => {
    if (!file) return;
    setRows([]); setError('');
    try {
      if (file.size > 2_000_000) throw new Error('Please choose a file under 2 MB.');
      if (!/\.(csv|json|txt)$/i.test(file.name)) throw new Error('Please choose a CSV, JSON, or TXT file.');
      setRows(parsePlaylist(file.name, await file.text())); setName(file.name);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read this file.'); }
    if (input.current) input.current.value = '';
  };
  return <Modal onClose={onClose} label="Upload playlist"><div className="modal-heading"><span className="overline">BRING YOUR MUSIC</span><button className="icon-button" onClick={onClose} aria-label="Close upload"><X size={20}/></button></div>
    <h2>Start with a playlist.</h2><p>Import a local file or try our sample. We’ll find matching music in the demo catalog.</p>
    <div className="provider-pills" role="group" aria-label="Playlist source">{['Spotify', 'YouTube Music', 'Apple Music'].map(p => <button key={p} aria-pressed={p === provider} className={p === provider ? 'active' : ''} onClick={() => setProvider(p)}>{p}</button>)}</div>
    <div className="drop-zone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void load(e.dataTransfer.files[0]); }}>
      <span className="upload-symbol"><FileMusic size={28}/></span><h3>Drop a playlist file here</h3><p>CSV, JSON, or TXT · Up to 2 MB / 250 tracks</p>
      <input ref={input} hidden type="file" accept=".csv,.json,.txt" onChange={e => void load(e.target.files?.[0])}/>
      <button className="secondary-button" onClick={() => input.current?.click()}><Upload size={16}/> Choose file</button>
      <button className="link-button" onClick={() => { setRows(parsePlaylist('sample.txt', 'Disorder — Joy Division\nParanoid Android — Radiohead\nHyperballad — Björk\nNot in the catalog — Unknown Artist')); setName('Sample playlist'); setError(''); }}>Load Sample Playlist</button>
    </div>
    <p className="fine-print">Source labels describe where your playlist originated. Export formats vary by platform; this demo reads local files and does not connect to streaming accounts.</p>
    {error && <p className="error-text" role="alert">{error}</p>}
    {!!rows.length && <div className="upload-preview"><div><strong>{name}</strong><span>{matched.length} unique matches</span></div>
      <div className="playlist-rows">{matches.map((m, i) => <p key={i}><span>{m.row.title}<small>{m.row.artist}</small></span><span className={m.song ? 'match-yes' : 'match-no'}>{m.song ? <><Check size={13}/> Matched</> : 'Not in catalog'}</span></p>)}</div>
      <p className="fine-print">{matches.filter(m => !m.song).length} unmatched entries will be skipped. Matching requires the song title and, when supplied, the artist.</p>
      <button className="primary-button" disabled={!matched.length} onClick={() => onImport(matched)}>Import {matched.length} songs & related favorites <Check size={16}/></button>
    </div>}
  </Modal>;
}
