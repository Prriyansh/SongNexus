// What changed for a user, as an append-only log the live stream tails. Writing to the database
// (not just an in-process emitter) is what lets a browser connected to one server instance hear
// about a sync running on another; the emitter only makes same-instance delivery immediate.

import { EventEmitter } from "node:events";
import type { Sql } from "../db";
import type { Json, LiveEvent } from "./types";

const shared = globalThis as { __songNexusBus?: EventEmitter };
const bus = (shared.__songNexusBus ??= new EventEmitter().setMaxListeners(0));

export async function publish(sql: Sql, userId: string, type: LiveEvent["type"], payload: Record<string, Json> = {}): Promise<void> {
  await sql.query("INSERT INTO user_events (user_id, type, payload) VALUES ($1, $2, $3::jsonb)", [userId, type, JSON.stringify(payload)]);
  // Listeners re-read from the database, so a rolled-back transaction can't deliver a phantom event.
  queueMicrotask(() => bus.emit(userId));
}

export async function eventsAfter(sql: Sql, userId: string, seq: number, limit = 100): Promise<LiveEvent[]> {
  const rows = await sql.query<{ seq: number; type: LiveEvent["type"]; payload: Record<string, Json> }>(
    "SELECT seq, type, payload FROM user_events WHERE user_id = $1 AND seq > $2 ORDER BY seq LIMIT $3", [userId, seq, limit]);
  return rows.map((row) => ({ seq: Number(row.seq), type: row.type, payload: row.payload }));
}

export async function latestSeq(sql: Sql, userId: string): Promise<number> {
  const [row] = await sql.query<{ seq: number | null }>("SELECT max(seq) AS seq FROM user_events WHERE user_id = $1", [userId]);
  return Number(row?.seq ?? 0);
}

/** Calls `wake` whenever this instance publishes for the user. Returns the unsubscribe. */
export function onLocalEvent(userId: string, wake: () => void): () => void {
  bus.on(userId, wake);
  return () => bus.off(userId, wake);
}
