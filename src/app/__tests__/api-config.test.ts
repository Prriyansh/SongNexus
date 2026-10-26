import { describe, expect, it } from "vitest";
import { maxDuration } from "../api/musicbrainz/collaborators/route";
import { maxDuration as soundMaxDuration } from "../api/sound/route";
import { SOUND_TIMEOUT_MS } from "@/lib/sound";

describe("collaborators route config", () => {
  // A cold scan reads ~6 albums at MusicBrainz's 1 request/second, about 10 s in practice.
  it("allows well over a cold scan's duration on serverless hosts", () => {
    expect(maxDuration).toBeGreaterThanOrEqual(30);
  });
});

describe("sound route config", () => {
  // The song_compare service may be cold (Python start + catalog load) on its first request.
  it("waits long enough for a cold sound service, and the route outlasts two rounds of it", () => {
    expect(SOUND_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000);
    expect(soundMaxDuration * 1000).toBeGreaterThan(2 * SOUND_TIMEOUT_MS);
  });
});

