// Everything beyond credits for a two-artist comparison: bio, awards, labels, audience, and what
// the two have in common. Each source can fail alone; its report says so and the rest still shows.

import { lookupMusicBrainz } from "./musicbrainz";
import { normalizeName } from "./credit-sources";
import type { SourceOptions } from "./credit-sources";
import { lastFmAudience, lastFmKey, lastFmSimilar } from "./lastfm";
import { listenBrainzAudience } from "./listenbrainz";
import { artistFacts } from "./wikidata";
import type { ArtistDetails, ArtistFacts, ArtistInsights, SimilarArtist, SourceReport, WikiLabelled } from "./types";

/** Entries on both lists, once each, using the first list's name and most recent year. */
export function sharedEntries(a: WikiLabelled[], b: WikiLabelled[]): WikiLabelled[] {
  const inB = new Set(b.map((item) => item.id));
  return [...new Map(a.filter((item) => inB.has(item.id)).reverse().map((item) => [item.id, item])).values()].reverse();
}

export function sharedSimilar(a: SimilarArtist[], b: SimilarArtist[], excludeIds: string[]): SimilarArtist[] {
  const key = (artist: SimilarArtist) => artist.mbid ?? normalizeName(artist.name);
  const inB = new Set(b.map(key));
  return a.filter((artist) => inB.has(key(artist)) && !(artist.mbid && excludeIds.includes(artist.mbid)));
}

const settled = <T>(result: PromiseSettledResult<T>, fallback: T, source: string): T => {
  if (result.status === "fulfilled") return result.value;
  console.warn(`[insights] ${source} failed:`, result.reason);
  return fallback;
};

export async function artistInsights(aId: string, bId: string, options: SourceOptions = {}): Promise<ArtistInsights> {
  const [a, b] = await Promise.all([
    lookupMusicBrainz({ type: "artist", id: aId }) as Promise<ArtistDetails>,
    lookupMusicBrainz({ type: "artist", id: bId }) as Promise<ArtistDetails>,
  ]);
  const key = lastFmKey(options.env ?? process.env);
  const wikidataFor = (artist: ArtistDetails) => artist.externalIds?.wikidata ? artistFacts(artist.externalIds.wikidata, options) : Promise.resolve(null);
  const [factsA, factsB, listenBrainz, fmA, fmB, simA, simB] = await Promise.allSettled([
    wikidataFor(a),
    wikidataFor(b),
    listenBrainzAudience([aId, bId], options),
    key ? lastFmAudience(aId, key, options) : Promise.resolve(null),
    key ? lastFmAudience(bId, key, options) : Promise.resolve(null),
    key ? lastFmSimilar(aId, key, options) : Promise.resolve([]),
    key ? lastFmSimilar(bId, key, options) : Promise.resolve([]),
  ]);

  const failed = (...results: PromiseSettledResult<unknown>[]) => results.some((r) => r.status === "rejected");
  const facts: [ArtistFacts | null, ArtistFacts | null] = [settled(factsA, null, "Wikidata"), settled(factsB, null, "Wikidata")];
  const lb = settled(listenBrainz, new Map(), "ListenBrainz");
  const sources: SourceReport[] = [
    { source: "Wikidata", status: failed(factsA, factsB) ? "failed" : facts[0] && facts[1] ? "ok" : "no-match" },
    { source: "ListenBrainz", status: failed(listenBrainz) ? "failed" : "ok" },
    { source: "Last.fm", status: !key ? "no-key" : failed(fmA, fmB, simA, simB) ? "failed" : "ok" },
  ];
  return {
    a: { id: aId, facts: facts[0], audience: { listenBrainz: lb.get(aId) ?? null, lastFm: settled(fmA, null, "Last.fm") } },
    b: { id: bId, facts: facts[1], audience: { listenBrainz: lb.get(bId) ?? null, lastFm: settled(fmB, null, "Last.fm") } },
    shared: {
      awards: sharedEntries(facts[0]?.awards ?? [], facts[1]?.awards ?? []),
      labels: sharedEntries(facts[0]?.labels ?? [], facts[1]?.labels ?? []),
      similarArtists: sharedSimilar(settled(simA, [], "Last.fm"), settled(simB, [], "Last.fm"), [aId, bId]),
    },
    sources,
  };
}
