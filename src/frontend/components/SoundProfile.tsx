// The sound-and-lyrics parts of a song comparison: rows for the side-by-side table, the
// "Musical similarity" block, Helen's sound-profile bars, and songs that sound alike. Data comes
// from /api/sound (Spotify audio features + lyric analysis, matched to these songs by name).
import type { ReactNode } from 'react';
import type { RecordingDetails } from '@/lib/types';
import type { AudioFeature, SimilarSong, SoundComparison, SoundResult } from '@/lib/sound';
import { capitalize } from '../model';
import { AlbumCover } from './Artwork';

export type SoundState = { data?: SoundResult; loading: boolean; error?: Error; retry: () => void };

const pct = (x: number) => Math.round(x * 100);
// The service says "valence"; the bars call it positivity, so the reasons do too.
const plainReason = (reason: string) => reason.replace(/\bvalence\b/g, 'positivity');
const mood = (sentiment: number) => (sentiment > 0.1 ? 'positive' : sentiment < -0.1 ? 'negative' : 'mixed');
const FEATURES: { key: AudioFeature; label: string }[] = [
  { key: 'energy', label: 'Energy' },
  { key: 'danceability', label: 'Danceability' },
  { key: 'valence', label: 'Positivity' },
  { key: 'acousticness', label: 'Acousticness' },
  { key: 'speechiness', label: 'Speechiness' },
  { key: 'instrumentalness', label: 'Instrumentalness' },
];

/** Extra rows for the side-by-side table: [label, left, right]. Empty until the data arrives. */
export function soundRows(sound: SoundState): [string, ReactNode, ReactNode][] {
  if (sound.data?.status !== 'ok') return [];
  const { a, b, structure: s } = sound.data.comparison;
  const lyric = (side: SoundComparison['a']) => side.lyrics
    ? <p>{capitalize(side.lyrics.top_emotion)} · {mood(side.lyrics.sentiment.compound)}<small>{side.lyrics.top_themes.map(capitalize).join(' · ') || 'No clear theme'}</small></p>
    : <p>—<small>Lyrics not matched</small></p>;
  return [
    ['Tempo', <p key="a">{s.tempo.a} BPM</p>, <p key="b">{s.tempo.b} BPM</p>],
    ['Musical key', <p key="a">{s.key.a}</p>, <p key="b">{s.key.b}</p>],
    ['Time signature', <p key="a">{s.time_signature.a ? `${s.time_signature.a}/4` : 'Unknown'}</p>, <p key="b">{s.time_signature.b ? `${s.time_signature.b}/4` : 'Unknown'}</p>],
    ['Lyrics: mood / themes', lyric(a), lyric(b)],
  ];
}

/** Why there's no sound data, in a sentence; null while loading or when there is data. */
export function soundUnavailableText(sound: SoundState, titles: [string, string]): string | null {
  const result = sound.data;
  if (sound.error) return `The sound and lyrics comparison failed: ${sound.error.message}`;
  if (!result) return null;
  if (result.status === 'not-found') {
    const names = result.missing.map(side => `“${titles[side === 'a' ? 0 : 1]}”`).join(' and ');
    return `${names} ${result.missing.length > 1 ? 'aren’t' : 'isn’t'} in the sound dataset (Spotify tracks up to 2022), so there’s no tempo, key or sound match.`;
  }
  if (result.status === 'same-track') return 'Both match the same track in the sound dataset, so there’s nothing to compare.';
  if (result.status === 'unavailable') return `The sound and lyrics analysis isn’t available right now.${'hint' in result && result.hint ? ` ${result.hint}` : ''}`;
  return null;
}

/** The "Musical similarity · calculated" block at the bottom of the side-by-side table. */
export function MusicalSimilarity({ sound, titles, sharedGenres }: { sound: SoundState; titles: [string, string]; sharedGenres: string[] }) {
  const result = sound.data?.status === 'ok' ? sound.data.comparison : null;
  const missing = soundUnavailableText(sound, titles);
  return <div className="artist-overlap musical-overlap"><strong>Musical similarity · calculated</strong>
    {result ? <>
      <div className="match-line"><span className="match-number">{pct(result.overall)}%</span><span>overall match<small>Sound {pct(result.audio.score)}% · Lyrics {result.lyrics ? `${pct(result.lyrics.score)}%` : 'not matched'}</small></span></div>
      <p>{result.reasons.map(reason => <span className="similarity-reason" key={reason}>{plainReason(reason)}</span>)}</p>
    </> : <p>{sound.loading ? 'Measuring their sound and lyrics…' : missing}</p>}
    <p>{sharedGenres.length ? `Shared genre tags: ${sharedGenres.slice(0, 5).join(' · ')}.` : 'No genre tags in common on MusicBrainz.'}</p>
    <small>Calculated from Spotify’s audio analysis, lyric sentiment and themes (the lyrics themselves aren’t stored), and MusicBrainz genre tags. Sounding alike doesn’t mean the songs share people.</small>
  </div>;
}

const Bars = ({ a, b }: { a: number; b?: number }) =>
  <div className="audio-bar"><span className="bar-a" style={{ width: `${a}%` }} />{b !== undefined && <span className="bar-b" style={{ width: `${b}%` }} />}</div>;

/** Helen's "Sound profile" panel: paired audio-feature bars, then how the lyrics compare. */
export function SoundProfile({ sound, songs }: { sound: SoundState; songs: [RecordingDetails, RecordingDetails] }) {
  if (sound.data?.status !== 'ok') return null;
  const { a, b, lyrics } = sound.data.comparison;
  return <section className="panel audio-panel">
    <div className="section-title"><div><span className="overline">SOUND PROFILE</span><h3>Beyond the credits</h3></div></div>
    <div className="bar-key"><span><i className="key-a" />{songs[0].title}</span><span><i className="key-b" />{songs[1].title}</span></div>
    {FEATURES.map(({ key, label }) => <div className="audio-row" key={key}>
      <div className="audio-label"><span>{label}</span><strong>{pct(a.audio[key])} <em>/</em> {pct(b.audio[key])}</strong></div>
      <Bars a={pct(a.audio[key])} b={pct(b.audio[key])} />
    </div>)}
    {lyrics && <>
      <div className="section-title lyric-heading"><div><span className="overline">LYRICS</span><h3>How the words compare</h3></div></div>
      {([['Meaning', lyrics.semantic], ['Shared words', lyrics.vocabulary], ['Themes', lyrics.themes], ['Sentiment', lyrics.sentiment]] as const).map(([label, value]) =>
        <div className="audio-row" key={label}><div className="audio-label"><span>{label}</span><strong>{pct(value)}%</strong></div><Bars a={pct(value)} /></div>)}
    </>}
    <p className="metadata-note">Audio features from Spotify’s analysis in the Spotify tracks dataset; lyric figures computed from Genius lyrics. Matched to these songs by title and artist: “{a.title}” by {a.artists.join(', ')} and “{b.title}” by {b.artists.join(', ')}.</p>
  </section>;
}

/** "Sounds like these": dataset songs nearest in sound; picking one compares it with the first song. */
export function SoundsLike({ sound, titles, onPick, busyId }: { sound: SoundState; titles: [string, string]; onPick: (song: SimilarSong) => void; busyId?: string }) {
  if (sound.data?.status !== 'ok') return null;
  const { a, b } = sound.data.similar;
  const list = (title: string, songs: SimilarSong[]) => songs.length ? <>
    <span className="mini-caption sounds-like-caption">Sounds like {title}</span>
    {songs.slice(0, 3).map(song => <button className="mini-entity" key={song.id} disabled={busyId === song.id} onClick={() => onPick(song)}>
      <AlbumCover cover={{ id: song.id }} size="sm" /><span><strong>{song.title}</strong><small>{song.artists.join(', ')} · {pct(song.score)}% similar sound</small></span>
    </button>)}
  </> : null;
  return <>{list(titles[0], a)}{list(titles[1], b)}</>;
}
