// The account connection lifecycle: OAuth state and PKCE, credential storage, token refresh under
// concurrency, reauthorization, disconnect, and that one user can never act on another's connection.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pkceChallenge } from "../../accounts/crypto";
import type { Db } from "../../db";
import { beginAuthorization, completeAuthorization, connectWithToken, credentials, disconnect, listConnections, ownedConnection } from "../connections";
import { ReauthRequiredError } from "../http";
import { connect, deps, fakeFetch, freshDb, makeUser, reply, TEST_ENV } from "./helpers";

const ORIGIN = "http://127.0.0.1:3000";
let db: Db;
beforeAll(async () => { db = await freshDb(); });
afterAll(async () => { await db.close(); });

const spotifyAuth = (onToken?: (body: URLSearchParams) => Response | undefined) => fakeFetch(({ url, body, headers }) => {
  if (url.href === "https://accounts.spotify.com/api/token") return onToken?.(new URLSearchParams(body)) ?? reply({ access_token: "access-abc", refresh_token: "refresh-abc", expires_in: 3600, scope: "user-library-read playlist-read-private" });
  if (url.href === "https://api.spotify.com/v1/me") return headers.get("authorization") === "Bearer access-abc" ? reply({ id: "sp-user", display_name: "Ada L", external_urls: { spotify: "https://open.spotify.com/user/sp-user" } }) : reply({ error: { message: "bad token" } }, 401);
  return undefined;
});

const begin = async (userId: string) => {
  const url = new URL(await beginAuthorization(db, userId, "spotify", ORIGIN, { env: TEST_ENV }));
  return { url, state: url.searchParams.get("state")! };
};

describe("starting an authorization", () => {
  it("builds a PKCE authorization URL with least-privilege scopes and stores only a hash of the state", async () => {
    const user = await makeUser(db);
    const { url, state } = await begin(user);
    expect(url.origin + url.pathname).toBe("https://accounts.spotify.com/authorize");
    const q = url.searchParams;
    expect(q.get("client_id")).toBe("spotify-client");
    expect(q.get("response_type")).toBe("code");
    expect(q.get("redirect_uri")).toBe(`${ORIGIN}/api/integrations/spotify/callback`);
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get("scope")!.split(" ").every((scope) => /read/.test(scope))).toBe(true);
    expect(url.href).not.toMatch(/client_secret/);
    const [row] = await db.query<{ state_hash: string; secret: string }>("SELECT state_hash, secret FROM oauth_states WHERE user_id = $1", [user]);
    expect(row.state_hash).not.toBe(state);
    expect(row.secret.startsWith("v1.")).toBe(true);
  });

  it("refuses providers that aren't configured or can't be connected at all", async () => {
    const user = await makeUser(db);
    await expect(beginAuthorization(db, user, "spotify", ORIGIN, { env: { ...TEST_ENV, SPOTIFY_CLIENT_ID: "" } })).rejects.toMatchObject({ status: 503 });
    await expect(beginAuthorization(db, user, "spotify", ORIGIN, { env: { NODE_ENV: "production", SPOTIFY_CLIENT_ID: "x" } })).rejects.toMatchObject({ status: 503 });
    await expect(beginAuthorization(db, user, "deezer", ORIGIN, { env: TEST_ENV })).rejects.toMatchObject({ status: 409 });
    await expect(beginAuthorization(db, user, "amazon-music", ORIGIN, { env: TEST_ENV })).rejects.toMatchObject({ status: 409 });
    await expect(connectWithToken(db, user, "shazam", { token: "x" }, { env: TEST_ENV })).rejects.toMatchObject({ status: 409 });
  });
});

describe("finishing an authorization", () => {
  it("exchanges the code with the matching verifier, stores sealed credentials and queues the first sync", async () => {
    const user = await makeUser(db);
    const { url, state } = await begin(user);
    let verifier = "";
    const api = spotifyAuth((body) => { verifier = body.get("code_verifier") ?? ""; expect(body.get("grant_type")).toBe("authorization_code"); expect(body.get("code")).toBe("the-code"); expect(body.get("redirect_uri")).toBe(`${ORIGIN}/api/integrations/spotify/callback`); return undefined; });
    const view = await completeAuthorization(db, user, "spotify", new URLSearchParams({ code: "the-code", state }), deps(api.fetchImpl));
    expect(pkceChallenge(verifier)).toBe(url.searchParams.get("code_challenge"));
    expect(view).toMatchObject({ provider: "spotify", displayName: "Ada L", status: "syncing", scopes: ["user-library-read", "playlist-read-private"] });
    expect(view.job).toMatchObject({ kind: "initial", status: "queued" });
    const [row] = await db.query<{ credentials: string; provider_user_id: string }>("SELECT credentials, provider_user_id FROM connections WHERE id = $1", [view.id]);
    expect(row.provider_user_id).toBe("sp-user");
    expect(row.credentials).not.toContain("access-abc");
    expect(row.credentials).not.toContain("refresh-abc");
    expect((await credentials(db, view.id, deps(api.fetchImpl)))?.credentials).toMatchObject({ accessToken: "access-abc", refreshToken: "refresh-abc" });
    // Capabilities reflect what was granted: no top-items scope here.
    expect(view.capabilities.library).toEqual(expect.objectContaining({ supported: true }));
    expect(view.capabilities.top_items.missingScope).toBe(true);
  });

  it("rejects a missing, unknown, replayed or expired state, and one issued to another user or provider", async () => {
    const user = await makeUser(db), other = await makeUser(db);
    const api = spotifyAuth();
    const finish = (who: string, provider: "spotify" | "tidal", state: string | null) =>
      completeAuthorization(db, who, provider, new URLSearchParams({ code: "c", ...(state ? { state } : {}) }), deps(api.fetchImpl));

    await expect(finish(user, "spotify", null)).rejects.toMatchObject({ status: 400 });
    await expect(finish(user, "spotify", "made-up-state")).rejects.toMatchObject({ status: 400 });

    const stolen = (await begin(user)).state;
    await expect(finish(other, "spotify", stolen)).rejects.toMatchObject({ status: 400 });
    // The failed attempt consumed it: the rightful user must start again too.
    await expect(finish(user, "spotify", stolen)).rejects.toMatchObject({ status: 400 });

    const wrongProvider = (await begin(user)).state;
    await expect(finish(user, "tidal", wrongProvider)).rejects.toMatchObject({ status: 400 });

    const expired = (await begin(user)).state;
    await db.query("UPDATE oauth_states SET expires_at = now() - interval '1 second' WHERE user_id = $1", [user]);
    await expect(finish(user, "spotify", expired)).rejects.toMatchObject({ status: 400 });

    const once = (await begin(user)).state;
    await finish(user, "spotify", once);
    await expect(finish(user, "spotify", once)).rejects.toMatchObject({ status: 400 });
    expect(api.calls.filter((c) => c.url.pathname === "/api/token")).toHaveLength(1);
    expect(await listConnections(db, other)).toEqual([]);
  });

  it("reports a declined consent and a rejected code without creating a connection", async () => {
    const user = await makeUser(db);
    const api = spotifyAuth(() => reply({ error: "invalid_grant", error_description: "Invalid authorization code" }, 400));
    await expect(completeAuthorization(db, user, "spotify", new URLSearchParams({ error: "access_denied", state: (await begin(user)).state }), deps(api.fetchImpl))).rejects.toThrow(/didn’t approve/);
    const failure = await completeAuthorization(db, user, "spotify", new URLSearchParams({ code: "bad", state: (await begin(user)).state }), deps(api.fetchImpl)).catch((e: Error) => e);
    expect(failure).toMatchObject({ status: 502 });
    expect((failure as Error).message).toMatch(/Invalid authorization code/);
    expect(await listConnections(db, user)).toEqual([]);
  });

  it("links ListenBrainz with a validated user token and refuses an invalid one", async () => {
    const user = await makeUser(db);
    const api = fakeFetch(({ url, headers }) => url.pathname === "/1/validate-token"
      ? reply(headers.get("authorization") === "Token 0123456789abcdef0123456789abcdef" ? { valid: true, user_name: "ada_listens" } : { valid: false, message: "Token invalid." }) : undefined);
    await expect(connectWithToken(db, user, "listenbrainz", { token: "ffffffffffffffffffffffffffffffff" }, deps(api.fetchImpl))).rejects.toMatchObject({ status: 400 });
    await expect(connectWithToken(db, user, "listenbrainz", { token: "short" }, deps(api.fetchImpl))).rejects.toMatchObject({ status: 400 });
    const view = await connectWithToken(db, user, "listenbrainz", { token: "0123456789abcdef0123456789abcdef" }, deps(api.fetchImpl));
    expect(view).toMatchObject({ provider: "listenbrainz", displayName: "ada_listens", profileUrl: "https://listenbrainz.org/user/ada_listens/" });
    const [row] = await db.query<{ credentials: string }>("SELECT credentials FROM connections WHERE id = $1", [view.id]);
    expect(row.credentials).not.toContain("0123456789abcdef");
  });

  it("replaces the data when the same user reconnects as a different account", async () => {
    const user = await makeUser(db);
    const api = fakeFetch(({ url, headers }) => url.pathname === "/1/validate-token" ? reply({ valid: true, user_name: headers.get("authorization")!.endsWith("a") ? "first" : "second" }) : undefined);
    const first = await connectWithToken(db, user, "listenbrainz", { token: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, deps(api.fetchImpl));
    const second = await connectWithToken(db, user, "listenbrainz", { token: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }, deps(api.fetchImpl));
    expect(second.id).not.toBe(first.id);
    expect((await listConnections(db, user)).map((c) => c.displayName)).toEqual(["second"]);
  });
});

describe("credentials in use", () => {
  const refreshing = (answer: () => Response) => fakeFetch(({ url }) => (url.href === "https://accounts.spotify.com/api/token" ? answer() : undefined));

  it("refreshes an expiring token once even when two workers ask at the same moment, and keeps a rotated refresh token", async () => {
    const user = await makeUser(db);
    const id = await connect(db, user, "spotify", fetch, { token: "old", refreshToken: "refresh-1", expiresAt: Date.now() + 30_000 });
    let n = 0;
    const api = refreshing(() => reply({ access_token: `new-${++n}`, refresh_token: `refresh-${n + 1}`, expires_in: 3600 }));
    const [a, b] = await Promise.all([credentials(db, id, deps(api.fetchImpl)), credentials(db, id, deps(api.fetchImpl))]);
    expect(api.calls).toHaveLength(1);
    expect(new URLSearchParams(api.calls[0].body).get("refresh_token")).toBe("refresh-1");
    expect(a?.credentials.accessToken).toBe("new-1");
    expect(b?.credentials).toMatchObject({ accessToken: "new-1", refreshToken: "refresh-2" });
  });

  it("keeps the existing refresh token when the provider doesn't send a new one, and leaves a fresh token alone", async () => {
    const user = await makeUser(db);
    const id = await connect(db, user, "spotify", fetch, { token: "old", refreshToken: "keep-me", expiresAt: Date.now() + 30_000 });
    const api = refreshing(() => reply({ access_token: "new", expires_in: 3600 }));
    expect((await credentials(db, id, deps(api.fetchImpl)))?.credentials).toMatchObject({ accessToken: "new", refreshToken: "keep-me" });
    await credentials(db, id, deps(api.fetchImpl));
    expect(api.calls).toHaveLength(1);
  });

  it("pauses the connection for reauthorization when the refresh token is rejected, and cancels its jobs", async () => {
    const user = await makeUser(db);
    const id = await connect(db, user, "spotify", fetch, { token: "old", refreshToken: "revoked", expiresAt: Date.now() - 1000 });
    await db.query("INSERT INTO sync_jobs (connection_id, user_id, kind) VALUES ($1, $2, 'scheduled')", [id, user]);
    const api = refreshing(() => reply({ error: "invalid_grant", error_description: "Refresh token revoked" }, 400));
    await expect(credentials(db, id, deps(api.fetchImpl))).rejects.toBeInstanceOf(ReauthRequiredError);
    const [view] = await listConnections(db, user);
    expect(view.status).toBe("reauth_required");
    expect(view.job?.status).toBe("cancelled");
  });

  it("does not treat a provider outage during refresh as a revoked authorization", async () => {
    const user = await makeUser(db);
    const id = await connect(db, user, "spotify", fetch, { token: "old", refreshToken: "fine", expiresAt: Date.now() - 1000 });
    const api = refreshing(() => reply({ error: "server_error" }, 503));
    await expect(credentials(db, id, deps(api.fetchImpl))).rejects.not.toBeInstanceOf(ReauthRequiredError);
    expect((await listConnections(db, user))[0].status).not.toBe("reauth_required");
  });
});

describe("ownership and disconnect", () => {
  it("hides another user's connection behind the same 404 as a missing one", async () => {
    const owner = await makeUser(db), intruder = await makeUser(db);
    const id = await connect(db, owner, "spotify", fetch);
    await expect(ownedConnection(db, intruder, id)).rejects.toMatchObject({ status: 404 });
    await expect(ownedConnection(db, intruder, "00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({ status: 404 });
    await expect(ownedConnection(db, intruder, "not-an-id'; DROP TABLE users;--")).rejects.toMatchObject({ status: 404 });
    await expect(disconnect(db, intruder, id, { env: TEST_ENV })).rejects.toMatchObject({ status: 404 });
    expect(await listConnections(db, intruder)).toEqual([]);
    expect(await listConnections(db, owner)).toHaveLength(1);
  });

  it("revokes at the provider, then deletes the credentials and everything synced through the connection", async () => {
    const user = await makeUser(db), bystander = await makeUser(db);
    const id = await connect(db, user, "youtube", fetch, { token: "yt-access", refreshToken: "yt-refresh" });
    const kept = await connect(db, bystander, "youtube", fetch);
    const { applyMutations } = await import("../store");
    const track = { kind: "track" as const, providerId: "vid1", title: "Song", artists: ["Artist"] };
    for (const [owner, connectionId] of [[user, id], [bystander, kept]] as const) {
      await applyMutations(db, { userId: owner, connectionId, source: "youtube" }, [
        { type: "library", relation: "favorite", entity: track },
        { type: "playlist", playlist: { providerId: "pl", name: "Mix", owned: true, snapshot: "1" } },
        { type: "playlist_items", playlistId: "pl", offset: 0, items: [{ entity: { ...track, providerId: owner === user ? "only-mine" : "vid1" } }] },
      ], 1);
    }
    const api = fakeFetch(({ url }) => (url.href === "https://oauth2.googleapis.com/revoke" ? reply({}) : undefined));
    await disconnect(db, user, id, deps(api.fetchImpl));
    expect(new URLSearchParams(api.calls[0].body).get("token")).toBe("yt-refresh");
    for (const table of ["connections", "library_items", "playlists", "sync_jobs", "now_playing"]) {
      expect(await db.query(`SELECT 1 FROM ${table} WHERE user_id = $1`, [user])).toEqual([]);
    }
    // Catalogue rows only this user's data used are gone; the one the other user still has stays.
    expect((await db.query<{ provider_id: string }>("SELECT provider_id FROM provider_entities WHERE provider = 'youtube'")).map((r) => r.provider_id)).toEqual(["vid1"]);
    expect(await db.query("SELECT 1 FROM library_items WHERE user_id = $1", [bystander])).toHaveLength(1);
  });

  it("still deletes locally when the provider can't be reached to revoke", async () => {
    const user = await makeUser(db);
    const id = await connect(db, user, "youtube", fetch);
    const api = fakeFetch(() => reply({ error: "down" }, 503));
    await disconnect(db, user, id, deps(api.fetchImpl));
    expect(await listConnections(db, user)).toEqual([]);
  });
});
