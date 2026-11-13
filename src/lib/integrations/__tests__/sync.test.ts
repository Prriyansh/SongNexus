// The sync engine, driven through the real Spotify adapter against a fake Spotify API: paging,
// removals, duplicate plays, rate limits, resuming after failures, duplicate jobs, token expiry.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../../db";
import { listConnections } from "../connections";
import { claim, enqueue, scheduleDue } from "../jobs";
import { housekeeping, runJob, runWorker } from "../sync";
import { applyMutations } from "../store";
import type { Call } from "./helpers";
import { connect, deps, fakeFetch, freshDb, makeUser, reply } from "./helpers";

let db: Db;
beforeAll(async () => { db = await freshDb(); });
afterAll(async () => { await db.close(); });

const track = (id: string) => ({ id, type: "track", name: `Song ${id}`, duration_ms: 200000, artists: [{ name: "Artist" }], album: { name: "Album", images: [{ url: "https://i.scdn.co/image/x" }] }, external_urls: { spotify: `https://open.spotify.com/track/${id}` } });

type World = { tracks: string[]; recent: { id: string; at: string }[]; playlist: { snapshot: string; tracks: string[] }; intercept?: (call: Call) => Response | undefined };
const world = (n = 0): World => ({ tracks: Array.from({ length: n }, (_, i) => `t${i}`), recent: [], playlist: { snapshot: "s1", tracks: ["t0", "t1"] } });

function spotifyApi(w: World) {
  return fakeFetch((call) => {
    const hit = w.intercept?.(call);
    if (hit) return hit;
    const { url } = call, q = url.searchParams;
    const offset = Number(q.get("offset") ?? 0), limit = Number(q.get("limit") ?? 20);
    const paged = <T>(all: T[]) => ({ items: all.slice(offset, offset + limit), next: offset + limit < all.length ? "https://api.spotify.com/next" : null, total: all.length });
    switch (url.pathname) {
      case "/v1/me/tracks": return reply(paged(w.tracks.map((id) => ({ added_at: "2024-03-01T10:00:00Z", track: track(id) }))));
      case "/v1/me/albums": return reply(paged([]));
      case "/v1/me/following": return reply({ artists: { items: [{ id: "a1", name: "Followed", external_urls: { spotify: "https://open.spotify.com/artist/a1" } }], cursors: { after: null } } });
      case "/v1/me/playlists": return reply(paged([
        { id: "p1", name: "Mine", owner: { id: "me", display_name: "Me" }, snapshot_id: w.playlist.snapshot, items: { total: w.playlist.tracks.length }, collaborative: false },
        { id: "p2", name: "Followed list", owner: { id: "someone-else" }, snapshot_id: "x", items: { total: 99 }, collaborative: false },
      ]));
      case "/v1/playlists/p1/items": return reply(paged(w.playlist.tracks.map((id) => ({ added_at: "2024-01-01T00:00:00Z", item: track(id) }))));
      case "/v1/me/top/tracks": case "/v1/me/top/artists": return reply({ items: [] });
      case "/v1/me/player/recently-played": return reply({ items: w.recent.filter((r) => !q.get("after") || Date.parse(r.at) > Number(q.get("after"))).map((r) => ({ played_at: r.at, track: track(r.id) })) });
      case "/v1/me/player/currently-playing": return reply(null, 204);
    }
    return undefined;
  });
}

const count = async (table: string, where: string, params: unknown[]) => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params))[0].n;
const jobOf = async (connection: string) => (await db.query<{ id: string; status: string; attempts: number; error: string | null; wait: number }>(
  "SELECT id, status, attempts, error, extract(epoch FROM run_after - now())::int AS wait FROM sync_jobs WHERE connection_id = $1 ORDER BY created_at DESC LIMIT 1", [connection]))[0];

async function setup(w: World, options: Parameters<typeof connect>[4] = {}) {
  const user = await makeUser(db);
  const api = spotifyApi(w);
  const connection = await connect(db, user, "spotify", api.fetchImpl, options);
  const sync = async (kind: "initial" | "manual" = "manual") => {
    await enqueue(db, { id: connection, userId: user }, kind);
    return runWorker(db, { budgetMs: 60_000, userId: user, deps: deps(api.fetchImpl) });
  };
  return { user, connection, api, sync, view: async () => (await listConnections(db, user))[0] };
}

describe("a full sync", () => {
  it("pages through the library, stores each item once and records per-resource state", async () => {
    const w = world(120);
    const { connection, api, sync, view } = await setup(w);
    await sync("initial");
    expect(api.paths().filter((p) => p.includes("/v1/me/tracks"))).toEqual(["GET /v1/me/tracks?limit=50&offset=0", "GET /v1/me/tracks?limit=50&offset=50", "GET /v1/me/tracks?limit=50&offset=100"]);
    expect(await count("library_items", "connection_id = $1 AND relation = 'saved'", [connection])).toBe(120);
    expect(await count("library_items", "connection_id = $1 AND relation = 'followed'", [connection])).toBe(1);
    const v = await view();
    expect(v.status).toBe("connected");
    expect(v.job).toMatchObject({ status: "succeeded", kind: "initial" });
    expect(v.lastSuccessAt).not.toBeNull();
    const tracks = v.resources.find((r) => r.key === "library.tracks")!;
    expect(tracks).toMatchObject({ items: 120, error: null });
    expect(tracks.lastSuccessAt).not.toBeNull();
    expect(Date.parse(tracks.nextDueAt!)).toBeGreaterThan(Date.now() + 5 * 3600_000);
    // Every request carried the user's token.
    expect(api.calls.every((c) => c.headers.get("authorization") === "Bearer access-1")).toBe(true);
  });

  it("is idempotent, and removes what disappeared upstream on the next pass", async () => {
    const w = world(60);
    const { connection, sync } = await setup(w);
    await sync(); await sync();
    expect(await count("library_items", "connection_id = $1 AND relation = 'saved'", [connection])).toBe(60);
    w.tracks = w.tracks.filter((id) => id !== "t7" && id !== "t55").concat("new-one");
    await sync();
    const titles = (await db.query<{ provider_id: string }>("SELECT pe.provider_id FROM library_items li JOIN provider_entities pe ON pe.id = li.entity_id WHERE li.connection_id = $1 AND li.relation = 'saved'", [connection])).map((r) => r.provider_id);
    expect(titles).toHaveLength(59);
    expect(titles).toContain("new-one");
    expect(titles).not.toContain("t7");
  });

  it("reads playlist tracks only for playlists the user owns, and only when the snapshot changed", async () => {
    const w = world(1);
    const { connection, api, sync } = await setup(w);
    await sync();
    const items = () => api.paths().filter((p) => p.includes("/playlists/p1/items")).length;
    expect(items()).toBe(1);
    expect(api.paths().some((p) => p.includes("/playlists/p2/"))).toBe(false);
    const rows = await db.query<{ name: string; owned: boolean; n: number }>("SELECT p.name, p.owned, (SELECT count(*)::int FROM playlist_items pi WHERE pi.playlist_id = p.id) AS n FROM playlists p WHERE p.connection_id = $1 ORDER BY p.name", [connection]);
    expect(rows).toEqual([{ name: "Followed list", owned: false, n: 0 }, { name: "Mine", owned: true, n: 2 }]);
    await sync();
    expect(items()).toBe(1);
    w.playlist = { snapshot: "s2", tracks: ["t1"] };
    await sync();
    expect(items()).toBe(2);
    expect(await count("playlist_items pi JOIN playlists p ON p.id = pi.playlist_id", "p.connection_id = $1", [connection])).toBe(1);
  });

  it("skips resources whose scope wasn't granted and reports partial access", async () => {
    const { api, sync, view } = await setup(world(1), { scopes: ["user-library-read"] });
    await sync();
    expect(api.paths().some((p) => /top|playlists|recently-played|following/.test(p))).toBe(false);
    const v = await view();
    expect(v.status).toBe("partial_access");
    expect(v.resources.find((r) => r.key === "top")?.skipped).toMatch(/permission/);
    expect(v.capabilities.recent_history.missingScope).toBe(true);
  });
});

describe("listening events", () => {
  it("stores a play once however often it is seen, keeps repeat plays, and asks only for what's new", async () => {
    const w = world(0);
    const { connection, api, sync } = await setup(w);
    w.recent = [{ id: "t1", at: "2024-05-01T10:00:00.000Z" }, { id: "t1", at: "2024-05-01T10:04:00.000Z" }, { id: "t2", at: "2024-05-01T10:08:00.000Z" }];
    await sync();
    expect(await count("listening_events", "connection_id = $1", [connection])).toBe(3);
    const after = () => api.calls.filter((c) => c.url.pathname.endsWith("recently-played")).map((c) => c.url.searchParams.get("after"));
    expect(after()).toEqual([null]);
    w.recent.push({ id: "t1", at: "2024-05-01T11:00:00.000Z" });
    await sync();
    expect(after()[1]).toBe(String(Date.parse("2024-05-01T10:08:00.000Z")));
    expect(await count("listening_events", "connection_id = $1", [connection])).toBe(4);
    // The same rows offered again (a provider ignoring `after`, a retried step) change nothing.
    await db.query("UPDATE sync_state SET checkpoint = NULL WHERE connection_id = $1 AND resource = 'recent'", [connection]);
    await sync();
    expect(await count("listening_events", "connection_id = $1", [connection])).toBe(4);
    expect(await count("listening_events le JOIN provider_entities pe ON pe.id = le.entity_id", "le.connection_id = $1 AND pe.provider_id = 't1'", [connection])).toBe(3);
  });
});

describe("failures", () => {
  it("waits out a rate limit without losing progress or counting it as a failure", async () => {
    const w = world(10);
    const { connection, sync } = await setup(w);
    w.intercept = ({ url }) => (url.pathname === "/v1/me/albums" ? reply({ error: { status: 429, message: "API rate limit exceeded" } }, 429, { "Retry-After": "120" }) : undefined);
    await sync();
    const waiting = await jobOf(connection);
    expect(waiting).toMatchObject({ status: "queued", attempts: 0 });
    expect(waiting.wait).toBeGreaterThan(100);
    expect(waiting.wait).toBeLessThan(130);
    expect(await count("library_items", "connection_id = $1 AND relation = 'saved'", [connection])).toBe(10);
    // Not runnable yet: the worker leaves it alone.
    expect(await claim(db)).toBeNull();
    w.intercept = undefined;
    await db.query("UPDATE sync_jobs SET run_after = now() WHERE connection_id = $1", [connection]);
    await runWorker(db, { budgetMs: 60_000, deps: deps(spotifyApi(w).fetchImpl) });
    expect(await jobOf(connection)).toMatchObject({ status: "succeeded", id: waiting.id });
  });

  it("resumes a failed import from the page that failed, not from the start", async () => {
    const w = world(120);
    const { connection, api, sync, view } = await setup(w);
    w.intercept = ({ url }) => (url.pathname === "/v1/me/tracks" && url.searchParams.get("offset") === "50" ? reply({ error: "upstream" }, 503) : undefined);
    await sync();
    const failed = await jobOf(connection);
    expect(failed).toMatchObject({ status: "queued", attempts: 1 });
    expect(failed.wait).toBeGreaterThan(30);
    expect(failed.error).toMatch(/Spotify is having trouble/);
    expect(await count("library_items", "connection_id = $1", [connection])).toBe(50);
    const [state] = await db.query<{ page_cursor: number }>("SELECT page_cursor FROM sync_state WHERE connection_id = $1 AND resource = 'library.tracks'", [connection]);
    expect(state.page_cursor).toBe(50);
    expect((await view()).status).toBe("connected");

    w.intercept = undefined;
    const before = api.calls.length;
    await db.query("UPDATE sync_jobs SET run_after = now() WHERE connection_id = $1", [connection]);
    await runWorker(db, { budgetMs: 60_000, deps: deps(api.fetchImpl) });
    const resumed = api.paths().slice(before).filter((p) => p.includes("/v1/me/tracks"));
    expect(resumed).toEqual(["GET /v1/me/tracks?limit=50&offset=50", "GET /v1/me/tracks?limit=50&offset=100"]);
    expect(await count("library_items", "connection_id = $1 AND relation = 'saved'", [connection])).toBe(120);
    expect(await jobOf(connection)).toMatchObject({ status: "succeeded" });
  });

  it("gives up after repeated failures, marks the connection, and tries again later rather than never", async () => {
    const w = world(1);
    const { user, connection, sync, view } = await setup(w);
    w.intercept = () => reply({ error: "down" }, 500);
    await sync();
    for (let i = 0; i < 6; i++) {
      await db.query("UPDATE sync_jobs SET run_after = now() WHERE connection_id = $1 AND status = 'queued'", [connection]);
      await runWorker(db, { budgetMs: 60_000, userId: user, deps: deps(spotifyApi(w).fetchImpl) });
    }
    expect(await jobOf(connection)).toMatchObject({ status: "failed", attempts: 4 });
    expect(await view()).toMatchObject({ status: "error", lastError: expect.stringMatching(/having trouble/) });
    expect(await scheduleDue(db, user)).toBe(0);
    await db.query("UPDATE sync_state SET next_due_at = now() WHERE connection_id = $1", [connection]);
    w.intercept = undefined;
    await runWorker(db, { budgetMs: 60_000, userId: user, deps: deps(spotifyApi(w).fetchImpl) });
    expect(await view()).toMatchObject({ status: "connected", lastError: null });
  });

  it("keeps syncing the rest when one resource is forbidden, and reports an account that can't be read at all", async () => {
    const w = world(3);
    const { connection, sync, view } = await setup(w);
    w.intercept = ({ url }) => (url.pathname.startsWith("/v1/me/top") ? reply({ error: { status: 403, message: "Insufficient client scope" } }, 403) : undefined);
    await sync();
    let v = await view();
    expect(v.status).toBe("partial_access");
    expect(v.job?.status).toBe("succeeded");
    expect(v.resources.find((r) => r.key === "top")?.error).toMatch(/Insufficient client scope/);
    expect(await count("library_items", "connection_id = $1 AND relation = 'saved'", [connection])).toBe(3);

    // A Development Mode app answers 403 on everything for a user who isn't on its allowlist.
    w.intercept = () => reply({ error: { status: 403, message: "User not registered in the Developer Dashboard" } }, 403);
    await sync();
    v = await view();
    expect(v.status).toBe("error");
    expect(v.lastError).toMatch(/User not registered/);
    expect(v.job?.status).toBe("failed");
  });

  it("refreshes once when a token is rejected mid-sync and carries on with the new one", async () => {
    const w = world(2);
    const { api, sync, view } = await setup(w, { token: "stale", refreshToken: "r1" });
    w.intercept = ({ url, headers }) => {
      if (url.href === "https://accounts.spotify.com/api/token") return reply({ access_token: "fresh", expires_in: 3600 });
      if (url.hostname === "api.spotify.com" && headers.get("authorization") !== "Bearer fresh") return reply({ error: { status: 401, message: "The access token expired" } }, 401);
      return undefined;
    };
    await sync();
    expect(api.calls.filter((c) => c.url.pathname === "/api/token")).toHaveLength(1);
    expect((await view()).status).toBe("connected");
  });

  it("pauses for reauthorization when the provider keeps rejecting the token, and stops scheduling it", async () => {
    const w = world(2);
    const { user, sync, view } = await setup(w);
    w.intercept = () => reply({ error: { status: 401, message: "Invalid access token" } }, 401);
    await sync();
    const v = await view();
    expect(v.status).toBe("reauth_required");
    expect(v.job?.status).toBe("cancelled");
    expect(await scheduleDue(db, user)).toBe(0);
  });
});

describe("jobs", () => {
  it("keeps one active job per connection no matter how often a sync is requested", async () => {
    const { user, connection } = await setup(world(1));
    const first = await enqueue(db, { id: connection, userId: user }, "manual");
    const second = await enqueue(db, { id: connection, userId: user }, "manual");
    const third = await Promise.all([1, 2, 3].map(() => enqueue(db, { id: connection, userId: user }, "scheduled")));
    expect(first.created).toBe(true);
    expect(second).toMatchObject({ created: false, job: { id: first.job.id } });
    expect(third.every((r) => r.job.id === first.job.id && !r.created)).toBe(true);
    expect(await count("sync_jobs", "connection_id = $1", [connection])).toBe(1);
    expect((await claim(db, user))?.id).toBe(first.job.id);
    // Claimed and leased: a second worker finds nothing.
    expect(await claim(db, user)).toBeNull();
    expect((await enqueue(db, { id: connection, userId: user }, "manual")).created).toBe(false);
  });

  it("picks a job back up when its worker died, which is how work resumes after a restart", async () => {
    const w = world(3);
    const { user, connection, api } = await setup(w);
    await enqueue(db, { id: connection, userId: user }, "manual");
    const taken = await claim(db, user);
    await db.query("UPDATE sync_jobs SET lease_until = now() - interval '1 second' WHERE id = $1", [taken!.id]);
    const again = await claim(db, user);
    expect(again).toMatchObject({ id: taken!.id, attempts: 1 });
    await runJob(db, again!, deps(api.fetchImpl));
    expect(await jobOf(connection)).toMatchObject({ status: "succeeded" });
  });

  it("yields when its time is up and continues from the stored cursor on the next run", async () => {
    const w = world(120);
    const { user, connection, api } = await setup(w);
    await enqueue(db, { id: connection, userId: user }, "manual");
    await runJob(db, (await claim(db, user))!, deps(api.fetchImpl), 0);
    expect(await jobOf(connection)).toMatchObject({ status: "queued", attempts: 0 });
    expect(await count("library_items", "connection_id = $1", [connection])).toBe(50);
    const result = await runWorker(db, { budgetMs: 60_000, userId: user, deps: deps(api.fetchImpl) });
    expect(result.exhausted).toBe(true);
    expect(await count("library_items", "connection_id = $1 AND relation = 'saved'", [connection])).toBe(120);
    expect(api.paths().filter((p) => p.includes("/v1/me/tracks?"))).toHaveLength(3);
  });

  it("schedules only what is due, and only for the user it was asked about", async () => {
    const mine = await setup(world(1)), theirs = await setup(world(1));
    expect(await scheduleDue(db, mine.user)).toBe(1);
    await runWorker(db, { budgetMs: 60_000, userId: mine.user, deps: deps(mine.api.fetchImpl) });
    expect(await count("sync_jobs", "user_id = $1", [theirs.user])).toBe(0);
    expect(await scheduleDue(db, mine.user)).toBe(0);
    await db.query("UPDATE sync_state SET next_due_at = now() - interval '1 minute' WHERE connection_id = $1 AND resource = 'recent'", [mine.connection]);
    const before = mine.api.calls.length;
    expect(await scheduleDue(db, mine.user)).toBe(1);
    await runWorker(db, { budgetMs: 60_000, userId: mine.user, deps: deps(mine.api.fetchImpl) });
    // Only the resource that was due made requests.
    expect(mine.api.paths().slice(before).every((p) => p.includes("/v1/me/player/"))).toBe(true);
  });

  it("publishes progress events for the user who owns the connection only", async () => {
    const mine = await setup(world(60)), theirs = await setup(world(1));
    await mine.sync();
    const events = await db.query<{ type: string; payload: Record<string, unknown> }>("SELECT type, payload FROM user_events WHERE user_id = $1 ORDER BY seq", [mine.user]);
    expect(events.some((e) => e.type === "sync" && e.payload.status === "running" && e.payload.resource === "library.tracks")).toBe(true);
    expect(events[events.length - 1]).toMatchObject({ type: "sync", payload: { status: "succeeded" } });
    expect(JSON.stringify(events)).not.toContain("access-1");
    expect(await count("user_events", "user_id = $1", [theirs.user])).toBe(0);
  });
});

describe("retention", () => {
  it("removes stale private YouTube playlist metadata even when public entity data was refreshed elsewhere", async () => {
    const user = await makeUser(db), id = await connect(db, user, "youtube", fetch);
    await applyMutations(db, { userId: user, connectionId: id, source: "youtube" }, [{ type: "playlist", playlist: { providerId: "private-list", name: "Private list", description: "Private description", owned: true } }], 1);
    await db.query("UPDATE connections SET connected_at = now() - interval '31 days' WHERE id = $1", [id]);
    await housekeeping(db);
    expect(await db.query("SELECT 1 FROM playlists WHERE connection_id = $1", [id])).toEqual([]);
  });
  it("deletes YouTube data that could not be refreshed within 30 days, and nothing else", async () => {
    const user = await makeUser(db);
    const youtube = await connect(db, user, "youtube", fetch);
    const lastfm = await connect(db, user, "lastfm", fetch);
    for (const [connectionId, source] of [[youtube, "youtube"], [lastfm, "lastfm"]] as const) {
      await applyMutations(db, { userId: user, connectionId, source }, [
        { type: "library", relation: "favorite", entity: { kind: "track", providerId: "old", title: "Old", artists: ["A"] } },
        { type: "library", relation: "favorite", entity: { kind: "track", providerId: "fresh", title: "Fresh", artists: ["A"] } },
      ], 1);
    }
    await db.query("UPDATE provider_entities SET fetched_at = now() - interval '31 days' WHERE provider_id = 'old'");
    await housekeeping(db);
    const left = await db.query<{ provider: string; provider_id: string }>("SELECT provider, provider_id FROM provider_entities WHERE provider IN ('youtube', 'lastfm') ORDER BY provider, provider_id");
    expect(left).toEqual([{ provider: "lastfm", provider_id: "fresh" }, { provider: "lastfm", provider_id: "old" }, { provider: "youtube", provider_id: "fresh" }]);
    expect(await count("library_items", "connection_id = $1", [youtube])).toBe(1);
  });
});
