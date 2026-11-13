// Each adapter against responses shaped like its provider's published schema (field names and
// nesting taken from the OpenAPI specs and API references named in each adapter). These pin our
// reading of the contract. They are not evidence that a live integration works: no adapter has been
// run against its real service from this repository.
import { createHash, createVerify, generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../../db";
import { completeAuthorization, beginAuthorization, connectWithToken, listConnections } from "../connections";
import { enqueue } from "../jobs";
import { POLICIES } from "../policy";
import { appleDeveloperToken } from "../providers/apple-music";
import { lastfmSignature } from "../providers/lastfm";
import { isoDurationMs } from "../providers/shared";
import { adapters, describe as describeProvider, describeAll } from "../registry";
import { runWorker } from "../sync";
import { CAPABILITIES, PROVIDER_IDS } from "../types";
import type { Handler } from "./helpers";
import { connect, deps, fakeFetch, freshDb, makeUser, reply, TEST_ENV } from "./helpers";

let db: Db;
beforeAll(async () => { db = await freshDb(); });
afterAll(async () => { await db.close(); });

type Options = Parameters<typeof connect>[4];
async function synced(provider: string, handler: Handler, options: Options = {}, env: Record<string, string> = TEST_ENV) {
  const user = await makeUser(db);
  const api = fakeFetch(handler);
  const connection = await connect(db, user, provider, api.fetchImpl, options);
  await enqueue(db, { id: connection, userId: user }, "initial");
  await runWorker(db, { budgetMs: 60_000, userId: user, deps: { ...deps(api.fetchImpl), env } });
  const library = await db.query<{ relation: string; period: string; position: number | null; kind: string; provider_id: string; title: string; artists: string[]; album: string | null; duration_ms: number | null; isrc: string | null; mbid: string | null; url: string | null; added_at: Date | null }>(
    `SELECT li.relation, li.period, li.position, pe.kind, pe.provider_id, pe.title, pe.artists, pe.album, pe.duration_ms, pe.isrc, pe.mbid, pe.url, li.added_at
     FROM library_items li JOIN provider_entities pe ON pe.id = li.entity_id WHERE li.connection_id = $1 ORDER BY li.relation, li.period, li.position, pe.title`, [connection]);
  const plays = await db.query<{ title: string; artists: string[]; played_at: Date; mbid: string | null; isrc: string | null }>(
    "SELECT pe.title, pe.artists, le.played_at, pe.mbid, pe.isrc FROM listening_events le JOIN provider_entities pe ON pe.id = le.entity_id WHERE le.connection_id = $1 ORDER BY le.played_at", [connection]);
  const playlists = await db.query<{ name: string; owned: boolean; tracks: string[] }>(
    `SELECT p.name, p.owned, COALESCE((SELECT jsonb_agg(pe.title ORDER BY pi.position) FROM playlist_items pi JOIN provider_entities pe ON pe.id = pi.entity_id WHERE pi.playlist_id = p.id), '[]'::jsonb) AS tracks
     FROM playlists p WHERE p.connection_id = $1 ORDER BY p.name`, [connection]);
  const playing = await db.query<{ title: string }>("SELECT pe.title FROM now_playing np JOIN provider_entities pe ON pe.id = np.entity_id WHERE np.connection_id = $1", [connection]);
  const [view] = await listConnections(db, user);
  return { user, connection, api, library, plays, playlists, playing, view };
}

describe("registry", () => {
  it("describes every provider with every capability, a policy and an honest live-test flag", () => {
    const all = describeAll(TEST_ENV);
    expect(all.map((p) => p.id)).toEqual([...PROVIDER_IDS]);
    for (const p of all) {
      expect(Object.keys(p.capabilities).sort()).toEqual([...CAPABILITIES].sort());
      expect(p.policy).toBe(POLICIES[p.id]);
      expect(p.liveTested).toBe(false);
      expect(p.availabilityNote.length).toBeGreaterThan(20);
      // Whatever isn't supported says why.
      for (const [name, c] of Object.entries(p.capabilities)) if (!c.supported && name !== "native_only" && name !== "manual_import") expect(c.note, `${p.id}.${name}`).toBeTruthy();
    }
  });

  it("never offers a sign-in for a provider that can't complete one", () => {
    for (const a of adapters()) {
      if (a.blocked) {
        expect(a.authorize, a.id).toBeUndefined();
        expect(a.connectWithToken, a.id).toBeUndefined();
        expect(a.resources, a.id).toEqual([]);
        expect(a.auth).toBe("none");
      } else {
        expect(Boolean(a.authorize && a.handleCallback) || Boolean(a.connectWithToken), a.id).toBe(true);
        expect(a.capabilities(null).sync_supported.supported, a.id).toBe(true);
      }
    }
    const byId = Object.fromEntries(describeAll(TEST_ENV).map((p) => [p.id, p.availability]));
    expect(byId).toMatchObject({ shazam: "import_only", deezer: "unsupported", "amazon-music": "partner_access_required", listenbrainz: "available", spotify: "available", "apple-music": "not_configured" });
  });

  it("reports missing credentials without leaking variable names in production, and needs an encryption key", () => {
    const spotify = adapters().find((a) => a.id === "spotify")!;
    const dev = describeProvider(spotify, { NODE_ENV: "development" });
    expect(dev).toMatchObject({ availability: "not_configured" });
    expect(dev.availabilityNote).toContain("SPOTIFY_CLIENT_ID");
    const production = describeProvider(spotify, { NODE_ENV: "production", INTEGRATIONS_ENCRYPTION_KEY: TEST_ENV.INTEGRATIONS_ENCRYPTION_KEY });
    expect(production.availabilityNote).not.toContain("SPOTIFY_CLIENT_ID");
    expect(describeProvider(spotify, { NODE_ENV: "production", SPOTIFY_CLIENT_ID: "x" }).availability).toBe("not_configured");
    // ListenBrainz needs no developer credentials at all.
    expect(describeProvider(adapters().find((a) => a.id === "listenbrainz")!, { NODE_ENV: "development" }).availability).toBe("available");
  });

  it("does not claim what the providers don't offer", () => {
    const caps = Object.fromEntries(describeAll(TEST_ENV).map((p) => [p.id, p.capabilities]));
    expect(caps.youtube.recent_history.supported).toBe(false);
    expect(caps.youtube.library.supported).toBe(false);
    expect(caps.youtube.now_playing.supported).toBe(false);
    expect(caps.tidal.recent_history.supported).toBe(false);
    expect(caps["apple-music"].now_playing.supported).toBe(false);
    expect(caps.shazam.native_only.supported).toBe(true);
    expect(caps.shazam.sync_supported.supported).toBe(false);
    expect(caps.spotify.recent_history.note).toMatch(/last 50 plays/);
    for (const id of ["shazam", "deezer", "amazon-music"]) expect(caps[id].profile.supported).toBe(false);
  });
});

describe("Spotify (February 2026 response shapes)", () => {
  it("reads `items.total` and `item` from playlists, skips episodes and local files, and stores no ISRC", async () => {
    const t = (id: string, extra = {}) => ({ id, type: "track", name: `T ${id}`, duration_ms: 1000, artists: [{ name: "A" }, { name: "B" }], album: { name: "Al", images: [] }, external_urls: { spotify: `https://open.spotify.com/track/${id}` }, external_ids: { isrc: "USRC17607839" }, ...extra });
    const r = await synced("spotify", ({ url }) => {
      const p = decodeURIComponent(url.pathname);
      if (p === "/v1/me/tracks") return reply({ items: [{ added_at: "2024-02-02T00:00:00Z", track: t("a") }, { added_at: "2024-02-02T00:00:00Z", track: t("local", { is_local: true }) }], next: null });
      if (p === "/v1/me/albums") return reply({ items: [{ added_at: "2023-01-01T00:00:00Z", album: { id: "al1", name: "Album One", artists: [{ name: "A" }], images: [{ url: "https://i.scdn.co/a" }] } }], next: null });
      if (p === "/v1/me/following") return reply({ artists: { items: [], cursors: {} } });
      if (p === "/v1/me/playlists") return reply({ items: [{ id: "p", name: "New shape", owner: { id: "me" }, snapshot_id: "v1", items: { href: "x", total: 2 } }], next: null });
      if (p === "/v1/playlists/p/items") return reply({ items: [{ added_at: "2024-01-01T00:00:00Z", item: t("b") }, { added_at: null, item: { id: "ep", type: "episode", name: "A podcast" } }], next: null });
      if (p === "/v1/me/top/tracks") return reply({ items: url.searchParams.get("time_range") === "short_term" ? [t("top1"), t("top2")] : [] });
      if (p === "/v1/me/top/artists") return reply({ items: [] });
      if (p === "/v1/me/player/recently-played") return reply({ items: [{ played_at: "2024-06-01T12:00:00.123Z", track: t("a") }], cursors: { after: "1", before: "0" } });
      if (p === "/v1/me/player/currently-playing") return reply({ is_playing: true, currently_playing_type: "track", item: t("now") });
      return undefined;
    });
    expect(r.library.filter((l) => l.relation === "saved").map((l) => [l.kind, l.provider_id])).toEqual([["album", "al1"], ["track", "a"]]);
    expect(r.library.find((l) => l.provider_id === "a")).toMatchObject({ artists: ["A", "B"], album: "Al", url: "https://open.spotify.com/track/a", isrc: null });
    expect(r.library.filter((l) => l.relation === "top").map((l) => [l.period, l.position, l.provider_id])).toEqual([["short_term", 1, "top1"], ["short_term", 2, "top2"]]);
    expect(r.playlists).toEqual([{ name: "New shape", owned: true, tracks: ["T b"] }]);
    expect(r.plays.map((p) => p.played_at.toISOString())).toEqual(["2024-06-01T12:00:00.123Z"]);
    expect(r.playing).toEqual([{ title: "T now" }]);
    expect(r.api.paths().filter((p) => p.includes("/top/"))).toHaveLength(6);
    expect(r.api.paths().some((p) => p.includes("/tracks?") && p.includes("/playlists/"))).toBe(false);
  });
});

describe("YouTube", () => {
  const video = (id: string, title: string, categoryId: string, channel = "Artist - Topic") => ({ id, snippet: { title, channelTitle: channel, categoryId, thumbnails: { medium: { url: "https://i.ytimg.com/vi/x/mqdefault.jpg" } } }, contentDetails: { duration: "PT3M21S" } });

  it("requests offline access with PKCE and only the read-only scope, and sends the client secret to the token endpoint only", async () => {
    const user = await makeUser(db);
    const url = new URL(await beginAuthorization(db, user, "youtube", "https://app.example", { env: TEST_ENV }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ scope: "https://www.googleapis.com/auth/youtube.readonly", access_type: "offline", prompt: "consent", code_challenge_method: "S256", client_id: "google-client" });
    expect(url.href).not.toContain("google-secret");
    const api = fakeFetch(({ url: u, body }) => {
      if (u.href === "https://oauth2.googleapis.com/token") { expect(new URLSearchParams(body).get("client_secret")).toBe("google-secret"); return reply({ access_token: "ya29", refresh_token: "1//r", expires_in: 3599, scope: "https://www.googleapis.com/auth/youtube.readonly" }); }
      if (u.pathname === "/youtube/v3/channels") return reply({ items: [{ id: "UC123", snippet: { title: "Ada's channel" } }] });
      return undefined;
    });
    const view = await completeAuthorization(db, user, "youtube", new URLSearchParams({ code: "4/abc", state: url.searchParams.get("state")! }), deps(api.fetchImpl));
    expect(view).toMatchObject({ displayName: "Ada's channel", profileUrl: "https://www.youtube.com/channel/UC123" });
  });

  it("follows page tokens, keeps liked videos in the Music category only, and drops deleted videos", async () => {
    const r = await synced("youtube", ({ url }) => {
      const q = url.searchParams;
      if (url.pathname === "/youtube/v3/playlists") return reply({ items: [{ id: "PL1", etag: "e1", snippet: { title: "Road trip", channelTitle: "Ada", thumbnails: {} }, contentDetails: { itemCount: 3 } }] });
      if (url.pathname === "/youtube/v3/playlistItems") {
        return q.get("pageToken") === "p2"
          ? reply({ items: [{ snippet: { title: "Second", videoOwnerChannelTitle: "Band - Topic", publishedAt: "2024-01-02T00:00:00Z", resourceId: { videoId: "v2" } }, contentDetails: { videoId: "v2" } }] })
          : reply({ nextPageToken: "p2", items: [
            { snippet: { title: "First", videoOwnerChannelTitle: "Singer - Topic", publishedAt: "2024-01-01T00:00:00Z" }, contentDetails: { videoId: "v1" } },
            { snippet: { title: "Deleted video" }, contentDetails: { videoId: "gone" } },
          ] });
      }
      if (url.pathname === "/youtube/v3/videos") return reply({ items: [video("m1", "A song", "10"), video("c1", "A cooking video", "26", "Chef")] });
      return undefined;
    });
    expect(r.playlists).toEqual([{ name: "Road trip", owned: true, tracks: ["First", "Second"] }]);
    expect(r.library.map((l) => [l.relation, l.title, l.artists, l.duration_ms, l.url])).toEqual([["favorite", "A song", ["Artist"], 201000, "https://music.youtube.com/watch?v=m1"]]);
    expect(r.api.paths().filter((p) => p.includes("playlistItems")).map((p) => new URLSearchParams(p.split("?")[1]).get("pageToken"))).toEqual([null, "p2"]);
    expect(r.view.status).toBe("connected");
  });

  it("treats an account without a channel as having no playlists, and a spent daily quota as a rate limit", async () => {
    const none = await synced("youtube", ({ url }) => {
      if (url.pathname === "/youtube/v3/playlists") return reply({ error: { code: 404, message: "Channel not found.", errors: [{ reason: "channelNotFound" }] } }, 404);
      if (url.pathname === "/youtube/v3/videos") return reply({ items: [] });
      return undefined;
    });
    expect(none.view.status).toBe("connected");
    const quota = await synced("youtube", () => reply({ error: { code: 403, message: "The request cannot be completed because you have exceeded your quota.", errors: [{ reason: "quotaExceeded" }] } }, 403));
    expect(quota.view.job).toMatchObject({ status: "queued" });
    expect(Date.parse(quota.view.job!.runAfter!)).toBeGreaterThan(Date.now() + 50 * 60_000);
    expect(quota.view.status).not.toBe("error");
  });

  it("parses ISO 8601 durations", () => {
    expect(isoDurationMs("PT2M58S")).toBe(178000);
    expect(isoDurationMs("PT1H2M3S")).toBe(3723000);
    expect(isoDurationMs("P1DT1S")).toBe(86401000);
    expect(isoDurationMs("")).toBeUndefined();
    expect(isoDurationMs("nonsense")).toBeUndefined();
  });
});

describe("Apple Music", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const env = { ...TEST_ENV, APPLE_MUSIC_TEAM_ID: "TEAM123456", APPLE_MUSIC_KEY_ID: "KEY1234567", APPLE_MUSIC_PRIVATE_KEY: (privateKey.export({ type: "pkcs8", format: "pem" }) as string).replace(/\n/g, "\\n") };

  it("signs an ES256 developer token Apple can verify, with the team as issuer and a short life", () => {
    const now = Date.UTC(2026, 0, 1);
    const token = appleDeveloperToken(env, now);
    const [header, payload, signature] = token.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEY1234567" });
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    expect(claims).toEqual({ iss: "TEAM123456", iat: now / 1000, exp: now / 1000 + 12 * 3600 });
    expect(createVerify("SHA256").update(`${header}.${payload}`).verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"))).toBe(true);
    expect(appleDeveloperToken(env, now + 1000)).toBe(token);
    expect(appleDeveloperToken(env, now + 13 * 3600_000)).not.toBe(token);
    expect(() => appleDeveloperToken({ ...env, APPLE_MUSIC_PRIVATE_KEY: "not a key" })).toThrow(/couldn’t be read/);
  });

  it("verifies the Music User Token against the storefront before storing it", async () => {
    const user = await makeUser(db);
    const api = fakeFetch(({ url, headers }) => {
      if (url.pathname !== "/v1/me/storefront") return undefined;
      expect(headers.get("authorization")).toMatch(/^Bearer ey/);
      return headers.get("music-user-token") === "good-user-token" ? reply({ data: [{ id: "gb", type: "storefronts", attributes: { name: "United Kingdom" } }] }) : reply({ errors: [{ status: "401" }] }, 401);
    });
    await expect(connectWithToken(db, user, "apple-music", { musicUserToken: "bad" }, { ...deps(api.fetchImpl), env })).rejects.toMatchObject({ status: 400 });
    await expect(connectWithToken(db, user, "apple-music", {}, { ...deps(api.fetchImpl), env })).rejects.toMatchObject({ status: 400 });
    const view = await connectWithToken(db, user, "apple-music", { musicUserToken: "good-user-token" }, { ...deps(api.fetchImpl), env });
    expect(view.displayName).toBe("Apple Music (United Kingdom)");
  });

  it("follows `next` links through the library and keeps recently played as an ordered list, not as plays", async () => {
    const song = (id: string, name: string) => ({ id, type: "library-songs", attributes: { name, artistName: "Artist", albumName: "Album", durationInMillis: 180000, dateAdded: "2023-05-05T00:00:00Z", artwork: { url: "https://is1-ssl.mzstatic.com/x/{w}x{h}bb.jpg" } } });
    const r = await synced("apple-music", ({ url, headers }) => {
      expect(headers.get("music-user-token")).toBe("access-1");
      const p = decodeURIComponent(url.pathname);
      if (p === "/v1/me/library/songs") return url.searchParams.get("offset") === "100" ? reply({ data: [song("i.2", "Two")] }) : reply({ data: [song("i.1", "One")], next: "/v1/me/library/songs?offset=100" });
      if (p === "/v1/me/library/albums" || p === "/v1/me/library/artists") return reply({ data: [] });
      if (p === "/v1/me/library/playlists") return reply({ data: [{ id: "p.1", attributes: { name: "Gym", canEdit: true, lastModifiedDate: "2024-01-01T00:00:00Z", description: { standard: "Lifting" } } }] });
      if (p === "/v1/me/library/playlists/p.1/tracks") return reply({ data: [song("i.1", "One")] });
      if (p === "/v1/me/recent/played/tracks") return reply({ data: [song("i.9", "Latest"), song("i.1", "One")] });
      if (p === "/v1/me/history/heavy-rotation") return reply({ data: [{ id: "l.1", type: "library-albums", attributes: { name: "Heavy", artistName: "Artist" } }, { id: "pl.x", type: "playlists", attributes: { name: "A playlist" } }] });
      return undefined;
    }, {}, env);
    expect(r.library.filter((l) => l.relation === "saved").map((l) => [l.title, l.album, l.duration_ms])).toEqual([["One", "Album", 180000], ["Two", "Album", 180000]]);
    expect(r.library.filter((l) => l.relation === "recent").map((l) => [l.position, l.title])).toEqual([[1, "Latest"], [2, "One"]]);
    expect(r.library.filter((l) => l.relation === "top").map((l) => [l.period, l.kind, l.title])).toEqual([["heavy-rotation", "album", "Heavy"]]);
    expect(r.plays).toEqual([]);
    expect(r.playlists).toEqual([{ name: "Gym", owned: true, tracks: ["One"] }]);
  });

  it("surfaces a lapsed subscription or expired user token as an account that can't be read", async () => {
    const r = await synced("apple-music", () => reply({ errors: [{ status: "403", title: "Forbidden", detail: "Invalid authentication" }] }, 403), {}, env);
    expect(r.view.status).toBe("error");
    expect(r.view.lastError).toMatch(/Apple Music refused access/);
  });
});

describe("Last.fm", () => {
  it("signs requests the way the API documents: sorted name+value pairs, then the secret, as MD5", () => {
    // md5("api_keyxxxxxxxxmethodauth.getSessiontokenyyyyyy" + "mysecret")
    expect(lastfmSignature({ method: "auth.getSession", token: "yyyyyy", api_key: "xxxxxxxx", format: "json" }, "mysecret")).toBe(createHash('md5').update('api_keyxxxxxxxxmethodauth.getSessiontokenyyyyyymysecret').digest('hex'));
    expect(lastfmSignature({ b: "2", a: "1" }, "s")).toBe(lastfmSignature({ a: "1", b: "2" }, "s"));
    // The value itself, computed independently: md5("a1b2s").
    expect(lastfmSignature({ a: "1", b: "2" }, "s")).toBe(createHash("md5").update("a1b2s").digest("hex"));
  });

  it("sends the user to Last.fm with the state in the callback address, then trades the token for a session", async () => {
    const user = await makeUser(db);
    const url = new URL(await beginAuthorization(db, user, "lastfm", "https://app.example", { env: TEST_ENV }));
    expect(url.origin + url.pathname).toBe("https://www.last.fm/api/auth/");
    expect(url.searchParams.get("api_key")).toBe("lastfm-key");
    const cb = new URL(url.searchParams.get("cb")!);
    expect(cb.origin + cb.pathname).toBe("https://app.example/api/integrations/lastfm/callback");
    const api = fakeFetch(({ url: u }) => {
      const q = u.searchParams;
      if (q.get("method") !== "auth.getSession") return undefined;
      expect(q.get("api_sig")).toBe(lastfmSignature({ method: "auth.getSession", api_key: "lastfm-key", token: "lfm-token" }, "lastfm-secret"));
      return reply({ session: { name: "AdaFM", key: "session-key-123", subscriber: 0 } });
    });
    const view = await completeAuthorization(db, user, "lastfm", new URLSearchParams({ token: "lfm-token", state: cb.searchParams.get("state")! }), deps(api.fetchImpl));
    expect(view).toMatchObject({ displayName: "AdaFM", profileUrl: "https://www.last.fm/user/AdaFM" });
    const [row] = await db.query<{ credentials: string }>("SELECT credentials FROM connections WHERE id = $1", [view.id]);
    expect(row.credentials).not.toContain("session-key-123");
  });

  const scrobble = (name: string, artist: string, uts?: number, extra = {}) => ({ name, artist: { "#text": artist, mbid: "" }, album: { "#text": "LP", mbid: "" }, mbid: "", url: `https://www.last.fm/music/${artist}/_/${name}`, ...(uts ? { date: { uts: String(uts), "#text": "x" } } : {}), ...extra });

  it("pages the whole history against a fixed end time, separates now-playing from plays, and continues from the last sync", async () => {
    const pages: Record<string, unknown> = {
      1: { recenttracks: { track: [scrobble("Live", "Band", undefined, { "@attr": { nowplaying: "true" } }), scrobble("B", "Band", 1700000300), scrobble("A", "Band", 1700000200)], "@attr": { page: "1", totalPages: "2", total: "3" } } },
      // A single remaining scrobble comes back as an object, not a list.
      2: { recenttracks: { track: scrobble("A", "Band", 1700000100, { mbid: "f8f0b5a6-0b0b-4b0b-8b0b-0b0b0b0b0b0b" }), "@attr": { page: "2", totalPages: "2", total: "3" } } },
    };
    const handler: Handler = ({ url }) => {
      const q = url.searchParams;
      expect(q.get("sk")).toBe("sk-1");
      expect(q.get("api_sig")).toMatch(/^[0-9a-f]{32}$/);
      if (q.get("method") === "user.getRecentTracks") return reply(pages[q.get("page")!] ?? { recenttracks: { track: [], "@attr": { totalPages: "0" } } });
      if (q.get("method") === "user.getLovedTracks") return reply({ lovedtracks: { track: [{ name: "A", artist: { name: "Band", mbid: "" }, date: { uts: "1690000000" }, url: "https://www.last.fm/music/Band/_/A" }], "@attr": { totalPages: "1" } } });
      if (q.get("method") === "user.getTopTracks") return reply({ toptracks: { track: q.get("period") === "overall" ? [{ name: "A", artist: { name: "Band" }, duration: "215", "@attr": { rank: "1" } }] : [] } });
      if (q.get("method") === "user.getTopArtists") return reply({ topartists: { artist: q.get("period") === "overall" ? [{ name: "Band", mbid: "", url: "https://www.last.fm/music/Band" }] : [] } });
      return undefined;
    };
    const r = await synced("lastfm", handler, { extra: { username: "AdaFM", sessionKey: "sk-1" } });
    expect(r.plays.map((p) => [p.title, p.played_at.toISOString()])).toEqual([["A", "2023-11-14T22:15:00.000Z"], ["A", "2023-11-14T22:16:40.000Z"], ["B", "2023-11-14T22:18:20.000Z"]]);
    expect(r.playing).toEqual([{ title: "Live" }]);
    expect(r.library.filter((l) => l.relation === "favorite").map((l) => [l.title, l.added_at?.toISOString()])).toEqual([["A", "2023-07-22T04:26:40.000Z"]]);
    expect(r.library.filter((l) => l.relation === "top").map((l) => [l.period, l.kind, l.title, l.duration_ms])).toEqual([["overall", "track", "A", 215000], ["overall", "artist", "Band", null]]);
    const recent = r.api.calls.filter((c) => c.url.searchParams.get("method") === "user.getRecentTracks").map((c) => c.url.searchParams);
    expect(recent.map((q) => q.get("page"))).toEqual(["1", "2"]);
    expect(recent[0].get("to")).toBe(recent[1].get("to"));
    expect(recent[0].get("from")).toBeNull();
    expect(recent[0].get("limit")).toBe("200");

    // The next sync asks only for scrobbles since the first one's end time.
    await enqueue(db, { id: r.connection, userId: r.user }, "manual");
    await runWorker(db, { budgetMs: 60_000, userId: r.user, deps: deps(r.api.fetchImpl) });
    const later = r.api.calls.filter((c) => c.url.searchParams.get("method") === "user.getRecentTracks").map((c) => c.url.searchParams);
    expect(later[2].get("from")).toBe(recent[0].get("to"));
    expect((await db.query("SELECT 1 FROM listening_events WHERE connection_id = $1", [r.connection]))).toHaveLength(3);
  });

  it("maps Last.fm's error codes: an invalid session needs a new sign-in, error 29 is a rate limit", async () => {
    const invalid = await synced("lastfm", () => reply({ error: 9, message: "Invalid session key - Please re-authenticate" }, 403), { extra: { username: "u", sessionKey: "dead" } });
    expect(invalid.view.status).toBe("reauth_required");
    const limited = await synced("lastfm", () => reply({ error: 29, message: "Rate Limit Exceeded" }, 429), { extra: { username: "u", sessionKey: "sk" } });
    expect(limited.view.job?.status).toBe("queued");
    expect(limited.view.status).not.toBe("reauth_required");
  });
});

describe("ListenBrainz", () => {
  const listen = (ts: number, name: string, extra: Record<string, unknown> = {}) => ({ listened_at: ts, recording_msid: `msid-${name}`, user_name: "ada", track_metadata: { track_name: name, artist_name: "Artist", release_name: "Release", additional_info: { duration_ms: 200000, ...extra }, ...(extra.mapping ? { mbid_mapping: extra.mapping } : {}) } });
  const MBID = "b1a9c0e9-d987-4042-ae91-78d6a3267d69";

  it("reads a bounded recent window, uses overlapping incremental updates, and keeps identifiers", async () => {
    const all = [listen(1000, "one"), listen(2000, "two", { isrc: "GBAYE0601498" }), listen(3000, "three", { mapping: { recording_mbid: MBID } })];
    const handler: Handler = ({ url, headers }) => {
      expect(headers.get("authorization")).toBe("Token access-1");
      const q = url.searchParams;
      if (url.pathname === "/1/user/ada/listens") {
        const max = Number(q.get("max_ts") ?? Infinity), min = Number(q.get("min_ts") ?? -Infinity);
        const rows = all.filter((l) => l.listened_at < max && l.listened_at > min).sort((a, b) => b.listened_at - a.listened_at).slice(0, 2);
        return reply({ payload: { count: rows.length, listens: rows, user_id: "ada" } });
      }
      if (url.pathname === "/1/user/ada/playing-now") return reply({ payload: { count: 1, playing_now: true, listens: [{ playing_now: true, track_metadata: { track_name: "Right now", artist_name: "Artist" } }] } });
      if (url.pathname === "/1/feedback/user/ada/get-feedback") return reply({ feedback: [{ created: 1700000000, recording_mbid: MBID, recording_msid: null, score: 1, track_metadata: { track_name: "three", artist_name: "Artist" } }], total_count: 1, count: 1, offset: 0 });
      if (url.pathname === "/1/user/ada/playlists") return reply({ playlist_count: 1, playlists: [{ playlist: { identifier: "https://listenbrainz.org/playlist/11111111-2222-3333-4444-555555555555", title: "Weekly Jams", creator: "ada", date: "2024-01-01T00:00:00+00:00", extension: { "https://musicbrainz.org/doc/jspf#playlist": { last_modified_at: "2024-01-02T00:00:00+00:00", public: true } } } }] });
      if (url.pathname === "/1/playlist/11111111-2222-3333-4444-555555555555") return reply({ playlist: { title: "Weekly Jams", track: [{ identifier: [`https://musicbrainz.org/recording/${MBID}`], title: "three", creator: "Artist", duration: 200000 }] } });
      return undefined;
    };
    const r = await synced("listenbrainz", handler, { extra: { username: "ada" }, providerUserId: "ada" });
    expect(r.plays.map((p) => [p.title, p.played_at.getTime() / 1000, p.isrc, p.mbid])).toEqual([["two", 2000, "GBAYE0601498", null], ["three", 3000, null, MBID]]);
    const listens = () => r.api.calls.filter((c) => c.url.pathname.endsWith("/listens")).map((c) => c.url.search);
    expect(listens()).toEqual(["?count=1000"]);
    expect(r.playing).toEqual([{ title: "Right now" }]);
    expect(r.library.map((l) => [l.relation, l.title, l.mbid])).toEqual([["favorite", "three", MBID]]);
    expect(r.playlists).toEqual([{ name: "Weekly Jams", owned: true, tracks: ["three"] }]);

    all.push(listen(4000, "four"));
    await enqueue(db, { id: r.connection, userId: r.user }, "manual");
    await runWorker(db, { budgetMs: 60_000, userId: r.user, deps: deps(r.api.fetchImpl) });
    expect(listens().slice(1)).toEqual(["?count=1000&min_ts=2999"]);
    expect(await db.query("SELECT 1 FROM listening_events WHERE connection_id = $1", [r.connection])).toHaveLength(3);
  });

  it("honours ListenBrainz's rate-limit reset header", async () => {
    const r = await synced("listenbrainz", () => reply({ code: 429, error: "Too many requests" }, 429, { "X-RateLimit-Reset-In": "45" }), { extra: { username: "ada" } });
    const wait = Date.parse(r.view.job!.runAfter!) - Date.now();
    expect(r.view.job?.status).toBe("queued");
    expect(wait).toBeGreaterThan(40_000);
    expect(wait).toBeLessThan(50_000);
  });
});

describe("SoundCloud", () => {
  it("uses the OAuth scheme SoundCloud expects, follows next_href, and names the uploader as artist", async () => {
    const t = (n: number, extra = {}) => ({ kind: "track", urn: `soundcloud:tracks:${n}`, title: `Track ${n}`, duration: 123000, permalink_url: `https://soundcloud.com/u/track-${n}`, user: { username: "uploader" }, isrc: "GBAYE0601498", ...extra });
    const r = await synced("soundcloud", ({ url, headers }) => {
      expect(headers.get("authorization")).toBe("OAuth access-1");
      const p = decodeURIComponent(url.pathname);
      if (p === "/me/likes/tracks") return url.searchParams.get("cursor") === "2" ? reply({ collection: [t(2, { metadata_artist: "Real Artist" })] }) : reply({ collection: [t(1)], next_href: "https://api.soundcloud.com/me/likes/tracks?cursor=2&linked_partitioning=true" });
      if (p === "/me/followings") return reply({ collection: [{ urn: "soundcloud:users:9", username: "Someone", permalink_url: "https://soundcloud.com/someone" }] });
      if (p === "/me/playlists") return reply({ collection: [{ urn: "soundcloud:playlists:5", title: "Set", track_count: 1, last_modified: "2024/01/01 00:00:00 +0000", user: { username: "me" } }] });
      if (p === "/playlists/soundcloud:playlists:5/tracks") return reply({ collection: [t(1)] });
      if (p === "/me/recently-played/tracks") return reply({ collection: [t(3), t(1)] });
      return undefined;
    });
    expect(r.library.filter((l) => l.relation === "favorite").map((l) => [l.provider_id, l.artists, l.duration_ms, l.isrc])).toEqual([["soundcloud:tracks:1", ["uploader"], 123000, null], ["soundcloud:tracks:2", ["Real Artist"], 123000, null]]);
    expect(r.library.filter((l) => l.relation === "followed").map((l) => [l.kind, l.title])).toEqual([["artist", "Someone"]]);
    expect(r.library.filter((l) => l.relation === "recent").map((l) => l.title)).toEqual(["Track 3", "Track 1"]);
    expect(r.playlists).toEqual([{ name: "Set", owned: true, tracks: ["Track 1"] }]);
    const likes = r.api.paths().filter((p) => p.includes("/me/likes/tracks"));
    expect(likes[0]).toContain("linked_partitioning=true");
    expect(likes[1]).toBe("GET /me/likes/tracks?cursor=2&linked_partitioning=true");
  });

  it("sends the single-use refresh token and stores its replacement", async () => {
    const user = await makeUser(db);
    const id = await connect(db, user, "soundcloud", fetch, { token: "old", refreshToken: "one-time-1", expiresAt: Date.now() - 1 });
    const api = fakeFetch(({ url, body }) => {
      if (url.href !== "https://secure.soundcloud.com/oauth/token") return undefined;
      const q = new URLSearchParams(body);
      expect(Object.fromEntries(q)).toMatchObject({ grant_type: "refresh_token", refresh_token: "one-time-1", client_id: "sc-client", client_secret: "sc-secret" });
      return reply({ access_token: "new", refresh_token: "one-time-2", expires_in: 3599 });
    });
    const { credentials } = await import("../connections");
    expect((await credentials(db, id, deps(api.fetchImpl)))?.credentials).toMatchObject({ accessToken: "new", refreshToken: "one-time-2" });
  });
});

describe("TIDAL (JSON:API)", () => {
  const trackResource = (id: string, title: string, artist = "ar1") => ({ id, type: "tracks", attributes: { title, isrc: "USUM71703861", duration: "PT2M58S", externalLinks: [{ href: `https://tidal.com/browse/track/${id}`, meta: { type: "TIDAL_SHARING" } }] }, relationships: { artists: { data: [{ id: artist, type: "artists" }] }, albums: { data: [{ id: "al1", type: "albums" }] } } });
  const artistResource = { id: "ar1", type: "artists", attributes: { name: "TIDAL Artist" } };
  const albumResource = { id: "al1", type: "albums", attributes: { title: "TIDAL Album" } };

  it("joins tracks to artists and albums through `included`, pages by cursor, and looks up names a page left out", async () => {
    const r = await synced("tidal", ({ url, headers }) => {
      expect(headers.get("accept")).toBe("application/vnd.api+json");
      const p = url.pathname, q = url.searchParams;
      if (p === "/v2/userCollectionTracks/me/relationships/items") {
        expect(q.get("countryCode")).toBe("NO");
        return q.get("page[cursor]") === "c2"
          // This page's `included` has the track but not its artist: the adapter must look it up.
          ? reply({ data: [{ id: "2", type: "tracks", meta: { addedAt: "2024-02-02T00:00:00Z" } }], included: [{ ...trackResource("2", "Second"), relationships: { artists: { data: [{ id: "ar1", type: "artists" }] } } }], links: { self: "x" } })
          : reply({ data: [{ id: "1", type: "tracks", meta: { addedAt: "2024-01-01T00:00:00Z" } }], included: [trackResource("1", "First"), artistResource, albumResource], links: { self: "x", next: "/userCollectionTracks/me/relationships/items?page[cursor]=c2", meta: { nextCursor: "c2" } } });
      }
      if (p === "/v2/tracks") { expect(q.get("filter[id]")).toBe("2"); return reply({ data: [trackResource("2", "Second")], included: [artistResource, albumResource] }); }
      if (p === "/v2/userCollectionAlbums/me/relationships/items") return reply({ data: [{ id: "al1", type: "albums", meta: { addedAt: "2023-01-01T00:00:00Z" } }], included: [{ ...albumResource, relationships: { artists: { data: [{ id: "ar1", type: "artists" }] } } }, artistResource], links: { self: "x" } });
      if (p === "/v2/userCollectionArtists/me/relationships/items") return reply({ data: [{ id: "ar1", type: "artists", meta: { addedAt: "2023-01-01T00:00:00Z" } }], included: [artistResource], links: { self: "x" } });
      if (p === "/v2/playlists") { expect(q.get("filter[owners.id]")).toBe("me"); return reply({ data: [{ id: "pl-1", type: "playlists", attributes: { name: "TIDAL list", numberOfItems: 1, lastModifiedAt: "2024-03-03T00:00:00Z", accessType: "PRIVATE" } }], links: { self: "x" } }); }
      if (p === "/v2/playlists/pl-1/relationships/items") return reply({ data: [{ id: "1", type: "tracks", meta: { addedAt: "2024-03-01T00:00:00Z", itemId: "i1" } }], included: [trackResource("1", "First"), artistResource, albumResource], links: { self: "x" } });
      return undefined;
    }, { extra: { country: "NO" } });
    const saved = r.library.filter((l) => l.relation === "saved");
    expect(saved.map((l) => [l.kind, l.title, l.artists, l.album, l.duration_ms, l.url])).toEqual([
      ["track", "First", ["TIDAL Artist"], "TIDAL Album", 178000, "https://tidal.com/browse/track/1"],
      ["track", "Second", ["TIDAL Artist"], "TIDAL Album", 178000, "https://tidal.com/browse/track/2"],
      ["album", "TIDAL Album", ["TIDAL Artist"], null, null, "https://tidal.com/browse/album/al1"],
    ].sort((a, b) => String(a[1]).localeCompare(String(b[1]))));
    expect(r.library.filter((l) => l.relation === "followed").map((l) => l.title)).toEqual(["TIDAL Artist"]);
    expect(r.playlists).toEqual([{ name: "TIDAL list", owned: true, tracks: ["First"] }]);
    // Display-only: the ISRC TIDAL sent is not kept.
    expect(saved.every((l) => l.isrc === null)).toBe(true);
    expect(r.plays).toEqual([]);
  });

  it("stores the user's country for catalogue lookups but not their email", async () => {
    const user = await makeUser(db);
    const url = new URL(await beginAuthorization(db, user, "tidal", "https://app.example", { env: TEST_ENV }));
    expect(url.origin + url.pathname).toBe("https://login.tidal.com/authorize");
    expect(url.searchParams.get("scope")).toBe("user.read collection.read playlists.read");
    const api = fakeFetch(({ url: u }) => {
      if (u.href === "https://auth.tidal.com/v1/oauth2/token") return reply({ access_token: "tidal-access", refresh_token: "tidal-refresh", expires_in: 14400, scope: "user.read collection.read playlists.read" });
      if (u.pathname === "/v2/users/me") return reply({ data: { id: "12345", type: "users", attributes: { username: "ada@example.com", country: "NO", email: "ada@example.com", firstName: "Ada" } } });
      return undefined;
    });
    const view = await completeAuthorization(db, user, "tidal", new URLSearchParams({ code: "c", state: url.searchParams.get("state")! }), deps(api.fetchImpl));
    const { credentials } = await import("../connections");
    const live = await credentials(db, view.id, deps(api.fetchImpl));
    expect(live?.credentials.extra).toEqual({ country: "NO" });
    expect(JSON.stringify(live?.credentials)).not.toContain("firstName");
  });
});
