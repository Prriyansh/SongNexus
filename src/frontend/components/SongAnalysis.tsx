// The main part of a two-song comparison: Ishita's sound and lyrics analysis (song_compare,
// via /api/sound): how alike the songs are and why, their sound profile, structure, lyrics, and
// songs that sound like them. MusicBrainz release details come after it (ComparisonDetails).
import type { ReactNode } from 'react';
import { GitCompareArrows } from 'lucide-react';
import type { RecordingDetails } from '@/lib/types';
import type { AudioFeature, SimilarSong, SoundComparison, SoundResult } from '@/lib/sound';
import { capitalize } from '../model';
import { AlbumCover } from './Artwork';

export type SoundState = { data?: SoundResult; loading: boolean; error?: Error; retry: () => void };

const pct = (x: number) => Math.round(x * 100);
const mood = (sentiment: number) => (sentiment > 0.1 ? 'Positive' : sentiment < -0.1 ? 'Negative' : 'Mixed');
const mmss = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
// The service says "valence"; the bars call it positivity, so the reasons do too.
const plainReason = (reason: string) => reason.replace(/\bvalence\b/g, 'positivity');
const FEATURES: { key: AudioFeature; label: string }[] = [
  { key: 'energy', label: 'Energy' },
  { key: 'danceability', label: 'Danceability' },
  { key: 'valence', label: 'Positivity' },
  { key: 'acousticness', label: 'Acousticness' },
  { key: 'speechiness', label: 'Speechiness' },
  { key: 'liveness', label: 'Liveness' },
  { key: 'instrumentalness', label: 'Instrumentalness' },
];

const Title = ({ overline, title, icon }: { overline: string; title: string; icon?: ReactNode }) =>
  <div className="section-title"><div><span className="overline">{overline}</span><h3>{title}</h3></div>{icon}</div>;
const Bars = ({ a, b }: { a: number; b?: number }) =>
  <div className="audio-bar"><span className="bar-a" style={{ width: `${a}%` }} />{b !== undefined && <span className="bar-b" style={{ width: `${b}%` }} />}</div>;
const Row = ({ name, a, b }: { name: string; a: ReactNode; b: ReactNode }) =>
  <div className="comparison-row"><span>{name}</span><div className="comparison-cell"><p>{a}</p></div><div className="comparison-cell"><p>{b}</p></div></div>;

/** Why there's no analysis, in a sentence; null while loading or when there is data. */
export function soundUnavailableText(sound: SoundState, titles: [string, string]): string | null {
  const result = sound.data;
  if (sound.error) return `The sound and lyrics comparison failed: ${sound.error.message}`;
  if (!result) return null;
  if (result.status === 'not-found') {
    const names = result.missing.map(side => `“${titles[side === 'a' ? 0 : 1]}”`).join(' and ');
    return `${names} ${result.missing.length > 1 ? 'aren’t' : 'isn’t'} in the song library (Spotify tracks up to 2022), so there’s no sound and lyrics analysis for this pair. Pick songs with the search above to see it.`;
  }
  if (result.status === 'same-track') return 'Both are the same track in the song library, so there’s nothing to compare.';
  if (result.status === 'unavailable') return `The sound and lyrics analysis isn’t available right now.${'hint' in result && result.hint ? ` ${result.hint}` : ''}`;
  return null;
}

/** 02 / How alike they are: the overall match, sound and lyric scores, reasons, shared credits. */
function MatchPanel({ c }: { c: SoundComparison }) {
  const shared = [
    ...c.credits.artists.map(artist => `Artist: ${artist}`),
    c.credits.same_album && c.credits.album ? `Album: ${c.credits.album}` : '',
    c.credits.same_genre && c.credits.genre ? `Genre: ${capitalize(c.credits.genre)}` : '',
  ].filter(Boolean);
  return <section className="panel match-panel">
    <Title overline="02 / HOW ALIKE THEY ARE" title="Listen for the similarities." icon={<GitCompareArrows size={20} />} />
    <div className="match-hero">
      <div className="match-score"><strong>{pct(c.overall)}%</strong><span>overall match</span></div>
      <div className="match-scores">
        <div className="audio-row"><div className="audio-label"><span>Sound</span><strong>{pct(c.audio.score)}%</strong></div><Bars a={pct(c.audio.score)} /></div>
        <div className="audio-row"><div className="audio-label"><span>Lyrics</span><strong>{c.lyrics ? `${pct(c.lyrics.score)}%` : 'n/a'}</strong></div><Bars a={c.lyrics ? pct(c.lyrics.score) : 0} /></div>
        <small>{c.lyrics ? 'Sound counts 60%, lyrics 40%.' : 'Lyrics weren’t matched for one of the songs, so this is sound only.'}</small>
      </div>
      <div className="match-reasons">
        {c.reasons.map((reason, i) => <div className="insight-block" key={reason}><span className="insight-number">{String(i + 1).padStart(2, '0')}</span><div><p>{plainReason(reason)}</p></div></div>)}
      </div>
    </div>
    {shared.length > 0 && <div className="chip-row match-shared">{shared.map(item => <span className="chip" key={item}>{item}</span>)}</div>}
  </section>;
}

/** Helen's sound-profile bars, one pair per audio feature. */
function SoundPanel({ c, titles }: { c: SoundComparison; titles: [string, string] }) {
  return <section className="panel audio-panel">
    <Title overline="03 / SOUND PROFILE" title="How they sound" />
    <div className="bar-key"><span><i className="key-a" />{titles[0]}</span><span><i className="key-b" />{titles[1]}</span></div>
    {FEATURES.map(({ key, label }) => <div className="audio-row" key={key}>
      <div className="audio-label"><span>{label}</span><strong>{pct(c.a.audio[key])} <em>/</em> {pct(c.b.audio[key])}</strong></div>
      <Bars a={pct(c.a.audio[key])} b={pct(c.b.audio[key])} />
    </div>)}
    <p className="metadata-note">From Spotify’s audio analysis, 0–100.</p>
  </section>;
}

/** Tempo, key, metre, length and the lyric structure, side by side. */
function StructurePanel({ c, titles }: { c: SoundComparison; titles: [string, string] }) {
  const s = c.structure, la = c.a.lyrics?.structure, lb = c.b.lyrics?.structure;
  const notes = [s.key.relation !== 'unknown' ? `Keys: ${s.key.relation}.` : '', s.tempo.half_double_match ? 'Tempos line up in half or double time.' : ''].filter(Boolean).join(' ');
  return <section className="panel comparison-details structure-panel">
    <Title overline="04 / STRUCTURE" title="How they’re built" />
    <div className="comparison-row comparison-row-heading"><span /><strong>{titles[0]}</strong><strong>{titles[1]}</strong></div>
    <Row name="Tempo" a={`${s.tempo.a} BPM`} b={`${s.tempo.b} BPM`} />
    <Row name="Key" a={s.key.a} b={s.key.b} />
    <Row name="Time signature" a={s.time_signature.a ? `${s.time_signature.a}/4` : 'Unknown'} b={s.time_signature.b ? `${s.time_signature.b}/4` : 'Unknown'} />
    <Row name="Length" a={mmss(s.duration_sec.a)} b={mmss(s.duration_sec.b)} />
    {la && lb && <>
      <Row name="Verses / choruses / bridges" a={`${la.verses} / ${la.choruses} / ${la.bridges}`} b={`${lb.verses} / ${lb.choruses} / ${lb.bridges}`} />
      <Row name="Repeated lines" a={`${pct(la.repetition)}%`} b={`${pct(lb.repetition)}%`} />
      <Row name="Words" a={la.words} b={lb.words} />
      <Row name="Vocabulary variety" a={`${pct(la.lexical_diversity)}%`} b={`${pct(lb.lexical_diversity)}%`} />
    </>}
    {notes && <p className="metadata-note">{notes}</p>}
  </section>;
}

/** Mood, sentiment and themes of each song's lyrics, then how the words compare. */
function LyricsPanel({ c, titles }: { c: SoundComparison; titles: [string, string] }) {
  const side = (track: SoundComparison['a'], title: string) => <div key={title}>
    <strong>{title}</strong>
    {track.lyrics
      ? <div className="chip-row"><span className="chip">{capitalize(track.lyrics.top_emotion)}</span><span className="chip">{mood(track.lyrics.sentiment.compound)} ({track.lyrics.sentiment.compound.toFixed(2)})</span>{track.lyrics.top_themes.map(theme => <span className="chip" key={theme}>{capitalize(theme)}</span>)}</div>
      : <p className="loading-text">Lyrics not matched.</p>}
  </div>;
  return <section className="panel audio-panel">
    <Title overline="05 / LYRICS" title="What they’re about" />
    <div className="lyric-sides">{side(c.a, titles[0])}{side(c.b, titles[1])}</div>
    {c.lyrics && ([['Meaning', c.lyrics.semantic], ['Shared words', c.lyrics.vocabulary], ['Themes', c.lyrics.themes], ['Sentiment', c.lyrics.sentiment]] as const).map(([label, value]) =>
      <div className="audio-row" key={label}><div className="audio-label"><span>{label}</span><strong>{pct(value)}%</strong></div><Bars a={pct(value)} /></div>)}
    <p className="metadata-note">Computed from Genius lyrics; the lyrics themselves aren’t stored or shown.</p>
  </section>;
}

/** Songs nearest in sound to each one; picking one compares it with the first song. */
function SimilarPanel({ similar, titles, onPick, busyId, error }: { similar: { a: SimilarSong[]; b: SimilarSong[] }; titles: [string, string]; onPick: (song: SimilarSong) => void; busyId?: string; error?: string }) {
  const list = (title: string, songs: SimilarSong[]) => songs.length > 0 && <div key={title}>
    <span className="mini-caption sounds-like-caption">Sounds like {title}</span>
    {songs.slice(0, 4).map(song => <button className="mini-entity" key={song.id} disabled={busyId === song.id} onClick={() => onPick(song)}>
      <AlbumCover cover={{ id: song.id }} size="sm" /><span><strong>{song.title}</strong><small>{song.artists.join(', ')} · {pct(song.score)}% similar sound</small></span>
    </button>)}
  </div>;
  return <section className="panel quick-peek similar-panel">
    <span className="overline">06 / DISCOVER</span><h3>Songs that sound like these</h3>
    <p>Pick one to compare it with {titles[0]}.</p>
    {list(titles[0], similar.a)}{list(titles[1], similar.b)}
    {error && <p className="error-text" role="alert">{error}</p>}
  </section>;
}

/** The analysis sections, or one panel saying why they're missing. */
export function SongAnalysis({ sound, songs, onPickSimilar, busyId, pickError }: {
  sound: SoundState;
  songs: [RecordingDetails, RecordingDetails];
  onPickSimilar: (song: SimilarSong) => void;
  busyId?: string;
  pickError?: string;
}) {
  const titles: [string, string] = [songs[0].title, songs[1].title];
  if (sound.data?.status !== 'ok') {
    const why = soundUnavailableText(sound, titles);
    return <section className="panel match-panel" aria-busy={sound.loading}>
      <Title overline="02 / HOW ALIKE THEY ARE" title="Listen for the similarities." />
      {why ? <p className="analysis-missing">{why}</p> : <><p className="loading-text">Measuring their sound and lyrics…</p><div className="skeleton-lines"><span /><span /><span /></div></>}
      {sound.error && <button className="secondary-button" onClick={sound.retry}>Try again</button>}
    </section>;
  }
  const { comparison: c, similar } = sound.data;
  return <div className="song-analysis">
    <MatchPanel c={c} />
    <div className="content-columns"><SoundPanel c={c} titles={titles} /><StructurePanel c={c} titles={titles} /></div>
    <div className="content-columns"><LyricsPanel c={c} titles={titles} /><SimilarPanel similar={similar} titles={titles} onPick={onPickSimilar} busyId={busyId} error={pickError} /></div>
  </div>;
}
