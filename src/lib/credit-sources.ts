// Shared by the sources that add credits MusicBrainz lacks (Genius, Discogs): plain requests, a
// label-to-role mapping, and finding the people a source credits on both artists' work.

import { UpstreamError } from "./musicbrainz";
import type { CreditEvidence, CreditSource, SourcedCollaborator } from "./types";

export const USER_AGENT = "SongNexus/1.0.0 (https://github.com/Prriyansh/SongNexus)";
const TIMEOUT_MS = 10_000;

export type SourceOptions = {
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
  useCache?: boolean;
  throttleMs?: number;
  budgetMs?: number;
};

/** Fetches JSON from another source; every failure is an UpstreamError naming that source. */
export async function sourceJson<T>(source: string, url: string, init: RequestInit = {}, options: SourceOptions = {}): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...init,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...init.headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new UpstreamError(`Could not reach ${source}.`, 502, true);
  }
  if (!response.ok) {
    throw new UpstreamError(`${source} returned an error (${response.status}).`, 502, response.status === 429 || response.status >= 500);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new UpstreamError(`${source} returned a malformed response.`, 502, false);
  }
}

/** Case, accents and punctuation don't count. Scripts other than Latin are kept, so they still compare. */
export const normalizeName = (name: string) =>
  name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

const IGNORED_LABEL = /master|design|photo|artwork|art direction|a&r|manage|publish|label|copyright|liner|manufactur|distribut|booking|legal|marketing| at$/i;
const INSTRUMENT_LABEL = /instrument|guitar|bass|drum|percussion|piano|keyboard|synth|organ|string|violin|viola|cello|sax|trumpet|trombone|horn|flute|harp|banjo|ukulele|mandolin|tambourine|cymbal|timbales|performer/i;

/** The same role names MusicBrainz credits get; null for labels the app doesn't show. */
export function creditRole(label: string): string | null {
  if (IGNORED_LABEL.test(label)) return null;
  if (/produc/i.test(label)) return "producer";
  if (/mix/i.test(label)) return "mixing";
  if (/writ|lyric|compos|music by/i.test(label)) return "songwriting";
  if (/program/i.test(label)) return "programming";
  if (/engineer|record/i.test(label)) return "engineering";
  if (/feat/i.test(label)) return "featured";
  if (/vocal|choir|rap\b/i.test(label)) return "vocals";
  return INSTRUMENT_LABEL.test(label) ? "instruments" : null;
}

export type SourcedPerson = { name: string; url: string; roles: Set<string>; work: Map<string, CreditEvidence> };
/** Everyone a source credits on one artist's work, keyed by that source's own person id. */
export type SourcedPeople = Map<string, SourcedPerson>;

export function addCredit(people: SourcedPeople, id: string, name: string, url: string, role: string | null, work: CreditEvidence) {
  if (!id || !name || !role) return;
  const person = people.get(id) ?? { name, url, roles: new Set<string>(), work: new Map<string, CreditEvidence>() };
  person.roles.add(role);
  person.work.set(work.url, work);
  people.set(id, person);
}

const EVIDENCE_PER_SIDE = 5;

/**
 * People in both lists, strongest overlap first, leaving out the two artists themselves. Ids compare
 * within one source, so two people who share a name can't be confused.
 */
export function commonPeople(source: CreditSource, a: SourcedPeople, b: SourcedPeople, artists: string[]): SourcedCollaborator[] {
  const refs = (person: SourcedPerson) => [...person.work.values()].slice(0, EVIDENCE_PER_SIDE);
  return [...a]
    .filter(([id]) => b.has(id) && !artists.includes(id))
    .map(([id, pa]) => {
      const pb = b.get(id)!;
      return {
        source, id, name: pa.name, url: pa.url,
        roles: { a: [...pa.roles].sort(), b: [...pb.roles].sort() },
        count: { a: pa.work.size, b: pb.work.size },
        evidence: { a: refs(pa), b: refs(pb) },
      };
    })
    .sort((x, y) => Math.min(y.count.a, y.count.b) - Math.min(x.count.a, x.count.b)
      || y.count.a + y.count.b - (x.count.a + x.count.b) || x.name.localeCompare(y.name));
}

/** Runs `step` for items in order until they or the time run out. Returns how many finished, and whether all did. */
export async function scanInOrder<T>(items: T[], budgetMs: number, spacingMs: number, step: (item: T) => Promise<void>): Promise<{ scanned: number; complete: boolean }> {
  const deadline = Date.now() + budgetMs;
  let scanned = 0;
  for (const item of items) {
    if (scanned > 0 && Date.now() > deadline) return { scanned, complete: false };
    if (scanned > 0 && spacingMs > 0) await new Promise((resolve) => setTimeout(resolve, spacingMs));
    try {
      await step(item);
      scanned++;
    } catch (error) {
      if (scanned === 0) throw error;
      return { scanned, complete: false };
    }
  }
  return { scanned, complete: true };
}
