// Builds the connection web from what the API returns: the two selections, the people credited
// on both artists' recent albums (/api/musicbrainz/collaborators), and shared MusicBrainz genres.
// Factual edges are credits; the dashed similarity edge is only shared genre tags.
import type { ArtistDetails, Collaborator, CollaboratorComparison, RecordingDetails, TrackRef } from '@/lib/types';
import { partitionGenres } from '@/lib/types';
import { layoutComparison, presentEdges } from './graph-layout';
import type { ComparisonGraph, GraphEdge, GraphNode } from './graph-layout';
import { artistCover, capitalize, musicBrainzUrl, roleText, songArtists } from './model';
import type { EntityType } from './types';

export type GraphInput =
  | { kind: 'artist'; a: ArtistDetails; b: ArtistDetails; collab?: CollaboratorComparison; role: string }
  | { kind: 'song'; a: RecordingDetails; b: RecordingDetails; collab?: CollaboratorComparison; role: string };

export type BuiltGraph = ComparisonGraph & { path: string[] };

type Named = { id: string; name: string };
const FIRST_COLLABORATORS = 5;
const MORE_COLLABORATORS = 4;
const TRACKS_PER_SIDE = 2;

const node = (id: string, entityType: EntityType, label: string, subtitle: string, extra: Partial<GraphNode> = {}): GraphNode =>
  ({ id, entityType, label, subtitle, x: 0, y: 0, ...extra });
const titles = (tracks: TrackRef[]) => tracks.slice(0, 3).map(t => `“${t.title}”`).join(', ');
const trackUrls = (tracks: TrackRef[]) => tracks.slice(0, 3).map(t => musicBrainzUrl('recording', t.id));

export const matchesRole = (c: Collaborator, role: string) =>
  role === 'all' || c.roles.a.includes(role) || c.roles.b.includes(role);

/** The primary credited artist of each song, when the two songs are by different artists. */
export function songArtistPair(a: RecordingDetails, b: RecordingDetails): [Named, Named] | null {
  const pa = a.artists.find(x => x.id), pb = b.artists.find(x => x.id);
  if (!pa?.id || !pb?.id || pa.id === pb.id) return null;
  if (a.artists.some(x => x.id && b.artists.some(y => y.id === x.id))) return null;
  return [{ id: pa.id, name: pa.name }, { id: pb.id, name: pb.name }];
}

/** Adds the collaborators linking artists a and b; returns what's visible and what can expand. */
function addCollaborators(nodes: GraphNode[], records: GraphEdge[], a: Named, b: Named, collab: CollaboratorComparison, role: string, expanded: string[], moreFrom: string[]) {
  const mutual = collab.mutual.filter(c => matchesRole(c, role));
  const extra = expanded.filter(id => moreFrom.includes(id)).length;
  const shown = mutual.slice(0, FIRST_COLLABORATORS + MORE_COLLABORATORS * extra);
  for (const c of shown) {
    nodes.push(node(c.id, 'artist', c.name, roleText([...new Set([...c.roles.a, ...c.roles.b])]), { contributor: true }));
    for (const [side, artist] of [['a', a], ['b', b]] as const) {
      records.push({
        from: artist.id, to: c.id, category: 'factual', label: roleText(c.roles[side]), relationshipId: `${c.id}:${side}`,
        detail: `${c.name} is credited (${roleText(c.roles[side]).toLowerCase()}) on ${c.trackCount[side]} of ${artist.name}’s scanned tracks, including ${titles(c.tracks[side])}.`,
        sourceUrls: trackUrls(c.tracks[side]),
      });
      // "Show more" on a collaborator reveals the songs that connect them.
      if (expanded.includes(c.id)) for (const track of c.tracks[side].slice(0, TRACKS_PER_SIDE)) {
        if (!nodes.some(n => n.id === track.id)) nodes.push(node(track.id, 'song', track.title, artist.name));
        records.push({ from: c.id, to: track.id, category: 'factual', label: roleText(c.roles[side]), relationshipId: `${c.id}:${track.id}`, detail: `${c.name} on “${track.title}” by ${artist.name}.`, sourceUrls: [musicBrainzUrl('recording', track.id)] });
      }
    }
  }
  let direct = false;
  if (role === 'all' || role === 'featured') {
    for (const [tracks, host, guest] of [[collab.direct.bOnA, a, b], [collab.direct.aOnB, b, a]] as const) {
      if (!tracks.length) continue;
      direct = true;
      records.push({ from: a.id, to: b.id, category: 'factual', label: 'Credited together', relationshipId: `direct:${host.id}`, detail: `${guest.name} is credited on ${host.name}’s ${titles(tracks)}.`, sourceUrls: trackUrls(tracks) });
    }
  }
  return {
    direct,
    first: shown[0],
    expandable: [...(mutual.length > shown.length ? moreFrom : []), ...shown.filter(c => !expanded.includes(c.id)).map(c => c.id)],
  };
}

function genreEdge(a: Named & { genres: { name: string; count: number }[] }, b: typeof a): GraphEdge | null {
  const shared = partitionGenres(a.genres, b.genres).shared;
  if (!shared.length) return null;
  return { from: a.id, to: b.id, category: 'similarity', label: 'Shared genres', score: shared.length, detail: `Both are tagged ${shared.slice(0, 4).map(capitalize).join(', ')} on MusicBrainz. Shared tags describe style; they don’t mean the two worked together.` };
}

export function buildGraph(input: GraphInput, expanded: string[], narrow: boolean): BuiltGraph {
  const nodes: GraphNode[] = [];
  const records: GraphEdge[] = [];
  const anchors = [input.a.id, input.b.id];
  let path: string[] = [];
  let expandable: string[] = [];

  if (input.kind === 'artist') {
    const { a, b } = input;
    for (const artist of [a, b]) nodes.push(node(artist.id, 'artist', artist.name, capitalize(artist.genres[0]?.name || artist.type || 'Artist'), { role: 'Comparison anchor', artUrl: artistCover(artist) }));
    if (input.collab) {
      const found = addCollaborators(nodes, records, a, b, input.collab, input.role, expanded, anchors);
      path = found.direct ? anchors : found.first ? [a.id, found.first.id, b.id] : [];
      expandable = found.expandable;
    }
    const similar = genreEdge(a, b);
    if (similar) records.push(similar);
  } else {
    const { a, b } = input;
    for (const song of [a, b]) nodes.push(node(song.id, 'song', song.title, songArtists(song), { role: 'Comparison anchor', artUrl: song.representative?.artUrl }));
    for (const song of [a, b]) for (const artist of song.artists) {
      if (!artist.id) continue;
      if (!nodes.some(n => n.id === artist.id)) nodes.push(node(artist.id, 'artist', artist.name, 'Artist'));
      records.push({ from: song.id, to: artist.id, category: 'factual', label: 'Performed by', relationshipId: `${song.id}:${artist.id}`, detail: `${artist.name} is credited on “${song.title}”.`, sourceUrls: [musicBrainzUrl('recording', song.id)] });
    }
    const shared = a.artists.find(x => x.id && b.artists.some(y => y.id === x.id));
    const pair = songArtistPair(a, b);
    if (shared?.id) path = [a.id, shared.id, b.id];
    else if (pair && input.collab) {
      const found = addCollaborators(nodes, records, pair[0], pair[1], input.collab, input.role, expanded, anchors);
      const middle = found.direct ? [] : found.first ? [found.first.id] : null;
      if (middle) path = [a.id, pair[0].id, ...middle, pair[1].id, b.id];
      expandable = found.expandable;
    }
    const similar = genreEdge({ id: a.id, name: a.title, genres: a.genres }, { id: b.id, name: b.title, genres: b.genres });
    if (similar) records.push(similar);
  }

  const edges = presentEdges(records, anchors, path, expanded);
  return { ...layoutComparison(nodes, edges, anchors, path, narrow), expandable, path };
}
