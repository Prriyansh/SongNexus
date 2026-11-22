// Helpers the adapters share: capability tables, defensive field readers and the two-phase
// playlist sync (list the playlists, then read the items of the ones that changed).

import { createHash } from "node:crypto";
import { AccessDeniedError } from "../http";
import { CAPABILITIES } from "../types";
import type { Capabilities, Capability, EntityInput, Json, PlaylistInput, StepContext, StepResult, SyncResource } from "../types";

/** Per capability: `{ note?, scopes? }` if the provider offers it, or a sentence saying why it doesn't. */
export type CapabilitySpec = Partial<Record<Capability, { note?: string; scopes?: string[] } | string>>;

export function capabilitySet(name: string, spec: CapabilitySpec, granted: string[] | null): Capabilities {
  const out = {} as Capabilities;
  for (const capability of CAPABILITIES) {
    const entry = spec[capability];
    if (entry === undefined) out[capability] = { supported: false, note: capability === "native_only" || capability === "manual_import" ? undefined : `${name}’s API doesn’t offer this.` };
    else if (typeof entry === "string") out[capability] = { supported: false, note: entry };
    else {
      const missing = granted !== null && (entry.scopes ?? []).some((scope) => !granted.includes(scope));
      out[capability] = { supported: true, ...(missing ? { missingScope: true } : {}), ...(entry.note ? { note: entry.note } : {}) };
    }
  }
  return out;
}

export const str = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");
export const optional = (value: unknown): string | undefined => str(value).trim() || undefined;
export const num = (value: unknown): number | undefined => {
  const n = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n) : undefined;
};
export const list = <T = Record<string, unknown>>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : value && typeof value === "object" ? [value as T] : []);
export const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
export const isoDate = (value: unknown): string | undefined => {
  const ms = typeof value === "number" ? value : typeof value === "string" && value ? Date.parse(value) : NaN;
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : undefined;
};
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const mbid = (value: unknown): string | undefined => (typeof value === "string" && MBID.test(value) ? value.toLowerCase() : undefined);
const ISRC = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
export const isrc = (value: unknown): string | undefined => {
  const code = str(value).replace(/[-\s]/g, "").toUpperCase();
  return ISRC.test(code) ? code : undefined;
};
export const httpsUrl = (value: unknown): string | undefined => (typeof value === "string" && /^https:\/\//.test(value) ? value : undefined);

/** Drops anything without an id or a title rather than storing a blank row. */
export const entity = (input: EntityInput): EntityInput | null => (input.providerId && input.title.trim() ? { ...input, title: input.title.trim(), artists: (input.artists ?? []).map((a) => a.trim()).filter(Boolean) } : null);

export const env = (source: Record<string, string | undefined>, name: string) => source[name]?.trim() || "";

type PlaylistPage = { playlists: PlaylistInput[]; next: Json | null };
type ItemPage = { items: { entity: EntityInput; addedAt?: string }[]; next: Json | null };
type PlaylistCursor = { phase: "list"; page: Json | null } | { phase: "items"; id?: string; page?: Json | null; offset?: number };

/**
 * Playlists in two phases. First every page of the user's playlists; then, for each playlist whose
 * snapshot changed since its items were last stored, its items. An unchanged playlist costs no
 * requests, which is what keeps this inside the providers' quotas.
 */
export function playlistResource(options: {
  intervalMinutes: number;
  scopes?: string[];
  list(ctx: StepContext, page: Json | null): Promise<PlaylistPage>;
  items(ctx: StepContext, playlistId: string, page: Json | null): Promise<ItemPage>;
}): SyncResource {
  return {
    key: "playlists",
    capability: "playlists",
    label: "Playlists",
    mode: "snapshot",
    owns: "playlists",
    intervalMinutes: options.intervalMinutes,
    scopes: options.scopes,
    async step(ctx, state): Promise<StepResult> {
      const cursor = (state.cursor ?? { phase: "list", page: null }) as PlaylistCursor;
      if (cursor.phase === "list") {
        const page = await options.list(ctx, cursor.page);
        return { mutations: page.playlists.map((playlist) => ({ type: "playlist", playlist })), next: page.next !== null ? { phase: "list", page: page.next } : { phase: "items" } };
      }
      const id = cursor.id ?? (await ctx.pendingPlaylists())[0]?.providerId;
      if (!id) return { mutations: [], next: null };
      const offset = cursor.offset ?? 0;
      let page: ItemPage;
      try {
        page = await options.items(ctx, id, cursor.page ?? null);
      } catch (error) {
        // One unreadable playlist (deleted meanwhile, or not ours to read) mustn't stop the rest.
        if (!(error instanceof AccessDeniedError)) throw error;
        return { mutations: [{ type: "playlist_done", playlistId: id, count: offset }], next: { phase: "items" } };
      }
      const count = offset + page.items.length;
      if (page.next !== null) return { mutations: [{ type: "playlist_items", playlistId: id, offset, items: page.items }], next: { phase: "items", id, page: page.next, offset: count } };
      return { mutations: [{ type: "playlist_items", playlistId: id, offset, items: page.items }, { type: "playlist_done", playlistId: id, count }], next: { phase: "items" } };
    },
  };
}

/** `https://host/path?a=1` with the given query parameters added. */
export function withQuery(base: string, params: Record<string, string | number | undefined>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, String(value));
  return url.toString();
}

/** An id for sources that name a track only by its text: the same artist and title always give the same id. */
export const textId = (...parts: string[]) => createHash("sha1").update(parts.map((p) => p.trim().toLowerCase().normalize("NFKC")).join("\u001f")).digest("hex");

/** PT3M21S → 201000. */
export function isoDurationMs(value: unknown): number | undefined {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(str(value));
  if (!match || !str(value)) return undefined;
  const [, d, h, m, s] = match;
  return Math.round(((Number(d) || 0) * 86400 + (Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0)) * 1000);
}
