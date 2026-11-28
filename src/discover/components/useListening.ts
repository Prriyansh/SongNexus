import { useEffect, useMemo, useState } from "react";
import { listening, type Listened } from "../api";
import { connectedIn, SERVICES_KEY, type Connected } from "../lib/services";
import { useStored } from "./useStored";

export type Heard = { artists: Listened[] } | { error: string };
export const keyOf = (c: Connected) => `${c.service}:${c.user}`;

/** The services connected in this browser and what each says is played most, read on each change. */
export function useListening(): { connected: Connected[]; heard: Record<string, Heard> } {
  const raw = useStored(SERVICES_KEY);
  const connected = useMemo(() => connectedIn(raw), [raw]);
  const key = connected.map(keyOf).join("|");
  const [heard, setHeard] = useState<{ key: string; by: Record<string, Heard> }>({ key: "", by: {} });

  useEffect(() => {
    const controller = new AbortController();
    const keep = (c: Connected, result: Heard) =>
      setHeard((h) => ({ key, by: { ...(h.key === key ? h.by : {}), [keyOf(c)]: result } }));
    for (const c of connected)
      listening(c.service, c.user, controller.signal)
        .then(({ artists }) => keep(c, { artists }))
        .catch((error: Error) => {
          if (!controller.signal.aborted) keep(c, { error: error.message });
        });
    return () => controller.abort();
    // `key` stands for the connected services.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { connected, heard: heard.key === key ? heard.by : {} };
}

/** A listener's artists in the catalog: their Top 5, the most played (each service in turn), then favourites. */
export function myArtists(connected: Connected[], heard: Record<string, Heard>, favourites: string[], top: string[] = []): string[] {
  const lists = connected.map((c) => {
    const found = heard[keyOf(c)];
    return found && "artists" in found ? found.artists.flatMap((a) => (a.artist ? [a.artist.id] : [])) : [];
  });
  const played: string[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let i = 0; i < longest; i++) for (const list of lists) if (list[i]) played.push(list[i]);
  return [...new Set([...top, ...played, ...favourites])];
}
