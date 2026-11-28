// The listening services Library can read by username, and the ones connected in this browser.
// Safe to import from client components.

export const SERVICES = ["listenbrainz", "lastfm", "deezer"] as const;
export type Service = (typeof SERVICES)[number];
export const isService = (value: string): value is Service => (SERVICES as readonly string[]).includes(value);

export const SERVICE_INFO: Record<Service, { name: string; user: string; hint: string; profile: (user: string) => string }> = {
  listenbrainz: {
    name: "ListenBrainz",
    user: "ListenBrainz username",
    hint: "Your most played artists of all time.",
    profile: (user) => `https://listenbrainz.org/user/${encodeURIComponent(user)}/`,
  },
  lastfm: {
    name: "Last.fm",
    user: "Last.fm username",
    hint: "Your most played artists of all time.",
    profile: (user) => `https://www.last.fm/user/${encodeURIComponent(user)}`,
  },
  deezer: {
    name: "Deezer",
    user: "Deezer profile number (the digits in your profile’s link)",
    hint: "The artists you follow, if your profile is public.",
    profile: (user) => `https://www.deezer.com/profile/${user}`,
  },
};

/** Usernames as each service allows them (Deezer's are numbers). */
const USER: Record<Service, RegExp> = {
  listenbrainz: /^[\w.-]{1,64}$/,
  lastfm: /^[A-Za-z][\w.-]{1,31}$/,
  deezer: /^\d{1,15}$/,
};
export const isUser = (service: Service, user: string) => USER[service].test(user);

export const SERVICES_KEY = "song-nexus-services";
export const MAX_CONNECTED = 6;
export type Connected = { service: Service; user: string };

/** The services connected in this browser, each once. */
export function connectedIn(raw: string | null): Connected[] {
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : [];
  } catch {
    parsed = [];
  }
  const seen = new Set<string>();
  const out: Connected[] = [];
  for (const item of Array.isArray(parsed) ? parsed : []) {
    const { service, user } = (item ?? {}) as Record<string, unknown>;
    if (typeof service !== "string" || !isService(service) || typeof user !== "string" || !isUser(service, user)) continue;
    if (seen.has(`${service}:${user}`)) continue;
    seen.add(`${service}:${user}`);
    out.push({ service, user });
  }
  return out.slice(0, MAX_CONNECTED);
}
