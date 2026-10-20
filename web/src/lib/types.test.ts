import { describe, expect, it } from "vitest";
import {
  formatDuration,
  isSong,
  sharedTags,
  type Artist,
  type Song,
} from "./types";

const song = (over: Partial<Song> = {}): Song => ({
  id: "s1",
  title: "Song",
  durationMs: null,
  disambiguation: "",
  artists: [],
  tags: [],
  releases: [],
  ...over,
});

const artist = (over: Partial<Artist> = {}): Artist => ({
  id: "a1",
  name: "Artist",
  disambiguation: "",
  country: "",
  type: "",
  tags: [],
  lifeSpan: {},
  ...over,
});

describe("isSong", () => {
  it("identifies songs by their title field", () => {
    expect(isSong(song())).toBe(true);
    expect(isSong(artist())).toBe(false);
  });
});

describe("formatDuration", () => {
  it("formats milliseconds as m:ss", () => {
    expect(formatDuration(346066)).toBe("5:46");
    expect(formatDuration(5000)).toBe("0:05");
    expect(formatDuration(65000)).toBe("1:05");
  });

  it("returns a clear fallback when duration is missing", () => {
    expect(formatDuration(null)).toBe("Not available");
  });
});

describe("sharedTags", () => {
  it("returns tags present on both, in the first's order", () => {
    const a = song({ tags: ["rock", "pop", "indie"] });
    const b = artist({ tags: ["indie", "rock"] });
    expect(sharedTags(a, b)).toEqual(["rock", "indie"]);
  });

  it("returns an empty array when nothing overlaps", () => {
    expect(sharedTags(song({ tags: ["rock"] }), artist({ tags: ["jazz"] }))).toEqual([]);
  });
});
