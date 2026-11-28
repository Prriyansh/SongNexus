// The You page and Discover's layout, with and without sign-in set up.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => "/discover/you" }));

import DiscoverLayout from "@/app/discover/layout";
import YouPage from "@/app/discover/you/page";
import { renderPage, textOf } from "./render";

afterEach(() => vi.unstubAllEnvs());

describe("You", () => {
  it("says sign-in isn't set up without its settings", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    expect(textOf(await renderPage(YouPage()))).toContain("Sign-in isn’t set up on this server");
  });

  it("offers sign-in with its settings, and keeps the layout's data in step", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-1");
    vi.stubEnv("SESSION_SECRET", "s".repeat(32));
    const text = textOf(await renderPage(YouPage()));
    expect(text).toContain("Your account");
    expect(text).not.toContain("isn’t set up");
    expect(textOf(await renderPage(DiscoverLayout({ children: "page", params: Promise.resolve({}) } as never)))).toContain("page");
  });
});
