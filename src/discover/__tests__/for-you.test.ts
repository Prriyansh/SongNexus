// For you, and the routes behind the home page's personal parts.
import { afterEach, describe, expect, it, vi } from "vitest";

const empty = vi.hoisted(() => ({ stories: false }));
// Outside a request, Next's connection() refuses; here it only marks the route as dynamic.
vi.mock("next/server", async (actual) => ({ ...(await actual<object>()), connection: async () => {} }));
vi.mock("@/discover/lib/stories", async (actual) => {
  const real = await actual<typeof import("@/discover/lib/stories")>();
  return { ...real, stories: (g: Parameters<typeof real.stories>[0]) => (empty.stories ? [] : real.stories(g)) };
});

import { GET as forYouRoute } from "@/app/api/discover/for-you/route";
import { GET as todayRoute } from "@/app/api/discover/today/route";
import { dayNumber } from "../lib/days";
import { forYou, genreIndex, PICKS } from "../lib/for-you";
import { normalize, searchCatalog } from "../lib/search";
import { graph } from "../lib/server";
import { stories } from "../lib/stories";
import type { ForYouPick } from "../lib/types";
import { world } from "./world";

const names = (picks: ForYouPick[]) => picks.map((p) => p.artist.name);

describe("for you", () => {
  const g = world({
    artists: ["S1", "S2", "X", "Y", "Shared", "Hidden"],
    others: ["Engineer"],
    songs: [
      ["s1x", 2000, [["S1", "primary"], ["X", "featured"]]],
      ["s2y", 2001, [["S2", "primary"], ["Y", "featured"]]],
      // Shared is connected to both favourites, more strongly to S2.
      ["s1shared", 2002, [["S1", "primary"], ["Shared", "instrument", "guitar"]]],
      ["s2shared", 2003, [["S2", "primary"], ["Shared", "featured"]]],
      ["s1hidden", 2004, [["S1", "primary"], ["Hidden", "featured"]]],
      // No one listens to an engineer.
      ["s1eng", 2005, [["S1", "primary"], ["Engineer", "featured"]]],
    ],
  });
  const at = (name: string) => g.catalog.artists.findIndex((a) => a.name === name);

  it("suggests who the favourites are connected to, those connected to more of them first", () => {
    const picks = forYou(g, [at("S1"), at("S2")], [], new Set([at("Hidden")]));
    expect(names(picks)).toEqual(["Shared", "X", "Y"]);
    const shared = picks[0];
    expect(shared.because!.name).toBe("S2");
    expect(shared.reason!.text).toBe("Shared is featured on “s2shared” by S2");
    expect(shared.genre).toBeNull();
    // Whichever favourite comes first, the closer one is the reason.
    expect(forYou(g, [at("S2"), at("S1")], [])[0].because!.name).toBe("S2");
  });

  it("leaves out the favourites themselves, hidden artists and artists no one listens to", () => {
    const picks = names(forYou(g, [at("S1")], []));
    expect(picks).toContain("Hidden");
    expect(picks).not.toContain("S1");
    expect(picks).not.toContain("Engineer");
  });

  it("fills up with the best-known artists of favourite genres, in turn, up to a limit", () => {
    const people = Array.from({ length: 24 }, (_, i) => `G${i}`);
    const genres = world({
      artists: ["Fan", ...people],
      others: ["Quiet"],
      songs: [["fan", 2000, [["Fan", "primary"], ["G0", "featured"]]]],
      genres: Object.fromEntries([...people.map((p, i) => [p, [[i % 2, 100]]]), ["Quiet", [[0, 100]]]]),
      // Two pop artists tie for the most listeners: the first in the catalog goes first.
      listeners: { G2: 200_000, G4: 200_000 },
    });
    const pos = (name: string) => genres.catalog.artists.findIndex((a) => a.name === name);
    const picks = forYou(genres, [pos("Fan")], [0, 1]);
    expect(picks).toHaveLength(PICKS);
    expect(names(picks).slice(0, 4)).toEqual(["G0", "G2", "G1", "G4"]);
    expect(picks[1].genre!.name).toBe("pop");
    expect(picks[2].genre!.name).toBe("rock");
    expect(names(picks)).not.toContain("Quiet");
  });

  it("finds genres by name or slug, without case or accents", () => {
    const index = genreIndex(graph().catalog);
    const hipHop = index.get(normalize("hip hop"));
    expect(hipHop).toBeDefined();
    expect(index.get(normalize("Hip-Hop"))).toBe(hipHop);
    expect(index.get(normalize("Électronique"))).toBeUndefined();
  });
});

describe("the for-you route", () => {
  const c = graph().catalog;
  const id = (name: string) => searchCatalog(c, name, ["artist"])[0].id;
  const call = async (query: string) => (await forYouRoute(new Request(`http://x/api/discover/for-you?${query}`))).json();

  it("reads favourites and hidden artists, ignoring what the catalog doesn't know", async () => {
    const taylor = id("Taylor Swift");
    const body = await call(`artists=${taylor.toUpperCase()},${taylor},nope&genre=Pop&genre=unknown&hidden=${id("Jack Antonoff")}`);
    expect(body.known).toEqual({ artists: 1, genres: 1 });
    expect(body.picks.length).toBe(PICKS);
    expect(body.picks.map((p: ForYouPick) => p.artist.name)).not.toContain("Jack Antonoff");
  });

  it("answers an empty list without favourites", async () => {
    expect(await call("")).toEqual({ picks: [], known: { artists: 0, genres: 0 } });
  });
});

describe("the today route", () => {
  afterEach(() => {
    vi.useRealTimers();
    empty.stories = false;
  });

  it("counts days in UTC", () => {
    expect(dayNumber(0)).toBe(0);
    expect(dayNumber(Date.UTC(2026, 10, 28, 23, 59))).toBe(dayNumber(Date.UTC(2026, 10, 28)));
  });

  it("gives everyone the same story until midnight UTC, then the next", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 28, 23, 30) });
    const all = stories(graph());
    const response = await todayRoute();
    const body = await response.json();
    expect(body.day).toBe(dayNumber(Date.now()));
    expect(body.story.text).toBe(all[body.story.n - 1].text);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=1800");
    vi.setSystemTime(Date.UTC(2026, 10, 29, 1));
    const next = await (await todayRoute()).json();
    expect(next.story.n).toBe((body.story.n % all.length) + 1);
    expect((await todayRoute()).headers.get("Cache-Control")).toBe("public, max-age=3600");
  });

  it("has no story for a catalog without any", async () => {
    empty.stories = true;
    expect((await (await todayRoute()).json()).story).toBeNull();
  });
});
