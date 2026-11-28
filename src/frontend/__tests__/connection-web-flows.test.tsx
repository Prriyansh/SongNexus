// @vitest-environment jsdom
// The Connection Web's Artist, Song and Comparison modes driven like a user, for what
// app.integration.test.tsx doesn't reach: a shared note, the artists-only filter, a song's map,
// zoom-in discovery that fails, and the Comparison mode's loading, partial and failed states.
import { describe, expect, it } from 'vitest';
import { button, click, fetchMock, render, settle, text } from './app-harness';
import { collab, OLIVIA, OPHELIA, PHOEBE, similarWeb, TAYLOR, VAMPIRE } from './fixtures';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function answer(test: (url: URL) => boolean, reply: (url: URL) => Response) {
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (input: string) => {
    const url = new URL(input, 'http://localhost');
    return test(url) ? reply(url) : original(input);
  });
}
const status = () => document.querySelector('.web-map-status')?.textContent ?? '';
const comparison = `/connections?mode=comparison&artistA=${OLIVIA}&artistB=${TAYLOR}`;

describe('the Artist and Song modes', () => {
  it('shows a note shared with the link', async () => {
    await render(`/connections?mode=artist&artist=${OLIVIA}&note=Listen+to+these`);
    expect(document.querySelector('.shared-note')!.textContent).toContain('Listen to these');
  });

  it('shows only artists when asked', async () => {
    await render('/connections');
    const songs = () => document.querySelectorAll('.web-artist.is-song, .web-song').length;
    await click(button('Artists'));
    expect(songs()).toBe(0);
    expect(button('Artists').getAttribute('aria-pressed')).toBe('true');
  });

  it('names a song’s map by its title and artist', async () => {
    const songCenter = { ...similarWeb.center, kind: 'song' as const, id: VAMPIRE, name: 'vampire', subtitle: 'Olivia Rodrigo' };
    answer(url => url.pathname === '/api/similar' && url.searchParams.get('kind') === 'song', () => json({ similar: { ...similarWeb, center: songCenter } }));
    await render(`/connections?mode=song&song=${VAMPIRE}`);
    expect(document.querySelector('.web-map-heading')!.textContent).toBe('vampire by Olivia Rodrigo');
  });

  it('says when finding more around an artist failed, and tries again', async () => {
    answer(url => url.pathname === '/api/similar' && url.searchParams.get('songs') === '0', () => json({ error: 'Too busy.' }, 400));
    await render('/connections');
    await click(button('Zoom in'));
    await settle();
    expect(status()).toMatch(/^Couldn’t load more around .+\.Try again$/);
    const asked = fetchMock.mock.calls.length;
    await click(button('Try again'));
    expect(fetchMock.mock.calls.length).toBeGreaterThan(asked);
  });
});

describe('the Comparison mode', () => {
  it('says when an artist couldn’t be loaded, and tries both again', async () => {
    answer(url => url.pathname === '/api/musicbrainz/details' && url.searchParams.get('id') === TAYLOR, () => json({ error: 'Taylor is unavailable.' }, 400));
    await render(comparison);
    expect(text()).toContain('We couldn’t load this map.');
    expect(text()).toContain('Taylor is unavailable.');
    const asked = fetchMock.mock.calls.length;
    await click(button('Try again'));
    expect(fetchMock.mock.calls.length).toBeGreaterThan(asked);
  });

  it('says when album credits couldn’t be loaded, and asks for them again', async () => {
    answer(url => url.pathname === '/api/musicbrainz/collaborators', () => json({ error: 'Credits failed.' }, 400));
    await render(comparison);
    expect(status()).toContain('Some album credits couldn’t be loaded.');
    answer(url => url.pathname === '/api/musicbrainz/collaborators', () => json({ collaborators: collab }));
    await click(button('Try again'));
    expect(status()).toContain('Credit path:');
  });

  it('says when some discovery data couldn’t be loaded', async () => {
    answer(url => url.pathname === '/api/musicbrainz/search', () => json({ error: 'Search failed.' }, 400));
    await render(comparison);
    expect(status()).toContain('Some discovery data couldn’t be loaded.');
    await click(button('Try again'));
  });

  it('says when no credit connects the two', async () => {
    answer(url => url.pathname === '/api/musicbrainz/collaborators', () => json({ collaborators: { ...collab, mutual: [], direct: { bOnA: [], aOnB: [] } } }));
    await render(comparison);
    expect(status()).toBe('No documented connection found in the scanned credits.');
  });

  it('swaps the two artists', async () => {
    await render(comparison);
    await click(button('Swap artists'));
    const q = new URLSearchParams(window.location.search);
    expect([q.get('artistA'), q.get('artistB')]).toEqual([TAYLOR, OLIVIA]);
  });
});

describe('choosing and growing a map', () => {
  const pick = async (chooser: number, query: string, label: string, name: string) => {
    await click(document.querySelectorAll('.web-selection-dock .chooser-button')[chooser]);
    const { type } = await import('./app-harness');
    await type(document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!, query);
    await click([...document.querySelectorAll('.chooser-option')].find(o => o.textContent?.includes(name))!);
  };

  it('centers the Artist mode on an artist picked from its search', async () => {
    await render('/connections');
    await pick(0, 'phoebe', 'Search artists', 'Phoebe Bridgers');
    expect(new URLSearchParams(window.location.search).get('artist')).toBe(PHOEBE);
  });

  it('centers the Song mode on a song picked from its search', async () => {
    await render(`/connections?mode=song&song=${OPHELIA}`);
    await pick(0, 'vampire', 'Search songs', 'vampire');
    expect(new URLSearchParams(window.location.search).get('song')).toBe(VAMPIRE);
  });

  it('adds the artists a zoom-in finds to the map', async () => {
    const extra = { ...similarWeb.artists[0], id: 'ee000000-0000-4000-8000-000000000099', name: 'Found By Zooming' };
    answer(url => url.pathname === '/api/similar' && url.searchParams.get('songs') === '0', () => json({ similar: { ...similarWeb, artists: [extra], songs: [] } }));
    await render('/connections');
    await click(button('Zoom in'));
    await settle();
    expect(document.querySelector('.web-summary')!.textContent).toContain(`${similarWeb.artists.length + 1} artists`);
  });

  // Each picker leaves out the artist chosen on the other side, so these are two tests.
  it('zooms the Comparison map, and changes its second artist', async () => {
    await render(comparison);
    await click(button('Zoom in'));
    await settle();
    await pick(1, 'phoebe', 'Search artists', 'Phoebe Bridgers');
    expect(new URLSearchParams(window.location.search).get('artistB')).toBe(PHOEBE);
  });

  it('changes the Comparison map’s first artist', async () => {
    await render(comparison);
    await pick(0, 'phoebe', 'Search artists', 'Phoebe Bridgers');
    expect(new URLSearchParams(window.location.search).get('artistA')).toBe(PHOEBE);
  });
});

describe('a map with a failed source', () => {
  it('offers to try the map again from its status line', async () => {
    answer(url => url.pathname === '/api/similar', () => json({ similar: { ...similarWeb, sources: [{ source: 'Deezer', status: 'failed' }] } }));
    await render('/connections');
    expect(status()).toContain('Deezer couldn’t be reached.');
    const asked = fetchMock.mock.calls.length;
    await click(document.querySelector('.web-map-status button')!);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(asked);
  });
});
