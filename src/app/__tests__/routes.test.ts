import { describe, expect, it } from "vitest";
import config from "../../../next.config";

// The React app is one client page at "/"; these rewrites let its other URLs load it directly.
describe("next.config rewrites", () => {
  it("serves every app URL from the React page and keeps the old prototype reachable", async () => {
    const rewrites = await config.rewrites!();
    const beforeFiles = Array.isArray(rewrites) ? rewrites : (rewrites.beforeFiles ?? []);
    const map = Object.fromEntries(beforeFiles.map((r) => [r.source, r.destination]));
    expect(map).toEqual({
      "/about": "/",
      "/about/manual": "/",
      "/connections": "/",
      "/friends": "/",
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

describe("next.config headers", () => {
  it("sends the security headers with every response", async () => {
    const [rule, ...rest] = await config.headers!();
    expect(rest).toEqual([]);
    expect(rule.source).toBe("/:path*");
    const sent = Object.fromEntries(rule.headers.map((h) => [h.key, h.value]));
    expect(sent).toEqual({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
      // Google's sign-in popup has to be able to answer the page that opened it.
      "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    });
  });
});
