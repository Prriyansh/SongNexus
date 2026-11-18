// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { applyAnswers, emptySetup, needsSetup, parseSetup, playlistFrom, readSetup, storeSetup } from '../setup';
import type { SetupAnswers } from '../setup';
import { emptyProfile } from '../profile';
import type { MusicProfile } from '../profile';
import { phoebe, PHOEBE, vampireDetails } from './fixtures';

const answers = (more: Partial<SetupAnswers> = {}): SetupAnswers => ({ name: '', genres: [], artists: [], songs: [], discover: null, ...more });
const withArtists = (...ids: string[]): MusicProfile => ({ ...emptyProfile, artists: ids.map(id => ({ id, name: id, subtitle: '', artUrl: null })) });

beforeEach(() => localStorage.clear());

describe('setup storage', () => {
  it('reads back what was stored and treats anything else as not done', () => {
    expect(readSetup()).toEqual(emptySetup);
    storeSetup({ done: true, name: 'Alka', discover: 'new' });
    expect(readSetup()).toEqual({ done: true, name: 'Alka', discover: 'new' });
    localStorage.setItem('song-nexus-setup', '{broken');
    expect(readSetup()).toEqual(emptySetup);
  });

  it('validates stored values', () => {
    expect(parseSetup({ done: 'yes', name: 42, discover: 'radio' })).toEqual(emptySetup);
    expect(parseSetup({ done: true, name: `  ${'x'.repeat(60)}  `, discover: 'friends' }).name).toHaveLength(40);
  });
});

describe('needsSetup', () => {
  it('asks only on a first visit with nothing saved', () => {
    expect(needsSetup(emptyProfile, emptySetup)).toBe(true);
    expect(needsSetup(emptyProfile, { ...emptySetup, done: true })).toBe(false);
    expect(needsSetup({ ...emptyProfile, genres: ['pop'] }, emptySetup)).toBe(false);
  });
});

describe('applyAnswers', () => {
  it('adds genres, artists and songs without duplicating what is saved', () => {
    const saved: MusicProfile = { ...withArtists(PHOEBE), genres: ['pop'] };
    const next = applyAnswers(saved, answers({ genres: ['pop', 'jazz'], artists: [phoebe], songs: [vampireDetails] }));
    expect(next.genres).toEqual(['pop', 'jazz']);
    expect(next.artists.map(a => a.id)).toEqual([PHOEBE]);
    expect(next.songs.map(s => [s.id, s.title, s.artist])).toEqual([[vampireDetails.id, 'vampire', 'Olivia Rodrigo']]);
    expect(playlistFrom(next)).toEqual([{ title: 'vampire', artist: 'Olivia Rodrigo' }]);
  });
});
