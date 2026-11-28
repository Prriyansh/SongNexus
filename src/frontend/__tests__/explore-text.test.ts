import { describe, expect, it } from 'vitest';
import type { CollaboratorComparison } from '@/lib/types';
import type { SoundComparison } from '@/lib/sound';
import { directConnection, graphStatus, mutualCollaborators, peopleOf, sharedArtists, similarity } from '../explore-text';
import { nameOf } from '../types';
import { collab, OLIVIA, oliviaDetails, opheliaDetails, soundOk, TAYLOR, taylorDetails, vampireDetails } from './fixtures';

const track = (title: string) => ({ id: `id-${title}`, title });
const withCredits = (direct: Partial<CollaboratorComparison['direct']>, writing?: Partial<CollaboratorComparison['direct']>): CollaboratorComparison => ({
  ...collab,
  direct: { bOnA: [], aOnB: [], ...direct },
  writing: writing && { bOnA: [], aOnB: [], ...writing },
});
const comparison = (soundOk as Extract<typeof soundOk, { status: 'ok' }>).comparison;

describe('names', () => {
  it('uses a song’s title and an artist’s name, and nothing while loading', () => {
    expect(nameOf(vampireDetails)).toBe('vampire');
    expect(nameOf(oliviaDetails)).toBe('Olivia Rodrigo');
    expect(nameOf(undefined)).toBe('');
  });
});

describe('the direct connection between two artists', () => {
  const say = (c: CollaboratorComparison | undefined, pending = false) => directConnection(c, pending, oliviaDetails, taylorDetails);

  it('says it is still checking while credits load', () => {
    expect(say(withCredits({ bOnA: [track('x')] }), true)).toBe('Checking album credits…');
  });

  it('names one album track in each direction someone is credited', () => {
    expect(say(withCredits({ bOnA: [track('vampire'), track('other')] }))).toBe('Taylor Swift is credited on Olivia Rodrigo’s “vampire”.');
    expect(say(withCredits({ aOnB: [track('Ophelia')] }))).toBe('Olivia Rodrigo is credited on Taylor Swift’s “Ophelia”.');
    expect(say(withCredits({ bOnA: [track('a')], aOnB: [track('b')] }))).toBe(
      'Taylor Swift is credited on Olivia Rodrigo’s “a”. Olivia Rodrigo is credited on Taylor Swift’s “b”.',
    );
  });

  it('prefers a performing credit over a writing one', () => {
    expect(say(withCredits({ bOnA: [track('a')] }, { aOnB: [track('w')] }))).not.toContain('songwriting');
  });

  it('calls a writing-only credit what it is, and says it may just be a sample', () => {
    const text = say(withCredits({}, { aOnB: [track('w')] }));
    expect(text).toMatch(/^Olivia Rodrigo has a songwriting credit on Taylor Swift’s “w”\. Writing credits can come from a sample/);
    expect(say(withCredits({}, { bOnA: [track('w')] }))).toMatch(/^Taylor Swift has a songwriting credit on Olivia Rodrigo’s “w”\./);
  });

  it('says neither is credited when no scan found anything, or before any scan', () => {
    for (const c of [withCredits({}), withCredits({}, {}), undefined]) {
      expect(say(c)).toBe('Neither is credited on the other’s scanned albums.');
    }
  });
});

describe('mutual collaborators', () => {
  it('keeps everyone for "all", and those credited in the role on either side otherwise', () => {
    expect(mutualCollaborators(collab, 'all').map((c) => c.name)).toEqual(['Serban Ghenea', 'Bryce Bordone', 'Dan Nigro']);
    expect(mutualCollaborators(collab, 'engineering').map((c) => c.name)).toEqual(['Bryce Bordone']);
    expect(mutualCollaborators(collab, 'producer').map((c) => c.name)).toEqual(['Dan Nigro']);
    expect(mutualCollaborators(collab, 'vocals')).toEqual([]);
    expect(mutualCollaborators(undefined, 'all')).toEqual([]);
  });
});

describe('the people behind a comparison', () => {
  it('is the two artists of an artist pair, as they load', () => {
    expect(peopleOf('artist', oliviaDetails, taylorDetails)).toEqual([
      { id: OLIVIA, name: 'Olivia Rodrigo' },
      { id: TAYLOR, name: 'Taylor Swift' },
    ]);
    expect(peopleOf('artist', undefined, taylorDetails)).toEqual([{ id: TAYLOR, name: 'Taylor Swift' }]);
  });

  it('is each song’s first artist with an id, once if both songs share them', () => {
    expect(peopleOf('song', vampireDetails, opheliaDetails).map((p) => p.name)).toEqual(['Olivia Rodrigo', 'Taylor Swift']);
    expect(peopleOf('song', vampireDetails, vampireDetails)).toEqual([{ id: OLIVIA, name: 'Olivia Rodrigo' }]);
    const uncredited = { ...vampireDetails, artists: [{ id: null, name: 'Someone' }, { id: TAYLOR, name: 'Taylor Swift' }] };
    expect(peopleOf('song', uncredited, undefined)).toEqual([{ id: TAYLOR, name: 'Taylor Swift' }]);
  });
});

describe('shared credited artists of two songs', () => {
  it('waits for both, lists who is on both, or says they differ', () => {
    expect(sharedArtists(vampireDetails, undefined)).toBe('Loading…');
    expect(sharedArtists(vampireDetails, vampireDetails)).toBe('Olivia Rodrigo');
    expect(sharedArtists(vampireDetails, opheliaDetails)).toBe('Different artists. The web shows who worked with both.');
  });

  it('only matches artists by id', () => {
    const noIds = { ...vampireDetails, artists: [{ id: null, name: 'Olivia Rodrigo' }] };
    expect(sharedArtists(noIds, noIds)).toBe('Different artists. The web shows who worked with both.');
  });
});

describe('musical similarity', () => {
  it('rounds the calculated match to whole percents, with up to three shared genres', () => {
    expect(similarity(comparison, false, ['Pop', 'Rock', 'Indie', 'Folk'])).toBe(
      '71% overall match: sound 74%, lyrics 66%. Shared genres: Pop, Rock, Indie.',
    );
    expect(similarity(comparison, false, [])).toBe('71% overall match: sound 74%, lyrics 66%.');
  });

  it('says when lyrics weren’t matched', () => {
    const noLyrics: SoundComparison = { ...comparison, lyrics: null };
    expect(similarity(noLyrics, false, [])).toBe('71% overall match: sound 74%, lyrics not matched.');
  });

  it('says it is measuring while the service answers, then falls back to up to five genres', () => {
    expect(similarity(null, true, ['Pop'])).toBe('Measuring their sound and lyrics…');
    expect(similarity(null, false, ['A', 'B', 'C', 'D', 'E', 'F'])).toBe('Shared genres: A, B, C, D, E.');
    expect(similarity(null, false, [])).toBe('No genre tags in common on MusicBrainz.');
  });
});

describe('the graph’s status line', () => {
  it('says the first scan is slow, then any error, then nothing', () => {
    expect(graphStatus(true, new Error('ignored'))).toMatch(/up to a minute the first time/);
    expect(graphStatus(false, new Error('MusicBrainz is busy'))).toBe('Couldn’t load collaborators: MusicBrainz is busy');
    expect(graphStatus(false, undefined)).toBe('');
  });
});
