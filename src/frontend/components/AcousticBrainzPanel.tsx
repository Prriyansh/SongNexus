// What AcousticBrainz measured for two songs, from /api/acousticbrainz: tempo, key and its
// classifiers' mood estimates. It's a second, independent measurement next to Ishita's analysis,
// so it's labelled as AcousticBrainz's own. Its data stops in 2022; a missing song says so.
import type { AudioComparison, AudioDescriptors } from '@/lib/types';
import type { Loadable } from './ComparisonDetails';

const pct = (x: number) => Math.round(x * 100);

function Side({ value, which }: { value: number | undefined; which: 'a' | 'b' }) {
  return value === undefined ? null : <span className={`bar-${which}`} style={{ width: `${pct(value)}%` }} />;
}

/** Every classifier either song has, in the order the server sends them. */
function classNames(a: AudioDescriptors | null, b: AudioDescriptors | null): string[] {
  return [...new Set([...(a?.classes ?? []), ...(b?.classes ?? [])].map(c => c.name))];
}

export function AcousticBrainzPanel({ state, titles }: { state: Loadable<AudioComparison>; titles: [string, string] }) {
  const title = <div className="section-title"><h3>Measured by AcousticBrainz</h3></div>;
  if (state.error) return <section className="panel audio-panel acousticbrainz-panel">{title}<p className="error-text" role="alert">{state.error.message}</p><button className="secondary-button" onClick={state.retry}>Try again</button></section>;
  if (!state.data) return <section className="panel audio-panel acousticbrainz-panel" aria-busy="true">{title}<p className="loading-text">Looking them up on AcousticBrainz…</p><div className="skeleton-lines"><span /><span /></div></section>;
  const { a, b, source } = state.data;
  if (source.status === 'failed') return <section className="panel audio-panel acousticbrainz-panel">{title}<p className="analysis-missing">AcousticBrainz couldn’t be reached just now.</p></section>;
  if (!a && !b) return <section className="panel audio-panel acousticbrainz-panel">{title}<p className="analysis-missing">AcousticBrainz has no measurements for either song. It stopped collecting in 2022, so newer and less-played songs are often missing.</p></section>;
  const missing = [!a && titles[0], !b && titles[1]].filter(Boolean);
  const value = (side: AudioDescriptors | null, name: string) => side?.classes.find(c => c.name === name)?.probability;
  const shown = (n: number | undefined) => (n === undefined ? '—' : pct(n));
  return <section className="panel audio-panel acousticbrainz-panel">
    {title}
    <div className="bar-key"><span><i className="key-a" />{titles[0]}</span><span><i className="key-b" />{titles[1]}</span></div>
    <div className="audio-row"><div className="audio-label"><span>Tempo</span><strong>{a?.bpm ?? '—'} <em>/</em> {b?.bpm ?? '—'} BPM</strong></div></div>
    <div className="audio-row"><div className="audio-label"><span>Key</span><strong>{a?.key ?? '—'} <em>/</em> {b?.key ?? '—'}</strong></div></div>
    {classNames(a, b).map(name => <div className="audio-row" key={name}>
      <div className="audio-label"><span>{name}</span><strong>{shown(value(a, name))} <em>/</em> {shown(value(b, name))}</strong></div>
      <div className="audio-bar"><Side value={value(a, name)} which="a" /><Side value={value(b, name)} which="b" /></div>
    </div>)}
    <p className="metadata-note">
      Calculated by AcousticBrainz from the audio: moods are its classifiers’ estimates (0–100), not listener ratings.
      {missing.length > 0 && ` It has no data for ${missing.join(' or ')} (it stopped collecting in 2022).`}
      {' '}{a && <a className="inline-link" href={a.url} target="_blank" rel="noreferrer">{titles[0]} ↗</a>}{a && b && ' · '}{b && <a className="inline-link" href={b.url} target="_blank" rel="noreferrer">{titles[1]} ↗</a>}
    </p>
  </section>;
}
