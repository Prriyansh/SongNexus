import {describe, expect, it} from 'vitest';

import {
  distanceFactor,
  layoutSimilar,
  layoutTaste,
  linkedNames,
  nodeOpacity,
  placeDiscovered,
  similarLines,
  zoomCamera,
  type MapNode,
} from './layout';
import {parsePlaylist, toLines} from './playlist';
import {PRESETS, presetsFor} from './presets';

function node(
  id: string,
  similarity: number,
  extra: Partial<MapNode> = {},
): MapNode {
  return {
    id,
    kind: 'ARTIST',
    displayName: id,
    subtitle: '',
    artist: `artists/${id}`,
    recording: null,
    imageUrl: null,
    similarity,
    group: 'SIMILAR',
    weight: 1,
    listeners: null,
    reasons: [],
    sourceUrl: null,
    ...extra,
  };
}

const center = node('center', 1, {group: 'CENTER'});

describe('similar maps', () => {
  it('places the more similar nearer the center', () => {
    const placed = layoutSimilar(
      center,
      [node('far', 0.1), node('near', 0.95)],
      1000,
      600,
    );
    const at = Object.fromEntries(
      placed.map(p => [p.id, Math.hypot(p.x - 500, p.y - 300)]),
    );
    expect(at.center).toBe(0);
    expect(at.near!).toBeLessThan(at.far!);
    expect(distanceFactor(1)).toBeLessThan(distanceFactor(0));
  });

  it('is deterministic and keeps cards apart', () => {
    const nodes = Array.from({length: 30}, (_, i) => node(`a${i}`, 1 - i / 40));
    const one = layoutSimilar(center, nodes, 1000, 600);
    expect(layoutSimilar(center, nodes, 1000, 600)).toEqual(one);
    for (const a of one)
      for (const b of one)
        if (a !== b)
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(40);
  });

  it('shows the closest few always and the rest as you zoom in', () => {
    const [, first, ...rest] = layoutSimilar(
      center,
      Array.from({length: 12}, (_, i) => node(`a${i}`, 1 - i / 20)),
      1000,
      600,
    );
    expect(nodeOpacity(first!, 0.6)).toBe(1);
    const last = rest.at(-1)!;
    expect(nodeOpacity(last, 0.6)).toBe(0);
    expect(nodeOpacity(last, 1)).toBe(1);
  });

  it('draws a spoke to everything and adds the links once', () => {
    const lines = similarLines(
      center,
      [node('a', 0.5), node('b', 0.4)],
      [
        {a: 'a', b: 'b', kind: 'CO_LISTENED', strength: 1},
        {a: 'center', b: 'a', kind: 'CO_LISTENED', strength: 1},
      ],
    );
    expect(lines.map(l => l.kind)).toEqual([
      'SIMILAR',
      'SIMILAR',
      'CO_LISTENED',
    ]);
    expect(
      linkedNames('a', [node('a', 1), node('b', 1)], lines, 'center'),
    ).toEqual(['b']);
  });

  it('places artists found by zooming in around the one they came from', () => {
    const base = layoutSimilar(center, [node('a', 0.9)], 1000, 600);
    const via = base[1]!;
    const {placed, lines} = placeDiscovered(base, [
      {via, zoom: 2, nodes: [node('a', 1), node('x', 0.8), node('y', 0.5)]},
    ]);
    expect(placed.map(p => p.id)).toEqual(['center', 'a', 'x', 'y']);
    expect(lines.map(l => [l.a, l.b])).toEqual([
      ['a', 'x'],
      ['a', 'y'],
    ]);
    const x = placed[2]!;
    expect(Math.hypot(x.x - via.x, x.y - via.y)).toBeLessThan(200);
  });

  it('zooms around the pointer within limits', () => {
    const next = zoomCamera({x: 0, y: 0, zoom: 1}, 2, {x: 100, y: 100});
    expect(next).toEqual({x: -100, y: -100, zoom: 2});
    expect(zoomCamera(next, 100, {x: 0, y: 0}).zoom).toBe(4);
  });
});

describe('playlist maps', () => {
  it('puts you left, your friend right and what you share in the middle', () => {
    const placed = layoutTaste(
      [
        node('mine', 1, {group: 'MINE'}),
        node('theirs', 1, {group: 'THEIRS'}),
        node('shared', 1, {group: 'SHARED'}),
      ],
      1200,
      600,
      true,
    );
    const x = Object.fromEntries(placed.map(p => [p.id, p.x]));
    expect(x.mine!).toBeLessThan(x.shared!);
    expect(x.shared!).toBeLessThan(x.theirs!);
  });
});

describe('reading playlists', () => {
  it('reads "Song - Artist" lines and counts what it skips', () => {
    const {tracks, skipped} = parsePlaylist(
      'pasted.txt',
      'Hit - Zed\nno artist here\n\nB – Bea',
    );
    expect(tracks).toEqual([
      {title: 'Hit', artists: ['Zed']},
      {title: 'B', artists: ['Bea']},
    ]);
    expect(skipped).toBe(1);
    expect(toLines(tracks)).toBe('Hit - Zed\nB - Bea');
  });

  it('reads CSV exports with quoted cells', () => {
    const csv = 'Track Name,Artist Name(s)\n"Hello, World",Zed;Bea\nSolo,';
    const {tracks, skipped} = parsePlaylist('export.csv', csv);
    expect(tracks).toEqual([{title: 'Hello, World', artists: ['Zed']}]);
    expect(skipped).toBe(1);
  });

  it('reads JSON lists', () => {
    const json = JSON.stringify({
      tracks: [{name: 'Hit', artist: 'Zed'}, {title: 'x'}],
    });
    expect(parsePlaylist('p.json', json).tracks).toEqual([
      {title: 'Hit', artists: ['Zed']},
    ]);
  });
});

describe('presets', () => {
  it('offers presets matching your genres first', () => {
    expect(presetsFor(['Hip Hop'])[0]!.id).toBe('hiphop');
    expect(presetsFor([]).map(p => p.id)).toEqual(PRESETS.map(p => p.id));
  });
});
