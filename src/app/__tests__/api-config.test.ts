import { describe, expect, it } from "vitest";
import { maxDuration } from "../api/musicbrainz/collaborators/route";

describe("collaborators route config", () => {
  // A cold scan reads ~6 albums at MusicBrainz's 1 request/second, about 10 s in practice.
  it("allows well over a cold scan's duration on serverless hosts", () => {
    expect(maxDuration).toBeGreaterThanOrEqual(30);
  });
});
