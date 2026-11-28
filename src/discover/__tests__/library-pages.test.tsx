// The Library and Friend paths pages, rendered whole.
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => "/discover/friends" }));
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

import FriendsPage from "@/app/discover/friends/page";
import LibraryPage from "@/app/discover/library/page";
import { catalog } from "../lib/catalog";
import { searchCatalog } from "../lib/search";
import { query, renderPage, textOf } from "./render";

const c = catalog();
const idOf = (name: string) => searchCatalog(c, name, ["artist"])[0].id;

describe("Library", () => {
  it("offers to connect a service, before anything is read in the browser", async () => {
    const text = textOf(await renderPage(LibraryPage()));
    expect(text).toContain("Connect a service by its public username");
    expect(text).toContain("ListenBrainz");
    expect(text).toContain("Your Nexus");
  });
});

describe("Friend paths", () => {
  it("shows a friend's artists from their link, named as they asked", async () => {
    const text = textOf(await renderPage(FriendsPage(query({ with: `${idOf("Adele")},nope,${idOf("Drake")}`, name: "sam" }))));
    expect(text).toContain("Sam’s artists");
    expect(text).toContain("Adele");
    expect(text).toContain("Drake");
  });

  it("calls an unnamed or oddly named friend “your friend”, and offers your own link without one", async () => {
    expect(textOf(await renderPage(FriendsPage(query({ with: idOf("Adele"), name: "<b>" }))))).toContain("Your friend’s artists");
    const alone = textOf(await renderPage(FriendsPage(query())));
    expect(alone).not.toContain("’s artists");
    expect(alone).toContain("How are your top artists connected to a friend’s?");
  });
});

describe("personal pages", () => {
  it("are left out of search engines", async () => {
    const pages = await Promise.all([
      import("@/app/discover/library/page"),
      import("@/app/discover/friends/page"),
      import("@/app/discover/you/page"),
    ]);
    for (const { metadata } of pages) expect(metadata.robots).toEqual({ index: false, follow: true });
  });
});
