import { useCallback, useMemo, useState } from 'react';
import { Compass, GitCompareArrows, Link2, ListMusic, LoaderCircle, Music2, Network, UserRound } from 'lucide-react';
import { similarMusic } from '../api';
import { sourceNote } from '../credits';
import type { WebSelection } from '../routing';
import { buildWebEdges, connectionsOf, layoutSimilarWeb } from '../similar-web';
import type { WebFilter, WebNode } from '../similar-web';
import type { EntityType, Selection } from '../types';
import { useAsync } from '../useAsync';
import { ConnectionWebCanvas } from './ConnectionWebCanvas';
import { SearchChooser } from './SearchChooser';
import { PlaylistWeb } from './TasteWeb';

type WebProps = { selection: WebSelection; onChange: (s: WebSelection) => void; onSelect: (s: Selection) => void; onCompare: (kind: EntityType, a: string, b: string) => void; note?: string };
const FILTERS: { value: WebFilter; label: string }[] = [{ value: 'all', label: 'Both' }, { value: 'artist', label: 'Artists' }, { value: 'song', label: 'Songs' }];

const MODES: { value: WebSelection['mode']; label: string; icon: typeof Music2 }[] = [
  { value: 'artist', label: 'Artist', icon: UserRound },
  { value: 'song', label: 'Song', icon: Music2 },
  { value: 'playlist', label: 'My playlist', icon: ListMusic },
];

export function ConnectionWeb(props: WebProps) {
  const { selection, onChange, note = '' } = props;
  return <div className="connection-web-page">
    <div className="web-page-heading"><h1>Connection Web</h1>
      <div className="web-mode" role="group" aria-label="Start from">{MODES.map(({ value, label, icon: Icon }) => <button key={value} className={selection.mode === value ? 'active' : ''} aria-pressed={selection.mode === value} onClick={() => onChange({ ...selection, mode: value })}><Icon size={16} /> {label}</button>)}</div>
    </div>
    {note && <div className="shared-note"><Link2 size={17} /><div><strong>Shared with a note</strong><p>{note}</p></div></div>}
    {selection.mode === 'playlist'
      ? <PlaylistWeb onExploreArtist={artist => onChange({ ...selection, mode: 'artist', artist })} onExploreSong={song => onChange({ ...selection, mode: 'song', song })} onDetails={props.onSelect} />
      : <SimilarView {...props} mode={selection.mode} />}
  </div>;
}

function SimilarView({ selection, onChange, onSelect, onCompare, mode }: WebProps & { mode: EntityType }) {
  const id = mode === 'song' ? selection.song : selection.artist;
  const state = useAsync(`similar:${mode}:${id}`, () => similarMusic(mode, id));
  const [filter, setFilter] = useState<WebFilter>('all');
  const [visibleCount, setVisibleCount] = useState<number | null>(null);
  const web = state.data;
  const shown = useMemo(() => web && {
    ...web,
    artists: filter === 'song' ? [] : web.artists,
    songs: filter === 'artist' ? [] : web.songs,
  }, [web, filter]);
  const edges = useMemo(() => shown ? buildWebEdges(shown) : [], [shown]);
  const missing = web ? web.sources.filter(s => s.status !== 'ok') : [];
  const empty = !!web && !web.artists.length && !web.songs.length;

  const place = useCallback((width: number, height: number) => shown ? layoutSimilarWeb(shown, width, height) : [], [shown]);
  const near = useCallback((nodeId: string) => web ? connectionsOf(nodeId, web) : [], [web]);
  const actions = (node: WebNode) => <>
    {!node.isCenter && <button className="primary-button" onClick={() => { setFilter('all'); onChange({ ...selection, mode: node.kind, ...(node.kind === 'artist' ? { artist: node.id } : { song: node.id }) }); }}><Compass size={13} /> Explore from here</button>}
    {!node.isCenter && node.kind === web?.center.kind && <button className="secondary-button" onClick={() => onCompare(node.kind, web.center.id, node.id)}><GitCompareArrows size={13} /> Compare</button>}
    <button className="secondary-button" onClick={() => onSelect({ type: node.kind, id: node.id })}>Details</button>
  </>;

  return <>
    <section className="web-workspace" aria-label="Connection Web workspace">
      <div className="web-toolbar"><div className="web-live-label"><span /> {mode === 'artist' ? 'SIMILAR TO THIS ARTIST' : 'SIMILAR TO THIS SONG'}<small>{web ? `${visibleCount ?? 0} in view` : 'Loading map'}</small></div>
        {web && <div className="web-summary"><span><i className="dot-artist" />{web.artists.length} artists</span><span><i className="dot-song" />{web.songs.length} songs</span><div className="web-filter" role="group" aria-label="Show on map">{FILTERS.map(f => <button key={f.value} className={filter === f.value ? 'active' : ''} aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>{f.label}</button>)}</div><span className="web-summary-note">Closer means more similar, calculated from listening data.</span></div>}</div>
      <div className="web-map-heading"><div><span className="web-mini-label">THE WORLD AROUND</span><h2>{web ? <>{web.center.name}{web.center.kind === 'song' && <span> by {web.center.subtitle}</span>}</> : 'Finding similar music…'}</h2></div></div>
      {shown ? <ConnectionWebCanvas key={`${mode}:${id}`} nodes={place} edges={edges} near={near} actions={actions} onVisibleCount={setVisibleCount} status={(missing.length > 0 || web!.seedSongs.length > 0) ? <div className="web-map-status" role="status"><span>{[mode === 'artist' && web!.seedSongs.length ? `Songs found from “${web!.seedSongs[0]}”.` : '', sourceNote(missing)].filter(Boolean).join(' ')}</span>{missing.some(s => s.status === 'failed') && <button onClick={state.retry}>Try again</button>}</div> : null} empty={empty} />
        : <div className="web-map web-loading" aria-busy={!state.error}>{state.error ? <div role="alert"><strong>We couldn’t load this map.</strong><p>{state.error.message}</p><button className="secondary-button" onClick={state.retry}>Try again</button></div> : <div role="status"><Network size={42} strokeWidth={1} /><p><LoaderCircle size={14} className="web-spinner" /> Finding similar artists and songs…</p></div>}</div>}
      <div className="web-selection-dock search-mode">
        {mode === 'artist' ? <SearchChooser key="artist" type="artist" label="ARTIST" value={selection.artist} display={undefined} displayName={web?.center.kind === 'artist' ? web.center.name : undefined} other="" onChange={next => onChange({ ...selection, artist: next })} />
          : <SearchChooser key="song" type="song" label="SONG" value={selection.song} display={undefined} displayName={web?.center.kind === 'song' ? web.center.name : undefined} other="" onChange={next => onChange({ ...selection, song: next })} />}
      </div>
    </section>
  </>;
}
