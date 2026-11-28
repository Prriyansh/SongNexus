// The Ask page: the form, examples, and every kind of answer as a reader sees it.
import { describe, expect, it, vi } from "vitest";

const crafted = vi.hoisted(() => ({ answer: null as unknown }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => "/discover" }));
vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  type Props = { href: string; prefetch?: boolean; scroll?: boolean; children?: unknown };
  return {
    default: ({ prefetch, scroll, ...props }: Props) => {
      void [prefetch, scroll];
      return createElement("a", props as never);
    },
  };
});
vi.mock("@/discover/lib/ask", async (actual) => {
  const real = await actual<typeof import("@/discover/lib/ask")>();
  return { ...real, ask: (...args: Parameters<typeof real.ask>) => crafted.answer ?? real.ask(...args) };
});

import AskPage from "@/app/discover/ask/page";
import type { Answer } from "../lib/ask";
import { catalog } from "../lib/catalog";
import { EXAMPLE_QUESTIONS } from "../lib/question";
import { searchCatalog } from "../lib/search";
import { artistRef, songRef } from "../lib/words";
import { hrefsOf, query, renderPage, textOf } from "./render";

const c = catalog();
const artist = (name: string) => artistRef(c, c.artistAt.get(searchCatalog(c, name, ["artist"])[0].id)!);
const song = (title: string) => songRef(c, c.songAt.get(searchCatalog(c, title, ["song"])[0].id)!);
const ADELE = artist("Adele");
const DRAKE = artist("Drake");
const HELLO = song("Hello");

async function page(q?: string, answer?: Answer) {
  crafted.answer = answer ?? null;
  const html = await renderPage(AskPage(query(q === undefined ? {} : { q })));
  crafted.answer = null;
  // Without the spaces tags leave inside quotes and before punctuation.
  const text = textOf(html).replace(/\s+([.,)”’])/g, "$1").replace(/([“(])\s+/g, "$1");
  return { html, text, hrefs: hrefsOf(html) };
}

describe("the Ask page", () => {
  it("starts with the form and questions to try", async () => {
    const { html, text, hrefs } = await page();
    expect(html).toContain('action="/discover/ask"');
    expect(text).toContain("Try asking");
    for (const question of EXAMPLE_QUESTIONS) expect(hrefs).toContain(`/discover/ask?q=${encodeURIComponent(question)}`);
  });

  it("answers a real question, keeping it in the form", async () => {
    const { html, text, hrefs } = await page("How is Johnny Cash connected to Rihanna?");
    expect(text).toContain("How Johnny Cash is connected to Rihanna");
    expect(text).toMatch(/\d steps apart/);
    expect(html).toContain('value="How is Johnny Cash connected to Rihanna?"');
    expect(hrefs.some((h) => h.startsWith("/discover/six-degrees?from="))).toBe(true);
    expect(text).not.toContain("Try asking");
  });

  it("cuts a very long question", async () => {
    const { html } = await page("x".repeat(260));
    expect(html).toContain(`value="${"x".repeat(200)}"`);
  });

  it("says which artist a name was taken to be", async () => {
    const said = { said: "drizzy", ref: { kind: "artist" as const, id: DRAKE.id, name: "Drake", note: "rapper" } };
    const plain = { said: "Adele", ref: { kind: "artist" as const, id: ADELE.id, name: "Adele", note: "" } };
    const noNote = { said: "adele adkins", ref: { kind: "artist" as const, id: ADELE.id, name: "Adele", note: "" } };
    const { text } = await page("q", {
      kind: "path",
      reading: "How Adele is connected to Drake",
      took: [plain, said, noNote],
      from: ADELE,
      to: DRAKE,
      result: { status: "same-artist" },
      href: "/discover/six-degrees",
    });
    expect(text).toContain("“drizzy” is read as Drake (rapper).");
    expect(text).toContain("“adele adkins” is read as Adele.");
    expect(text).not.toContain("“Adele” is read as");
    expect(text).toContain("That’s the same artist twice.");
  });

  it("says when no path was found", async () => {
    const { text } = await page("q", {
      kind: "path",
      reading: "r",
      took: [],
      from: ADELE,
      to: DRAKE,
      result: { status: "not-connected" },
      href: "/discover/six-degrees",
    });
    expect(text).toContain("No connection within six steps in this catalog.");
  });

  it("shows what two artists share, and when they share nothing", async () => {
    const full = await page("What do Adele and Ed Sheeran have in common?");
    expect(full.text).toContain("People both worked with");
    expect(full.hrefs.some((h) => h.startsWith("/compare/artists?artistA="))).toBe(true);
    const none = await page("q", {
      kind: "compare",
      reading: "What Adele and Drake have in common",
      took: [],
      a: ADELE,
      b: DRAKE,
      linked: [{ category: "features", text: "They sang together", subject: null, year: 2020 }],
      linkedTotal: 1,
      shared: [],
      sharedTotal: 0,
      genres: [],
      labels: [],
      exploreHref: "/compare/artists",
      pathHref: "/discover/six-degrees",
    });
    expect(none.text).toContain("They sang together");
    expect(none.text.match(/None in this catalog\./g)).toHaveLength(3);
  });

  it("says when more people are shared than shown", async () => {
    const { text } = await page("q", {
      kind: "compare",
      reading: "r",
      took: [],
      a: ADELE,
      b: DRAKE,
      linked: [],
      linkedTotal: 0,
      shared: [DRAKE],
      sharedTotal: 15,
      genres: [{ kind: "genre", id: "pop", name: "pop", note: "" }],
      labels: [{ kind: "label", id: "x", name: "A Label", note: "" }],
      exploreHref: "/compare/artists",
      pathHref: "/discover/six-degrees",
    });
    expect(text).toContain("No credit links them directly in this catalog.");
    expect(text).toContain("And 14 more.");
  });

  it("compares two songs", async () => {
    const shared = await page("q", {
      kind: "compare-songs",
      reading: "What two songs have in common",
      took: [],
      a: HELLO,
      b: HELLO,
      shared: [{ artist: ADELE, parts: [] }, { artist: DRAKE, parts: ["guitar", "piano"] }],
      exploreHref: "/compare/songs?songA=a&songB=b",
    });
    expect(shared.text).toContain("guitar, piano");
    expect(shared.hrefs).toContain("/compare/songs?songA=a&songB=b");
    const none = await page("q", { kind: "compare-songs", reading: "r", took: [], a: HELLO, b: HELLO, shared: [], exploreHref: "/x" });
    expect(none.text).toContain("No one is credited on both in this catalog.");
  });

  it("lists a song's credits, or says there are none of that kind", async () => {
    expect((await page("Who produced Umbrella?")).text).toContain("Producers");
    const none = await page("q", { kind: "credits", reading: "Who produced “Hello”", took: [], song: HELLO, role: "producer", groups: [] });
    expect(none.text).toContain("This catalog has no producer credit for this song.");
  });

  it("lists collaborators, with a count and the rest", async () => {
    const { text } = await page("Who has Taylor Swift worked with the most?");
    expect(text).toMatch(/\d+ credits together/);
    expect(text).toMatch(/And [\d,]+ more\./);
    expect(text).toContain("Open Taylor Swift’s web");
    const none = await page("q", { kind: "collaborators", reading: "r", took: [], artist: ADELE, items: [], total: 0, href: "/x" });
    expect(none.text).toContain("None in this catalog.");
  });

  it("lists samples, or says there are none", async () => {
    expect((await page("Who sampled Chimamanda Ngozi Adichie?")).text).toContain("samples Chimamanda Ngozi Adichie");
    const none = await page("q", { kind: "sampled", reading: "r", took: [], artist: ADELE, reasons: [], total: 0 });
    expect(none.text).toContain("No sample of Adele in this catalog.");
  });

  it("lists connections, or says there are none", async () => {
    const some = await page("Artists like Bon Iver");
    expect(some.text).toContain("not a measure of how alike they sound");
    const none = await page("q", { kind: "connections", reading: "r", took: [], artist: ADELE, items: [], total: 0, href: "/x" });
    expect(none.text).toContain("None in this catalog.");
  });

  it("looks up a name", async () => {
    expect((await page("Kendrick Lamar")).hrefs.some((h) => h.startsWith("/discover/artist/"))).toBe(true);
    expect((await page("q", { kind: "lookup", reading: "r", results: [] })).text).toContain("None in this catalog.");
  });

  it("names what it couldn't find, and offers questions it can answer", async () => {
    const { text } = await page("How is Adele connected to Nobodyatall?");
    expect(text).toContain("No artist called “Nobodyatall” in this catalog.");
    expect(text).toContain("Questions Ask can answer");
  });

  it("says when a question isn't one it can answer", async () => {
    const { text } = await page("what is the meaning of life");
    expect(text).toContain("Not a question Ask can answer yet");
    expect(text).toContain("Questions Ask can answer");
  });
});
