// What each source's terms allow Song Nexus to do with its data. This table is the single place
// that decides it: the store, the library queries and the discovery hand-off all ask here, so a
// restricted source can't leak into a feature by accident.
//
// Two classes:
//   open          may be matched to other sources (by ISRC / MusicBrainz id) and used in discovery
//                 features, once the user has agreed ("combine_sources").
//   display_only  shown on its own, labelled with its source, linked back to the provider. Never
//                 matched across services, never used for graphs, taste maps, rankings, statistics
//                 or any model.
//
// When a term is unclear the source is display_only. Changing a class is a legal decision, not a
// code one: read the provider's current terms first, and update docs/integrations/compliance.md.

import type { DataPolicy, DataUse, ProviderId } from "./types";

export const POLICIES: Record<ProviderId, DataPolicy> = {
  spotify: {
    use: "display_only",
    attribution: "Content supplied and made available by Spotify.",
    termsUrl: "https://developer.spotify.com/policy",
    revokeUrl: "https://www.spotify.com/account/apps/",
    rules: [
      "Shown only with a link back to the item on Spotify, and never mixed into lists with other services’ content.",
      "Not used for the Connection Web, Friends maps, comparisons, search ranking, statistics or any derived metric (Developer Policy III.5, III.13).",
      "Never sent to an AI or machine-learning model (III.14). No games or quizzes are built on it (III.2).",
      "Deleted from Song Nexus when you disconnect (I.2).",
    ],
  },
  youtube: {
    use: "display_only",
    refreshWithinDays: 30,
    attribution: "Playlist and video data from YouTube.",
    termsUrl: "https://developers.google.com/youtube/terms/developer-policies",
    revokeUrl: "https://security.google.com/settings/security/permissions",
    rules: [
      "Stored data is refreshed at least every 30 days or deleted (Developer Policies III.E.4), and deleted when you disconnect.",
      "Not aggregated, not combined with other sources, and no new metrics are derived from it (III.E.2, III.E.4.h).",
      "By connecting you agree to the YouTube Terms of Service; Google’s Privacy Policy applies to the data.",
    ],
  },
  "apple-music": {
    use: "display_only",
    attribution: "Library data from Apple Music.",
    termsUrl: "https://developer.apple.com/support/terms/apple-developer-program-license-agreement/",
    revokeUrl: "https://music.apple.com/account/settings",
    rules: [
      "Used only to show your own library to you. Kept separate until the MusicKit terms have been reviewed for anything more.",
      "Deleted from Song Nexus when you disconnect.",
    ],
  },
  lastfm: {
    use: "open",
    attribution: "Scrobbles from Last.fm.",
    termsUrl: "https://www.last.fm/api/tos",
    revokeUrl: "https://www.last.fm/settings/applications",
    rules: [
      "Used with a credit and link to Last.fm. Last.fm’s API terms are for non-commercial use; a commercial deployment needs Last.fm’s agreement.",
      "May be combined with your other open sources if you turn that on.",
    ],
  },
  listenbrainz: {
    use: "open",
    attribution: "Listens from ListenBrainz (open data).",
    termsUrl: "https://listenbrainz.org/terms-of-service/",
    revokeUrl: "https://listenbrainz.org/settings/",
    rules: [
      "ListenBrainz listens are open data. They may be combined with your other open sources if you turn that on.",
    ],
  },
  soundcloud: {
    use: "display_only",
    attribution: "Likes and playlists from SoundCloud.",
    termsUrl: "https://developers.soundcloud.com/docs/api/terms-of-use",
    revokeUrl: "https://soundcloud.com/settings/connections",
    rules: [
      "Shown with a link back to SoundCloud and the uploader’s name.",
      "Not used to train or feed any model, and kept separate from other services until the API Terms of Use have been reviewed for more.",
    ],
  },
  tidal: {
    use: "display_only",
    attribution: "Collection and playlists from TIDAL.",
    termsUrl: "https://developer.tidal.com/documentation/guidelines/guidelines-developer-terms",
    revokeUrl: "https://account.tidal.com/",
    rules: [
      "Shown with a link back to TIDAL. Kept separate from other services until TIDAL’s developer terms have been reviewed for more.",
    ],
  },
  shazam: {
    use: "open",
    attribution: "Your Shazam history, from a file you exported.",
    termsUrl: "https://www.shazam.com/terms",
    rules: ["Only data you export and upload yourself is stored. It is your copy of your own history."],
  },
  deezer: {
    use: "display_only",
    attribution: "Data from Deezer.",
    termsUrl: "https://developers.deezer.com/termsofuse",
    rules: ["No Deezer account data is read: new developer applications can’t currently be registered."],
  },
  "amazon-music": {
    use: "display_only",
    attribution: "Data from Amazon Music.",
    termsUrl: "https://developer.amazon.com/docs/music/API_web_overview.html",
    rules: ["No Amazon Music account data is read: its Web API is a closed beta for approved partners."],
  },
};

/**
 * Uploaded exports. A file from a display-only service keeps that class: importing a Spotify or
 * YouTube export must not become a way around what their API terms restrict.
 */
export const IMPORT_USE: Record<string, DataUse> = {
  "spotify-history": "display_only",
  "spotify-library": "display_only",
  "spotify-playlists": "display_only",
  "youtube-music-history": "display_only",
  "youtube-music-library": "display_only",
  "apple-music-activity": "display_only",
  "apple-music-library": "display_only",
  "listenbrainz-listens": "open",
  "shazam-library": "open",
  generic: "open",
};

/** Sources are named "spotify" for a connection and "import:spotify-history" for an upload. */
export function sourceDataUse(source: string): DataUse {
  if (source.startsWith("import:")) return IMPORT_USE[source.slice(7)] ?? "display_only";
  return (POLICIES as Record<string, DataPolicy | undefined>)[source]?.use ?? "display_only";
}

export const isOpen = (source: string) => sourceDataUse(source) === "open";
export const OPEN_SOURCES = [...Object.entries(POLICIES).filter(([, p]) => p.use === "open").map(([id]) => id), ...Object.entries(IMPORT_USE).filter(([, use]) => use === "open").map(([id]) => `import:${id}`)];

export type FeatureRule = { feature: string; open: "allowed" | "with_consent"; displayOnly: "allowed" | "blocked"; why: string };

/** The compliance matrix, as data: the dashboard shows it and docs/integrations/compliance.md mirrors it. */
export const FEATURE_RULES: FeatureRule[] = [
  { feature: "Show your library, playlists and plays, labelled by source", open: "allowed", displayOnly: "allowed", why: "Displaying a user’s own data back to them, with attribution, is what each API is for." },
  { feature: "Match the same recording across sources (ISRC / MusicBrainz id)", open: "with_consent", displayOnly: "blocked", why: "Spotify III.5 and YouTube III.E.2 forbid combining their content with other services." },
  { feature: "Send tracks to the Connection Web or Friends as a playlist", open: "with_consent", displayOnly: "blocked", why: "Those maps analyse and combine music; Spotify III.13 and YouTube III.E.4.h forbid derived data." },
  { feature: "Rank search results or build a taste profile", open: "with_consent", displayOnly: "blocked", why: "Profiling from Spotify content is forbidden (III.13); not yet built for any source." },
  { feature: "Listening statistics and charts", open: "with_consent", displayOnly: "blocked", why: "New or derived listenership metrics are forbidden for Spotify and YouTube data; not yet built." },
  { feature: "Any AI or machine-learning model", open: "allowed", displayOnly: "blocked", why: "Spotify III.14 forbids it outright. Song Nexus sends no account data to any model." },
  { feature: "Games and quizzes", open: "allowed", displayOnly: "blocked", why: "Spotify III.2. Song Nexus has none built on account data." },
];
