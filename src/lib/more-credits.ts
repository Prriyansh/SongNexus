// Collaborators of two artists according to sources other than MusicBrainz. One source failing or
// having no token only removes its results, and its report says why.

import { lookupMusicBrainz } from "./musicbrainz";
import { commonPeople } from "./credit-sources";
import type { SourcedPeople, SourceOptions } from "./credit-sources";
import { discogsCredits } from "./discogs";
import { geniusCredits } from "./genius";
import type { ArtistDetails, CreditEvidence, CreditSource, MoreCredits, SourcedCollaborator, SourceReport } from "./types";

type Found = { collaborators: SourcedCollaborator[]; direct: (CreditEvidence & { source: CreditSource })[]; report: SourceReport };

/** Work where one artist appears in the other's credits. */
function directWork(source: CreditSource, a: SourcedPeople, b: SourcedPeople, aId?: string, bId?: string) {
  const work = [...(bId ? a.get(bId)?.work.values() ?? [] : []), ...(aId ? b.get(aId)?.work.values() ?? [] : [])];
  return [...new Map(work.map((w) => [w.url, { ...w, source }])).values()].slice(0, 6);
}

async function fromDiscogs(a: ArtistDetails, b: ArtistDetails, options: SourceOptions): Promise<Found> {
  const ida = a.externalIds?.discogs, idb = b.externalIds?.discogs;
  if (!ida || !idb) return { collaborators: [], direct: [], report: { source: "Discogs", status: "no-match" } };
  // One after the other: both artists share Discogs' per-minute limit.
  const ca = await discogsCredits(ida, a.discography?.studioTitles ?? [], options);
  const cb = await discogsCredits(idb, b.discography?.studioTitles ?? [], options);
  return {
    collaborators: commonPeople("discogs", ca.people, cb.people, [ida, idb]),
    direct: directWork("discogs", ca.people, cb.people, ida, idb),
    report: { source: "Discogs", status: ca.complete && cb.complete ? "ok" : "partial", scanned: { a: ca.scanned, b: cb.scanned }, unit: "albums" },
  };
}

async function fromGenius(a: ArtistDetails, b: ArtistDetails, options: SourceOptions): Promise<Found> {
  const token = (options.env ?? process.env).GENIUS_ACCESS_TOKEN?.trim();
  if (!token) return { collaborators: [], direct: [], report: { source: "Genius", status: "no-key" } };
  const [ca, cb] = await Promise.all([
    geniusCredits({ name: a.name, slug: a.externalIds?.genius }, token, options),
    geniusCredits({ name: b.name, slug: b.externalIds?.genius }, token, options),
  ]);
  if (!ca || !cb) return { collaborators: [], direct: [], report: { source: "Genius", status: "no-match" } };
  return {
    collaborators: commonPeople("genius", ca.people, cb.people, [ca.artistId, cb.artistId]),
    direct: directWork("genius", ca.people, cb.people, ca.artistId, cb.artistId),
    report: { source: "Genius", status: ca.complete && cb.complete ? "ok" : "partial", scanned: { a: ca.scanned, b: cb.scanned }, unit: "songs" },
  };
}

export async function moreCredits(aId: string, bId: string, options: SourceOptions = {}): Promise<MoreCredits> {
  const [a, b] = await Promise.all([
    lookupMusicBrainz({ type: "artist", id: aId }) as Promise<ArtistDetails>,
    lookupMusicBrainz({ type: "artist", id: bId }) as Promise<ArtistDetails>,
  ]);
  const names = ["Genius", "Discogs"];
  const results = await Promise.allSettled([fromGenius(a, b, options), fromDiscogs(a, b, options)]);
  const found = results.map((result, i): Found => {
    if (result.status === "fulfilled") return result.value;
    console.warn(`[credits] ${names[i]} failed:`, result.reason);
    return { collaborators: [], direct: [], report: { source: names[i], status: "failed" } };
  });
  return {
    collaborators: found.flatMap((f) => f.collaborators),
    direct: found.flatMap((f) => f.direct),
    sources: found.map((f) => f.report),
  };
}
