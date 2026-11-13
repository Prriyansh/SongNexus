// The app's database: Postgres. In production it's whatever DATABASE_URL points at (Neon, Vercel
// Postgres, a container…). In development and tests it's PGlite, a real Postgres compiled to
// WebAssembly that runs inside the Node process, so nothing has to be installed and the same SQL,
// constraints and transactions apply everywhere.
//
// Conventions that keep the two drivers interchangeable:
//   - ids are uuid; counts are cast to ::int (int8 comes back as a string from `pg`);
//   - lists are jsonb, never Postgres arrays, and bulk writes send one JSON parameter through
//     jsonb_to_recordset;
//   - timestamps go in as ISO strings and come back as Date; mappers call iso().

import { MIGRATIONS } from "./migrations";

export type Row = Record<string, unknown>;

export interface Sql {
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Sql {
  /** Runs `fn` in one transaction: committed if it resolves, rolled back if it throws. */
  tx<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  driver: "postgres" | "pglite";
}

export class DatabaseUnavailableError extends Error {
  constructor() {
    super("Accounts aren’t set up on this server.");
    this.name = "DatabaseUnavailableError";
  }
}

export const iso = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString() : typeof value === "string" && value ? new Date(value).toISOString() : null;

type Env = Record<string, string | undefined>;

export const databaseUrl = (env: Env = process.env) =>
  env.DATABASE_URL?.trim() || env.POSTGRES_URL?.trim() || null;

/** Where the development database lives on disk. `memory://` keeps nothing (tests). */
export const devDataDir = (env: Env = process.env) => env.PGLITE_DATA_DIR?.trim() || ".data/pglite";

async function openPostgres(url: string): Promise<Db> {
  const { Pool } = await import("pg");
  const local = /@(localhost|127\.0\.0\.1|postgres|db)[:/]/.test(url);
  // Serverless instances each hold their own pool, so it stays small; use the provider's pooled URL.
  const pool = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10_000, ssl: local || /sslmode=disable/.test(url) ? undefined : { rejectUnauthorized: true } });
  pool.on("error", (error) => console.error("[db] idle client error:", error.message));
  return {
    driver: "postgres",
    query: async <T>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as T[],
    tx: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({ query: async <T>(text: string, params: unknown[] = []) => (await client.query(text, params)).rows as T[] });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export async function openPglite(dataDir = "memory://"): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (!dataDir.startsWith("memory://")) {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dataDir, { recursive: true });
  }
  const pg = new PGlite(dataDir);
  await pg.waitReady;
  return {
    driver: "pglite",
    query: async <T>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows,
    tx: (fn) => pg.transaction((tx) => fn({ query: async <T>(text: string, params: unknown[] = []) => (await tx.query<T>(text, params)).rows })) as Promise<never>,
    close: () => pg.close(),
  };
}

/** Applies migrations that haven't run yet, one transaction each, under a lock so two servers can't race. */
export async function migrate(db: Db): Promise<string[]> {
  await db.query("CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const applied: string[] = [];
  for (const migration of MIGRATIONS) {
    await db.tx(async (sql) => {
      await sql.query("SELECT pg_advisory_xact_lock(727274001)");
      const done = await sql.query("SELECT 1 FROM schema_migrations WHERE id = $1", [migration.id]);
      if (done.length) return;
      for (const statement of migration.statements) await sql.query(statement);
      await sql.query("INSERT INTO schema_migrations (id) VALUES ($1)", [migration.id]);
      applied.push(migration.id);
    });
  }
  return applied;
}

// On globalThis so every route shares one connection, and it survives hot reloads in development.
const shared = globalThis as { __songNexusDb?: Promise<Db> | null };

/** True when this server can store accounts: a Postgres URL, or any non-production run (PGlite). */
export const databaseConfigured = (env: Env = process.env) => Boolean(databaseUrl(env)) || env.NODE_ENV !== "production";

/**
 * The migrated database. Throws DatabaseUnavailableError in production without DATABASE_URL: an
 * in-process database there would differ between server instances and vanish on redeploy.
 */
export function getDb(env: Env = process.env): Promise<Db> {
  if (shared.__songNexusDb) return shared.__songNexusDb;
  const url = databaseUrl(env);
  if (!url && env.NODE_ENV === "production") return Promise.reject(new DatabaseUnavailableError());
  const opening = (async () => {
    const db = url ? await openPostgres(url) : await openPglite(env.NODE_ENV === "test" ? "memory://" : devDataDir(env));
    await migrate(db);
    return db;
  })();
  shared.__songNexusDb = opening;
  opening.catch(() => { shared.__songNexusDb = null; });
  return opening;
}

/** Tests: use this database for everything that calls getDb(). */
export function setDb(db: Db | null) {
  shared.__songNexusDb = db ? Promise.resolve(db) : null;
}

/** A fresh, migrated, in-memory database. */
export async function testDb(): Promise<Db> {
  const db = await openPglite();
  await migrate(db);
  return db;
}
