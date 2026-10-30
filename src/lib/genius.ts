// Song credits from Genius: producers, writers, features and other performers on an artist's most
// popular songs. Needs GENIUS_ACCESS_TOKEN (free). Only credits are read, never lyrics.

import { withCache } from "./musicbrainz";
import { addCredit, creditRole, normalizeName, sourceJson } from "./credit-sources";
import type { SourcedPeople, SourceOptions } from "./credit-sources";

const BASE = "https://api.genius.com";
const SONGS = 30;
const BATCH = 4;
const BUDGET_MS = 15_000;
const CACHE_MS = 24 * 60 * 60_000;

type RawArtist = { id?: number; name?: string; url?: string };
type RawSong = {
  id?: number;
  title?: string;
  url?: string;
  release_date?: string | null;
  primary_artist?: RawArtist;
  producer_artists?: RawArtist[];
  writer_artists?: RawArtist[];
  featured_artists?: RawArtist[];
  custom_performances?: { label?: string; artists?: RawArtist[] }[];
};

export type GeniusCredits = { artistId: string; people: SourcedPeople; scanned: number; complete: boolean };

const slugOf = (url = "") => url.match(/\/artists\/([^/?#]+)/)?.[1]?.toLowerCase();

/**
 * The artist on Genius: the one MusicBrainz links to when it has a link, otherwise an exact name
 * match. A near match could be someone else, so anything less counts as not found.
 */
function pickArtist(hits: { result?: { primary_artist?: RawArtist } }[], name: string, slug?: string): RawArtist | null {
  const artists = hits.flatMap((hit) => (hit.result?.primary_artist ? [hit.result.primary_artist] : []));
  if (slug) return artists.find((a) => slugOf(a.url) === slug.toLowerCase()) ?? null;
  return artists.find((a) => normalizeName(a.name ?? "") === normalizeName(name)) ?? null;
}

/** Null when Genius has no artist we can be sure of. */
export async function geniusCredits(artist: { name: string; slug?: string }, token: string, options: SourceOptions = {}): Promise<GeniusCredits | null> {
  const headers = { Authorization: `Bearer ${token}` };
  const useCache = options.useCache ?? true;
  const get = <T>(path: string) => withCache(`genius:${path}`, CACHE_MS, useCache, async () =>
    (await sourceJson<{ response?: T }>("Genius", `${BASE}${path}`, { headers }, options)).response as T);

  const search = await get<{ hits?: { result?: { primary_artist?: RawArtist } }[] }>(`/search?q=${encodeURIComponent(artist.name)}`);
  const found = pickArtist(search.hits ?? [], artist.name, artist.slug);
  if (!found?.id) return null;

  const listing = await get<{ songs?: RawSong[] }>(`/artists/${found.id}/songs?sort=popularity&per_page=${SONGS}`);
  const songs = (listing.songs ?? []).filter((song) => song.id && song.primary_artist?.id === found.id);
  const people: SourcedPeople = new Map();
  const deadline = Date.now() + (options.budgetMs ?? BUDGET_MS);
  let scanned = 0;
  let complete = true;
  for (let i = 0; i < songs.length; i += BATCH) {
    if (scanned > 0 && Date.now() > deadline) { complete = false; break; }
    const results = await Promise.allSettled(songs.slice(i, i + BATCH).map((song) => get<{ song?: RawSong }>(`/songs/${song.id}?text_format=plain`)));
    for (const result of results) {
      if (result.status === "rejected" || !result.value.song) { complete = false; continue; }
      const song = result.value.song;
      const work = { title: song.title ?? "Untitled song", url: song.url ?? "", year: (song.release_date ?? "").slice(0, 4) };
      const add = (people_: RawArtist[] | undefined, role: string | null) => {
        for (const p of people_ ?? []) {
          if (p.id && p.id !== found.id) addCredit(people, String(p.id), p.name ?? "", p.url ?? "", role, work);
        }
      };
      add(song.producer_artists, "producer");
      add(song.writer_artists, "songwriting");
      add(song.featured_artists, "featured");
      for (const performance of song.custom_performances ?? []) add(performance.artists, creditRole(performance.label ?? ""));
      scanned++;
    }
    if (scanned === 0 && results.every((r) => r.status === "rejected")) throw (results[0] as PromiseRejectedResult).reason;
  }
  return { artistId: String(found.id), people, scanned, complete };
}
