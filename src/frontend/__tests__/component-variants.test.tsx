// @vitest-environment jsdom
// Screens rendered on their own with every shape of data they can get: the song analysis when the
// service says no, lyrics that didn't match, artists with little on file, collaborators found only
// on Genius or Discogs, and every loading and error state.
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtistDetails, ArtistInsights, CollaboratorComparison, MoreCredits, RecordingDetails } from '@/lib/types';
import type { SoundComparison, SoundResult } from '@/lib/sound';
import { ArtistInsightsPanel } from '../components/ArtistInsightsPanel';
import { Collaborators, ComparisonDetails } from '../components/ComparisonDetails';
import type { Loadable } from '../components/ComparisonDetails';
import { SongAnalysis } from '../components/SongAnalysis';
import type { SoundState } from '../components/SongAnalysis';
import { collab, oliviaDetails, opheliaDetails, soundOk, taylorDetails, vampireDetails } from './fixtures';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLElement;
afterEach(async () => { await act(async () => root?.unmount()); root = null; host?.remove(); });

async function show(element: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(element));
  return host;
}
const words = () => host.textContent ?? '';
const click = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const buttonNamed = (name: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.includes(name))!;
const loaded = <T,>(data?: T, extra: Partial<Loadable<T>> = {}): Loadable<T> => ({ data, loading: false, retry: vi.fn(), ...extra });

describe('the song analysis', () => {
  const songs: [RecordingDetails, RecordingDetails] = [vampireDetails, opheliaDetails];
  const state = (data?: SoundResult, extra: Partial<SoundState> = {}): SoundState => ({ data, loading: false, retry: vi.fn(), ...extra });
  const render = (sound: SoundState, extra = {}) => show(<SongAnalysis sound={sound} songs={songs} onPickSimilar={vi.fn()} {...extra} />);
  const ok = (soundOk as Extract<SoundResult, { status: 'ok' }>);

  it('says why there is no analysis, for each reason, and offers to retry a failure', async () => {
    const retry = vi.fn();
    await render(state(undefined, { error: new Error('timed out'), retry }));
    expect(words()).toContain('The sound and lyrics comparison failed: timed out');
    await click(buttonNamed('Try again'));
    expect(retry).toHaveBeenCalled();
    await act(async () => root!.unmount());

    const cases: [SoundResult, string][] = [
      [{ status: 'not-found', missing: ['a', 'b'] }, '“vampire” and “The Fate of Ophelia” aren’t in the song library'],
      [{ status: 'not-found', missing: ['b'] }, '“The Fate of Ophelia” isn’t in the song library'],
      [{ status: 'same-track' }, 'Both are the same track in the song library'],
      [{ status: 'unavailable' }, 'The sound and lyrics analysis isn’t available right now.'],
      [{ status: 'unavailable', hint: 'Start it.' }, 'isn’t available right now. Start it.'],
    ];
    for (const [result, expected] of cases) {
      await render(state(result));
      expect(words()).toContain(expected);
      expect(buttonNamed('Try again')).toBeUndefined();
      await act(async () => root!.unmount());
    }
    await render(state(undefined, { loading: true }));
    expect(words()).toContain('Measuring their sound and lyrics…');
  });

  it('shows a match without lyrics as sound only, with what the songs share', async () => {
    const track = (t: SoundComparison['a'], compound: number) => ({ ...t, lyrics: t.lyrics && { ...t.lyrics, sentiment: { ...t.lyrics.sentiment, compound } } });
    const c: SoundComparison = {
      ...ok.comparison,
      a: track(ok.comparison.a, 0.5), b: { ...ok.comparison.b, lyrics: null },
      lyrics: null,
      credits: { artists: ['Olivia Rodrigo'], same_album: true, album: 'GUTS', same_genre: true, genre: 'pop' },
      structure: { ...ok.comparison.structure, key: { a: 'C', b: 'C', relation: 'unknown' }, tempo: { a: 120, b: 60, half_double_match: true }, time_signature: { a: null, b: null } },
    };
    await render(state({ ...ok, comparison: c }), { pickError: 'Couldn’t find it.', busyId: 'sp-sim' });
    for (const expected of ['n/a', 'so this is sound only', 'Artist: Olivia Rodrigo', 'Album: GUTS', 'Genre: Pop', 'Positive (0.50)', 'Lyrics not matched.', 'Unknown', 'Tempos line up in half or double time.', 'Couldn’t find it.']) {
      expect(words()).toContain(expected);
    }
    expect(words()).not.toContain('Keys:');
    expect(host.querySelector<HTMLButtonElement>('.similar-panel .mini-entity')!.disabled).toBe(true);
  });

  it('calls a neutral song’s lyrics mixed, and says nothing shared when nothing is', async () => {
    const lyrics = ok.comparison.a.lyrics!;
    const c: SoundComparison = { ...ok.comparison, a: { ...ok.comparison.a, lyrics: { ...lyrics, sentiment: { ...lyrics.sentiment, compound: 0 } } }, credits: { artists: [], same_album: true, album: null, same_genre: true, genre: null } };
    await render(state({ ...ok, comparison: c }));
    expect(words()).toContain('Mixed (0.00)');
    expect(host.querySelector('.match-shared')).toBeNull();
  });
});

describe('facts beyond the credits', () => {
  const side = (extra: Partial<ArtistInsights['a']> = {}): ArtistInsights['a'] => ({ id: 'x', facts: null, audience: { listenBrainz: null, lastFm: null }, ...extra });
  const insights = (a: ArtistInsights['a'], shared: Partial<ArtistInsights['shared']> = {}): ArtistInsights =>
    ({ a, b: side(), shared: { awards: [], labels: [], similarArtists: [], ...shared }, sources: [{ source: 'Wikidata', status: 'ok' }] });

  it('offers to retry a failure', async () => {
    const retry = vi.fn();
    await show(<ArtistInsightsPanel state={loaded<ArtistInsights>(undefined, { error: new Error('down'), retry })} names={['A', 'B']} />);
    await click(buttonNamed('Try again'));
    expect(retry).toHaveBeenCalled();
  });

  it('shows a photo, Last.fm listeners, more awards than fit, dated ones, and similar artists of both', async () => {
    const awards = Array.from({ length: 7 }, (_, i) => ({ id: `Q${i}`, name: `Award ${i}`, year: i === 0 ? '2020' : '' }));
    const a = side({
      facts: { wikidataUrl: 'https://www.wikidata.org/wiki/Q1', description: '', activeFrom: '', awards, nominations: [], labels: [], wikipedia: { url: 'https://en.wikipedia.org/wiki/A', extract: 'Bio.', imageUrl: 'https://upload.wikimedia.org/a.jpg' } },
      audience: { listenBrainz: null, lastFm: { listeners: 1200, plays: 34000, url: 'https://last.fm/a' } },
    });
    await show(<ArtistInsightsPanel state={loaded(insights(a, { similarArtists: [{ name: 'Similar One', mbid: null, url: 'https://last.fm/s' }] }))} names={['A', 'B']} />);
    expect(host.querySelector('img.insight-photo')).not.toBeNull();
    for (const expected of ['1,200 listeners · 34,000 plays', 'Award 0 (2020)', 'and 2 more', 'Last.fm lists as similar to both', 'Similar One']) expect(words()).toContain(expected);
  });
});

describe('the comparison table', () => {
  const none = vi.fn();
  const render = (kind: 'artist' | 'song', a: ArtistDetails | RecordingDetails | undefined, b: ArtistDetails | RecordingDetails | undefined, collabState: Loadable<CollaboratorComparison> | null = null, more?: Loadable<MoreCredits>, role = 'all') =>
    show(<ComparisonDetails kind={kind} a={a} b={b} collab={collabState} more={more} role={role} onSelect={none} onCompareSongs={none} />);

  it('waits for both sides', async () => {
    await render('artist', oliviaDetails, undefined);
    expect(words()).toContain('Loading from MusicBrainz…');
  });

  it('describes artists with little on file, and a lifespan with only an end', async () => {
    const sparse: ArtistDetails = { ...taylorDetails, type: '', area: '', country: '', disambiguation: 'the other one', genres: [], tags: ['indie'], lifeSpan: { end: '2020' }, discography: null, rating: { value: 4, votes: 3 }, links: [] };
    const born: ArtistDetails = { ...oliviaDetails, lifeSpan: { begin: '2003', end: '2099' }, rating: null };
    await render('artist', born, sparse);
    for (const expected of ['Artist', 'the other one', 'Indie', 'Ended 2020', 'Born 2003 · Died 2099', '4.0 / 5', 'Not available']) expect(words()).toContain(expected);
  });

  it('describes songs with little on file', async () => {
    const sparse: RecordingDetails = { ...opheliaDetails, artists: [{ id: null, name: 'Uncredited' }], firstReleaseDate: '', representative: null, durationMs: null, genres: [], tags: [], rating: { value: 3.5, votes: 2 }, links: [{ type: 'streaming', url: 'https://open.spotify.com/track/x' }] };
    await render('song', vampireDetails, sparse);
    for (const expected of ['Uncredited', '3.5 / 5', 'Spotify']) expect(words()).toContain(expected);
    expect(host.querySelectorAll('.comparison-row').length).toBeGreaterThan(5);
  });
});

describe('collaborators', () => {
  const names: [string, string] = ['Olivia Rodrigo', 'Taylor Swift'];
  const render = (state: Loadable<CollaboratorComparison>, extra: Partial<Parameters<typeof Collaborators>[0]> = {}) =>
    show(<Collaborators state={state} names={names} role="all" onSelect={vi.fn()} onCompareSongs={vi.fn()} {...extra} />);

  it('say they’re reading credits while loading, and offer to retry a failure or nothing at all', async () => {
    await render(loaded<CollaboratorComparison>(undefined, { loading: true }));
    expect(words()).toContain('Reading album credits on MusicBrainz.');
    await act(async () => root!.unmount());
    const retry = vi.fn();
    await render(loaded<CollaboratorComparison>(undefined, { retry }));
    expect(words()).toContain('Could not load collaborators.');
    await click(buttonNamed('Try again'));
    expect(retry).toHaveBeenCalled();
  });

  it('say none share a role, name years, recordings scanned, and offer to scan more of a partial scan', async () => {
    const years = { ...collab, mutual: [{ ...collab.mutual[0], trackCount: { a: 1, b: 2 }, years: { a: { first: '2021', last: '2021' }, b: { first: '2019', last: '2023' } } }],
      coverage: { a: { scanned: 40, total: 90, unit: 'recordings' as const }, b: { ...collab.coverage.b, partial: true } } };
    const retry = vi.fn();
    await render(loaded(years, { retry }));
    for (const expected of ['on 1 track, 2021', 'across 2 tracks, 2019–2023', '40 of Olivia Rodrigo’s recordings']) expect(words()).toContain(expected);
    await click(buttonNamed('Scan more albums'));
    expect(retry).toHaveBeenCalled();
    await act(async () => root!.unmount());
    await render(loaded(collab), { role: 'vocals' });
    expect(words()).toContain('No shared collaborators in this role.');
  });

  it('list people only Genius or Discogs credit, work credited together, and say other sources are loading', async () => {
    const person = (source: 'genius' | 'discogs', id: string, count: number) => ({ source, id, name: `${source} person`, url: `https://${source}.com/${id}`, roles: { a: ['producer'], b: ['producer'] }, count: { a: count, b: count },
      evidence: { a: [{ title: 'Work A', url: `https://${source}.com/a${id}`, year: '' }], b: [{ title: 'Work B', url: `https://${source}.com/b${id}`, year: '' }] } });
    const more: MoreCredits = {
      collaborators: [person('genius', '1', 1), person('discogs', '2', 3)],
      direct: [{ source: 'discogs', title: 'Together', url: 'https://discogs.com/t', year: '' }, { source: 'genius', title: 'Duet', url: 'https://genius.com/d', year: '2020' }],
      sources: [],
    };
    await render(loaded({ ...collab, mutual: [] }), { more: loaded(more, { loading: true }) });
    for (const expected of ['genius person', 'on 1 song', 'discogs person', 'across 3 releases', 'Together · Discogs', 'Duet (2020) · Genius', 'Checking Genius and Discogs for more credits…']) expect(words()).toContain(expected);
  });
});

describe('the comparison table’s last cases', () => {
  it('leaves out a lifespan and genres nobody recorded, and a latest album the same as the first', async () => {
    const bare: ArtistDetails = { ...taylorDetails, lifeSpan: {}, genres: [], tags: [], discography: { ...taylorDetails.discography!, firstYear: '2006', lastYear: '2006' } };
    const undated: ArtistDetails = { ...oliviaDetails, discography: { ...oliviaDetails.discography!, firstYear: '' } };
    await show(<ComparisonDetails kind="artist" a={undated} b={bare} collab={null} role="all" onSelect={vi.fn()} onCompareSongs={vi.fn()} />);
    expect(words()).toContain('Debut album 2006');
    expect(words()).not.toContain('latest 2006');
    expect(words()).not.toContain('Debut album 2021');
  });

  it('opens an artist from a song, and compares the songs a collaborator connects', async () => {
    const onSelect = vi.fn(), onCompareSongs = vi.fn();
    await show(<ComparisonDetails kind="song" a={vampireDetails} b={opheliaDetails} collab={loaded(collab)} role="all" onSelect={onSelect} onCompareSongs={onCompareSongs} />);
    await click(buttonNamed('Olivia Rodrigo ↗'));
    expect(onSelect).toHaveBeenCalledWith({ type: 'artist', id: vampireDetails.artists[0].id });
    await act(async () => root!.unmount());
    const other = { ...collab, mutual: [{ ...collab.mutual[0], tracks: { a: [{ id: 'x1', title: 'One' }], b: [{ id: 'x2', title: 'Two' }] } }] };
    await show(<Collaborators state={loaded(other)} names={['A', 'B']} role="all" onSelect={vi.fn()} onCompareSongs={onCompareSongs} />);
    await click(buttonNamed('Compare “One” and “Two”'));
    expect(onCompareSongs).toHaveBeenCalledWith({ id: 'x1', title: 'One' }, { id: 'x2', title: 'Two' });
  });

  it('notes when another source confirms a collaborator, and lists several pieces of evidence', async () => {
    const serban = collab.mutual[0];
    const evidence = [{ title: 'W1', url: 'https://genius.com/w1', year: '' }, { title: 'W2', url: 'https://genius.com/w2', year: '' }];
    const more: MoreCredits = {
      collaborators: [
        { source: 'genius', id: '9', name: serban.name, url: 'https://genius.com/s', roles: { a: ['mixing'], b: ['mixing'] }, count: { a: 2, b: 2 }, evidence: { a: evidence, b: evidence } },
        { source: 'discogs', id: '8', name: 'Other Person', url: 'https://discogs.com/o', roles: { a: ['producer'], b: ['producer'] }, count: { a: 2, b: 2 }, evidence: { a: evidence, b: evidence } },
      ],
      direct: [], sources: [],
    };
    await show(<Collaborators state={loaded(collab)} names={['A', 'B']} role="all" more={loaded(more)} onSelect={vi.fn()} onCompareSongs={vi.fn()} />);
    expect(words()).toContain('Also on Genius ↗');
    expect(words()).toContain('W1, W2');
  });
});

describe('the song analysis’s last case', () => {
  it('shows a time signature known for one song only', async () => {
    const ok = soundOk as Extract<SoundResult, { status: 'ok' }>;
    const c = { ...ok.comparison, structure: { ...ok.comparison.structure, time_signature: { a: null, b: 3 } } };
    await show(<SongAnalysis sound={{ data: { ...ok, comparison: c }, loading: false, retry: vi.fn() }} songs={[vampireDetails, opheliaDetails]} onPickSimilar={vi.fn()} />);
    expect(words()).toContain('Time signatureUnknown3/4');
  });
});

describe('a collaborator’s name', () => {
  it('opens that collaborator', async () => {
    const onSelect = vi.fn();
    await show(<Collaborators state={loaded(collab)} names={['A', 'B']} role="all" onSelect={onSelect} onCompareSongs={vi.fn()} />);
    await click(buttonNamed(`${collab.mutual[0].name} ↗`));
    expect(onSelect).toHaveBeenCalledWith({ type: 'artist', id: collab.mutual[0].id });
  });
});

describe('artwork', () => {
  it('hides a cover that fails to load, leaving the initials, and looks nothing up for an artist with one', async () => {
    const { ArtistPicture } = await import('../components/Artwork');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await show(<ArtistPicture artist={{ id: 'x', name: 'The Band', artUrl: 'https://coverartarchive.org/x.jpg' }} />);
    const img = host.querySelector('img')!;
    await act(async () => { img.dispatchEvent(new Event('error')); });
    expect(img.hidden).toBe(true);
    expect(words()).toBe('B');
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('the Comparison web’s count', () => {
  it('says “1 artist” when only one is in view', async () => {
    vi.resetModules();
    vi.doMock('../components/ComparisonWebCanvas', () => ({
      ComparisonWebCanvas: ({ onVisibleCount }: { onVisibleCount: (n: number) => void }) => { queueMicrotask(() => onVisibleCount(1)); return null; },
    }));
    vi.doMock('../api', async (original) => {
      const actual = await original<typeof import('../api')>();
      const { oliviaDetails: a, taylorDetails: b, collab: c } = await import('./fixtures');
      return { ...actual, artistDetails: vi.fn(async (id: string) => (id === a.id ? a : b)), collaborators: vi.fn(async () => c), discoverWebArtists: vi.fn(async () => ({ artists: [], failed: [] })) };
    });
    const { ComparisonWeb } = await import('../components/ComparisonWeb');
    const { oliviaDetails: a, taylorDetails: b } = await import('./fixtures');
    const { defaultWeb } = await import('../routing');
    const { emptyProfile: profile } = await import('../profile');
    await show(<ComparisonWeb selection={{ ...defaultWeb(), mode: 'comparison', left: a.id, right: b.id }} onChange={vi.fn()} onSelect={vi.fn()} profile={profile} />);
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(host.querySelector('.web-live-label small')!.textContent).toBe('1 artist');
    vi.doUnmock('../components/ComparisonWebCanvas');
    vi.doUnmock('../api');
  });
});
