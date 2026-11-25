import { describe, expect, it } from "vitest";
import { maxDuration } from "../api/musicbrainz/collaborators/route";
import { maxDuration as soundMaxDuration } from "../api/sound/route";
import { maxDuration as creditsMaxDuration } from "../api/credits/route";
import { SOUND_TIMEOUT_MS } from "@/lib/sound";

describe("collaborators route config", () => {
  // A cold scan gets 20 s per artist before reporting a partial result, plus one slow last request.
  it("allows well over a cold scan's duration on serverless hosts", () => {
    expect(maxDuration).toBeGreaterThanOrEqual(60);
    expect(creditsMaxDuration).toBeGreaterThanOrEqual(60);
  });
});

describe("sound route config", () => {
  // The song_compare service may be cold (Python start + catalog load) on its first request.
  it("waits long enough for a cold sound service, and the route outlasts two rounds of it", () => {
    expect(SOUND_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000);
    expect(soundMaxDuration * 1000).toBeGreaterThan(2 * SOUND_TIMEOUT_MS);
  });
});


describe("similar route", () => {
  it("rejects a bad kind or id, and allows time for several sources", async () => {
    const { GET, maxDuration: similarMaxDuration } = await import("../api/similar/route");
    expect(similarMaxDuration).toBeGreaterThanOrEqual(60);
    expect((await GET(new Request("http://x/api/similar?kind=nope&id=x"))).status).toBe(400);
    expect((await GET(new Request("http://x/api/similar?kind=artist&id=nope"))).status).toBe(400);
  });
});
