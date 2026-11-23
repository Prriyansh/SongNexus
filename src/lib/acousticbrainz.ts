// Audio descriptors from AcousticBrainz (CC0), by MusicBrainz recording id, so nothing is matched by
// name. AcousticBrainz stopped collecting in 2022 and its API serves that final dataset: many songs,
// especially newer ones, have no data, and that is reported rather than filled in. The values are
// AcousticBrainz's own measurements and classifier estimates, never Spotify's audio features.
// Not used: the voice-gender classifier (it labels people) and the genre classifiers (genres come
// from MusicBrainz).

import { UUID_RE, ValidationError, withCache } from "./musicbrainz";
import { sourceJson } from "./credit-sources";
import type { SourceOptions } from "./credit-sources";
import type { AudioClass, AudioComparison, AudioDescriptors } from "./types";

const API = "https://acousticbrainz.org/api/v1";
// The dataset no longer changes, so a day is only a bound on memory, not on freshness.
const CACHE_MS = 24 * 60 * 60_000;
const LOW_LEVEL_FEATURES = "rhythm.bpm;tonal.key_key;tonal.key_scale";

/** Classifier → the class whose probability is shown, and what it's called in the app. */
export const CLASSIFIERS: readonly (readonly [classifier: string, value: string, name: string])[] = [
  ["danceability", "danceable", "Danceable"],
  ["mood_happy", "happy", "Happy"],
  ["mood_sad", "sad", "Sad"],
  ["mood_relaxed", "relaxed", "Relaxed"],
  ["mood_aggressive", "aggressive", "Aggressive"],
  ["mood_party", "party", "Party"],
  ["mood_acoustic", "acoustic", "Acoustic"],
  ["mood_electronic", "electronic", "Electronic"],
  ["voice_instrumental", "instrumental", "Instrumental"],
];

type Submission = Record<string, unknown>;
/** Bulk responses: { [mbid]: { "0": first submission, ... }, mbid_mapping: ... }. */
type Bulk = Record<string, Record<string, Submission> | undefined>;

const dig = (value: unknown, path: string[]): unknown =>
  path.reduce<unknown>((node, key) => (node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined), value);
const finite = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

/** The descriptors in one recording's first submission (offset 0), or null if there's nothing. */
export function readDescriptors(id: string, low: Submission | undefined, high: Submission | undefined): AudioDescriptors | null {
  const bpm = finite(dig(low, ["rhythm", "bpm"]));
  const keyName = text(dig(low, ["tonal", "key_key"]));
  const scale = text(dig(low, ["tonal", "key_scale"]));
  const classes: AudioClass[] = CLASSIFIERS.flatMap(([classifier, value, name]) => {
    const probability = finite(dig(high, ["highlevel", classifier, "all", value]));
    return probability === null || probability < 0 || probability > 1 ? [] : [{ name, probability }];
  });
  if (bpm === null && !keyName && !classes.length) return null;
  return {
    url: `https://acousticbrainz.org/${id}`,
    bpm: bpm === null ? null : Math.round(bpm),
    key: keyName ? `${keyName}${scale ? ` ${scale}` : ""}` : null,
    classes,
  };
}

/** Descriptors for each recording AcousticBrainz has; recordings it lacks are left out. */
export async function audioDescriptors(ids: string[], options: SourceOptions = {}): Promise<Map<string, AudioDescriptors>> {
  const list = [...new Set(ids.map((id) => id.toLowerCase()))].sort();
  if (!list.length || list.some((id) => !UUID_RE.test(id))) throw new ValidationError("AcousticBrainz needs MusicBrainz recording ids.");
  const joined = list.join(";");
  const [low, high] = await withCache(`acousticbrainz:${joined}`, CACHE_MS, options.useCache ?? true, () => Promise.all([
    sourceJson<Bulk>("AcousticBrainz", `${API}/low-level?recording_ids=${joined}&features=${LOW_LEVEL_FEATURES}`, {}, options),
    sourceJson<Bulk>("AcousticBrainz", `${API}/high-level?recording_ids=${joined}`, {}, options),
  ]));
  const out = new Map<string, AudioDescriptors>();
  for (const id of list) {
    const descriptors = readDescriptors(id, low?.[id]?.["0"], high?.[id]?.["0"]);
    if (descriptors) out.set(id, descriptors);
  }
  return out;
}

/** Validates `a` and `b`: two different MusicBrainz recording ids. */
export function parseRecordingPair(params: URLSearchParams): { a: string; b: string } {
  const a = (params.get("a") ?? "").trim().toLowerCase();
  const b = (params.get("b") ?? "").trim().toLowerCase();
  if (!UUID_RE.test(a) || !UUID_RE.test(b)) throw new ValidationError('Query params "a" and "b" must be MusicBrainz recording UUIDs.');
  if (a === b) throw new ValidationError("Pick two different songs.");
  return { a, b };
}

/** Both songs' descriptors. A failed or missing source is reported, never an error for the page. */
export async function compareAudio(a: string, b: string, options: SourceOptions = {}): Promise<AudioComparison> {
  try {
    const found = await audioDescriptors([a, b], options);
    const [da, db] = [found.get(a) ?? null, found.get(b) ?? null];
    return { a: da, b: db, source: { source: "AcousticBrainz", status: da && db ? "ok" : "no-match" } };
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    console.warn("[acousticbrainz] failed:", error);
    return { a: null, b: null, source: { source: "AcousticBrainz", status: "failed" } };
  }
}
