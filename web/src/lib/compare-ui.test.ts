// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Drives the real Compare script extracted from the HTML frontend in an isolated
// jsdom document with mocked API responses — proving the integrated UI searches,
// selects, and renders enriched comparisons end to end.
// (jsdom's import.meta.url is an http URL, so resolve from the project cwd.)

const html = readFileSync(
  resolve(process.cwd(), "public/song-nexus.html"),
  "utf8"
);
const compareView = html.slice(
  html.indexOf('<section class="view" id="v-compare"'),
  html.indexOf('<section class="view" id="v-explore"')
);
const compareScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1])
  .pop()!;

const ID_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const ID_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

const searchArtist = (name: string, id: string) => ({
  results: [{ id, name, type: "Group", country: "GB", disambiguation: "", tags: [] }],
});

const detailsArtist = (name: string, id: string, genres: string[]) => ({
  details: {
    id,
    name,
    disambiguation: "",
    country: "GB",
    type: "Group",
    gender: "",
    area: "",
    tags: [],
    genres: genres.map((n, i) => ({ name: n, count: 30 - i })),
    rating: { value: 4.5, votes: 80 },
    lifeSpan: { begin: "1991", ended: false },
    links: [{ type: "official homepage", url: "https://example.com" }],
    discography: {
      albumCount: 9,
      epCount: 2,
      singleCount: 5,
      otherCount: 0,
      firstYear: "1993",
      lastYear: "2016",
      representative: [{ id: "rg1", title: "OK Computer", year: "1997", type: "Album", artUrl: null }],
    },
  },
});

function mockFetch() {
  return vi.fn(async (url: string) => {
    const u = new URL(String(url), "http://localhost");
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
    if (u.pathname.endsWith("/search")) {
      const q = (u.searchParams.get("q") || "").toLowerCase();
      if (q.includes("radiohead")) return ok(searchArtist("Radiohead", ID_A));
      if (q.includes("portishead")) return ok(searchArtist("Portishead", ID_B));
      return ok({ results: [] });
    }
    // details
    const id = u.searchParams.get("id");
    return ok(
      id === ID_A
        ? detailsArtist("Radiohead", ID_A, ["alternative rock", "art rock"])
        : detailsArtist("Portishead", ID_B, ["trip hop", "art rock"])
    );
  });
}

async function type(id: string, value: string) {
  const input = document.getElementById(id) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.advanceTimersByTimeAsync(500); // debounce + fetch
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = `<div class="main">${compareView}</div>`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = mockFetch();
  // Run the IIFE; it wires listeners and calls renderCompare().
  new Function(compareScript)();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Compare UI (integrated into the HTML frontend)", () => {
  it("searches and lists results from the API", async () => {
    await type("qA", "radiohead");
    const items = document.querySelectorAll("#resA .pick-item");
    expect(items.length).toBe(1);
    expect(items[0].textContent).toContain("Radiohead");
  });

  it("shows a friendly empty state for no results", async () => {
    await type("qA", "zzxqwvgibberish");
    expect(document.querySelector("#resA")!.textContent).toContain("No matches");
  });

  it("enables Compare only once two different items are selected", async () => {
    const run = document.getElementById("cmpRun") as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    await type("qA", "radiohead");
    (document.querySelector("#resA .pick-item") as HTMLElement).click();
    expect(run.disabled).toBe(true); // only one chosen
    await type("qB", "portishead");
    (document.querySelector("#resB .pick-item") as HTMLElement).click();
    expect(run.disabled).toBe(false);
  });

  it("renders an enriched comparison with shared-genre insight", async () => {
    await type("qA", "radiohead");
    (document.querySelector("#resA .pick-item") as HTMLElement).click();
    await type("qB", "portishead");
    (document.querySelector("#resB .pick-item") as HTMLElement).click();

    (document.getElementById("cmpRun") as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(10); // resolve the two details fetches

    const out = document.getElementById("cmpOut")!;
    expect(out.textContent).toContain("Radiohead");
    expect(out.textContent).toContain("Portishead");
    expect(out.textContent).toContain("Insights");
    // "art rock" is shared and should be marked as a shared genre chip.
    const sharedChip = out.querySelector(".g-chip.shared");
    expect(sharedChip?.textContent).toBe("art rock");
    // Discography made it into the card.
    expect(out.textContent).toContain("9 albums");
  });

  it("switching mode clears selections", async () => {
    await type("qA", "radiohead");
    (document.querySelector("#resA .pick-item") as HTMLElement).click();
    expect((document.getElementById("chosenA") as HTMLElement).hidden).toBe(false);

    (document.querySelector('[data-cmpmode="songs"]') as HTMLElement).click();
    expect((document.getElementById("chosenA") as HTMLElement).hidden).toBe(true);
    expect(document.getElementById("labelA")!.textContent).toBe("Song A");
  });
});
