import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { iso, migrate, testDb } from "../index";
import type { Db } from "../index";
import { MIGRATIONS } from "../migrations";

let db: Db;
beforeAll(async () => { db = await testDb(); });
afterAll(async () => { await db.close(); });

describe("database", () => {
  it("applies every migration once and records it", async () => {
    const rows = await db.query<{ id: string }>("SELECT id FROM schema_migrations ORDER BY id");
    expect(rows.map((r) => r.id)).toEqual(MIGRATIONS.map((m) => m.id));
    expect(await migrate(db)).toEqual([]);
  });

  it("rolls a transaction back when it throws", async () => {
    await expect(db.tx(async (sql) => {
      await sql.query("INSERT INTO users (username, username_key, password_hash) VALUES ('Rolled', 'rolled', 'x')");
      throw new Error("stop");
    })).rejects.toThrow("stop");
    expect(await db.query("SELECT 1 FROM users WHERE username_key = 'rolled'")).toEqual([]);
  });

  it("round-trips jsonb, bulk JSON parameters, counts and timestamps the way the mappers expect", async () => {
    const [user] = await db.query<{ id: string; created_at: unknown }>("INSERT INTO users (username, username_key, password_hash) VALUES ('Ada', 'ada', 'x') RETURNING id, created_at");
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(iso(user.created_at)).toMatch(/^\d{4}-\d\d-\d\dT/);
    const rows = [{ provider_id: "a", title: "One", artists: ["X", "Y"] }, { provider_id: "b", title: "Two", artists: [] }];
    const inserted = await db.query<{ title: string; artists: string[] }>(
      `INSERT INTO provider_entities (provider, kind, provider_id, title, artists)
       SELECT 'test', 'track', r.provider_id, r.title, r.artists FROM jsonb_to_recordset($1::jsonb) AS r(provider_id text, title text, artists jsonb)
       RETURNING title, artists`, [JSON.stringify(rows)]);
    expect(inserted).toEqual([{ title: "One", artists: ["X", "Y"] }, { title: "Two", artists: [] }]);
    const [{ n }] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM provider_entities WHERE provider = 'test'");
    expect(n).toBe(2);
    const [{ at }] = await db.query<{ at: unknown }>("SELECT $1::timestamptz AS at", ["2024-05-01T10:00:00.000Z"]);
    expect(iso(at)).toBe("2024-05-01T10:00:00.000Z");
  });

  it("refuses a second active sync job for one connection, and rows owned by both or neither source", async () => {
    const [{ id: user }] = await db.query<{ id: string }>("SELECT id FROM users WHERE username_key = 'ada'");
    const [{ id: connection }] = await db.query<{ id: string }>("INSERT INTO connections (user_id, provider, provider_user_id, credentials) VALUES ($1, 'test', 'u1', 'sealed') RETURNING id", [user]);
    await db.query("INSERT INTO sync_jobs (connection_id, user_id, kind) VALUES ($1, $2, 'initial')", [connection, user]);
    await expect(db.query("INSERT INTO sync_jobs (connection_id, user_id, kind) VALUES ($1, $2, 'manual')", [connection, user])).rejects.toThrow();
    const [{ id: entity }] = await db.query<{ id: string }>("SELECT id FROM provider_entities LIMIT 1");
    await expect(db.query("INSERT INTO listening_events (user_id, entity_id, played_at) VALUES ($1, $2, now())", [user, entity])).rejects.toThrow();
    await db.query("INSERT INTO listening_events (user_id, connection_id, entity_id, played_at) VALUES ($1, $2, $3, '2024-01-01T00:00:00Z')", [user, connection, entity]);
    await expect(db.query("INSERT INTO listening_events (user_id, connection_id, entity_id, played_at) VALUES ($1, $2, $3, '2024-01-01T00:00:00Z')", [user, connection, entity])).rejects.toThrow();
    await db.query("INSERT INTO listening_events (user_id, connection_id, entity_id, played_at) VALUES ($1, $2, $3, '2024-01-01T00:04:00Z')", [user, connection, entity]);
  });
});
