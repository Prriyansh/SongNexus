// An artist's top track, for the "Explore track comparison" shortcut.
//
// MusicBrainz has no popularity data, so the ranking comes from Deezer's public API (no key
// needed). Deezer is only used to pick *which* song; the song itself is then matched to a
// MusicBrainz recording so the song comparison stays on MusicBrainz data. No Deezer numbers
// (fans, plays) are shown anywhere.

import { findRecording, UpstreamError, type RequestOptions } from "./musicbrainz";
import type { TopTrack } from "./types";

const DEEZER_BASE = "https://api.deezer.com";
const DEEZER_TIMEOUT_MS = 8_000;
/** How many of Deezer's top tracks to try matching before giving up. */
const CANDIDATES = 3;

type DeezerArtist = { id?: unknown; name?: unknown; nb_fan?: unknown };
type DeezerTrack = { title?: unknown };

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[’']/g, "'").trim();

async function deezerJson(path: string, fetchImpl: typeof fetch): Promise<{ data?: unknown[]; error?: unknown }> {
  let response: Response;
  try {
    response = await fetchImpl(`${DEEZER_BASE}${path}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(DEEZER_TIMEOUT_MS),
    });
  } catch {
    throw new UpstreamError("Could not reach Deezer to find top tracks.", 502, true);
  }
  if (!response.ok) {
    throw new UpstreamError(`Deezer returned an error (${response.status}).`, 502, response.status >= 500);
  }
  const body = (await response.json().catch(() => ({}))) as { data?: unknown[]; error?: unknown };
  // Deezer reports quota errors inside a 200 response.
  if (body.error) throw new UpstreamError("Deezer is busy right now. Please try again in a moment.", 503, true);
  return body;
}

/**
 * The artist's most popular track that also exists on MusicBrainz, or null when there's no
 * confident match (no Deezer artist with exactly this name, or none of its top songs matched).
 */
export async function findTopTrack(
  artist: { id: string; name: string },
  options: RequestOptions = {}
): Promise<TopTrack | null> {
  const fetchImpl = options.fetchImpl ?? fetch;

  // Exact (case-insensitive) name match only: a loose match can pick a different act with a
  // similar name. If several share the name, the one with the most fans is the likely intent.
  const search = await deezerJson(`/search/artist?q=${encodeURIComponent(artist.name)}&limit=10`, fetchImpl);
  const match = ((search.data ?? []) as DeezerArtist[])
    .filter((d) => typeof d?.name === "string" && norm(d.name) === norm(artist.name))
    .sort((x, y) => Number(y.nb_fan ?? 0) - Number(x.nb_fan ?? 0))[0];
  if (!match || match.id == null) return null;

  const top = await deezerJson(`/artist/${encodeURIComponent(String(match.id))}/top?limit=${CANDIDATES}`, fetchImpl);
  for (const track of (top.data ?? []) as DeezerTrack[]) {
    if (typeof track?.title !== "string") continue;
    const recording = await findRecording(artist.id, track.title, options);
    if (recording) return { ...recording, source: "Deezer" };
  }
  return null;
}
