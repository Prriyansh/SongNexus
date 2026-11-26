import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/discover/six-degrees" }));

import DiscoverShell from "../components/DiscoverShell";
import { currentLink, DISCOVER_LINKS, SidebarLinks } from "../components/SidebarLinks";
import { PAGES } from "@/frontend/components/AppFrame";

describe("the sidebar", () => {
  it("adds Discover’s features, marking none in the rest of the app", () => {
    const html = renderToStaticMarkup(<SidebarLinks />);
    for (const { href, label } of DISCOVER_LINKS)
      expect(html).toContain(`href="${href}" aria-label="${label}"`);
    expect(html).not.toContain("aria-current");
  });

  it("marks where you are, with entity pages under Discover", () => {
    expect(currentLink("/discover/connections")?.label).toBe("Collaborators");
    expect(currentLink("/discover/artist/x")?.label).toBe("Discover");
    expect(currentLink("/about")).toBeNull();
  });

  it("is the same on Discover’s pages as in the app", () => {
    const html = renderToStaticMarkup(<DiscoverShell>content</DiscoverShell>);
    const appLabels = PAGES.map((p) => p.name);
    expect(appLabels).toHaveLength(4);
    const labels = [...html.matchAll(/class="nav-option[^>]*? aria-label="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(labels).toEqual([...appLabels, ...DISCOVER_LINKS.map((l) => l.label)]);
    expect(html).toContain(
      'href="/discover/six-degrees" aria-label="Six Degrees" aria-current="page"',
    );
  });
});
