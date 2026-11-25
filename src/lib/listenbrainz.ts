// Listener counts from ListenBrainz, by MusicBrainz id. These count ListenBrainz's own users, a
// small open community, so they're a sign of relative reach rather than an artist's total audience.

import { withCache } from "./musicbrainz";
import { sourceJson } from "./credit-sources";
import type { SourceOptions } from "./credit-sources";
import type { ArtistAudience } from "./types";

const CACHE_MS = 60 * 60_000;

type Row = { artist_mbid?: string; total_listen_count?: number | null; total_user_count?: number | null };

export async function listenBrainzAudience(ids: string[], options: SourceOptions = {}): Promise<Map<string, ArtistAudience["listenBrainz"]>> {
  const rows = await withCache(`listenbrainz:${[...ids].sort().join(",")}`, CACHE_MS, options.useCache ?? true, () =>
    sourceJson<Row[]>("ListenBrainz", "https://api.listenbrainz.org/1/popularity/artist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artist_mbids: ids }),
    }, options));
  const out = new Map<string, ArtistAudience["listenBrainz"]>();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row.artist_mbid || typeof row.total_user_count !== "number") continue;
    out.set(row.artist_mbid, {
      listeners: row.total_user_count,
      listens: row.total_listen_count ?? 0,
      url: `https://listenbrainz.org/artist/${row.artist_mbid}`,
    });
  }
  return out;
}
