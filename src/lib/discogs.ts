// Album credits from Discogs, found through the artist link MusicBrainz already holds, so there's
// no guessing by name. Credits are CC0 under Discogs' API terms. Works without a token at a lower
// rate limit (25 requests a minute); DISCOGS_TOKEN raises it to 60.

import { withCache } from "./musicbrainz";
import { addCredit, creditRole, normalizeName, scanInOrder, sourceJson } from "./credit-sources";
import type { SourcedPeople, SourceOptions } from "./credit-sources";

const BASE = "https://api.discogs.com";
const ALBUMS = 10;
const BUDGET_MS = 15_000;
const CACHE_MS = 24 * 60 * 60_000;
const SPACING_MS = { token: 1_100, anonymous: 2_600 };

type RawCredit = { id?: number; name?: string; role?: string; resource_url?: string };
type RawRelease = { id?: number; title?: string; year?: number; uri?: string; extraartists?: RawCredit[]; tracklist?: { extraartists?: RawCredit[] }[] };
type RawListing = { releases?: { type?: string; role?: string; title?: string; main_release?: number; year?: number }[] };

/** "Dan Nigro (2)": Discogs' number separates people who share a name; it isn't part of the name. */
const cleanName = (name: string) => name.replace(/\s\(\d+\)$/, "");

export type DiscogsCredits = { people: SourcedPeople; scanned: number; complete: boolean };

/** `albumTitles`: the artist's studio albums per MusicBrainz. Discogs' list doesn't separate them from singles. */
export async function discogsCredits(artistId: string, albumTitles: string[], options: SourceOptions = {}): Promise<DiscogsCredits> {
  const env = options.env ?? process.env;
  const token = env.DISCOGS_TOKEN?.trim();
  const headers: Record<string, string> = token ? { Authorization: `Discogs token=${token}` } : {};
  const useCache = options.useCache ?? true;
  const get = <T>(path: string) => withCache(`discogs:${path}`, CACHE_MS, useCache, () => sourceJson<T>("Discogs", `${BASE}${path}`, { headers }, options));

  const listing = await get<RawListing>(`/artists/${encodeURIComponent(artistId)}/releases?sort=year&sort_order=desc&per_page=100`);
  // A master groups a record's editions; its main release is the one Discogs treats as the reference.
  const albums = new Set(albumTitles.map(normalizeName));
  const isAlbum = (title = "") => albums.has(normalizeName(title));
  const masters = (listing.releases ?? [])
    .filter((r) => r.type === "master" && r.role === "Main" && r.main_release)
    .sort((x, y) => Number(isAlbum(y.title)) - Number(isAlbum(x.title))) // stable: newest first within each
    .slice(0, ALBUMS);
  const people: SourcedPeople = new Map();
  const spacing = options.throttleMs ?? (token ? SPACING_MS.token : SPACING_MS.anonymous);
  const { scanned, complete } = await scanInOrder(masters, options.budgetMs ?? BUDGET_MS, spacing, async (master) => {
    const release = await get<RawRelease>(`/releases/${master.main_release}`);
    const work = { title: release.title ?? "Untitled release", url: release.uri ?? `https://www.discogs.com/release/${master.main_release}`, year: String(release.year || master.year || "") };
    const credits = [...(release.extraartists ?? []), ...(release.tracklist ?? []).flatMap((t) => t.extraartists ?? [])];
    for (const credit of credits) {
      if (!credit.id) continue;
      addCredit(people, String(credit.id), cleanName(credit.name ?? ""), `https://www.discogs.com/artist/${credit.id}`, creditRole(credit.role ?? ""), work);
    }
  });
  return { people, scanned, complete };
}
