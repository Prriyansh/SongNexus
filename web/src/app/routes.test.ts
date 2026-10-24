import { describe, expect, it } from "vitest";
import config from "../../next.config";

// The React app is one client page at "/"; these rewrites let its other URLs load it directly.
describe("next.config rewrites", () => {
  it("serves every app URL from the React page and keeps the old prototype reachable", async () => {
    const rewrites = await config.rewrites!();
    const beforeFiles = Array.isArray(rewrites) ? rewrites : (rewrites.beforeFiles ?? []);
    const map = Object.fromEntries(beforeFiles.map((r) => [r.source, r.destination]));
    expect(map).toEqual({
      "/about": "/",
      "/about/manual": "/",
      "/compare/:mode(artists|songs)": "/",
      "/prototype": "/song-nexus.html",
    });
  });

  it("no longer rewrites the root to the HTML prototype", async () => {
    const rewrites = await config.rewrites!();
    const beforeFiles = Array.isArray(rewrites) ? rewrites : (rewrites.beforeFiles ?? []);
    expect(beforeFiles.some((r) => r.source === "/")).toBe(false);
  });
});
