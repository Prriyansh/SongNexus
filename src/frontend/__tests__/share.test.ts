import { describe, expect, it } from 'vitest';
import { emptyProfile } from '../profile';
import type { MusicProfile } from '../profile';
import { comparisonFor, defaultWeb, parseRoute } from '../routing';
import type { Route, WebSelection } from '../routing';
import { shareLabel, shareSubject, shareUrl } from '../share';
import { OLIVIA, OPHELIA, TAYLOR, VAMPIRE } from './fixtures';

const origin = 'https://songnexus.example';
const at = (path: string, hash = '') => ({ origin, href: `${origin}${path}${hash}`, hash });
const route = (page: Route['page'], web?: Partial<WebSelection>): Route => ({
  page,
  manual: false,
  comparison: comparisonFor('artist', OLIVIA, TAYLOR),
  note: '',
  web: web && { ...defaultWeb(), ...web },
});
const profile: MusicProfile = {
  ...emptyProfile,
  artists: [{ id: OLIVIA, name: 'Olivia Rodrigo' }] as MusicProfile['artists'],
  genres: ['pop', 'rock'],
};

describe('what the Share button shares', () => {
  it('shares About Me as a profile, and playlist maps without naming music', () => {
    expect(shareSubject(route('about'))).toEqual({ what: 'profile' });
    expect(shareSubject(route('friends'))).toEqual({ what: 'taste', friends: true });
    expect(shareSubject(route('connections', { mode: 'playlist' }))).toEqual({ what: 'taste', friends: false });
  });

  it('names the music at the centre of the Connection Web, or both sides of its comparison', () => {
    expect(shareSubject(route('connections', { mode: 'artist', artist: TAYLOR }))).toEqual({ what: 'web', kind: 'artist', ids: [TAYLOR] });
    expect(shareSubject(route('connections', { mode: 'song', song: OPHELIA }))).toEqual({ what: 'web', kind: 'song', ids: [OPHELIA] });
    expect(shareSubject(route('connections', { mode: 'comparison', left: TAYLOR, right: OLIVIA }))).toEqual({
      what: 'web',
      kind: 'artist',
      ids: [TAYLOR, OLIVIA],
    });
    expect(shareSubject(route('connections'))).toEqual({ what: 'web', kind: 'artist', ids: [defaultWeb().artist] });
  });

  it('names Explore’s two artists or songs', () => {
    expect(shareSubject(route('explore'))).toEqual({ what: 'comparison', kind: 'artist', ids: [OLIVIA, TAYLOR] });
    const songs = { ...route('explore'), comparison: comparisonFor('song', VAMPIRE, OPHELIA) };
    expect(shareSubject(songs)).toEqual({ what: 'comparison', kind: 'song', ids: [VAMPIRE, OPHELIA] });
  });
});

describe('the line naming what is shared', () => {
  it('counts what a profile holds', () => {
    expect(shareLabel({ what: 'profile' }, profile, [])).toBe('1 artists · 2 genres · 0 albums · 0 songs');
  });

  it('names the page for playlist maps', () => {
    expect(shareLabel({ what: 'taste', friends: true }, profile, [])).toBe('Friends');
    expect(shareLabel({ what: 'taste', friends: false }, profile, [])).toBe('Connection Web');
  });

  it('shows names as they load, with an ellipsis until then', () => {
    expect(shareLabel({ what: 'comparison', kind: 'artist', ids: [OLIVIA, TAYLOR] }, profile, ['Olivia Rodrigo', ''])).toBe('Olivia Rodrigo ↔ …');
    expect(shareLabel({ what: 'web', kind: 'song', ids: [VAMPIRE] }, profile, ['vampire', ''])).toBe('vampire · Connection Web');
    expect(shareLabel({ what: 'web', kind: 'artist', ids: [OLIVIA, TAYLOR] }, profile, ['', ''])).toBe('… ↔ … · Connection Web');
  });
});

describe('the link the Share button copies', () => {
  it('carries the profile snapshot and note for About Me', () => {
    const url = new URL(shareUrl(route('about'), profile, 'my taste', at('/about')));
    expect(url.pathname).toBe('/about');
    expect(JSON.parse(url.searchParams.get('profile')!)).toEqual(profile);
    expect(url.searchParams.get('note')).toBe('my taste');
  });

  it('is the page’s own address on Friends, which carries the room or playlist', () => {
    expect(shareUrl(route('friends'), profile, 'ignored', at('/friends', '#playlist=abc'))).toBe(`${origin}/friends#playlist=abc`);
  });

  it('keeps the Connection Web’s selection, note and hash', () => {
    const web = route('connections', { mode: 'song', song: OPHELIA });
    const url = new URL(shareUrl(web, profile, 'listen', at('/connections', '#playlist=abc')));
    expect(url.hash).toBe('#playlist=abc');
    const reopened = parseRoute(url.pathname, url.search);
    expect(reopened.page).toBe('connections');
    expect(reopened.web).toMatchObject({ mode: 'song', song: OPHELIA });
    expect(reopened.note).toBe('listen');
  });

  it('reopens the same Explore comparison with its note', () => {
    const url = new URL(shareUrl(route('explore'), profile, 'why these two', at('/compare/artists')));
    expect(url.origin).toBe(origin);
    const reopened = parseRoute(url.pathname, url.search);
    expect(reopened.comparison).toMatchObject({ kind: 'artist', left: OLIVIA, right: TAYLOR });
    expect(reopened.note).toBe('why these two');
  });
});
