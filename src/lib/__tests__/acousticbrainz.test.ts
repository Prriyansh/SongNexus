import { afterEach, describe, expect, it, vi } from "vitest";
import { __clearCache, ValidationError } from "../musicbrainz";
import { audioDescriptors, compareAudio, parseRecordingPair, readDescriptors } from "../acousticbrainz";

type FetchMock = (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const fail = (status: number) => ({ ok: false, status, json: async () => ({}) }) as unknown as Response;

const A = "b1a9c0e9-d987-4042-ae91-78d6a3267d69";
const B = "0c2f4c3a-0b2a-4f6e-9b8e-6b3c1f7c9d10";

// Shaped like the bulk endpoints: { [mbid]: { "0": first submission } }, plus the mapping key.
const low = { [A]: { "0": { rhythm: { bpm: 140.279 }, tonal: { key_key: "D#", key_scale: "major" } } }, mbid_mapping: {} };
const high = { [A]: { "0": { highlevel: {
  danceability: { all: { danceable: 0.149, not_danceable: 0.851 } },
  mood_sad: { all: { sad: 0.62, not_sad: 0.38 } },
  gender: { all: { female: 0.58, male: 0.42 } },
  genre_dortmund: { all: { electronic: 0.99 } },
} } }, mbid_mapping: {} };

const endpoints = (lowReply: Response, highReply: Response) => vi.fn<FetchMock>(async (input) => {
  const url = String(input);
  if (url.includes("/low-level?")) return lowReply;
  if (url.includes("/high-level?")) return highReply;
  throw new Error(`unexpected ${url}`);
});

afterEach(() => __clearCache());

describe("readDescriptors", () => {
  it("reads tempo, key and the mood classifiers, and never the gender or genre ones", () => {
    const d = readDescriptors(A, low[A]["0"], high[A]["0"]);
    expect(d).toEqual({
      url: `https://acousticbrainz.org/${A}`,
      bpm: 140,
      key: "D# major",
      classes: [{ name: "Danceable", probability: 0.149 }, { name: "Sad", probability: 0.62 }],
    });
  });

  it("is null when a submission has nothing it uses, and drops out-of-range estimates", () => {
    expect(readDescriptors(A, {}, {})).toBeNull();
    expect(readDescriptors(A, undefined, { highlevel: { mood_happy: { all: { happy: 1.7 } } } })).toBeNull();
  });
});

describe("audioDescriptors", () => {
  it("asks for both recordings at once and leaves out the ones AcousticBrainz lacks", async () => {
    const fetchImpl = endpoints(ok(low), ok(high));
    const found = await audioDescriptors([B, A.toUpperCase()], { fetchImpl, useCache: false });
    expect([...found.keys()]).toEqual([A]);
    const urls = fetchImpl.mock.calls.map(([url]) => String(url));
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain(`recording_ids=${[A, B].sort().join(";")}`);
    expect(urls[0]).toContain("features=rhythm.bpm;tonal.key_key;tonal.key_scale");
  });

  it("refuses anything that isn't a MusicBrainz id, before any request", async () => {
    const fetchImpl = vi.fn<FetchMock>();
    await expect(audioDescriptors(["x;y"], { fetchImpl })).rejects.toBeInstanceOf(ValidationError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("compareAudio", () => {
  it("reports no-match when a song has no data, keeping the other", async () => {
    const audio = await compareAudio(A, B, { fetchImpl: endpoints(ok(low), ok(high)), useCache: false });
    expect(audio.a?.bpm).toBe(140);
    expect(audio.b).toBeNull();
    expect(audio.source).toEqual({ source: "AcousticBrainz", status: "no-match" });
  });

  it("reports a failure instead of throwing when AcousticBrainz is down", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const audio = await compareAudio(A, B, { fetchImpl: endpoints(fail(503), ok(high)), useCache: false });
    warn.mockRestore();
    expect(audio).toEqual({ a: null, b: null, source: { source: "AcousticBrainz", status: "failed" } });
  });
});

describe("parseRecordingPair", () => {
  it("accepts two different recording ids, in lower case", () => {
    expect(parseRecordingPair(new URLSearchParams({ a: A.toUpperCase(), b: B }))).toEqual({ a: A, b: B });
  });

  it("rejects bad or identical ids", () => {
    expect(() => parseRecordingPair(new URLSearchParams({ a: "nope", b: B }))).toThrow(ValidationError);
    expect(() => parseRecordingPair(new URLSearchParams({ a: A, b: A }))).toThrow("Pick two different songs.");
  });
});
