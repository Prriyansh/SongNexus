import { describe, expect, it } from 'vitest';
import type { Collaborator, MoreCredits, SourcedCollaborator } from '@/lib/types';
import { mergeSourcedCredits, sourceNote } from '../credits';

const mb = (id: string, name: string): Collaborator => ({ id, name, roles: { a: [], b: [] }, trackCount: { a: 1, b: 1 }, tracks: { a: [], b: [] } });
const sourced = (source: 'genius' | 'discogs', name: string): SourcedCollaborator => ({ source, id: name, name, url: `https://${source}/${name}`, roles: { a: [], b: [] }, count: { a: 1, b: 1 }, evidence: { a: [], b: [] } });
const more = (...collaborators: SourcedCollaborator[]): MoreCredits => ({ collaborators, direct: [], sources: [] });

describe('mergeSourcedCredits', () => {
  it('marks a MusicBrainz person as confirmed when another source lists the same name', () => {
    const merged = mergeSourcedCredits([mb('m1', 'Jack Antonoff')], more(sourced('genius', 'JACK ANTONOFF'), sourced('discogs', 'Jack Antonoff')));
    expect(merged.confirmed.get('m1')?.map(s => s.source)).toEqual(['genius', 'discogs']);
    expect(merged.extra).toEqual([]);
  });
  it('lists anyone else once, even when two sources have them', () => {
    const merged = mergeSourcedCredits([mb('m1', 'Jack Antonoff')], more(sourced('genius', 'Dan Nigro'), sourced('discogs', 'Dan Nigro')));
    expect(merged.extra.map(p => p.source)).toEqual(['genius']);
    expect(merged.confirmed.size).toBe(0);
  });
  it('works before the extra credits arrive', () => {
    expect(mergeSourcedCredits([mb('m1', 'A')]).extra).toEqual([]);
  });
});

describe('sourceNote', () => {
  it('says what each source did, so an empty list reads honestly', () => {
    expect(sourceNote([
      { source: 'Genius', status: 'no-key' },
      { source: 'Discogs', status: 'partial', scanned: { a: 4, b: 2 }, unit: 'albums' },
    ])).toBe('Genius isn’t set up here. Discogs: checked 4 and 2 albums before stopping early, so more may exist.');
  });
  it('covers failure of the whole request', () => {
    expect(sourceNote(undefined, new Error('x'))).toBe('Genius and Discogs couldn’t be checked.');
  });
});
