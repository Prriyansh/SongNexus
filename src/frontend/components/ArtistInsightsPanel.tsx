// Facts about each artist from outside MusicBrainz, with every one linked to where it came from.
// Wikidata and Wikipedia are community-edited, so lists read "listed on Wikidata", never as a full record.
import type { ArtistInsight, ArtistInsights, WikiLabelled } from '@/lib/types';
import type { Loadable } from './ComparisonDetails';
import { sourceNote } from '../credits';

const AWARDS_SHOWN = 5;
const number = (n: number) => n.toLocaleString('en-US');
const dated = (item: WikiLabelled) => `${item.name}${item.year ? ` (${item.year})` : ''}`;

function Listed({ label, items, url }: { label: string; items: WikiLabelled[]; url: string }) {
  if (!items.length) return null;
  const rest = items.length - AWARDS_SHOWN;
  return <div className="insight-fact"><span>{label} listed on Wikidata · {items.length}</span><p>{items.slice(0, AWARDS_SHOWN).map(dated).join(' · ')}{rest > 0 && ` · and ${rest} more`}</p><small><a className="inline-link" href={url} target="_blank" rel="noreferrer">Wikidata ↗</a></small></div>;
}

function Side({ name, insight }: { name: string; insight: ArtistInsight }) {
  const { facts, audience } = insight;
  const wiki = facts?.wikipedia;
  return <div className="insight-side">
    <div className="insight-side-head">
      {/* eslint-disable-next-line @next/next/no-img-element -- remote Wikipedia image, sized by CSS */}
      {wiki?.imageUrl && <img className="insight-photo" src={wiki.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      <div><strong>{name}</strong>{facts?.description && <small>{facts.description}</small>}</div>
    </div>
    {wiki ? <p className="insight-bio">{wiki.extract} <a className="inline-link" href={wiki.url} target="_blank" rel="noreferrer">Wikipedia ↗</a></p> : <p className="insight-bio">No Wikipedia summary linked for this artist.</p>}
    {facts?.activeFrom && <div className="insight-fact"><span>Active since</span><p>{facts.activeFrom}</p></div>}
    {facts && <Listed label="Awards" items={facts.awards} url={facts.wikidataUrl} />}
    {facts && <Listed label="Nominations" items={facts.nominations} url={facts.wikidataUrl} />}
    {facts && <Listed label="Record labels" items={facts.labels} url={facts.wikidataUrl} />}
    {audience.listenBrainz && <div className="insight-fact"><span>ListenBrainz users</span><p>{number(audience.listenBrainz.listeners)} listeners · {number(audience.listenBrainz.listens)} listens</p><small><a className="inline-link" href={audience.listenBrainz.url} target="_blank" rel="noreferrer">ListenBrainz ↗</a> Counts its own community, not all listeners.</small></div>}
    {audience.lastFm && <div className="insight-fact"><span>Last.fm users</span><p>{number(audience.lastFm.listeners)} listeners · {number(audience.lastFm.plays)} plays</p><small><a className="inline-link" href={audience.lastFm.url} target="_blank" rel="noreferrer">Last.fm ↗</a></small></div>}
  </div>;
}

export function ArtistInsightsPanel({ state, names }: { state: Loadable<ArtistInsights>; names: [string, string] }) {
  const title = <div className="section-title"><div><span className="overline">WHO THEY ARE</span><h3>Beyond the credits</h3></div></div>;
  if (state.error) return <section className="panel artist-insights">{title}<p className="error-text" role="alert">{state.error.message}</p><button className="secondary-button" onClick={state.retry}>Try again</button></section>;
  if (!state.data) return <section className="panel artist-insights" aria-busy="true">{title}<p className="loading-text">Looking them up on Wikidata, Wikipedia and ListenBrainz…</p><div className="skeleton-lines"><span /><span /><span /></div></section>;
  const { a, b, shared, sources } = state.data;
  return <section className="panel artist-insights">{title}
    <div className="insight-sides"><Side name={names[0]} insight={a} /><Side name={names[1]} insight={b} /></div>
    {(shared.awards.length > 0 || shared.labels.length > 0 || shared.similarArtists.length > 0) && <div className="insight-shared">
      {shared.labels.length > 0 && <div className="insight-fact"><span>Both released on</span><div className="chip-row">{shared.labels.map(item => <span className="chip" key={item.id}>{item.name}</span>)}</div></div>}
      {shared.awards.length > 0 && <div className="insight-fact"><span>Both received</span><div className="chip-row">{shared.awards.map(item => <span className="chip" key={item.id}>{item.name}</span>)}</div></div>}
      {shared.similarArtists.length > 0 && <div className="insight-fact"><span>Last.fm lists as similar to both</span><div className="chip-row">{shared.similarArtists.slice(0, 8).map(artist => <a className="chip" key={artist.url} href={artist.url} target="_blank" rel="noreferrer">{artist.name}</a>)}</div><small>Listener similarity, not a collaboration.</small></div>}
    </div>}
    <small className="coverage-note">{sourceNote(sources.filter(s => s.status !== 'ok'))} Wikidata and Wikipedia are community-edited: their lists aren’t complete totals and can contain mistakes, so check the links.</small>
  </section>;
}
