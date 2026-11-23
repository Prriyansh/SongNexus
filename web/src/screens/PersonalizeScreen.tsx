/**
 * Personalize: pick genres you like and artists you love, so For you on Home starts from them.
 * Picks are kept in this browser; when signed in, the artists are also followed, which is what
 * the server's recommendations learn from. Every choice can be changed here later.
 */
import {useMemo, useState, type CSSProperties} from 'react';
import {Link, useNavigate} from 'react-router';

import type {Schemas} from '../api/client';
import {useFollowArtists, useGenreSuggestions} from '../api/foryou';
import {useGenres} from '../api/queries';
import {usePageTitle} from '../app/Shell';
import {useAuth} from '../auth/AuthProvider';
import {Icon} from '../components/Icon';
import {SearchBox} from '../components/SearchBox';
import {Cover} from '../components/Shelf';
import {ToolHero} from '../connect/parts';
import {useI18n} from '../i18n/i18n';
import {
  MAX_ARTISTS,
  MAX_GENRES,
  savePicks,
  usePicks,
  type PickedArtist,
  type PickedGenre,
} from '../taste/picks';

const GENRES_SHOWN = 18;
const SUGGESTIONS_SHOWN = 18;

/** Top-level genres, biggest first (the server sends them by size). */
function topGenres(genres: Schemas['Genre'][]): PickedGenre[] {
  return genres
    .filter(g => g.parents.length === 0)
    .map(g => ({name: g.name, displayName: g.displayName}));
}

function toggle<T extends {name: string}>(
  list: T[],
  item: T,
  max: number,
): T[] {
  if (list.some(x => x.name === item.name))
    return list.filter(x => x.name !== item.name);
  return list.length >= max ? list : [...list, item];
}

function GenrePicker({
  chosen,
  onChange,
}: {
  chosen: PickedGenre[];
  onChange: (genres: PickedGenre[]) => void;
}) {
  const {t} = useI18n();
  const genres = useGenres();
  const [all, setAll] = useState(false);
  const options = useMemo(() => topGenres(genres.data ?? []), [genres.data]);
  const shown = all ? options : options.slice(0, GENRES_SHOWN);
  return (
    <section className="cx-card cx-card--wide" aria-labelledby="pz-genres">
      <div className="cx-card__head">
        <h2 id="pz-genres" className="cx-card__title">
          {t('personalize.genres.title')}
        </h2>
        <span className="cx-card__count">
          {t('personalize.count', {count: chosen.length, max: MAX_GENRES})}
        </span>
      </div>
      <p className="cx-card__note">{t('personalize.genres.lead')}</p>
      {genres.isPending && (
        <span
          className="skeleton pz-skel"
          role="status"
          aria-label={t('state.loading')}
        />
      )}
      <ul className="chips pz-chips">
        {shown.map(genre => {
          const on = chosen.some(g => g.name === genre.name);
          return (
            <li key={genre.name}>
              <button
                type="button"
                className="chip"
                aria-pressed={on}
                disabled={!on && chosen.length >= MAX_GENRES}
                onClick={() => onChange(toggle(chosen, genre, MAX_GENRES))}
              >
                {on && <Icon name="check" />}
                {genre.displayName}
              </button>
            </li>
          );
        })}
      </ul>
      {options.length > GENRES_SHOWN && (
        <button
          type="button"
          className="btn btn--text btn--compact cx-card__more"
          aria-expanded={all}
          onClick={() => setAll(value => !value)}
        >
          {all
            ? t('personalize.fewer')
            : t('personalize.allGenres', {count: options.length})}
        </button>
      )}
    </section>
  );
}

function ArtistToggle({
  artist,
  on,
  disabled,
  onClick,
  style,
}: {
  artist: PickedArtist;
  on: boolean;
  disabled: boolean;
  onClick: () => void;
  style?: CSSProperties;
}) {
  return (
    <li style={style}>
      <button
        type="button"
        className="pz-artist"
        aria-pressed={on}
        disabled={disabled}
        onClick={onClick}
      >
        <span className="pz-artist__art">
          <Cover name={artist.displayName} image={artist.imageUrl} round />
          {on && (
            <span className="pz-artist__check" aria-hidden="true">
              <Icon name="check" size={18} />
            </span>
          )}
        </span>
        <span className="pz-artist__name">
          <bdi>{artist.displayName}</bdi>
        </span>
      </button>
    </li>
  );
}

function ArtistPicker({
  genres,
  chosen,
  onChange,
}: {
  genres: PickedGenre[];
  chosen: PickedArtist[];
  onChange: (artists: PickedArtist[]) => void;
}) {
  const {t} = useI18n();
  const results = useGenreSuggestions(genres.map(g => g.name));
  const loading = results.some(r => r.isPending);
  // Round-robin across the chosen genres so each one is represented, without repeats.
  const suggestions = useMemo(() => {
    const lists = results.map(r =>
      (r.data?.artists ?? []).map(a => ({
        name: a.artist.name,
        displayName: a.artist.displayName,
        imageUrl: a.artist.imageUrl ?? null,
      })),
    );
    const out = new Map<string, PickedArtist>();
    for (
      let i = 0;
      out.size < SUGGESTIONS_SHOWN && lists.some(l => i < l.length);
      i++
    ) {
      for (const list of lists) {
        const artist = list[i];
        if (artist && !out.has(artist.name) && out.size < SUGGESTIONS_SHOWN)
          out.set(artist.name, artist);
      }
    }
    return [...out.values()];
  }, [results]);
  const full = chosen.length >= MAX_ARTISTS;
  const picked = (name: string) => chosen.some(a => a.name === name);
  const extra = chosen.filter(a => !suggestions.some(s => s.name === a.name));
  return (
    <section className="cx-card cx-card--wide" aria-labelledby="pz-artists">
      <div className="cx-card__head">
        <h2 id="pz-artists" className="cx-card__title">
          {t('personalize.artists.title')}
        </h2>
        <span className="cx-card__count">
          {t('personalize.count', {count: chosen.length, max: MAX_ARTISTS})}
        </span>
      </div>
      <p className="cx-card__note">{t('personalize.artists.lead')}</p>
      <div className="pz-search">
        <SearchBox
          label={t('personalize.artists.search')}
          placeholder={t('personalize.artists.placeholder')}
          types={['ARTIST']}
          onPick={result =>
            onChange(
              toggle(
                chosen.filter(a => a.name !== result.name),
                {
                  name: result.name,
                  displayName: result.displayName,
                  imageUrl: result.imageUrl ?? null,
                },
                MAX_ARTISTS,
              ),
            )
          }
        />
      </div>
      {extra.length > 0 && (
        <ul className="pz-artists" aria-label={t('personalize.artists.yours')}>
          {extra.map(artist => (
            <ArtistToggle
              key={artist.name}
              artist={artist}
              on
              disabled={false}
              onClick={() =>
                onChange(chosen.filter(a => a.name !== artist.name))
              }
            />
          ))}
        </ul>
      )}
      {genres.length === 0 ? (
        <p className="cx-card__empty">{t('personalize.artists.pickGenres')}</p>
      ) : loading && suggestions.length === 0 ? (
        <span
          className="skeleton pz-skel pz-skel--tall"
          role="status"
          aria-label={t('state.loading')}
        />
      ) : (
        <>
          <h3 className="pz-subtitle">{t('personalize.artists.suggested')}</h3>
          <ul className="pz-artists">
            {suggestions.map((artist, index) => (
              <ArtistToggle
                key={artist.name}
                artist={artist}
                on={picked(artist.name)}
                disabled={full && !picked(artist.name)}
                onClick={() => onChange(toggle(chosen, artist, MAX_ARTISTS))}
                style={{'--i': index} as CSSProperties}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export default function PersonalizeScreen() {
  const {t} = useI18n();
  const navigate = useNavigate();
  const auth = useAuth();
  const stored = usePicks();
  const follow = useFollowArtists();
  const [genres, setGenres] = useState<PickedGenre[]>(stored.genres);
  const [artists, setArtists] = useState<PickedArtist[]>(stored.artists);
  const [problem, setProblem] = useState(false);
  usePageTitle(t('personalize.title'));
  const signedIn = auth.status === 'signedIn';

  async function save() {
    savePicks({genres, artists, done: true});
    if (signedIn && artists.length > 0) {
      try {
        await follow.mutateAsync(artists.map(a => a.name));
      } catch {
        setProblem(true); // kept in this browser; following can be retried
        return;
      }
    }
    void navigate('/#for-you');
  }

  function skip() {
    savePicks({...stored, done: true});
    void navigate('/');
  }

  return (
    <div className="cx pz">
      <ToolHero
        overline={t('personalize.overline')}
        icon="tune"
        title={t('personalize.title')}
        lead={t('personalize.lead')}
      />
      <div className="cx-board">
        <GenrePicker chosen={genres} onChange={setGenres} />
        <ArtistPicker genres={genres} chosen={artists} onChange={setArtists} />
      </div>
      <div className="pz-bar">
        <p className="pz-bar__note">
          <Icon name="lock" size={18} />
          {signedIn
            ? t('personalize.privacy.signedIn')
            : t('personalize.privacy.signedOut')}{' '}
          <Link to="/privacy">{t('personalize.privacy.link')}</Link>
        </p>
        {problem && (
          <p className="pz-bar__problem" role="alert">
            {t('personalize.followFailed')}
          </p>
        )}
        <div className="pz-bar__actions">
          <button type="button" className="btn btn--text" onClick={skip}>
            {t('personalize.skip')}
          </button>
          <button
            type="button"
            className="btn btn--filled"
            disabled={
              follow.isPending || (genres.length === 0 && artists.length === 0)
            }
            onClick={() => void save()}
          >
            <Icon name="check" />
            {follow.isPending ? t('personalize.saving') : t('personalize.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
