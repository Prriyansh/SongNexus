import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowUpRight, ChevronDown, Filter, GitCompareArrows, Link2, Music2, Users, X } from 'lucide-react';
import type { ArtistDetails, Collaborator, RecordingDetails, TrackRef } from '@/lib/types';
import { partitionGenres } from '@/lib/types';
import type { SimilarSong } from '@/lib/sound';
import { artistInsights, collaborators, detailsOf, moreCredits, soundComparison, topTrack } from '../api';
import { directConnection, graphStatus, mutualCollaborators, peopleOf, sharedArtists, similarity } from '../explore-text';
import { buildGraph, songArtistPair } from '../graph';
import type { GraphInput } from '../graph';
import { artistCover, artistSubtitle, capitalize, errorText, ROLE_LABELS, roleText, songArtists, yearOf } from '../model';
import type { MusicProfile } from '../profile';
import { findRecording } from '../resolve';
import { comparisonFor, ROLE_FILTERS } from '../routing';
import type { Comparison } from '../routing';
import { nameOf } from '../types';
import type { Details, EntityType, Selection } from '../types';
import { useAsync } from '../useAsync';
import { ArtistInsightsPanel } from './ArtistInsightsPanel';
import { AlbumCover, ArtistAvatar } from './Artwork';
import { ComparisonDetails } from './ComparisonDetails';
import { ConnectionGraph } from './ConnectionGraph';
import { LoadError } from './LoadError';
import { MiniArtist } from './MiniArtist';
import { SearchChooser } from './SearchChooser';
import { SongAnalysis } from './SongAnalysis';

type Props = {
  comparison: Comparison;
  onComparison: (c: Comparison) => void;
  onRole: (role: string) => void;
  onDetails: (s: Selection) => void;
  note: string;
  onDismissNote: () => void;
  profile: MusicProfile;
};

type Lookup = ReturnType<typeof useAsync<Details>>;

const rolesOf = (c: Collaborator) => roleText([...new Set([...c.roles.a, ...c.roles.b])]);

/** The Explore page: two artists or two songs side by side, and everything that connects them. */
export function Explore({ comparison, onComparison, onRole, onDetails, note, onDismissNote, profile }: Props) {
  const { kind, left, right } = comparison;
  const role = comparison.role;
  const da = useAsync<Details>(`${kind}:${left}`, () => detailsOf(kind, left));
  const db = useAsync<Details>(`${kind}:${right}`, () => detailsOf(kind, right));
  const a = da.data;
  const b = db.data;
  // Song pairs, once both have loaded; they also get sound and lyrics (tempo, key, mood, a match
  // score and similar-sounding songs).
  const songs = kind === 'song' && a && b ? ([a, b] as [RecordingDetails, RecordingDetails]) : null;

  // Artist pairs scan both artists' albums; song pairs scan the two songs' lead artists (when different).
  const pair = kind === 'artist' ? [left, right] : songs ? (songArtistPair(...songs)?.map((x) => x.id) ?? null) : null;
  const collab = useAsync(pair ? `collab:${pair[0]}:${pair[1]}` : null, () => collaborators(pair![0], pair![1]));
  // Artist pairs also get other sources: credits from Genius and Discogs, then facts about each artist.
  const more = useAsync(kind === 'artist' ? `credits:${left}:${right}` : null, () => moreCredits(left, right));
  const insights = useAsync(kind === 'artist' ? `insights:${left}:${right}` : null, () => artistInsights(left, right));
  const sound = useAsync(songs ? `sound:${songs[0].id}:${songs[1].id}` : null, () => soundComparison(...songs!));

  const collabData = collab.data;
  const input = useMemo(() => (a && b ? ({ kind, a, b, collab: collabData, role } as GraphInput) : null), [kind, a, b, collabData, role]);
  const base = useMemo(() => (input ? buildGraph(input, [], false) : null), [input]);
  const collabPending = !!pair && collab.loading;
  const sharedGenres = a && b ? partitionGenres(a.genres, b.genres).shared.map(capitalize) : [];
  const mutual = mutualCollaborators(collabData, role);
  const pathText = base?.path.length ? base.path.map((id) => base.nodes.find((n) => n.id === id)?.label).join(' → ') : '';
  const top = useTopSongs(a, b, onComparison);
  const pick = useSimilarPick(left, onComparison);

  return (
    <div className="explore-page">
      <div className="page-heading">
        <div>
          <h1>Find the connection.</h1>
          <p>Compare two tracks or artists, follow their shared connections, and discover the people behind the sound.</p>
        </div>
        <Segment value={kind} onChange={(next) => onComparison(comparisonFor(next))} />
      </div>
      {note && <SharedNote note={note} onDismiss={onDismissNote} />}

      <section className="panel selection-panel">
        <div className="selection-heading">
          <h2>Choose {kind === 'song' ? 'two songs' : 'two artists'} to compare</h2>
          {kind === 'artist' ? (
            <button className="secondary-button" disabled={!a || !b || top.busy} onClick={() => void top.compare()}>
              <Music2 size={15} /> {top.busy ? 'Finding top songs…' : 'Compare their top songs'}
            </button>
          ) : (
            <span className="mini-caption">Search the song library for the full sound and lyrics analysis</span>
          )}
        </div>
        {top.error && (
          <p className="error-text" role="alert">
            {top.error}
          </p>
        )}
        <div className="select-grid">
          <SearchChooser
            type={kind}
            value={left}
            display={a}
            other={right}
            label={kind === 'song' ? 'SONG ONE' : 'ARTIST ONE'}
            onChange={(v) => onComparison({ ...comparison, left: v })}
            profile={profile}
          />
          <span className="vs">VS</span>
          <SearchChooser
            type={kind}
            value={right}
            display={b}
            other={left}
            label={kind === 'song' ? 'SONG TWO' : 'ARTIST TWO'}
            onChange={(v) => onComparison({ ...comparison, right: v })}
            profile={profile}
          />
        </div>
        <div className="selected-cards">
          <SelectedCard kind={kind} state={da} onDetails={onDetails} />
          <SelectedCard kind={kind} state={db} onDetails={onDetails} />
        </div>
      </section>

      {/* Songs: the sound and lyrics analysis is the comparison; release details and credits follow. */}
      {kind === 'song' &&
        (songs ? (
          <SongAnalysis sound={sound} songs={songs} onPickSimilar={(song) => void pick.compare(song)} busyId={pick.id} pickError={pick.error} />
        ) : (
          <section className="panel match-panel" aria-busy="true">
            <p className="loading-text">Loading the songs…</p>
            <div className="skeleton-lines">
              <span />
              <span />
            </div>
          </section>
        ))}
      {kind === 'artist' && <ArtistInsightsPanel state={insights} names={[a ? nameOf(a) : 'Artist one', b ? nameOf(b) : 'Artist two']} />}
      <ComparisonDetails
        kind={kind}
        a={a}
        b={b}
        collab={pair ? collab : null}
        more={kind === 'artist' ? more : undefined}
        role={role}
        onSelect={onDetails}
        onCompareSongs={(ta: TrackRef, tb: TrackRef) => onComparison(comparisonFor('song', ta.id, tb.id))}
      />

      <div className="content-columns">
        <section className="panel graph-panel">
          <div className="graph-heading">
            <div>
              <h2>How they’re connected</h2>
              <p>
                Solid lines are credits on MusicBrainz; dotted is a songwriting credit alone; dashed is shared genre tags. Select a person
                to see the songs that connect them.
              </p>
            </div>
            <RoleSelect value={role} onChange={onRole} />
          </div>
          {input ? (
            <ConnectionGraph key={`${kind}:${left}:${right}:${role}`} input={input} status={graphStatus(collabPending, collab.error)} onSelect={onDetails} />
          ) : da.error || db.error ? (
            <LoadError
              error={(da.error || db.error)!}
              retry={() => {
                da.retry();
                db.retry();
              }}
            />
          ) : (
            <div className="graph-canvas graph-loading" aria-busy="true">
              <div className="graph-grid" />
              <p className="loading-text">Loading from MusicBrainz…</p>
            </div>
          )}
        </section>

        <aside className="right-column">
          <section className="panel insights">
            <div className="section-title">
              <h3>What connects them?</h3>
              <GitCompareArrows size={20} />
            </div>
            {kind === 'artist' ? (
              <>
                <Insight title="Direct connection">{directConnection(collabData, collabPending, a, b)}</Insight>
                <Insight title="Mutual collaborators">
                  {collabPending
                    ? 'Reading album credits…'
                    : mutual.length
                      ? mutual.slice(0, 4).map((c) => (
                          <button className="inline-link" key={c.id} onClick={() => onDetails({ type: 'artist', id: c.id })}>
                            {c.name} · {rolesOf(c)} ↗
                          </button>
                        ))
                      : 'No one is credited on both artists’ scanned albums.'}
                </Insight>
                <Insight title="Genre overlap">
                  {sharedGenres.length
                    ? sharedGenres.slice(0, 5).join(', ')
                    : 'Their MusicBrainz genre tags don’t overlap. Follow the web to see where they meet.'}
                </Insight>
              </>
            ) : (
              <>
                <Insight title="Shared credited artists">{sharedArtists(songs?.[0], songs?.[1])}</Insight>
                <Insight title="Musical similarity · calculated">
                  {similarity(sound.data?.status === 'ok' ? sound.data.comparison : null, sound.loading, sharedGenres)}
                </Insight>
                <Insight title="Factual connection path">
                  {pathText || (collabPending ? 'Reading album credits…' : 'No documented path between these two songs in the albums we scanned.')}
                </Insight>
              </>
            )}
          </section>
          <section className="panel quick-peek">
            <h3>The people behind the music</h3>
            <p>Click an artist in the web or choose one below to see their albums, links, and genres.</p>
            {peopleOf(kind, a, b).map((p) => (
              <MiniArtist key={p.id} artist={p} onClick={() => onDetails({ type: 'artist', id: p.id })} />
            ))}
            {mutual.slice(0, 3).map((c) => (
              <MiniArtist
                key={c.id}
                artist={c}
                picture={false}
                subtitle={`Worked with both · ${rolesOf(c)}`}
                onClick={() => onDetails({ type: 'artist', id: c.id })}
              />
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}

/** "Compare their top songs": finds each artist's top song on MusicBrainz and opens the pair. */
function useTopSongs(a: Details | undefined, b: Details | undefined, onComparison: (c: Comparison) => void) {
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const compare = async () => {
    // The button is only on two-artist comparisons, and off until both have loaded.
    const [first, second] = [a!, b!];
    setState({ busy: true });
    try {
      const [ta, tb] = await Promise.all([topTrack(first.id, nameOf(first)), topTrack(second.id, nameOf(second))]);
      if (!ta || !tb) {
        setState({ busy: false, error: `Couldn’t match a top song for ${!ta ? nameOf(first) : nameOf(second)} on MusicBrainz.` });
        return;
      }
      setState({ busy: false });
      onComparison(comparisonFor('song', ta.id, tb.id));
    } catch (e) {
      setState({ busy: false, error: errorText(e, 'Could not find top songs.') });
    }
  };
  return { ...state, compare };
}

/** A similar-sounding song comes from the Spotify dataset; finds it on MusicBrainz to compare it with the first song. */
function useSimilarPick(left: string, onComparison: (c: Comparison) => void) {
  const [state, setState] = useState<{ id?: string; error?: string }>({});
  const compare = async (song: SimilarSong) => {
    setState({ id: song.id });
    try {
      const found = await findRecording(song.title, song.artists[0] ?? '');
      if (!found) {
        setState({ error: `Couldn’t find “${song.title}” on MusicBrainz.` });
        return;
      }
      setState({});
      onComparison(comparisonFor('song', left, found.id));
    } catch (e) {
      setState({ error: errorText(e, 'Search failed.') });
    }
  };
  return { ...state, compare };
}

function Insight({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="insight-block">
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}

function SharedNote({ note, onDismiss }: { note: string; onDismiss: () => void }) {
  return (
    <div className="shared-note">
      <Link2 size={17} />
      <div>
        <strong>Shared with a note</strong>
        <p>{note}</p>
      </div>
      <button className="icon-button" onClick={onDismiss} aria-label="Dismiss shared note">
        <X size={17} />
      </button>
    </div>
  );
}

function Segment({ value, onChange }: { value: EntityType; onChange: (v: EntityType) => void }) {
  const option = (kind: EntityType, icon: ReactNode, text: string) => (
    <button aria-pressed={value === kind} className={value === kind ? 'selected' : ''} onClick={() => onChange(kind)}>
      {icon} {text}
    </button>
  );
  return (
    <div className="compare-switch" role="group" aria-label="Comparison type">
      {option('song', <Music2 size={17} />, '2 Songs')}
      {option('artist', <Users size={17} />, '2 Artists')}
    </div>
  );
}

// Helen's genre filter, repurposed: collaborators carry credited roles, not genres.
function RoleSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="filter-field">
      <Filter size={16} />
      <select aria-label="Filter collaborators by role" value={value} onChange={(e) => onChange(e.target.value)}>
        {ROLE_FILTERS.map((role) => (
          <option key={role} value={role}>
            {role === 'all' ? 'All roles' : ROLE_LABELS[role]}
          </option>
        ))}
      </select>
      <ChevronDown size={15} />
    </label>
  );
}

function SelectedCard({ kind, state, onDetails }: { kind: EntityType; state: Lookup; onDetails: (s: Selection) => void }) {
  if (state.error) {
    return (
      <div className="selected-card">
        <span className="selected-card-info">
          <LoadError error={state.error} retry={state.retry} />
        </span>
      </div>
    );
  }
  const d = state.data;
  if (!d) {
    return (
      <div className="selected-card is-loading" aria-busy="true">
        <span className="skeleton-art" />
        <span className="selected-card-info">
          <span className="skeleton-lines">
            <span />
            <span />
          </span>
        </span>
      </div>
    );
  }
  return (
    <button className="selected-card" onClick={() => onDetails({ type: kind, id: d.id })}>
      {'title' in d ? (
        <AlbumCover cover={{ id: d.id, artUrl: d.representative?.artUrl }} size="lg" />
      ) : (
        <ArtistAvatar artist={{ ...d, artUrl: artistCover(d) }} size="lg" />
      )}
      <span className="selected-card-info">
        <strong>{nameOf(d)}</strong>
        <small>{'title' in d ? songSubtitle(d) : artistLine(d)}</small>
        <span className="selected-details">
          View {kind === 'artist' ? 'details & albums' : 'song details'} <ArrowUpRight size={14} />
        </span>
      </span>
    </button>
  );
}

const songSubtitle = (song: RecordingDetails) =>
  [songArtists(song), song.representative?.title, yearOf(song.firstReleaseDate)].filter(Boolean).join(' · ');

const artistLine = (artist: ArtistDetails) =>
  [artist.genres.slice(0, 3).map((g) => capitalize(g.name)).join(' · '), artist.area || artist.country].filter(Boolean).join(' · ') ||
  artistSubtitle(artist);
