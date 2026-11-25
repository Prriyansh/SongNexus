// Helen's two-artist Connection Web (PR #6): documented credits between two artists, a genre
// journey between their styles, and discovery that widens on zoom-out and deepens on zoom-in.
import { useMemo, useState } from 'react';
import { ArrowRight, ArrowRightLeft, Check, LoaderCircle, Network } from 'lucide-react';
import { artistDetails, collaborators } from '../api';
import { artistTags, buildConnectionWeb, discoveryGenres } from '../connection-web';
import type { WebSource } from '../connection-web';
import { capitalize } from '../model';
import type { WebSelection } from '../routing';
import type { Selection } from '../types';
import type { MusicProfile } from '../profile';
import { useAsync } from '../useAsync';
import { useWebDiscovery } from '../useWebDiscovery';
import { ComparisonWebCanvas } from './ComparisonWebCanvas';
import { SearchChooser } from './SearchChooser';

type ComparisonProps = { selection: WebSelection; onChange: (s: WebSelection) => void; onSelect: (s: Selection) => void; profile: MusicProfile };

export function ComparisonWeb({ selection, onChange, onSelect, profile }: ComparisonProps) {
  const { left, right } = selection;
  const selectionKey = `comparison:${left}:${right}`;
  const [scope, setScope] = useState({ key: selectionKey, level: 0 });
  const [visibleCount, setVisibleCount] = useState<number | null>(null);
  const level = scope.key === selectionKey ? scope.level : 0;
  const setLevel = (next: number) => setScope({ key: selectionKey, level: Math.max(-1, Math.min(2, next)) });
  const a = useAsync(`artist:${left}`, () => artistDetails(left));
  const b = useAsync(`artist:${right}`, () => artistDetails(right));
  const credits = useAsync(`collab:${left}:${right}`, () => collaborators(left, right));
  const breadth = Math.max(0, level);
  const journeyKey = JSON.stringify(a.data && b.data ? discoveryGenres(artistTags(a.data), artistTags(b.data), breadth) : []);
  const journey = useMemo<string[]>(() => JSON.parse(journeyKey), [journeyKey]);
  const discovery = useWebDiscovery(journey);
  const source = useMemo<WebSource | null>(() => a.data && b.data ? { mode: 'comparison', a: a.data, b: b.data, collab: credits.data } : null, [a.data, b.data, credits.data]);
  const graph = useMemo(() => source ? buildConnectionWeb(source, discovery.artists, journey) : null, [source, discovery.artists, journey]);
  const error = a.error || b.error;
  const pending = discovery.loading || credits.loading;
  const partial = discovery.partial || !!credits.error;
  const retry = () => { if (error) { a.retry(); b.retry(); } if (discovery.partial) discovery.retry(); if (credits.error) credits.retry(); };
  const names = graph?.path.map(id => graph.nodes.find(n => n.id === id)?.label).join(' → ');
  const artistCount = visibleCount ?? graph?.nodes.length ?? 0;
  const status = (pending || partial || !!graph) ? <div className="web-map-status" role="status">{pending ? <><LoaderCircle size={14} className="web-spinner" /><span>{credits.loading ? 'Reading album credits and finding similar artists…' : 'Finding similar artists…'}</span></>
    : partial ? <><span>Some {credits.error ? 'album credits' : 'discovery data'} couldn’t be loaded. The available artists are shown.</span><button onClick={retry}>Try again</button></>
      : graph?.path.length ? <><Check size={14} /><span title={names}>Credit path: {names}</span></>
        : <span>No documented connection found in the scanned credits.</span>}</div> : null;

  return <section className="web-workspace" aria-label="Connection Web workspace">
    <div className="web-toolbar"><div className="web-live-label"><span /> ARTIST CONNECTIONS<small>{graph ? `${artistCount} artist${artistCount === 1 ? '' : 's'}` : 'Loading map'}</small></div></div>
    <div className="web-map-heading"><h2>{a.data?.name ?? 'Artist one'} <span>↔</span> {b.data?.name ?? 'Artist two'}</h2></div>
    {!!journey.length && <div className="web-journey" aria-label="Genre discovery neighborhoods">{journey.map((genre, i) => <span key={genre}>{i > 0 && <ArrowRight size={11} />}<span>{capitalize(genre)}</span></span>)}</div>}
    {graph ? <ComparisonWebCanvas key={selectionKey} graph={graph} onSelect={onSelect} onLevelChange={setLevel} onExplore={(focus, zoom) => void discovery.expand(focus, zoom)} onVisibleCount={setVisibleCount} status={status} /> : <div className="web-map web-loading" aria-busy={!error}>{error ? <div role="alert"><strong>We couldn’t load this map.</strong><p>{error.message}</p><button className="secondary-button" onClick={retry}>Try again</button></div> : <div role="status"><Network size={42} strokeWidth={1} /><p>Finding artists…</p></div>}</div>}
    <div className="web-selection-dock">
      <div className="web-pair-pickers"><SearchChooser type="artist" label="ARTIST ONE" value={left} display={a.data} other={right} onChange={id => onChange({ ...selection, left: id })} profile={profile} /><button className="web-swap icon-button" aria-label="Swap artists" onClick={() => onChange({ ...selection, left: right, right: left })}><ArrowRightLeft size={17} /></button><SearchChooser type="artist" label="ARTIST TWO" value={right} display={b.data} other={left} onChange={id => onChange({ ...selection, right: id })} profile={profile} /></div>
    </div>
  </section>;
}
