import { describe, expect, it } from 'vitest';
import { buildPath, buildProfileShareUrl, buildShareUrl, comparisonFor, examples, parseRoute, defaultWeb } from '../routing';
import { emptyProfile } from '../profile';
import { OLIVIA, PHOEBE, TAYLOR, VAMPIRE } from './fixtures';

describe('parseRoute', () => {
  it('reads a shareable artist comparison link', () => {
    const route = parseRoute('/compare/artists', `?artistA=${PHOEBE}&artistB=${TAYLOR}`);
    expect(route.page).toBe('explore');
    expect(route.comparison).toEqual({ kind: 'artist', left: PHOEBE, right: TAYLOR, role: 'all' });
  });

  it('reads a song comparison link with a role filter and note', () => {
    const route = parseRoute('/compare/songs', `?songA=${VAMPIRE}&songB=${examples.song[1]}&role=mixing&note=listen`);
    expect(route.comparison).toMatchObject({ kind: 'song', left: VAMPIRE, role: 'mixing' });
    expect(route.note).toBe('listen');
  });

  it('falls back to the default pair for missing or malformed ids', () => {
    expect(parseRoute('/compare/artists', '').comparison).toMatchObject({ left: OLIVIA, right: TAYLOR });
    expect(parseRoute('/compare/artists', '?artistA=not-a-uuid').comparison.left).toBe(OLIVIA);
  });

  it('never compares something with itself', () => {
    const same = parseRoute('/compare/artists', `?artistA=${PHOEBE}&artistB=${PHOEBE}`).comparison;
    expect(same.left).toBe(PHOEBE);
    expect(same.right).not.toBe(PHOEBE);
    // Only artistB given, equal to the first default: the defaults swap rather than collide.
    expect(comparisonFor('artist', null, OLIVIA)).toMatchObject({ left: TAYLOR, right: OLIVIA });
  });

  it('ignores unknown role filters', () => {
    expect(parseRoute('/compare/artists', '?role=dj').comparison.role).toBe('all');
  });

  it('opens About Me for the root, /about and /about/manual', () => {
    expect(parseRoute('/', '').page).toBe('about');
    expect(parseRoute('/about/', '')).toMatchObject({ page: 'about', manual: false });
    expect(parseRoute('/about/manual', '')).toMatchObject({ page: 'about', manual: true });
  });

  it('keeps the current comparison when moving to About Me', () => {
    const current = comparisonFor('song');
    expect(parseRoute('/about', '', current).comparison).toBe(current);
  });

  it('reads a shared profile and its note, and ignores a broken one', () => {
    const profile = { ...emptyProfile, genres: ['pop'] };
    const shared = parseRoute('/about', `?profile=${encodeURIComponent(JSON.stringify(profile))}&note=hi`);
    expect(shared.profile?.genres).toEqual(['pop']);
    expect(shared.note).toBe('hi');
    const broken = parseRoute('/about', '?profile=%7Bnot-json&note=hi');
    expect(broken.profile).toBeUndefined();
    expect(broken.note).toBe('');
  });

  it('caps notes at 300 characters', () => {
    expect(parseRoute('/compare/songs', `?note=${'x'.repeat(400)}`).note).toHaveLength(300);
  });
});

describe('buildPath', () => {
  it('writes the same URL scheme main used, and round-trips', () => {
    const comparison = comparisonFor('artist', PHOEBE, TAYLOR, 'producer');
    const path = buildPath('explore', comparison, 'hello');
    expect(path).toBe(`/compare/artists?artistA=${PHOEBE}&artistB=${TAYLOR}&role=producer&note=hello`);
    const url = new URL(path, 'http://x');
    expect(parseRoute(url.pathname, url.search).comparison).toEqual(comparison);
  });

  it('leaves out the default role', () => {
    expect(buildPath('explore', comparisonFor('song'))).not.toContain('role=');
  });

  it('builds About Me paths', () => {
    expect(buildPath('about', comparisonFor('artist'))).toBe('/about');
    expect(buildPath('about', comparisonFor('artist'), '', true)).toBe('/about/manual');
  });

  it('builds absolute share links on the current origin', () => {
    expect(buildShareUrl('https://songnexus.app', comparisonFor('artist'))).toMatch(/^https:\/\/songnexus\.app\/compare\/artists\?artistA=/);
    const profileUrl = new URL(buildProfileShareUrl('https://songnexus.app', { ...emptyProfile, genres: ['folk'] }, 'mine'));
    expect(profileUrl.pathname).toBe('/about');
    expect(JSON.parse(profileUrl.searchParams.get('profile')!).genres).toEqual(['folk']);
    expect(profileUrl.searchParams.get('note')).toBe('mine');
  });

  it('keeps one artist and one song for the Connection Web, and round-trips them', () => {
    const web = { mode: 'song' as const, artist: PHOEBE, song: VAMPIRE };
    const url = new URL(buildPath('connections', comparisonFor('song'), 'a note', false, web), 'http://localhost');
    const route = parseRoute(url.pathname, url.search);
    expect(route.page).toBe('connections');
    expect(route.web).toEqual(web);
    expect(route.note).toBe('a note');
  });

  it('opens old two-artist and search links as the new artist and song views', () => {
    expect(parseRoute('/connections', `?mode=comparison&artistA=${PHOEBE}&artistB=${TAYLOR}`).web).toMatchObject({ mode: 'artist', artist: PHOEBE });
    expect(parseRoute('/connections', `?mode=search&song=${VAMPIRE}`).web).toMatchObject({ mode: 'song', song: VAMPIRE });
  });

  it('falls back to the defaults for bad ids and modes', () => {
    expect(parseRoute('/connections', '?mode=nope&artist=bad&song=bad').web).toEqual(defaultWeb());
  });
});
