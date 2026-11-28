// The Stories page, rendered whole from the committed catalog.
import { describe, expect, it, vi } from "vitest";

const empty = vi.hoisted(() => ({ on: false }));
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
vi.mock("@/discover/lib/stories", async (actual) => {
  const real = await actual<typeof import("@/discover/lib/stories")>();
  return { ...real, stories: (g: Parameters<typeof real.stories>[0]) => (empty.on ? [] : real.stories(g)) };
});

import StoriesPage from "@/app/discover/stories/page";
import { graph } from "../lib/server";
import { stories } from "../lib/stories";
import { hrefsOf, query, renderPage, textOf } from "./render";

const all = stories(graph());
const page = async (story?: string) => {
  const html = await renderPage(StoriesPage(query(story === undefined ? {} : { story })));
  return { html, text: textOf(html), hrefs: hrefsOf(html) };
};

describe("the Stories page", () => {
  it("opens on the first story, with its credits and a way on", async () => {
    const { text, hrefs } = await page();
    expect(text).toContain(`Story 1 of ${all.length}`);
    expect(text).toContain(all[0].text);
    expect(text).toContain(all[0].reasons[0].text);
    expect(hrefs).toContain("/discover/stories?story=2");
    expect(hrefs).not.toContain("/discover/stories?story=0");
    expect(text).not.toContain("Previous");
    for (const artist of all[0].artists) expect(hrefs).toContain(`/discover/artist/${artist.id}`);
  });

  it("opens the story an address names, and the first for a bad one", async () => {
    expect((await page("3")).text).toContain(all[2].text);
    expect((await page("nope")).text).toContain(`Story 1 of ${all.length}`);
  });

  it("ends with the last story", async () => {
    const { text, hrefs } = await page(String(all.length));
    expect(text).toContain(all[all.length - 1].text);
    expect(text).toContain("Previous");
    expect(text).not.toContain("Next");
    expect(hrefs).toContain(`/discover/stories?story=${all.length - 1}`);
  });

  it("links a pair to Six Degrees, and only stories about a pair", async () => {
    const paired = all.findIndex((s) => s.pair);
    const single = all.findIndex((s) => !s.pair);
    const withPair = await page(String(paired + 1));
    expect(withPair.hrefs.some((h) => h.startsWith("/discover/six-degrees?from="))).toBe(true);
    expect(withPair.text).toContain("in Six Degrees");
    expect((await page(String(single + 1))).text).not.toContain("in Six Degrees");
  });

  it("says so when the catalog has no stories", async () => {
    empty.on = true;
    expect((await page()).text).toContain("This catalog has no stories yet.");
    empty.on = false;
  });
});
