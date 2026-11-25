import { describe, expect, it } from 'vitest';
import { decodePlaylist, encodePlaylist, friendLink, layoutTaste, tasteNear } from '../taste';
import type { TasteMap, TasteNode } from '@/lib/types';

const node = (id: string, group: TasteNode['group'], kind: TasteNode['kind'] = 'artist'): TasteNode => ({ kind, id, name: id, subtitle: '', mbid: null, imageUrl: null, group, weight: 1, reasons: [] });
const map = (nodes: TasteNode[]): TasteMap => ({ nodes, links: [], stats: { mineSongs: 0, mineArtists: 0, friendSongs: 0, friendArtists: 0, sharedArtists: 0, sharedSongs: 0, similarLinks: 0 }, sources: [] });

describe('playlists in links', () => {
  it('survive the round trip, including non-Latin text', async () => {
    const playlist = { name: 'Alka', songs: [{ title: '紅蓮華', artist: 'LiSA' }, { title: 'Tití Me Preguntó', artist: 'Bad Bunny' }] };
    expect(await decodePlaylist(await encodePlaylist(playlist))).toEqual(playlist);
  });
  it('stay after the #, so they never reach a server', () => {
    expect(friendLink('https://x.app', 'CODE')).toBe('https://x.app/friends#a=CODE');
  });
  it('reject anything that isn’t a playlist', async () => {
    expect(await decodePlaylist('not a real code!!')).toBeNull();
    expect(await decodePlaylist('')).toBeNull();
  });
});

describe('friend map layout', () => {
  it('puts you left, your friend right, and what you share between', () => {
    const nodes = layoutTaste(map([node('me', 'mine'), node('them', 'theirs'), node('both', 'shared')]), 1200, 600, true);
    const x = (id: string) => nodes.find(n => n.id === id)!.x;
    expect(x('me')).toBeLessThan(x('both'));
    expect(x('both')).toBeLessThan(x('them'));
  });
  it('is the same every time, and keeps cards apart', () => {
    const many = map(Array.from({ length: 40 }, (_, i) => node(`n${i}`, (['mine', 'theirs', 'shared', 'for-me', 'for-them', 'new'] as const)[i % 6], i % 2 ? 'song' : 'artist')));
    const nodes = layoutTaste(many, 1200, 600, true);
    expect(layoutTaste(many, 1200, 600, true)).toEqual(nodes);
    for (let i = 0; i < nodes.length; i++) for (const other of nodes.slice(i + 1)) {
      expect(((nodes[i].x - other.x) / 96) ** 2 + ((nodes[i].y - other.y) / 88) ** 2).toBeGreaterThanOrEqual(.999);
    }
  });
  it('lists what a node connects to', () => {
    expect(tasteNear('a', { ...map([node('a', 'mine'), node('b', 'mine')]), links: [{ from: 'a', to: 'b', kind: 'similar' }] })).toEqual(['b']);
  });
});
