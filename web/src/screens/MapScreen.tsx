/**
 * Similar music: the team app's Connection Web map modes, in one page (`/map`).
 *
 * - **Artist** (`?artist=`) and **Song** (`?song=`): the selection in the middle, and what
 *   listeners play with it placed by how similar it is. Zooming in near an artist loads more
 *   around it.
 * - **My playlist** (`?mode=playlist`): your playlist's artists and songs, and artists new to you
 *   that listeners connect to them.
 * - **With a friend** (`?mode=friend`, `?room=CODE`): two playlists on one map, joined with a
 *   six-character code: what only you play, only they play, what you share, what each of you
 *   should try, and what's new to both.
 *
 * Similarity comes from listening data (ListenBrainz), never credits; every card says why.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {Link, useNavigate, useSearchParams} from 'react-router';

import {ApiError, idOf} from '../api/client';
import {usePageTitle} from '../app/Shell';
import {Icon, type IconName} from '../components/Icon';
import {SearchBox} from '../components/SearchBox';
import {ToolHero} from '../connect/parts';
import {useI18n} from '../i18n/i18n';
import type {MessageId} from '../i18n/messages';
import {
  centeredOn,
  COMPARE_WORLD_WIDTH,
  layoutCompare,
  layoutSimilar,
  layoutTaste,
  linkedNames,
  placeDiscovered,
  similarLines,
  TASTE_WORLD_WIDTH,
  type Discovery,
  type MapNode,
  type Placed,
} from '../maps/layout';
import {
  MAX_FILE_BYTES,
  parsePlaylist,
  readStoredPlaylist,
  SAMPLE_FRIEND,
  SAMPLE_MINE,
  storePlaylist,
  toLines,
  type Track,
} from '../maps/playlist';
import {presetsFor} from '../maps/presets';
import {
  prefetchArtistMap,
  useArtistMap,
  useCompareMap,
  useCreateRoom,
  useJoinRoom,
  useRoom,
  useSongMap,
  useTasteMap,
  type SimilarMap,
  type TasteMap,
  type TasteRoom,
} from '../maps/queries';
import {reasonText} from '../maps/reasons';
import {EXPLORE_ZOOM, SimilarityMap} from '../maps/SimilarityMap';
import {readRoomRole, storeRoomRole} from '../maps/rooms';
import {useSavedSongs} from '../taste/setup';
import {usePicks} from '../taste/picks';

type Mode = 'artist' | 'song' | 'pair' | 'playlist' | 'friend';
const MODES: readonly {mode: Mode; icon: IconName}[] = [
  {mode: 'artist', icon: 'person'},
  {mode: 'song', icon: 'note'},
  {mode: 'pair', icon: 'compare'},
  {mode: 'playlist', icon: 'library'},
  {mode: 'friend', icon: 'people'},
];

function modeOf(params: URLSearchParams): Mode {
  if (params.get('song')) return 'song';
  if (params.get('room')) return 'friend';
  if (params.get('a') || params.get('b')) return 'pair';
  const mode = params.get('mode');
  return mode === 'song' ||
    mode === 'pair' ||
    mode === 'playlist' ||
    mode === 'friend'
    ? mode
    : 'artist';
}

/** Where a node leads: its page in our catalog, or where the source lists it. */
function NodeActions({
  node,
  onMap,
}: {
  node: Placed;
  onMap: (n: Placed) => void;
}) {
  const {t} = useI18n();
  const artist = node.artist ? idOf(node.artist) : null;
  const song = node.recording ? idOf(node.recording) : null;
  return (
    <>
      {(artist || song) && !node.isCenter && (
        <button
          type="button"
          className="btn btn--filled btn--compact"
          onClick={() => onMap(node)}
        >
          <Icon name="explore" />
          {t('map.action.mapFromHere')}
        </button>
      )}
      {artist && (
        <Link className="btn btn--tonal btn--compact" to={`/artist/${artist}`}>
          {t('map.action.artist')}
        </Link>
      )}
      {song && (
        <Link className="btn btn--tonal btn--compact" to={`/song/${song}`}>
          {t('map.action.song')}
        </Link>
      )}
      {!artist && !song && node.sourceUrl && (
        <a
          className="btn btn--text btn--compact"
          href={node.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          {t('map.action.source')}
          <Icon name="external" />
        </a>
      )}
    </>
  );
}

function useExplain(friend = '', hasFriend = false) {
  const i18n = useI18n();
  const {t, formatNumber} = i18n;
  return useCallback(
    (node: Placed, near: string[], showCloseness: boolean): ReactNode => (
      <>
        {node.isCenter ? (
          <p className="smap__note">
            {t(node.kind === 'SONG' ? 'map.center.song' : 'map.center.artist')}
          </p>
        ) : (
          showCloseness && (
            <div className="smap__meter" title={t('map.closeness.title')}>
              <span>
                <i style={{width: `${Math.round(node.similarity * 100)}%`}} />
              </span>
              {t('map.closeness', {
                value: formatNumber(node.similarity, {style: 'percent'}),
              })}
            </div>
          )
        )}
        {node.reasons.length > 0 && (
          <ul className="smap__reasons">
            {node.reasons.map(reason => (
              <li key={reason.kind + reason.artists.join()}>
                {reasonText(i18n, reason, {
                  name: node.displayName,
                  friend,
                  hasFriend,
                })}
                {reason.sourceUrl && (
                  <>
                    {' '}
                    <a href={reason.sourceUrl} target="_blank" rel="noreferrer">
                      {t('map.source')}
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {node.listeners !== null && (
          <p className="smap__note">
            {t('map.listeners', {count: node.listeners})}
          </p>
        )}
        {near.length > 0 && (
          <p className="smap__note">
            {t('map.near', {
              names: near.slice(0, 5).join(', '),
              more: Math.max(0, near.length - 5),
            })}
          </p>
        )}
      </>
    ),
    [i18n, t, formatNumber, friend, hasFriend],
  );
}

function Status({
  map,
  loading,
  error,
}: {
  map: {sources: SimilarMap['sources']} | undefined;
  loading: boolean;
  error: unknown;
}) {
  const {t} = useI18n();
  const problem = map?.sources.find(
    s => s.status === 'UNAVAILABLE' || s.status === 'PARTIAL',
  );
  if (loading)
    return (
      <p className="smap__status" role="status">
        {t('map.status.loading')}
      </p>
    );
  if (error)
    return (
      <p className="smap__status smap__status--error" role="alert">
        {t('map.status.error')}
      </p>
    );
  if (problem)
    return (
      <p className="smap__status" role="status">
        {t('map.status.partial')}
      </p>
    );
  return null;
}

/** The map around an artist or a song, with zoom-in discovery for artists. */
function SimilarView({kind, id}: {kind: 'artist' | 'song'; id: string}) {
  const {t} = useI18n();
  const navigate = useNavigate();
  const client = useQueryClient();
  const artistMap = useArtistMap(kind === 'artist' ? id : undefined);
  const songMap = useSongMap(kind === 'song' ? id : undefined);
  const query = kind === 'artist' ? artistMap : songMap;
  const map = query.data;
  const [found, setFound] = useState<{key: string; list: Discovery[]}>({
    key: '',
    list: [],
  });
  const discoveries = found.key === `${kind}:${id}` ? found.list : [];
  const asked = useRef(new Set<string>());
  const explain = useExplain();
  usePageTitle(
    map ? t('map.title.of', {name: map.center.displayName}) : t('map.title'),
  );

  const built = useMemo(() => {
    if (!map) return null;
    return {
      base: (w: number, h: number) =>
        layoutSimilar(map.center, map.nodes, w, h),
      lines: similarLines(map.center, map.nodes, map.links),
    };
  }, [map]);
  const sizeRef = useRef({w: 900, h: 560});
  const place = useCallback(
    (w: number, h: number) => {
      sizeRef.current = {w, h};
      if (!built) return [];
      return placeDiscovered(built.base(w, h), discoveries).placed;
    },
    [built, discoveries],
  );
  const lines = useMemo(() => {
    if (!built) return [];
    const {w, h} = sizeRef.current;
    return [
      ...built.lines,
      ...placeDiscovered(built.base(w, h), discoveries).lines,
    ];
  }, [built, discoveries]);
  const allNodes = useMemo(
    () =>
      map
        ? [map.center, ...map.nodes, ...discoveries.flatMap(d => d.nodes)]
        : [],
    [map, discoveries],
  );

  const explore = useCallback(
    (node: Placed, zoom: number) => {
      if (
        !node.artist ||
        node.isCenter ||
        asked.current.has(node.id) ||
        zoom < EXPLORE_ZOOM
      )
        return;
      asked.current.add(node.id);
      const key = `${kind}:${id}`;
      prefetchArtistMap(client, idOf(node.artist))
        .then(more =>
          setFound(prev => ({
            key,
            list: [
              ...(prev.key === key ? prev.list : []),
              {via: node, zoom, nodes: more.nodes},
            ],
          })),
        )
        .catch(() => asked.current.delete(node.id));
    },
    [client, kind, id],
  );

  const mapFrom = (node: Placed) => {
    if (node.recording) void navigate(`/map?song=${idOf(node.recording)}`);
    else if (node.artist) void navigate(`/map?artist=${idOf(node.artist)}`);
  };

  if (query.error instanceof ApiError && query.error.httpStatus === 404)
    return <p className="smap__empty">{t('map.notFound')}</p>;
  return (
    <>
      {map && map.nodes.length === 0 && (
        <p className="smap__empty">{t('map.empty')}</p>
      )}
      <SimilarityMap
        place={place}
        lines={lines}
        label={t('map.label')}
        explain={node =>
          explain(
            node,
            linkedNames(node.id, allNodes, lines, map?.center.id),
            true,
          )
        }
        actions={node => <NodeActions node={node} onMap={mapFrom} />}
        onExplore={kind === 'artist' ? explore : undefined}
        status={
          <Status map={map} loading={query.isLoading} error={query.error} />
        }
        legend={
          <p className="smap__legend">
            <Icon name="info" />
            {t('map.legend.similar')}
          </p>
        }
      />
    </>
  );
}

/** Two artists on one map (Helen's comparison web), with pickers for each side. */
function PairView({a, b}: {a: string | null; b: string | null}) {
  const {t} = useI18n();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = useCompareMap(a ?? undefined, b ?? undefined);
  const map = query.data;
  const explain = useExplain();
  const place = useCallback(
    (w: number, h: number) =>
      map ? layoutCompare(map.nodes, map.path, w, h) : [],
    [map],
  );
  const startAt = useCallback(
    (width: number) => centeredOn(width, COMPARE_WORLD_WIDTH),
    [],
  );
  const names = map ? new Map(map.nodes.map(n => [n.id, n.displayName])) : null;
  const set = (key: 'a' | 'b', id: string) => {
    const next = new URLSearchParams(params);
    next.delete('mode');
    next.set(key, id);
    setParams(next);
  };
  const mapFrom = (node: Placed) => {
    if (node.artist) void navigate(`/map?artist=${idOf(node.artist)}`);
  };
  return (
    <>
      <div className="smap-pair">
        {(['a', 'b'] as const).map(key => (
          <SearchBox
            key={key}
            label={t(key === 'a' ? 'map.pair.first' : 'map.pair.second')}
            placeholder={
              (key === 'a' ? a : b) &&
              names?.get(`artists/${key === 'a' ? a : b}`)
                ? names.get(`artists/${key === 'a' ? a : b}`)!
                : t(key === 'a' ? 'map.pair.first' : 'map.pair.second')
            }
            types={['ARTIST']}
            onPick={result => set(key, idOf(result.name))}
            clearOnPick
          />
        ))}
      </div>
      {map && (
        <p className="smap-bar">
          {map.path.length > 1
            ? t('map.pair.path', {
                names: map.path
                  .map(id => names?.get(id) ?? '')
                  .join(' \u2192 '),
              })
            : t('map.pair.noPath')}
        </p>
      )}
      {a && b && (
        <SimilarityMap
          place={place}
          lines={map?.links ?? []}
          label={t('map.label.pair')}
          startAt={startAt}
          explain={node =>
            explain(
              node,
              linkedNames(node.id, map?.nodes ?? [], map?.links ?? []),
              !node.isCenter && node.group !== 'SHARED',
            )
          }
          actions={node => <NodeActions node={node} onMap={mapFrom} />}
          status={
            <Status map={map} loading={query.isLoading} error={query.error} />
          }
          legend={
            <ul className="smap__key" aria-label={t('map.legend.label')}>
              <li data-group="mine">
                {t('map.pair.legend.a', {
                  name: names?.get(`artists/${a}`) ?? '',
                })}
              </li>
              <li data-group="shared">{t('map.pair.legend.both')}</li>
              <li data-group="theirs">
                {t('map.pair.legend.b', {
                  name: names?.get(`artists/${b}`) ?? '',
                })}
              </li>
            </ul>
          }
        />
      )}
    </>
  );
}

/** Grows with its content up to a sensible height, and shrinks again as lines go (Helen). */
function useAutoSize(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.style.height = '0px';
    const max = Math.max(160, Math.round(window.innerHeight * 0.45));
    field.style.height = `${Math.min(field.scrollHeight + 2, max)}px`;
  }, [value]);
  return ref;
}

/** Choose a playlist: a file, pasted lines, your saved songs (on click), or a preset. */
function PlaylistPicker({
  label,
  onPick,
  initial,
  presets = true,
}: {
  label: string;
  onPick: (tracks: Track[]) => void;
  initial?: Track[];
  presets?: boolean;
}) {
  const {t} = useI18n();
  const [text, setText] = useState(initial?.length ? toLines(initial) : '');
  const [problem, setProblem] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const area = useAutoSize(text);
  const saved = useSavedSongs();
  const {genres} = usePicks();
  const offered = useMemo(
    () => presetsFor(genres.map(g => g.displayName)),
    [genres],
  );

  const take = (name: string, content: string) => {
    const {tracks, skipped} = parsePlaylist(name, content);
    if (!tracks.length) {
      setProblem(t('map.playlist.noArtists'));
      return;
    }
    setProblem(skipped ? t('map.playlist.skipped', {count: skipped}) : null);
    onPick(tracks);
  };
  const load = async (picked?: File) => {
    if (!picked) return;
    if (picked.size > MAX_FILE_BYTES) setProblem(t('map.playlist.tooBig'));
    else if (!/\.(csv|json|txt)$/i.test(picked.name))
      setProblem(t('map.playlist.format'));
    else take(picked.name, await picked.text());
    if (file.current) file.current.value = '';
  };

  return (
    <div className="smap-picker">
      <p className="smap-picker__label">
        {label}{' '}
        {saved.length > 0 ? (
          <button
            type="button"
            className="smap-picker__autofill"
            onClick={() => {
              setText(toLines(saved));
              setProblem(null);
              area.current?.focus();
            }}
          >
            {t('map.playlist.autofill', {count: saved.length})}
          </button>
        ) : (
          t('map.playlist.format.hint')
        )}
      </p>
      <textarea
        ref={area}
        className="smap-picker__text"
        aria-label={t('map.playlist.paste')}
        placeholder={t('map.playlist.placeholder')}
        value={text}
        onChange={event => setText(event.target.value)}
      />
      <input
        ref={file}
        type="file"
        hidden
        accept=".csv,.json,.txt"
        aria-label={t('map.playlist.file')}
        onChange={event => void load(event.target.files?.[0])}
      />
      <div className="smap-picker__actions">
        <button
          type="button"
          className="btn btn--filled"
          disabled={!text.trim()}
          onClick={() => take('pasted.txt', text)}
        >
          {t('map.playlist.use')}
        </button>
        <button
          type="button"
          className="btn btn--tonal"
          onClick={() => file.current?.click()}
        >
          <Icon name="upload" />
          {t('map.playlist.chooseFile')}
        </button>
      </div>
      {presets && (
        <div className="smap-picker__presets">
          <span>{t('map.playlist.presets')}</span>
          <ul className="chips">
            {offered.map(preset => (
              <li key={preset.id}>
                <button
                  type="button"
                  className="chip"
                  onClick={() => onPick(preset.tracks)}
                >
                  {t(preset.label)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {problem && (
        <p className="smap-picker__problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

const LEGEND: Record<string, readonly MapNode['group'][]> = {
  solo: ['MINE', 'NEW'],
  friend: ['MINE', 'THEIRS', 'SHARED', 'FOR_ME', 'FOR_THEM', 'NEW'],
};

function TasteView({
  mine,
  friend,
  friendName,
  onChange,
  changeLabel,
}: {
  mine: Track[];
  friend: Track[] | null;
  friendName: string;
  onChange: () => void;
  changeLabel: MessageId;
}) {
  const {t} = useI18n();
  const navigate = useNavigate();
  const name = friendName || t('map.friend.default');
  const query = useTasteMap(mine, friend, name);
  const map: TasteMap | undefined = query.data;
  const hasFriend = friend !== null;
  const explain = useExplain(name, hasFriend);
  const place = useCallback(
    (w: number, h: number) =>
      map ? layoutTaste(map.nodes, w, h, hasFriend) : [],
    [map, hasFriend],
  );
  const startAt = useCallback(
    (width: number) => centeredOn(width, hasFriend ? TASTE_WORLD_WIDTH : 900),
    [hasFriend],
  );
  const mapFrom = (node: Placed) => {
    if (node.recording) void navigate(`/map?song=${idOf(node.recording)}`);
    else if (node.artist) void navigate(`/map?artist=${idOf(node.artist)}`);
  };
  const stats = map?.stats;
  return (
    <>
      <div className="smap-bar">
        {stats && (
          <p>
            {hasFriend
              ? t('map.taste.statsFriend', {
                  shared: stats.sharedArtists,
                  songs: stats.sharedSongs,
                  friend: name,
                })
              : t('map.taste.stats', {
                  artists: stats.mineArtists,
                  songs: stats.mineSongs,
                })}
          </p>
        )}
        <button
          type="button"
          className="btn btn--text btn--compact"
          onClick={onChange}
        >
          {t(changeLabel)}
        </button>
      </div>
      <SimilarityMap
        place={place}
        lines={map?.links ?? []}
        label={t('map.label.taste')}
        startAt={startAt}
        explain={node =>
          explain(
            node,
            linkedNames(node.id, map?.nodes ?? [], map?.links ?? []),
            false,
          )
        }
        actions={node => <NodeActions node={node} onMap={mapFrom} />}
        status={
          <Status map={map} loading={query.isLoading} error={query.error} />
        }
        legend={
          <ul className="smap__key" aria-label={t('map.legend.label')}>
            {LEGEND[hasFriend ? 'friend' : 'solo']!.map(group => (
              <li key={group} data-group={group.toLowerCase()}>
                {t(`map.group.${group}` as MessageId, {friend: name})}
              </li>
            ))}
          </ul>
        }
      />
    </>
  );
}

function PlaylistMode() {
  const {t} = useI18n();
  const [mine, setMine] = useState<Track[]>(() => readStoredPlaylist());
  const [editing, setEditing] = useState(mine.length === 0);
  const pick = (tracks: Track[]) => {
    storePlaylist(tracks);
    setMine(tracks);
    setEditing(false);
  };
  if (editing || !mine.length)
    return (
      <section className="card smap-panel">
        <h2>{t('map.playlist.title')}</h2>
        <PlaylistPicker
          label={t('map.playlist.label')}
          onPick={pick}
          initial={mine}
        />
        <button
          type="button"
          className="btn btn--text"
          onClick={() => pick(SAMPLE_MINE)}
        >
          {t('map.playlist.sample')}
        </button>
      </section>
    );
  return (
    <TasteView
      mine={mine}
      friend={null}
      friendName=""
      onChange={() => setEditing(true)}
      changeLabel="map.playlist.change"
    />
  );
}

/** Two playlists, one code: start a room, share the code, and both see the same map. */
function FriendMode({code}: {code: string | null}) {
  const {t} = useI18n();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [mine, setMine] = useState<Track[]>(() => readStoredPlaylist());
  const create = useCreateRoom();
  const join = useJoinRoom();
  const room = useRoom(code);
  const role = code ? readRoomRole(code) : null;
  const [copied, setCopied] = useState(false);

  const start = (tracks: Track[]) => {
    storePlaylist(tracks);
    setMine(tracks);
    create.mutate(
      {displayName: name.trim(), tracks},
      {
        onSuccess: (created: TasteRoom) => {
          storeRoomRole(created.code, 'host');
          void navigate(`/map?room=${created.code}`, {replace: true});
        },
      },
    );
  };
  const accept = (tracks: Track[]) => {
    if (!code) return;
    storePlaylist(tracks);
    join.mutate(
      {code, member: {displayName: name.trim(), tracks}},
      {onSuccess: () => storeRoomRole(code, 'guest')},
    );
  };
  const openCode = (event: FormEvent) => {
    event.preventDefault();
    const value = joinCode.replace(/[\s-]/g, '').toUpperCase();
    if (value) void navigate(`/map?room=${encodeURIComponent(value)}`);
  };
  const nameField = (
    <label className="search-pill smap-name">
      <Icon name="person" />
      <span className="visually-hidden">{t('map.friend.name')}</span>
      <input
        maxLength={30}
        autoComplete="given-name"
        placeholder={t('map.friend.name')}
        value={name}
        onChange={event => setName(event.target.value)}
      />
    </label>
  );

  if (!code)
    return (
      <div className="smap-panels">
        <section className="card smap-panel">
          <h2>{t('map.friend.start')}</h2>
          <p>{t('map.friend.startLead')}</p>
          {nameField}
          <PlaylistPicker
            label={t('map.playlist.label')}
            onPick={start}
            initial={mine}
          />
          <button
            type="button"
            className="btn btn--text"
            onClick={() => start(SAMPLE_MINE)}
          >
            {t('map.playlist.sample')}
          </button>
          {create.error && <p role="alert">{t('map.friend.failed')}</p>}
        </section>
        <section className="card smap-panel">
          <h2>{t('map.friend.join')}</h2>
          <p>{t('map.friend.joinLead')}</p>
          <form className="code-form" onSubmit={openCode}>
            <label className="search-pill">
              <Icon name="link" />
              <span className="visually-hidden">{t('map.friend.code')}</span>
              <input
                autoComplete="off"
                spellCheck={false}
                maxLength={8}
                placeholder={t('map.friend.codePlaceholder')}
                value={joinCode}
                onChange={event => setJoinCode(event.target.value)}
              />
            </label>
            <button
              type="submit"
              className="btn btn--tonal"
              disabled={!joinCode.trim()}
            >
              {t('map.friend.open')}
            </button>
          </form>
        </section>
      </div>
    );

  if (room.isLoading)
    return <p className="smap__status">{t('map.status.loading')}</p>;
  if (!room.data)
    return (
      <section className="card smap-panel" role="alert">
        <h2>{t('map.friend.missing')}</h2>
        <Link className="btn btn--tonal" to="/map?mode=friend">
          {t('map.friend.again')}
        </Link>
      </section>
    );

  const {host, guest} = room.data;
  const link = `${window.location.origin}/map?room=${room.data.code}`;
  const isGuest = role === 'guest';
  if (!guest && role === 'host')
    return (
      <section className="card smap-panel smap-room">
        <h2>{t('map.friend.share')}</h2>
        <p className="smap-room__code" aria-label={t('map.friend.code')}>
          {room.data.code}
        </p>
        <p>{t('map.friend.waiting')}</p>
        <button
          type="button"
          className="btn btn--filled"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(link)
              .then(() => setCopied(true));
          }}
        >
          <Icon name={copied ? 'check' : 'copy'} />
          {copied ? t('map.friend.copied') : t('map.friend.copy')}
        </button>
      </section>
    );
  if (!guest)
    return (
      <section className="card smap-panel">
        <h2>
          {t('map.friend.joining', {
            name: host.displayName || t('map.friend.default'),
          })}
        </h2>
        {nameField}
        <PlaylistPicker
          label={t('map.playlist.label')}
          onPick={accept}
          initial={mine}
        />
        <button
          type="button"
          className="btn btn--text"
          onClick={() => accept(SAMPLE_FRIEND)}
        >
          {t('map.playlist.sample')}
        </button>
        {join.error && <p role="alert">{t('map.friend.full')}</p>}
      </section>
    );
  const me = isGuest ? guest : host;
  const them = isGuest ? host : guest;
  return (
    <TasteView
      mine={me.tracks}
      friend={them.tracks}
      friendName={them.displayName}
      onChange={() => void navigate('/map?mode=friend')}
      changeLabel="map.friend.new"
    />
  );
}

function Picker({kind}: {kind: 'artist' | 'song'}) {
  const {t} = useI18n();
  const navigate = useNavigate();
  return (
    <div className="smap-search">
      <SearchBox
        label={t(kind === 'artist' ? 'map.pick.artist' : 'map.pick.song')}
        placeholder={t(kind === 'artist' ? 'map.pick.artist' : 'map.pick.song')}
        types={[kind === 'artist' ? 'ARTIST' : 'RECORDING']}
        onPick={result => void navigate(`/map?${kind}=${idOf(result.name)}`)}
        clearOnPick
      />
    </div>
  );
}

export default function MapScreen() {
  const {t} = useI18n();
  const [params, setParams] = useSearchParams();
  const mode = modeOf(params);
  const artist = params.get('artist');
  const song = params.get('song');
  const room = params.get('room');
  usePageTitle(
    mode === 'artist' || mode === 'song' ? undefined : t('map.title'),
  );
  useEffect(() => {
    // Old links to the team app's Connection Web map modes keep working.
    if (params.get('mode') === 'comparison') setParams({}, {replace: true});
  }, [params, setParams]);

  return (
    <main className="page smap-page">
      <ToolHero
        overline={t('map.overline')}
        icon="explore"
        title={t('map.heading')}
        lead={t('map.lead')}
      >
        <div className="segmented" role="tablist" aria-label={t('map.modes')}>
          {MODES.map(option => (
            <button
              key={option.mode}
              type="button"
              role="tab"
              className="segmented__option"
              aria-selected={option.mode === mode}
              onClick={() =>
                setParams(option.mode === 'artist' ? {} : {mode: option.mode})
              }
            >
              <Icon name={option.icon} />
              {t(`map.mode.${option.mode}`)}
            </button>
          ))}
        </div>
      </ToolHero>
      {(mode === 'artist' || mode === 'song') && <Picker kind={mode} />}
      {mode === 'artist' && artist && (
        <SimilarView key={`a:${artist}`} kind="artist" id={artist} />
      )}
      {mode === 'song' && song && (
        <SimilarView key={`s:${song}`} kind="song" id={song} />
      )}
      {mode === 'pair' && <PairView a={params.get('a')} b={params.get('b')} />}
      {mode === 'playlist' && <PlaylistMode />}
      {mode === 'friend' && <FriendMode key={room ?? ''} code={room} />}
    </main>
  );
}
