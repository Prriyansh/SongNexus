import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, Compass, Copy, GitCompareArrows, LoaderCircle, Network, RotateCcw, Upload } from 'lucide-react';
import { ApiError, createRoom, joinRoom, readRoom, tasteWeb } from '../api';
import { sourceNote } from '../credits';
import { parsePlaylist } from '../playlist';
import { findRecording } from '../resolve';
import { decodePlaylist, encodePlaylist, friendLink, layoutTaste, readStoredPlaylist, SAMPLE_FRIEND, SAMPLE_MINE, storePlaylist, TASTE_WORLD_WIDTH, tasteEdges, tasteNear } from '../taste';
import type { Room } from '@/lib/rooms';
import type { SharedPlaylist } from '../taste';
import type { WebNode } from '../similar-web';
import type { Selection } from '../types';
import { useAsync } from '../useAsync';
import { ConnectionWebCanvas } from './ConnectionWebCanvas';

type Props = { onExploreArtist: (id: string) => void; onExploreSong: (id: string) => void; onDetails: (s: Selection) => void };

const LEGEND_SOLO = [['mine', 'On your playlist', '#6db3ff'], ['new', 'New to you', '#71d99e']] as const;
const LEGEND_FRIEND = (name: string) => [
  ['mine', 'Only yours', '#6db3ff'], ['theirs', `Only ${name}’s`, '#f5a65b'], ['shared', 'On both', '#f4e06d'],
  ['for-me', 'You should listen', '#f5a65b'], ['for-them', `${name} should listen`, '#6db3ff'], ['new', 'New to both', '#71d99e'],
] as const;

/** Narrow screens start on the middle of the map, where the two playlists meet. */
const centerOnBoth = (width: number) => ({ x: Math.min(0, (width - TASTE_WORLD_WIDTH) / 2), y: 0, zoom: 1 });

/** Reads a playlist file or pasted lines. Rows without an artist can't be placed on the map, so they're dropped and counted. */
function PlaylistPicker({ onPick, sample, label }: { onPick: (songs: SharedPlaylist['songs']) => void; sample: SharedPlaylist; label: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const take = (name: string, content: string) => {
    try {
      const rows = parsePlaylist(name, content);
      const songs = rows.filter(row => row.artist);
      if (!songs.length) throw new Error('These songs have no artist names. Use “Title - Artist” lines, or a file with an Artist column.');
      setError('');
      onPick(songs);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read this playlist.'); }
  };
  const load = async (file?: File) => {
    if (!file) return;
    if (file.size > 2_000_000) { setError('Please choose a file under 2 MB.'); return; }
    if (!/\.(csv|json|txt)$/i.test(file.name)) { setError('Please choose a CSV, JSON, or TXT file.'); return; }
    take(file.name, await file.text());
    if (input.current) input.current.value = '';
  };
  return <>
    <p>{label} CSV, JSON or TXT, or paste lines like “vampire - Olivia Rodrigo”. It stays in your browser.</p>
    <input ref={input} hidden type="file" accept=".csv,.json,.txt" aria-label="Playlist file" onChange={e => void load(e.target.files?.[0])} />
    <textarea aria-label="Paste a playlist" value={text} onChange={e => setText(e.target.value)} placeholder={'vampire - Olivia Rodrigo\nKill Bill - SZA'} />
    <div className="taste-box-actions">
      <button className="primary-button" onClick={() => input.current?.click()}><Upload size={14} /> Choose file</button>
      <button className="secondary-button" disabled={!text.trim()} onClick={() => take('pasted.txt', text)}>Use pasted songs</button>
      <button className="secondary-button" onClick={() => onPick(sample.songs)}>Try a sample</button>
    </div>
    {error && <p className="error-text" role="alert">{error}</p>}
  </>;
}

function TasteMapView({ mine, friend, onExploreArtist, onExploreSong, onDetails, onChange, changeLabel = 'Change playlist', extra }: { mine: SharedPlaylist; friend: SharedPlaylist | null; onChange: () => void; changeLabel?: string; extra?: ReactNode } & Pick<Props, 'onExploreArtist' | 'onExploreSong' | 'onDetails'>) {
  const friendName = friend?.name || 'your friend';
  const request = useMemo(() => ({ mine: mine.songs, ...(friend ? { friend: friend.songs, friendName } : {}) }), [mine, friend, friendName]);
  const state = useAsync(`taste:${JSON.stringify(request)}`, () => tasteWeb(request));
  const [visible, setVisible] = useState(0);
  const [opening, setOpening] = useState<string>('');
  const map = state.data;
  const hasFriend = !!friend;
  const place = useCallback((width: number, height: number) => map ? layoutTaste(map, width, height, hasFriend) : [], [map, hasFriend]);
  const edges = useMemo(() => map ? tasteEdges(map.links) : [], [map]);
  const near = useCallback((id: string) => map ? tasteNear(id, map) : [], [map]);
  const label = friend?.name || 'Friend';
  const open = async (node: WebNode) => {
    const found = map?.nodes.find(n => n.id === node.id);
    if (!found) return;
    if (found.mbid) { onExploreArtist(found.mbid); return; }
    setOpening(found.id);
    try {
      const recording = await findRecording(found.name, found.artist ?? '');
      if (recording) onExploreSong(recording.id);
      else setOpening(`Couldn’t find “${found.name}” on MusicBrainz.`);
    } catch { setOpening(`Couldn’t look up “${found.name}” just now.`); }
  };
  const actions = (node: WebNode) => {
    const found = map?.nodes.find(n => n.id === node.id);
    if (!found) return null;
    const openable = found.kind === 'song' || !!found.mbid;
    return <>
      {openable && <button className="primary-button" disabled={opening === found.id} onClick={() => void open(node)}><Compass size={13} /> {opening === found.id ? 'Opening…' : 'Explore from here'}</button>}
      {found.kind === 'artist' && found.mbid && <button className="secondary-button" onClick={() => onDetails({ type: 'artist', id: found.mbid! })}>Details</button>}
      {opening && opening !== found.id && <small className="error-text">{opening}</small>}
    </>;
  };
  const missing = map ? map.sources.filter(s => s.status !== 'ok') : [];
  return <>
    <div className="web-toolbar"><div className="web-live-label"><span /> {hasFriend ? `YOU AND ${label.toUpperCase()}` : 'FROM YOUR PLAYLIST'}<small>{map ? `${visible} in view` : 'Loading map'}</small></div>
      <div className="taste-toolbar-actions">{extra}<button className="secondary-button" onClick={onChange}><RotateCcw size={13} /> {changeLabel}</button></div></div>
    {map && <div className="taste-stats">
      {hasFriend ? <><span><strong>{map.stats.sharedArtists}</strong> artists in common</span><span><strong>{map.stats.sharedSongs}</strong> songs in common</span><span><strong>{map.stats.similarLinks}</strong> similar-artist links between you</span></> : <span><strong>{map.stats.mineSongs}</strong> songs by <strong>{map.stats.mineArtists}</strong> artists</span>}
      <div className="taste-legend" aria-label="What the colors mean">{(hasFriend ? LEGEND_FRIEND(label) : LEGEND_SOLO).map(([group, text, color]) => <span key={group}><i style={{ borderColor: color, borderStyle: group.startsWith('for-') ? 'dashed' : 'solid' }} />{text}</span>)}<span><i className="is-line" style={{ borderColor: '#c7a5ff', borderStyle: 'dashed' }} />Listeners play both</span><span><i className="is-line" style={{ borderColor: '#8f8a9a' }} />By this artist</span><span>Circle: artist · Square: song</span></div>
    </div>}
    {map ? <ConnectionWebCanvas key={`${hasFriend}:${state.data ? map.nodes.length : 0}`} nodes={place} edges={edges} near={near} actions={actions} showCloseness={false} startAt={hasFriend ? centerOnBoth : undefined} onVisibleCount={setVisible} empty={!map.nodes.length} status={missing.length ? <div className="web-map-status" role="status"><span>{sourceNote(missing)}</span></div> : null} />
      : <div className="web-map web-loading" aria-busy={!state.error}>{state.error ? <div role="alert"><strong>We couldn’t build this map.</strong><p>{state.error.message}</p><button className="secondary-button" onClick={state.retry}>Try again</button></div> : <div role="status"><Network size={42} strokeWidth={1} /><p><LoaderCircle size={14} className="web-spinner" /> Reading the playlists and finding connections…</p></div>}</div>}
  </>;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return <button className="secondary-button" onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false))}>{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : label}</button>;
}

/** The My playlist option on the Connection Web: one person's map, kept in this browser. */
export function PlaylistWeb(props: Props) {
  const [mine, setMine] = useState<SharedPlaylist | null>(() => readStoredPlaylist());
  const pick = (songs: SharedPlaylist['songs']) => { const next = { name: mine?.name ?? '', songs }; setMine(next); storePlaylist(next); };
  return <section className="web-workspace" aria-label="Connection Web workspace">
    {mine ? <TasteMapView mine={mine} friend={null} onChange={() => { setMine(null); storePlaylist(null); }} {...props} />
      : <div className="taste-panel-upload"><div className="taste-box"><h3>Build a web from your playlist</h3><PlaylistPicker label="Upload a playlist to see your artists, how they connect, and who to try next." sample={SAMPLE_MINE} onPick={pick} /></div></div>}
  </section>;
}

const ROOM_KEY = 'song-nexus-room';
const POLL_MS = 4000;
type SavedRoom = { code: string; role: 'host' | 'guest' };
const readSavedRoom = (): SavedRoom | null => {
  try {
    const saved = JSON.parse(localStorage.getItem(ROOM_KEY) || 'null') as SavedRoom | null;
    return saved?.code && (saved.role === 'host' || saved.role === 'guest') ? saved : null;
  } catch { return null; }
};
const saveRoom = (room: SavedRoom | null) => {
  try { if (room) localStorage.setItem(ROOM_KEY, JSON.stringify(room)); else localStorage.removeItem(ROOM_KEY); } catch { /* Private windows can block storage. */ }
};
const codeInUrl = () => new URLSearchParams(window.location.search).get('code')?.trim().toUpperCase() ?? '';

/** The Friends page: two people's playlists on one map, joined with a short code. */
export function Friends(props: Props) {
  const [name, setName] = useState(() => readStoredPlaylist()?.name ?? '');
  const [mine, setMine] = useState<SharedPlaylist | null>(() => readStoredPlaylist());
  const [friend, setFriend] = useState<SharedPlaylist | null>(null);
  const [saved, setSaved] = useState<SavedRoom | null>(() => (codeInUrl() ? null : readSavedRoom()));
  const [joining, setJoining] = useState(codeInUrl);
  const [hostName, setHostName] = useState<string | null>(null);
  const [entered, setEntered] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [noCodes, setNoCodes] = useState(false);
  const [longLink, setLongLink] = useState('');
  const [backLink, setBackLink] = useState('');
  const fail = (e: unknown, fallback: string) => setError(e instanceof Error ? e.message : fallback);

  const pick = (songs: SharedPlaylist['songs']) => { const next = { name: name.trim(), songs }; setMine(next); storePlaylist(next); };
  const showRoom = useCallback((room: Room, role: SavedRoom['role']) => {
    if (!room.guest) return false;
    const [me, them] = role === 'host' ? [room.host, room.guest] : [room.guest, room.host];
    setMine(me); setFriend(them);
    return true;
  }, []);

  // A code in the address, or one typed in: check it's real, and say whose it is.
  const checkCode = useCallback(async (code: string) => {
    try {
      const room = await readRoom(code);
      setJoining(code);
      setHostName(room.host.name || 'A friend');
      if (room.guest) setError('Someone has already joined this room. Ask for a new code.');
    } catch (e) {
      if (e instanceof ApiError && e.unavailable) setNoCodes(true);
      setJoining(''); fail(e, 'Couldn’t find that code.');
    } finally { setBusy(false); }
  }, []);
  const lookUp = (code: string) => { setBusy(true); setError(''); void checkCode(code); };
  useEffect(() => {
    const code = codeInUrl();
    // The first state change happens after the network answers, so this can't loop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (code) void checkCode(code);
  }, [checkCode]);

  // A room you're already in: wait for your friend, and show the map the moment they join.
  useEffect(() => {
    if (!saved || friend) return;
    let live = true;
    const check = async () => {
      try {
        const room = await readRoom(saved.code);
        if (live && showRoom(room, saved.role)) clearInterval(timer);
      } catch (e) {
        if (live && e instanceof ApiError && !e.retryable) { saveRoom(null); setSaved(null); setError('That room has expired. Start a new one.'); clearInterval(timer); }
      }
    };
    const timer = setInterval(() => void check(), POLL_MS);
    void check();
    return () => { live = false; clearInterval(timer); };
  }, [saved, friend, showRoom]);

  const startRoom = async () => {
    if (!mine) return;
    setBusy(true); setError('');
    try {
      const code = await createRoom({ name: name.trim(), songs: mine.songs });
      const room = { code, role: 'host' as const };
      saveRoom(room); setSaved(room);
    } catch (e) {
      if (e instanceof ApiError && e.unavailable) {
        setNoCodes(true);
        setLongLink(friendLink(window.location.origin, await encodePlaylist({ ...mine, name: name.trim() })));
      } else fail(e, 'Couldn’t create a code.');
    } finally { setBusy(false); }
  };
  const join = async (songs: SharedPlaylist['songs']) => {
    pick(songs);
    setBusy(true); setError('');
    try {
      const room = await joinRoom(joining, { name: name.trim(), songs });
      const entry = { code: joining, role: 'guest' as const };
      saveRoom(entry); setSaved(entry); showRoom(room, 'guest');
    } catch (e) { fail(e, 'Couldn’t join this room.'); } finally { setBusy(false); }
  };
  const startOver = () => {
    saveRoom(null); setSaved(null); setFriend(null); setJoining(''); setHostName(null); setError(''); setBackLink('');
    window.history.replaceState(null, '', '/friends');
  };

  // Where short codes aren't set up, a long link carries the playlist itself instead.
  const [invite, setInvite] = useState<SharedPlaylist | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const [a, b] = [params.get('a'), params.get('b')];
    if (!a) return;
    let live = true;
    void (async () => {
      const first = await decodePlaylist(a);
      const second = b ? await decodePlaylist(b) : null;
      if (!live) return;
      if (!first) setError('This link doesn’t contain a playlist we can read. Ask for a new one.');
      else if (second) { setMine(first); setFriend(second); }
      else setInvite(first);
    })();
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (saved || !friend || !mine) return;
    let live = true;
    void Promise.all([encodePlaylist(friend), encodePlaylist(mine)]).then(([them, me]) => { if (live) setBackLink(friendLink(window.location.origin, them, me)); });
    return () => { live = false; };
  }, [saved, friend, mine]);

  const nameField = <><label className="field-label" htmlFor="taste-name">YOUR NAME (OPTIONAL)</label><input id="taste-name" type="text" maxLength={30} value={name} onChange={e => setName(e.target.value)} placeholder="Shown to your friend" /></>;
  const shareUrl = saved ? `${window.location.origin}/friends?code=${saved.code}` : '';

  let body;
  if (mine && friend) {
    body = <TasteMapView mine={mine} friend={friend} onChange={startOver} changeLabel="Start over" extra={backLink ? <CopyButton text={backLink} label="Copy link for your friend" /> : undefined} {...props} />;
  } else if (saved) {
    body = <div className="taste-panel-upload"><div className="taste-box room-box">
      <h3>Your code</h3>
      <div className="room-code" aria-label="Room code">{saved.code}</div>
      <p>Send this to your friend. They go to the Friends page, enter it and upload their playlist. Your map will open here by itself.</p>
      <div className="taste-box-actions"><CopyButton text={saved.code} label="Copy code" /><CopyButton text={shareUrl} label="Copy link" /><button className="secondary-button" onClick={startOver}>Start over</button></div>
      <p className="room-waiting" role="status"><LoaderCircle size={13} className="web-spinner" /> Waiting for your friend… You can close this page and come back. The code lasts a week.</p>
    </div></div>;
  } else if (joining || invite) {
    const inviter = invite ? invite.name || 'A friend' : hostName ?? 'A friend';
    body = <div className="taste-panel-upload"><div className="taste-box">
      <h3>{inviter} wants to compare playlists</h3>{nameField}
      <PlaylistPicker label="Add your playlist to see what you share and what you should each listen to." sample={SAMPLE_FRIEND} onPick={songs => { if (invite) { pick(songs); setFriend(invite); } else void join(songs); }} />
      {busy && <p className="loading-text">Joining…</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="taste-box-actions"><button className="secondary-button" onClick={startOver}>Cancel</button></div>
    </div></div>;
  } else {
    body = <div className="taste-panel-upload">
      <div className="taste-box"><h3>Start a comparison</h3>{nameField}
        {mine ? <><p><Check size={13} /> {mine.songs.length} songs ready.</p><div className="taste-box-actions"><button className="primary-button" disabled={busy} onClick={() => void startRoom()}>{busy ? 'Creating…' : 'Get a code to share'}</button><button className="secondary-button" onClick={() => setFriend(SAMPLE_FRIEND)}>Try a sample friend</button><button className="secondary-button" onClick={() => { setMine(null); storePlaylist(null); setLongLink(''); }}>Use a different playlist</button></div></> : <PlaylistPicker label="Upload your playlist, then share a short code with a friend." sample={SAMPLE_MINE} onPick={pick} />}
        {noCodes && longLink && <><p>Short codes aren’t set up on this server, so send this longer link instead. It contains your playlist.</p><input type="text" readOnly aria-label="Your friend link" value={longLink} onFocus={e => e.currentTarget.select()} /><div className="taste-box-actions"><CopyButton text={longLink} label="Copy link" /></div></>}
      </div>
      <div className="taste-box"><h3>Got a code?</h3>
        <p>Enter the code a friend sent you, then add your playlist.</p>
        <input type="text" aria-label="Room code" className="room-input" maxLength={8} value={entered} onChange={e => setEntered(e.target.value.toUpperCase())} placeholder="ABC234" />
        <div className="taste-box-actions"><button className="primary-button" disabled={busy || entered.trim().length < 6} onClick={() => lookUp(entered.trim())}><GitCompareArrows size={14} /> Continue</button></div>
        {error && <p className="error-text" role="alert">{error}</p>}
      </div>
    </div>;
  }
  return <div className="connection-web-page">
    <div className="web-page-heading"><h1>Friends</h1></div>
    <section className="web-workspace" aria-label="Friends workspace">{body}</section>
  </div>;
}
