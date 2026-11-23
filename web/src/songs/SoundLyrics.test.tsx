import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {cleanup, render, screen, within} from '@testing-library/react';
import {MemoryRouter} from 'react-router';
import {afterEach, describe, expect, it, vi} from 'vitest';

import type {Schemas} from '../api/client';
import {SoundLyrics} from './SoundLyrics';

type Result = Schemas['CompareSoundResponse'];

const track = (title: string, lyrics: boolean): Schemas['SoundTrack'] => ({
  title,
  artists: ['Alice'],
  album: 'First Album',
  genre: 'indie-pop',
  tempoBpm: 120,
  key: 'A minor',
  timeSignature: 4,
  durationMs: 201_000,
  features: [
    {feature: 'ENERGY', value: 0.8},
    {feature: 'VALENCE', value: 0.4},
  ],
  lyrics: lyrics
    ? {
        topEmotion: 'joy',
        sentiment: 0.42,
        topThemes: ['love', 'night'],
        structure: {
          verses: 2,
          choruses: 3,
          bridges: 1,
          words: 312,
          repetition: 0.35,
        },
      }
    : null,
});

const OK: Result = {
  status: 'OK',
  comparison: {
    trackA: track('Song', true),
    trackB: track('Other Song', false),
    similarity: 0.81,
    soundSimilarity: 0.81,
    lyricSimilarity: null,
    structure: {halfOrDoubleTime: true, keyRelation: 'relative major/minor'},
    reasons: ['Similar energy and positivity.'],
  },
  similarA: [
    {
      title: 'In the catalog',
      artists: ['Alice'],
      genre: null,
      similarity: 0.9,
      sharesArtist: true,
      recording: 'recordings/r9',
    },
    {
      title: 'Only in the dataset',
      artists: ['Nobody'],
      genre: null,
      similarity: 0.7,
      sharesArtist: false,
      recording: null,
    },
  ],
  similarB: [],
  missing: [],
  sources: [],
};

function serve(body: Result | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        body === null
          ? new Response('{}', {status: 503})
          : new Response(JSON.stringify(body), {
              status: 200,
              headers: {'Content-Type': 'application/json'},
            }),
      ),
    ),
  );
}

function show() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <div className="cx-board">
          <SoundLyrics
            a="ra"
            b="rb"
            names={{'recordings/ra': 'Song', 'recordings/rb': 'Other Song'}}
          />
        </div>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SoundLyrics', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('explains how alike the songs are, from which data', async () => {
    serve(OK);
    show();
    await screen.findByText('Similar energy and positivity.');
    const alike = screen.getByRole('region', {name: 'Sound and lyrics'});
    expect(within(alike).getAllByText('81%')).toHaveLength(2); // overall and sound
    expect(
      within(alike).getByText('Similar energy and positivity.'),
    ).toBeDefined();
    // Lyrics are missing for one song: only the sound meter shows.
    expect(within(alike).getByText('Sound')).toBeDefined();
    expect(within(alike).queryByText('Lyric meaning')).toBeNull();
    const built = screen.getByRole('region', {name: 'How they’re built'});
    expect(within(built).getByText('joy · positive')).toBeDefined();
    expect(
      within(built).getAllByText('No lyrics matched').length,
    ).toBeGreaterThan(0);
    expect(
      within(built).getByText(
        'The tempos line up in half or double time. Keys: relative major/minor.',
      ),
    ).toBeDefined();
    expect(
      screen.getByRole('img', {name: 'Positivity of Other Song: 40%'}),
    ).toBeDefined();
    expect(screen.getByText(/Spotify Tracks Dataset \(2022\)/)).toBeDefined();
  });

  it('links similar songs only when they are in the catalog', async () => {
    serve(OK);
    show();
    const link = await screen.findByRole('link', {
      name: 'Compare with In the catalog',
    });
    expect(link.getAttribute('href')).toBe('/compare/songs?a=ra&b=r9');
    expect(
      screen.queryByRole('link', {name: /Only in the dataset/}),
    ).toBeNull();
    expect(screen.getByText('Only in the dataset')).toBeDefined();
  });

  it('names the songs the sound library lacks', async () => {
    serve({
      ...OK,
      status: 'NOT_FOUND',
      comparison: null,
      similarA: [],
      missing: ['recordings/rb'],
    });
    show();
    expect(
      await screen.findByText(/Other Song isn’t in the sound library yet/),
    ).toBeDefined();
  });

  it('says it is unavailable when the request fails, without an error', async () => {
    serve(null);
    show();
    expect(
      await screen.findByText(
        'The sound and lyrics analysis isn’t available right now.',
      ),
    ).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
