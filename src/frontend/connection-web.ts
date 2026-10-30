import type { Artist, ArtistDetails, CollaboratorComparison, DiscoveryReason, RecordingDetails } from '@/lib/types';
import { buildGraph } from './graph';
import type { BuiltGraph } from './graph';
import type { GraphEdge, GraphNode } from './graph-layout';
import { allGenres, genreFamilies } from './genres';
import { artistCover, capitalize } from './model';

const normalize = (tag: string) => tag.toLowerCase().trim().replace(/^jpop$/, 'j-pop').replace(/^kpop$/, 'k-pop');
const styleTags = new Set([...allGenres, 'folk rock', 'j-pop', 'j-rock', 'indie', 'alternative', 'pop punk', 'progressive rock', 'psychedelic rock', 'experimental', 'world', 'disco']);
export const artistTags = (artist: Artist | ArtistDetails) => [...new Set([
  ...('genres' in artist ? artist.genres.map(g => g.name) : []), ...artist.tags.filter(t => styleTags.has(normalize(t))),
].map(normalize))];

// An editorial neighborhood map for discovery, never evidence of a collaboration.
const links = new Map<string, Set<string>>();
function link(a: string, b: string) {
  if (!links.has(a)) links.set(a, new Set());
  if (!links.has(b)) links.set(b, new Set());
  links.get(a)!.add(b); links.get(b)!.add(a);
}
for (const genres of Object.values(genreFamilies)) for (const genre of genres.slice(1)) link(genres[0], genre);
for (const [a, b] of [
  ['folk', 'folk rock'], ['folk rock', 'pop rock'], ['pop rock', 'pop'], ['pop', 'j-pop'],
  ['pop', 'k-pop'], ['folk', 'country'], ['country', 'country pop'], ['country pop', 'pop'],
  ['rock', 'folk rock'], ['rock', 'pop rock'], ['rock', 'heavy metal'], ['rock', 'blues'],
  ['blues', 'jazz'], ['jazz', 'soul'], ['soul', 'r&b'], ['r&b', 'hip hop'], ['r&b', 'pop'],
  ['pop', 'electronic'], ['pop', 'latin pop'], ['latin pop', 'reggaeton'],
  ['electronic', 'classical'], ['afrobeats', 'r&b'], ['reggae', 'soul'],
]) link(a, b);

function shortest(start: string, end: string, neighbors: (id: string) => string[]): string[] {
  const queue = [[start]], seen = new Set([start]);
  for (let i = 0; i < queue.length; i++) {
    const path = queue[i], last = path[path.length - 1];
    if (last === end) return path;
    for (const next of neighbors(last)) if (!seen.has(next)) { seen.add(next); queue.push([...path, next]); }
  }
  return [];
}

const primaryGenre = (tags: string[]) => tags.find(t => ['j-pop', 'k-pop'].includes(t)) ?? tags[0];

/** Content scope follows stylistic distance, independently of credit/path availability. */
export function genreJourney(a: string[], b?: string[]): string[] {
  const left = a.map(normalize), right = b?.map(normalize);
  const start = primaryGenre(left), end = right && primaryGenre(right);
  if (!start) return end ? [end] : [];
  if (!end) return [...new Set([start, ...left.slice(1, 3), ...[...(links.get(start) ?? [])].slice(0, 2)])].slice(0, 4);
  const path = shortest(start, end, id => [...(links.get(id) ?? [])]);
  // Unknown catalog tags can still guide both endpoint neighborhoods without inventing a bridge.
  return path.length ? path : [...new Set([start, ...left.slice(1, 2), ...right!.slice(1, 2), end])];
}

/** Semantic zoom changes the catalog scope, never avatar size. */
export function discoveryGenres(a: string[], b: string[] | undefined, level: number): string[] {
  const base = genreJourney(a, b);
  if (level < 0) return [...new Set([primaryGenre(a), primaryGenre(b ?? [])].filter((g): g is string => !!g))];
  if (!level) return base;
  const result = [...base];
  let frontier = [...base];
  const limit = level === 1 ? Math.max(8, base.length + 3) : 12;
  for (let distance = 0; distance < level && result.length < limit; distance++) {
    const next: string[] = [];
    const neighbors = frontier.map(genre => [...(links.get(genre) ?? [])]);
    const longest = Math.max(0, ...neighbors.map(list => list.length));
    for (let i = 0; i < longest && result.length < limit; i++) for (const list of neighbors) {
      const genre = list[i];
      if (genre && !result.includes(genre) && result.length < limit) { result.push(genre); next.push(genre); }
    }
    frontier = next;
  }
  return result;
}

export const similarityTo = (tags: string[], reference: string[]) => {
  const overlap = tags.filter(t => reference.includes(t)).length;
  return overlap / Math.max(1, new Set([...tags, ...reference]).size);
};

export type DiscoveryArtist = Artist & { neighborhood: string; reasons?: DiscoveryReason[]; originId?: string; focus?: { x: number; y: number }; discoveryZoom?: number };
export type DiscoveryFocus = { artistId: string; x: number; y: number };

/** Append discoveries without evicting earlier points or overwriting their placement origin. */
export function mergeDiscoveryArtists(previous: DiscoveryArtist[], incoming: DiscoveryArtist[]): DiscoveryArtist[] {
  const merged = new Map(previous.map(a => [a.id, a]));
  for (const artist of incoming) {
    const old = merged.get(artist.id);
    if (!old && merged.size >= 120) continue;
    const reasons = [...(old?.reasons ?? []), ...(artist.reasons ?? [])];
    merged.set(artist.id, { ...artist, ...old, country: old?.country || artist.country,
      tags: [...new Set([...(old?.tags ?? []), ...artist.tags])],
      reasons: reasons.filter((r, i) => reasons.findIndex(x => x.kind === r.kind && x.text === r.text && x.relatedTo === r.relatedTo) === i),
    });
  }
  return [...merged.values()];
}
export type WebSource =
  | { mode: 'comparison'; a: ArtistDetails; b: ArtistDetails; collab?: CollaboratorComparison }
  | { mode: 'search'; song: RecordingDetails; lead?: ArtistDetails };

export type WebGraph = BuiltGraph & { journey: string[]; pathType: 'credits' | null };

export function buildConnectionWeb(source: WebSource, discovered: DiscoveryArtist[], journey: string[], narrow = false): WebGraph {
  let nodes: GraphNode[], edges: GraphEdge[], anchors: string[], path: string[] = [];
  let pathType: WebGraph['pathType'] = null;
  const tags = new Map<string, string[]>();
  if (source.mode === 'comparison') {
    const base = buildGraph({ kind: 'artist', a: source.a, b: source.b, collab: source.collab, role: 'all' }, [], narrow);
    nodes = base.nodes.filter(n => n.role || base.path.includes(n.id)); edges = base.edges.filter(e => e.category === 'factual' && e.onPath); anchors = [source.a.id, source.b.id]; path = base.path;
    if (path.length) pathType = 'credits';
    const allowed = ['member of band', 'collaboration', 'supporting musician', 'conductor', 'founder'];
    const direct = [source.a, source.b].flatMap(a => (a.relationships ?? []).filter(r => allowed.includes(r.type) && anchors.includes(r.artist.id))
      .map(r => ({ from: a.id, to: r.artist.id, category: 'factual' as const, label: r.type,
        detail: `${a.name} and ${r.artist.name}: ${r.type}${r.end ? ` (ended ${r.end})` : ''}.`,
        sourceUrls: [`https://musicbrainz.org/artist/${a.id}`], onPath: true })));
    if (direct.length) { path = anchors; edges = direct.slice(0, 1); pathType = 'credits'; }
    if (!path.length) {
      const shared = (source.a.relationships ?? []).find(r => r.type === 'member of band' && source.b.relationships?.some(b => b.type === 'member of band' && b.artist.id === r.artist.id));
      if (shared) {
        const a = shared.artist;
        nodes.push({ id: a.id, entityType: 'artist', label: a.name, subtitle: source.a.type === 'Person' ? 'Shared band' : 'Shared member', x: 0, y: 0 });
        path = [anchors[0], a.id, anchors[1]]; pathType = 'credits';
        edges = [source.a, source.b].map(artist => ({ from: artist.id, to: a.id, category: 'factual', label: 'Member of band',
          detail: `Documented membership linking ${artist.name} and ${a.name}.`, sourceUrls: [`https://musicbrainz.org/artist/${artist.id}`], onPath: true }));
      }
    }
    tags.set(source.a.id, artistTags(source.a)); tags.set(source.b.id, artistTags(source.b));
  } else {
    const { song, lead } = source;
    anchors = song.artists.flatMap(a => a.id ? [a.id] : []);
    nodes = song.artists.flatMap(artist => artist.id ? [{ id: artist.id, entityType: 'artist' as const, label: artist.name,
      subtitle: lead?.id === artist.id ? capitalize(artistTags(lead)[0] ?? 'Performer') : 'Credited performer',
      role: 'Comparison anchor', artUrl: lead?.id === artist.id ? artistCover(lead) : song.representative?.artUrl, x: 0, y: 0,
    }] : []);
    edges = [];
    if (lead) tags.set(lead.id, artistTags(lead));
    for (const artist of nodes) if (artist.id !== lead?.id) tags.set(artist.id, song.genres.map(g => normalize(g.name)));
  }
  const existing = new Set(nodes.map(n => n.id));
  // Keep the cache complete; the canvas samples its visible detail separately.
  for (const artist of discovered) {
    if (existing.has(artist.id) || nodes.length >= 124) continue;
    existing.add(artist.id); tags.set(artist.id, artistTags(artist));
    nodes.push({ id: artist.id, entityType: 'artist', label: artist.name,
      subtitle: artist.reasons?.[0]?.text || capitalize(artist.neighborhood),
      detail: artist.reasons?.map(r => r.text).join(' · '), discoveryAnchor: artist.originId, discoveryGenre: artist.neighborhood, discoveryFocus: artist.focus, discoveryZoom: artist.discoveryZoom, x: 0, y: 0 });
  }
  // Similarity decides which artists are visible. Only the documented path
  // between the selected artists gets lines; surrounding artists stay unlinked.

  // Lay out a spaced, gently winding spine. Context nodes occupy style columns
  // on both sides, including unconnected artists between distant selections.
  const columns = Math.max(3, journey.length, path.length);
  const pitch = narrow ? 170 : 240, margin = 100;
  const width = (columns - 1) * pitch + margin * 2;
  const spine = path.length ? path : anchors;
  const positioned = new Map<string, { x: number; y: number }>();
  spine.forEach((id, i) => positioned.set(id, { x: margin + (spine.length === 1 ? (columns - 1) / 2 : i * (columns - 1) / (spine.length - 1)) * pitch, y: 260 + (i % 2 ? 28 : -28) }));
  const occupancy = Array.from({ length: columns }, () => 0);
  let contextIndex = 0;
  for (const node of nodes) {
    if (positioned.has(node.id)) continue;
    const context = discovered.find(a => a.id === node.id);
    const desired = context ? journey.length <= 1 ? contextIndex++ % columns : Math.round(journey.indexOf(context.neighborhood) * (columns - 1) / (journey.length - 1)) : Math.floor((columns - 1) / 2);
    // Fill the neighboring style columns before adding another distant row.
    const column = occupancy.map((count, i) => ({ i, cost: Math.floor(count / 2) * columns * 2 + Math.abs(i - desired) + count % 2 * .1 }))
      .sort((a, b) => a.cost - b.cost || a.i - b.i)[0].i;
    const slot = occupancy[column]++;
    positioned.set(node.id, { x: margin + column * pitch + (slot % 2 ? 20 : -18), y: slot % 2 ? 430 + Math.floor(slot / 2) * 152 : 90 - Math.floor(slot / 2) * 152 });
  }
  const minY = Math.min(0, ...[...positioned.values()].map(p => p.y - 75));
  const height = Math.max(520, ...[...positioned.values()].map(p => p.y + 85)) - minY;
  return { nodes: nodes.map(n => ({ ...n, discoveryGenre: n.discoveryGenre || tags.get(n.id)?.[0], ...positioned.get(n.id)!, y: positioned.get(n.id)!.y - minY })), edges,
    width, height, nodeWidth: 132, expandable: [], path, pathType, journey };
}

const artistSeed = (id: string) => {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) / 4294967296;
};

/** A deterministic, scattered 2D world; artist cards stay the same pixel size. */
export function positionWebInViewport(graph: WebGraph, width: number, height: number, previous: GraphNode[] = []): GraphNode[] {
  const spine = graph.path.length ? graph.path : graph.nodes.filter(n => n.role).map(n => n.id);
  const left = Math.max(82, width * .2), right = Math.max(left, width - left), center = (height - 60) / 2;
  const positions = new Map<string, { x: number; y: number }>(previous.map(n => [n.id, { x: n.x, y: n.y }]));
  const visible = new Set(graph.nodes.map(n => n.id));
  for (const id of positions.keys()) if (!visible.has(id)) positions.delete(id);
  spine.forEach((id, i) => positions.set(id, {
    x: positions.get(id)?.x ?? (spine.length === 1 ? width / 2 : left + i * (right - left) / (spine.length - 1)),
    y: positions.get(id)?.y ?? center + (spine.length > 2 && i % 2 ? 47 : -20 + artistSeed(id) * 25),
  }));
  // Stable ID order prevents catalog result order from rearranging the same set.
  const context = graph.nodes.filter(n => !positions.has(n.id)).sort((a, b) => a.id.localeCompare(b.id));
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  // Reserve compact positions for detail points even while the overview hides them.
  for (const node of context) {
    const resolution = Math.max(1, node.discoveryZoom ?? 1);
    const clearanceX = graph.nodeWidth / resolution, clearanceY = 124 / resolution;
    const seed = artistSeed(node.id), angle = seed * Math.PI * 2;
    const genre = graph.journey.findIndex(g => g.toLowerCase() === node.subtitle.toLowerCase());
    const t = graph.journey.length > 1 && genre >= 0 ? genre / (graph.journey.length - 1) : seed;
    const origin = (node.discoveryFocus ?? (node.discoveryAnchor && positions.get(node.discoveryAnchor)))
      || { x: spine.length === 1 ? width / 2 : left + t * (right - left), y: center };
    let best: { x: number; y: number; cost: number } | undefined;
    for (let attempt = 0; attempt < 480; attempt++) {
      const theta = angle + attempt * goldenAngle;
      const radius = ((node.discoveryFocus ? 65 : 95) + seed * 60 + Math.floor(attempt / 24) * 22) / resolution;
      const point = { x: origin.x + Math.cos(theta) * radius * 1.22, y: origin.y + Math.sin(theta) * radius };
      // Leave room for both the avatar and its labels, without introducing rows.
      if ([...positions.values()].some(p => ((p.x - point.x) / clearanceX) ** 2 + ((p.y - point.y) / clearanceY) ** 2 < 1)) continue;
      const overflow = Math.max(0, 76 - point.x) + Math.max(0, point.x - width + 76)
        + Math.max(0, 70 - point.y) + Math.max(0, point.y - height + 95);
      const cost = overflow * 3 + radius + attempt * .12;
      if (!best || cost < best.cost) best = { ...point, cost };
    }
    // Extra discoveries live outside the initial viewport and remain reachable by panning.
    positions.set(node.id, best ?? { x: origin.x + 900 + positions.size * 165, y: origin.y });
  }
  return graph.nodes.map(node => ({ ...node, ...positions.get(node.id)! }));
}
