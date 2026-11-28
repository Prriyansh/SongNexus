// What an account keeps in step across browsers: game results, hidden artists, your Top 5 and the
// connected services. The same checks read it from this browser and from the server. Safe to import
// from client components.
import { GAMES, GAMES_KEY, resultsIn, type GameResults } from "./game-info";
import { connectedIn, SERVICES_KEY, type Connected } from "./services";
import { artistsIn, HIDDEN_KEY, hiddenArtistsIn, MAX_HIDDEN, type Visit } from "./stored";

export const TOP_KEY = "song-nexus-top";
export const MAX_TOP = 5;

/** Your Top 5: the artists you'd name first, in order. */
export const topIn = (raw: string | null) => artistsIn(raw, MAX_TOP);

export type Synced = { games: GameResults; hidden: Visit[]; top: Visit[]; services: Connected[] };

/** Everything synced, read with `read` (this browser's storage, say). */
export function syncedFrom(read: (key: string) => string | null): Synced {
  return {
    games: resultsIn(read(GAMES_KEY)),
    hidden: hiddenArtistsIn(read(HIDDEN_KEY)),
    top: topIn(read(TOP_KEY)),
    services: connectedIn(read(SERVICES_KEY)),
  };
}

/** Synced data sent as JSON, checked the same way. */
export function syncedIn(value: unknown): Synced {
  const body = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const json = (part: unknown) => (part === undefined ? null : JSON.stringify(part));
  return {
    games: resultsIn(json(body.games)),
    hidden: hiddenArtistsIn(json(body.hidden)),
    top: topIn(json(body.top)),
    services: connectedIn(json(body.services)),
  };
}

/** This browser's data with the account's: every result and hidden artist from either, this Top 5 if set. */
export function mergeSynced(local: Synced, saved: Synced): Synced {
  const games = {} as GameResults;
  for (const game of GAMES) {
    games[game] = { ...saved.games[game] };
    for (const [day, result] of Object.entries(local.games[game]))
      games[game][day] = { ...result, submitted: result.submitted || saved.games[game][day]?.submitted === true };
  }
  return {
    games,
    hidden: artistsIn(JSON.stringify([...local.hidden, ...saved.hidden]), MAX_HIDDEN),
    top: local.top.length ? local.top : saved.top,
    services: connectedIn(JSON.stringify([...local.services, ...saved.services])),
  };
}

/** Writes synced data into this browser with `write`, a key at a time. */
export function writeSynced(synced: Synced, write: (key: string, value: unknown) => void) {
  write(GAMES_KEY, synced.games);
  write(HIDDEN_KEY, synced.hidden);
  write(TOP_KEY, synced.top);
  write(SERVICES_KEY, synced.services);
}

export const sameSynced = (a: Synced, b: Synced) => JSON.stringify(a) === JSON.stringify(b);
