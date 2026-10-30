import { useMemo, useState } from 'react';
import { ArrowRight, ArrowRightLeft, Check, GitCompareArrows, Link2, LoaderCircle, Network, Search } from 'lucide-react';
import { artistDetails, collaborators, songDetails } from '../api';
import { artistTags, buildConnectionWeb, discoveryGenres } from '../connection-web';
import type { WebSource } from '../connection-web';
import { capitalize } from '../model';
import type { WebSelection } from '../routing';
import type { Selection } from '../types';
import { useAsync } from '../useAsync';
import { useWebDiscovery } from '../useWebDiscovery';
import { ConnectionWebCanvas } from './ConnectionWebCanvas';
import { SearchChooser } from './SearchChooser';

type WebProps = { selection: WebSelection; onChange: (s: WebSelection) => void; onSelect: (s: Selection) => void; note?: string };
export function ConnectionWeb(props: WebProps) {
  const s = props.selection;
  return <ConnectionWebView key={`${s.mode}:${s.left}:${s.right}:${s.song}`} {...props} />;
}

function ConnectionWebView({ selection, onChange, onSelect, note = '' }: WebProps) {
  const { mode, left, right, song: songId } = selection;
  const selectionKey = `${mode}:${left}:${right}:${songId}`;
  const [scope, setScope] = useState({ key: selectionKey, level: 0 });
  const [visibleCount, setVisibleCount] = useState<number | null>(null);
  const level = scope.key === selectionKey ? scope.level : 0;
  const setLevel = (next: number) => setScope({ key: selectionKey, level: Math.max(-1, Math.min(2, next)) });
  const comparing = mode === 'comparison';
  const a = useAsync(comparing ? `artist:${left}` : null, () => artistDetails(left));
  const b = useAsync(comparing ? `artist:${right}` : null, () => artistDetails(right));
  const song = useAsync(!comparing ? `song:${songId}` : null, () => songDetails(songId));
  const leadId = song.data?.artists.find(artist => artist.id)?.id;
  const lead = useAsync(!comparing && leadId ? `artist:${leadId}` : null, () => artistDetails(leadId!));
  const credits = useAsync(comparing ? `collab:${left}:${right}` : null, () => collaborators(left, right));
  const breadth = Math.max(0, level);
  const journeyKey = JSON.stringify(comparing ? a.data && b.data ? discoveryGenres(artistTags(a.data), artistTags(b.data), breadth) : []
    : song.data ? discoveryGenres(lead.data ? artistTags(lead.data) : song.data.genres.map(g => g.name), undefined, breadth) : []);
  const journey = useMemo<string[]>(() => JSON.parse(journeyKey), [journeyKey]);
  const discovery = useWebDiscovery(journey);
  const source = useMemo<WebSource | null>(() => comparing ? a.data && b.data ? { mode: 'comparison', a: a.data, b: b.data, collab: credits.data } : null
    : song.data ? { mode: 'search', song: song.data, lead: lead.data } : null, [comparing, a.data, b.data, credits.data, song.data, lead.data]);
  const graph = useMemo(() => source ? buildConnectionWeb(source, discovery.artists, journey) : null, [source, discovery.artists, journey]);
  const error = a.error || b.error || song.error;
  const pending = discovery.loading || credits.loading || lead.loading;
  const partial = discovery.partial || !!credits.error || !!lead.error;
  const retry = () => { if (error) { a.retry(); b.retry(); song.retry(); } if (discovery.partial) discovery.retry(); if (credits.error) credits.retry(); if (lead.error) lead.retry(); };
  const names = graph?.path.map(id => graph.nodes.find(n => n.id === id)?.label).join(' → ');
  const artistCount = visibleCount ?? graph?.nodes.length ?? 0;
  const status = (pending || partial || comparing && !!graph) ? <div className="web-map-status" role="status">{pending ? <><LoaderCircle size={14} className="web-spinner" /><span>{credits.loading ? 'Reading album credits and finding similar artists…' : 'Finding similar artists…'}</span></>
    : partial ? <><span>Some {credits.error ? 'album credits' : 'discovery data'} couldn’t be loaded. The available artists are shown.</span><button onClick={retry}>Try again</button></>
      : graph?.path.length ? <><Check size={14} /><span title={names}>Credit path: {names}</span></>
        : <span>No documented connection found in the scanned credits.</span>}</div> : null;

  return <div className="connection-web-page">
    <div className="web-page-heading"><h1>Connection Web</h1>
      <div className="web-mode" role="group" aria-label="Connection web mode"><button className={!comparing ? 'active' : ''} aria-pressed={!comparing} onClick={() => onChange({ ...selection, mode: 'search' })}><Search size={16} /> Search</button><button className={comparing ? 'active' : ''} aria-pressed={comparing} onClick={() => onChange({ ...selection, mode: 'comparison' })}><GitCompareArrows size={16} /> Comparison</button></div>
    </div>
    {note && <div className="shared-note"><Link2 size={17} /><div><strong>Shared with a note</strong><p>{note}</p></div></div>}
    <section className="web-workspace" aria-label="Connection Web workspace">
      <div className="web-toolbar"><div className="web-live-label"><span /> {comparing ? 'ARTIST CONNECTIONS' : 'SONG DISCOVERY'}<small>{graph ? `${artistCount} artist${artistCount === 1 ? '' : 's'}` : 'Loading map'}</small></div></div>
      <div className="web-map-heading"><div><span className="web-mini-label">{comparing ? 'THE SPACE BETWEEN' : 'THE WORLD AROUND'}</span><h2>{comparing ? <>{a.data?.name ?? 'Artist one'} <span>↔</span> {b.data?.name ?? 'Artist two'}</> : song.data ? <>“{song.data.title}” <span>by {song.data.artists.map(a => a.name).join(', ')}</span></> : 'Finding your song…'}</h2></div></div>
      {!!journey.length && <div className="web-journey" aria-label="Genre discovery neighborhoods">{journey.map((genre, i) => <span key={genre}>{i > 0 && <ArrowRight size={11} />}<span>{capitalize(genre)}</span></span>)}</div>}
      {graph ? <ConnectionWebCanvas key={selectionKey} graph={graph} onSelect={onSelect} onLevelChange={setLevel} onExplore={(focus, zoom) => void discovery.expand(focus, zoom)} onVisibleCount={setVisibleCount} status={status} /> : <div className="web-map web-loading" aria-busy={!error}>{error ? <div role="alert"><strong>We couldn’t load this map.</strong><p>{error.message}</p><button className="secondary-button" onClick={retry}>Try again</button></div> : <div role="status"><Network size={42} strokeWidth={1} /><p>Finding artists…</p></div>}</div>}
      <div className={`web-selection-dock ${!comparing ? 'search-mode' : ''}`}>
        {comparing ? <div className="web-pair-pickers"><SearchChooser type="artist" label="ARTIST ONE" value={left} display={a.data} other={right} onChange={id => onChange({ ...selection, left: id })} /><button className="web-swap icon-button" aria-label="Swap artists" onClick={() => onChange({ ...selection, left: right, right: left })}><ArrowRightLeft size={17} /></button><SearchChooser type="artist" label="ARTIST TWO" value={right} display={b.data} other={left} onChange={id => onChange({ ...selection, right: id })} /></div>
          : <SearchChooser type="song" label="SONG" value={songId} display={song.data} other="" onChange={id => onChange({ ...selection, song: id })} />}
      </div>
    </section>
  </div>;
}
