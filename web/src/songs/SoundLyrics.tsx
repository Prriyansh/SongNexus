/**
 * Sound and lyrics, from the song_compare service: how alike two songs are and why, their sound
 * profiles side by side, what their lyrics are about, and songs that sound like each. Every
 * number comes from the Spotify Tracks Dataset (2022) or an analysis of Genius lyrics, and says
 * so; songs outside that dataset are named rather than estimated.
 */
import type {CSSProperties, ReactNode} from 'react';
import {Link} from 'react-router';

import {idOf, type Schemas} from '../api/client';
import {useRecordingSound} from '../api/queries';
import {useListFormat} from '../components/AskAnswer';
import {Icon} from '../components/Icon';
import {MAGNITUDE_COLOR, SIDE_COLOR} from '../connect/mixtape';
import {useI18n} from '../i18n/i18n';
import type {MessageId} from '../i18n/messages';
import {Meter, percent} from './Descriptors';

type Result = Schemas['CompareSoundResponse'];
type Comparison = Schemas['SoundComparison'];
type Track = Schemas['SoundTrack'];
type Similar = Schemas['SimilarSong'];
type Side = 'a' | 'b';

const sideStyle = (side: Side, share: number) =>
  ({
    '--side': SIDE_COLOR[side],
    '--share': `${Math.max(2, Math.round(share * 100))}%`,
  }) as CSSProperties;

/** Sentiment as a word: the compound score runs from -1 to 1. */
function mood(sentiment: number): MessageId {
  if (sentiment > 0.1) return 'sound.sentiment.positive';
  if (sentiment < -0.1) return 'sound.sentiment.negative';
  return 'sound.sentiment.mixed';
}

function minutes(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function Card({
  id,
  title,
  wide,
  children,
  count,
}: {
  id: string;
  title: string;
  wide?: boolean;
  count?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`cx-card${wide ? ' cx-card--wide' : ''}`}
      aria-labelledby={id}
    >
      <div className="cx-card__head">
        <h2 id={id} className="cx-card__title">
          {title}
        </h2>
        {count && <span className="cx-card__count">{count}</span>}
      </div>
      {children}
    </section>
  );
}

function Legend({a, b}: {a: string; b: string}) {
  return (
    <p className="cx-legend" aria-hidden="true">
      <span style={sideStyle('a', 1)}>
        <bdi>{a}</bdi>
      </span>
      <span style={sideStyle('b', 1)}>
        <bdi>{b}</bdi>
      </span>
    </p>
  );
}

/** The headline: overall, sound and lyrics, and the reasons in plain words. */
function Alike({c}: {c: Comparison}) {
  const {t} = useI18n();
  const lyrics = c.lyricSimilarity;
  return (
    <Card
      id="sx-alike"
      title={t('sound.title')}
      count={percent(c.similarity)}
      wide
    >
      <p className="cx-card__note">{t('sound.howMade')}</p>
      <div
        className="cx-meters"
        style={{'--ring': MAGNITUDE_COLOR} as CSSProperties}
      >
        <Meter label={t('sound.part.sound')} value={c.soundSimilarity} />
        {/* Without lyrics for both, the service's reasons say it's sound alone. */}
        {lyrics && (
          <>
            <Meter label={t('sound.part.lyrics')} value={lyrics.score} />
            <Meter label={t('sound.part.meaning')} value={lyrics.meaning} />
            <Meter label={t('sound.part.words')} value={lyrics.sharedWords} />
            <Meter label={t('sound.part.themes')} value={lyrics.themes} />
            <Meter label={t('sound.part.sentiment')} value={lyrics.sentiment} />
          </>
        )}
      </div>
      {c.reasons.length > 0 && (
        <ul className="sx-reasons">
          {c.reasons.map(reason => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      {lyrics && lyrics.sharedThemes.length > 0 && (
        <ul className="sx-chips" aria-label={t('sound.sharedThemes')}>
          {lyrics.sharedThemes.map(theme => (
            <li key={theme} className="chip sx-chip">
              {theme}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Each audio feature as two bars, one per song. */
function Profile({c}: {c: Comparison}) {
  const {t} = useI18n();
  const valueOf = (track: Track, feature: string) =>
    track.features.find(f => f.feature === feature)?.value;
  return (
    <Card id="sx-profile" title={t('sound.profile')}>
      <ul className="cx-genres">
        {c.trackA.features.map(({feature}) => {
          const a = valueOf(c.trackA, feature) ?? 0;
          const b = valueOf(c.trackB, feature) ?? 0;
          const name = t(`sound.feature.${feature}` as MessageId);
          return (
            <li key={feature} className="cx-genre">
              <span className="cx-genre__name">{name}</span>
              <span className="cx-genre__bars">
                {(
                  [
                    ['a', a, c.trackA.title],
                    ['b', b, c.trackB.title],
                  ] as const
                ).map(([side, value, title]) => (
                  <span
                    key={side}
                    className="cx-bar"
                    style={sideStyle(side, value)}
                    role="img"
                    aria-label={t('sound.featureValue', {
                      feature: name,
                      title,
                      value: percent(value),
                    })}
                  />
                ))}
              </span>
            </li>
          );
        })}
      </ul>
      <Legend a={c.trackA.title} b={c.trackB.title} />
    </Card>
  );
}

/** Tempo, key, metre, length and the lyric structure, as a table. */
function Built({c}: {c: Comparison}) {
  const {t} = useI18n();
  const formatList = useListFormat();
  const {trackA: a, trackB: b} = c;
  const lyric = (
    track: Track,
    pick: (l: NonNullable<Track['lyrics']>) => string,
  ) => (track.lyrics ? pick(track.lyrics) : t('sound.noLyrics'));
  const rows: [string, string, string][] = [
    [
      t('sound.tempo'),
      t('sound.bpm', {bpm: Math.round(a.tempoBpm)}),
      t('sound.bpm', {bpm: Math.round(b.tempoBpm)}),
    ],
    [t('sound.key'), a.key, b.key],
    [
      t('sound.timeSignature'),
      a.timeSignature ? t('sound.beats', {beats: a.timeSignature}) : '—',
      b.timeSignature ? t('sound.beats', {beats: b.timeSignature}) : '—',
    ],
    [t('sound.length'), minutes(a.durationMs), minutes(b.durationMs)],
    [
      t('sound.mood'),
      lyric(a, l => `${l.topEmotion} · ${t(mood(l.sentiment))}`),
      lyric(b, l => `${l.topEmotion} · ${t(mood(l.sentiment))}`),
    ],
    [
      t('sound.themes'),
      lyric(a, l => formatList(l.topThemes) || '—'),
      lyric(b, l => formatList(l.topThemes) || '—'),
    ],
    [
      t('sound.sections'),
      lyric(a, l => t('sound.sectionCounts', l.structure)),
      lyric(b, l => t('sound.sectionCounts', l.structure)),
    ],
    [
      t('sound.repetition'),
      lyric(a, l => percent(l.structure.repetition)),
      lyric(b, l => percent(l.structure.repetition)),
    ],
  ];
  const notes = [
    c.structure.halfOrDoubleTime ? t('sound.halfDouble') : '',
    c.structure.keyRelation !== 'unknown'
      ? t('sound.keyRelation', {relation: c.structure.keyRelation})
      : '',
  ].filter(Boolean);
  return (
    <Card id="sx-built" title={t('sound.built')}>
      <div className="cx-table-wrap">
        <table className="cx-sxs">
          <thead>
            <tr>
              <th scope="col">
                <span className="visually-hidden">
                  {t('songCompare.quality')}
                </span>
              </th>
              <th scope="col" style={{'--side': SIDE_COLOR.a} as CSSProperties}>
                <bdi>{a.title}</bdi>
              </th>
              <th scope="col" style={{'--side': SIDE_COLOR.b} as CSSProperties}>
                <bdi>{b.title}</bdi>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, x, y]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{x}</td>
                <td>{y}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {notes.length > 0 && <p className="cx-card__note">{notes.join(' ')}</p>}
    </Card>
  );
}

/** Songs that sound like each; ones in our catalog open a comparison. */
function SoundsLike({
  result,
  current,
}: {
  result: Result;
  current: {a: string; b: string};
}) {
  const {t} = useI18n();
  const formatList = useListFormat();
  const c = result.comparison!;
  const lists = [
    ['a', c.trackA.title, result.similarA],
    ['b', c.trackB.title, result.similarB],
  ] as const;
  if (lists.every(([, , songs]) => songs.length === 0)) return null;
  const row = (side: Side, song: Similar) => {
    const label = (
      <>
        <span className="sx-similar__title">
          <bdi>{song.title}</bdi>
        </span>
        <span className="sx-similar__by">
          <bdi>{formatList(song.artists)}</bdi>
          {song.sharesArtist && ` · ${t('sound.sameArtist')}`}
        </span>
      </>
    );
    return (
      <li key={`${song.title}-${song.artists.join()}`} className="sx-similar">
        <span className="sx-similar__score">{percent(song.similarity)}</span>
        {song.recording ? (
          <Link
            className="sx-similar__body"
            to={`/compare/songs?a=${current[side]}&b=${idOf(song.recording)}`}
            aria-label={t('sound.compareWith', {title: song.title})}
          >
            {label}
            <Icon name="chevron" />
          </Link>
        ) : (
          <span className="sx-similar__body">{label}</span>
        )}
      </li>
    );
  };
  return (
    <Card id="sx-like" title={t('sound.alike')} wide>
      <div className="sx-similar-lists">
        {lists.map(([side, title, songs]) => (
          <div
            key={side}
            className="cx-apart__side"
            style={{'--side': SIDE_COLOR[side]} as CSSProperties}
          >
            <h3 className="cx-apart__title">{t('sound.alikeTo', {title})}</h3>
            {songs.length > 0 ? (
              <ol className="sx-similar-list">
                {songs.map(s => row(side, s))}
              </ol>
            ) : (
              <p className="cx-card__empty">{t('sound.noneAlike')}</p>
            )}
          </div>
        ))}
      </div>
      <p className="cx-card__note">{t('sound.alikeNote')}</p>
    </Card>
  );
}

/** Why there's no analysis, in a sentence. */
function Missing({
  result,
  names,
}: {
  result: Result;
  names: Record<string, string>;
}) {
  const {t} = useI18n();
  const formatList = useListFormat();
  let text: string;
  if (result.status === 'NOT_FOUND') {
    const missing = result.missing.map(name => names[name] ?? name);
    text = t('sound.notFound', {
      titles: formatList(missing),
      count: missing.length,
    });
  } else if (result.status === 'SAME_TRACK') {
    text = t('sound.sameTrack');
  } else {
    text = t('sound.unavailable');
  }
  return (
    <Card id="sx-alike" title={t('sound.title')} wide>
      <p className="cx-card__empty">{text}</p>
    </Card>
  );
}

/** The sound & lyrics cards for a song comparison, or a sentence on why there are none. */
export function SoundLyrics({
  a,
  b,
  names,
}: {
  a: string;
  b: string;
  /** Display names by resource name (`recordings/{id}`), for "not found" messages. */
  names: Record<string, string>;
}) {
  const {t} = useI18n();
  const result = useRecordingSound(a, b);
  if (result.isPending) {
    return (
      <section
        className="cx-card cx-card--wide"
        aria-labelledby="sx-alike"
        aria-busy="true"
      >
        <div className="cx-card__head">
          <h2 id="sx-alike" className="cx-card__title">
            {t('sound.title')}
          </h2>
        </div>
        <p className="cx-card__note" role="status">
          {t('sound.loading')}
        </p>
        <span className="skeleton cx-skel-card sx-skel" aria-hidden="true" />
      </section>
    );
  }
  // A failed request reads like an unavailable service: the rest of the comparison still works.
  const data: Result = result.data ?? {
    status: 'UNAVAILABLE',
    comparison: null,
    similarA: [],
    similarB: [],
    missing: [],
    sources: [],
  };
  if (data.status !== 'OK' || !data.comparison) {
    return <Missing result={data} names={names} />;
  }
  const c = data.comparison;
  return (
    <>
      <Alike c={c} />
      <Profile c={c} />
      <Built c={c} />
      <SoundsLike result={data} current={{a, b}} />
      <p className="cx-card__note sx-source">{t('sound.source')}</p>
    </>
  );
}
