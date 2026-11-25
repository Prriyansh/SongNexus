import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/lib/types';

const song = (id: string, title: string, artist: string, date: string): Song => ({
  id, title, durationMs: null, disambiguation: '', tags: [], artists: [{ id: null, name: artist }],
  releases: date ? [{ id: `r-${id}`, title: 'Release', date }] : [],
});
const searchSongs = vi.fn();
beforeEach(() => { vi.resetModules(); searchSongs.mockReset(); vi.doMock('../api', () => ({ searchSongs })); });
afterEach(() => vi.doUnmock('../api'));

describe('findRecording', () => {
  it('searches official MusicBrainz releases by title and artist', async () => {
    searchSongs.mockResolvedValue([]);
    const { findRecording } = await import('../resolve');
    expect(await findRecording('The Scientist', 'Coldplay')).toBeNull();
    expect(searchSongs).toHaveBeenCalledWith('recording:"The Scientist" AND artist:"Coldplay" AND status:official', undefined, 15);
  });

  it('picks the matching recording with the earliest release, ignoring other titles and artists', async () => {
    searchSongs.mockResolvedValue([
      song('live', 'The Scientist', 'Coldplay', '2003-11-17'),
      song('cover', 'The Scientist', 'Someone Else', '1999-01-01'),
      song('other', 'The Scientist (Live)', 'Coldplay', '2001-01-01'),
      song('undated', 'The Scientist', 'Coldplay', ''),
      song('original', 'The Scientist', 'Coldplay', '2002-08-26'),
    ]);
    const { findRecording } = await import('../resolve');
    expect((await findRecording('The Scientist', 'Coldplay'))?.id).toBe('original');
  });
});
