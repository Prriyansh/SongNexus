// A path between two artists as a playlist: one real song per step.
import type { EntityRef, FoundPath } from "./types";

/** The first song of each step that has one, each song once. */
export function playlistOf(path: FoundPath): EntityRef[] {
  const songs = new Map<string, EntityRef>();
  for (const step of path.steps) {
    const own = step.reasons.map((r) => r.subject).filter((s) => s?.kind === "song");
    const song = own.find((s) => !songs.has(s!.id));
    if (song) songs.set(song.id, song);
  }
  return [...songs.values()];
}

/** "Artist - Title" lines, the form playlist importers read. */
export function playlistText(songs: EntityRef[]): string {
  return songs.map((song) => `${song.note} - ${song.name}`).join("\n");
}
