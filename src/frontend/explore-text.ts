// The sentences Explore's "What connects them?" panel and graph status are made of, kept apart from
// the page so each wording is tested on its own.
import type { CollaboratorComparison, RecordingDetails } from '@/lib/types';
import type { SoundComparison } from '@/lib/sound';
import { nameOf } from './types';
import type { Details, EntityType } from './types';

type Credits = CollaboratorComparison['direct'];

/** A sentence per direction in which one artist is credited on the other's album, joined. */
function creditSentences(credits: Credits, a: Details | undefined, b: Details | undefined, verb: string): string[] {
  return [
    credits.bOnA.length ? `${nameOf(b)} ${verb} ${nameOf(a)}’s “${credits.bOnA[0].title}”.` : '',
    credits.aOnB.length ? `${nameOf(a)} ${verb} ${nameOf(b)}’s “${credits.aOnB[0].title}”.` : '',
  ].filter(Boolean);
}

/** Whether either artist is credited on the other's albums: as a performer first, then as a writer. */
export function directConnection(
  collab: CollaboratorComparison | undefined,
  pending: boolean,
  a?: Details,
  b?: Details,
): string {
  if (pending) return 'Checking album credits…';
  if (collab && (collab.direct.bOnA.length || collab.direct.aOnB.length)) {
    return creditSentences(collab.direct, a, b, 'is credited on').join(' ');
  }
  if (collab?.writing && (collab.writing.bOnA.length || collab.writing.aOnB.length)) {
    return [
      ...creditSentences(collab.writing, a, b, 'has a songwriting credit on'),
      'Writing credits can come from a sample or interpolation, so this doesn’t by itself mean they worked together.',
    ].join(' ');
  }
  return 'Neither is credited on the other’s scanned albums.';
}

/** People credited on both artists' albums, keeping those with the chosen role (or all). */
export function mutualCollaborators(collab: CollaboratorComparison | undefined, role: string) {
  return (collab?.mutual ?? []).filter(
    (c) => role === 'all' || c.roles.a.includes(role) || c.roles.b.includes(role),
  );
}

/** The two artists of a comparison, or the lead artist of each song (once if they're the same). */
export function peopleOf(kind: EntityType, a?: Details, b?: Details): { id: string; name: string }[] {
  if (kind === 'artist') return [a, b].filter((x) => x !== undefined).map((x) => ({ id: x.id, name: nameOf(x) }));
  const leads = [a, b].flatMap((song) => {
    const lead = (song as RecordingDetails | undefined)?.artists.find((x) => x.id);
    return lead ? [{ id: lead.id!, name: lead.name }] : [];
  });
  return leads.filter((v, i) => leads.findIndex((x) => x.id === v.id) === i);
}

/** Two songs' credited artists in common, as a sentence. */
export function sharedArtists(a?: RecordingDetails, b?: RecordingDetails): string {
  if (!a || !b) return 'Loading…';
  const shared = a.artists.filter((x) => x.id && b.artists.some((y) => y.id === x.id)).map((x) => x.name);
  return shared.join(', ') || 'Different artists. The web shows who worked with both.';
}

const percent = (score: number) => `${Math.round(score * 100)}%`;

/** How alike two songs are: the calculated match when there is one, else their shared genres. */
export function similarity(sound: SoundComparison | null, loading: boolean, sharedGenres: string[]): string {
  if (sound) {
    const lyrics = sound.lyrics ? percent(sound.lyrics.score) : 'not matched';
    const genres = sharedGenres.length ? ` Shared genres: ${sharedGenres.slice(0, 3).join(', ')}.` : '';
    return `${percent(sound.overall)} overall match: sound ${percent(sound.audio.score)}, lyrics ${lyrics}.${genres}`;
  }
  if (loading) return 'Measuring their sound and lyrics…';
  return sharedGenres.length
    ? `Shared genres: ${sharedGenres.slice(0, 5).join(', ')}.`
    : 'No genre tags in common on MusicBrainz.';
}

/** What the graph says while collaborators load, or when they couldn't be. */
export function graphStatus(pending: boolean, error: Error | undefined): string {
  if (pending) return 'Finding people credited on both artists’ albums… (up to a minute the first time)';
  return error ? `Couldn’t load collaborators: ${error.message}` : '';
}
