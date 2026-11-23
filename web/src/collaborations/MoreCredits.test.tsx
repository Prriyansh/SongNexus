import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {cleanup, render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router';
import {afterEach, describe, expect, it, vi} from 'vitest';

import type {Schemas} from '../api/client';
import {MoreCredits} from './MoreCredits';

const REPLY: Schemas['ListMoreCreditsResponse'] = {
  collaborators: [
    {
      source: 'dataSources/discogs',
      displayName: 'Carol',
      url: 'https://www.discogs.com/artist/300',
      artist: {
        name: 'artists/carol',
        displayName: 'Carol',
        disambiguation: null,
        artistType: null,
        country: null,
        genreKnown: false,
        imageUrl: null,
        listeners: null,
      },
      rolesA: ['producer'],
      rolesB: ['producer', 'mixing'],
      evidenceA: [
        {
          title: 'Alice Album',
          url: 'https://www.discogs.com/release/11',
          year: 2020,
        },
      ],
      evidenceB: [
        {
          title: 'Bob Album',
          url: 'https://www.discogs.com/release/21',
          year: null,
        },
      ],
    },
    {
      source: 'dataSources/genius',
      displayName: 'Wren Writer',
      url: 'https://genius.com/artists/Wren',
      artist: null,
      rolesA: ['songwriting'],
      rolesB: ['songwriting'],
      evidenceA: [],
      evidenceB: [],
    },
  ],
  direct: [],
  checks: [
    {
      source: 'dataSources/discogs',
      status: 'PARTIAL',
      scannedA: 3,
      scannedB: 5,
      unit: 'releases',
    },
    {
      source: 'dataSources/genius',
      status: 'NO_KEY',
      scannedA: 0,
      scannedB: 0,
      unit: 'songs',
    },
  ],
};

function show() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(REPLY), {
          status: 200,
          headers: {'Content-Type': 'application/json'},
        }),
      ),
    ),
  );
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MoreCredits a="alice" b="bob" names={['Alice', 'Bob']} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MoreCredits', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('links people to the catalog only through a mapped artist', async () => {
    show();
    const carol = await screen.findByRole('link', {name: 'Carol'});
    expect(carol.getAttribute('href')).toBe('/artist/carol');
    const wren = screen.getByRole('link', {name: 'Wren Writer'});
    expect(wren.getAttribute('href')).toBe('https://genius.com/artists/Wren');
    expect(
      screen.getByText('Alice: producer · Bob: producer and mixing'),
    ).toBeDefined();
    expect(screen.getByRole('link', {name: 'Alice Album'})).toBeDefined();
  });

  it('says what each source checked', async () => {
    show();
    expect(
      await screen.findByText(
        /Discogs: checked 3 and 5 releases before running out of time/,
      ),
    ).toBeDefined();
    expect(
      screen.getByText('Genius isn’t set up on this server.'),
    ).toBeDefined();
  });
});
