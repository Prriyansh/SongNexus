import { getArtist, getSong, artistSongs, mutualCollaborators, compareMusic } from '../data';
import type { EntityType, Song, Credit, MusicalProfile } from '../data';
import type { Selection } from '../types';

function ContextNote({ music }: { music?: MusicalProfile }) {
  const source = music?.evidence.find(e => e.field === 'description' && e.sourceUrls.length);
  return source ? <small>Album context · editorial summary · <a className="inline-link" href={source.sourceUrls[0]} target="_blank" rel="noreferrer">source ↗</a></small> : null;
}
export function MusicalOverlap({ kind, left, right }: { kind: EntityType; left: string; right: string }) {
  const result = compareMusic(kind,left,right);
  const shared = result.signals.filter(s => s.score > 0 && s.shared.length && s.attribute !== 'Genre');
  return <div className="artist-overlap musical-overlap"><strong>Musical similarity</strong>
    <p>{shared.length ? shared.map(s => <span className="similarity-reason" key={s.attribute}>{s.attribute === 'Era' ? s.detail : `${s.attribute}: ${s.shared.join(', ')}.`}{s.scope && <small>{s.scope}</small>}</span>) : 'No specific musical overlap is supported by the available metadata.'}</p>
    <small>{result.eligible ? 'Calculated from shared metadata. This does not establish a historical collaboration.' : 'Evidence is too limited or the match is too weak for an automatic similarity link.'} Genre and style tags are editorial; no audio analysis is implied.</small>
  </div>;
}
export function ComparisonDetails({ kind, left, right, onSelect }: { kind: EntityType; left: string; right: string; onSelect: (s: Selection) => void }) {
  const creditRow = (name: string, a: Song, b: Song, role: Credit['role']) => {
    if (![a,b].some(s => s.credits.some(c => c.role === role))) return null;
    return <div className="comparison-row"><span>{name}</span>{[a,b].map(s => <div className="inline-credit-list" key={s.id}>{s.credits.filter(c => c.role === role).map(c => <button className="inline-link" key={c.artistId} onClick={() => onSelect({type:'artist',id:c.artistId!})}>{c.name}{c.viaSample ? ' (sample composition)' : ''} ↗</button>)}{!s.credits.some(c => c.role === role) && <p>—</p>}</div>)}</div>;
  };
  if (kind === 'song') {
    const a = getSong(left)!, b = getSong(right)!;
    const optionalRows = [
      { name:'Tempo', values:[a,b].map(s => s.bpm === null ? '' : `${s.bpm} BPM`) },
      { name:'Musical key', values:[a.key,b.key] },
      { name:'Mood / style', values:[a,b].map(s => s.mood ? `${s.mood} · editorial album description` : '') },
      { name:'Instruments', values:[a,b].map(s => s.instrumentation.join(' · ')) }
    ].filter(row => row.values.some(Boolean));
    return <section className="panel comparison-details"><div className="section-title"><div><span className="overline">SIDE BY SIDE</span><h3>Listen for the similarities.</h3></div></div>
      <div className="comparison-row comparison-row-heading"><span/><strong>{a.title}</strong><strong>{b.title}</strong></div>
      <div className="comparison-row"><span>Released</span><p>{a.year}</p><p>{b.year}</p></div>
      <div className="comparison-row"><span>Genre / style</span>{[a,b].map(s => <p key={s.id}>{s.genre} · {s.music?.styles.join(' · ') || s.subgenre}<small>Curated tags</small></p>)}</div>
      {optionalRows.map(row => <div className="comparison-row" key={row.name}><span>{row.name}</span>{row.values.map((value,i) => <p key={i}>{value || '—'}</p>)}</div>)}
      {[a,b].some(s => s.music?.description) && <div className="comparison-row"><span>Sound / style</span>{[a,b].map(s => <p key={s.id}>{s.music?.description || '—'}<ContextNote music={s.music}/></p>)}</div>}
      <div className="comparison-row"><span>Album</span>{[a,b].map(s => <button className="inline-link" key={s.id} onClick={() => onSelect({type:'album',id:s.id})}>{s.album} ↗</button>)}</div>
      {creditRow('Produced by',a,b,'Producer')}{creditRow('Songwriters',a,b,'Songwriter')}
      {(a.bpm === null || b.bpm === null || !a.key || !b.key) && <p className="metadata-note">Unverified tempo, key, and audio measurements are omitted. Instruments come from recording credits; sound descriptions describe the album.</p>}
      <MusicalOverlap kind={kind} left={left} right={right}/>
    </section>;
  }
  const a = getArtist(left)!, b = getArtist(right)!, mutual = mutualCollaborators(left,right);
  return <section className="panel comparison-details"><div className="section-title"><div><span className="overline">SIDE BY SIDE</span><h3>Their sound, their circle.</h3></div></div>
    <div className="comparison-row comparison-row-heading"><span/><strong>{a.name}</strong><strong>{b.name}</strong></div>
    <div className="comparison-row"><span>Genres</span>{[a,b].map(artist => <p key={artist.id}>{artist.genres.join(' · ')}<small>{artist.subgenres.join(' · ')} · curated tags</small></p>)}</div>
    <div className="comparison-row"><span>Musical style</span>{[a,b].map(artist => <p key={artist.id}>{artist.music?.description || artist.description}<ContextNote music={artist.music}/></p>)}</div>
    <div className="comparison-row"><span>Selected works</span>{[a,b].map(artist => <div className="inline-credit-list" key={artist.id}>{artistSongs(artist.id).slice(0,3).map(s => <button className="inline-link" key={s.id} onClick={() => onSelect({type:'song',id:s.id})}>{s.title} ↗</button>)}</div>)}</div>
    <MusicalOverlap kind={kind} left={left} right={right}/>
    <div className="artist-overlap"><strong>Mutual collaborators & producers · factual credits</strong><div className="inline-credit-list">{mutual.length ? mutual.map(id => <button className="inline-link" key={id} onClick={() => onSelect({type:'artist',id})}>{getArtist(id)?.name} ↗</button>) : <p>No credited collaborators in common in this catalog.</p>}</div></div>
  </section>;
}
