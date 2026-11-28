import type { NextConfig } from "next";

/**
 * Sent with every response: browsers mustn't guess content types, other sites can't frame the app,
 * pages ask for no camera, microphone or location, links send only the origin elsewhere, and Google's
 * sign-in popup can still answer the page that opened it.
 */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // The React app (src/frontend, Helen's design) is a single client page at "/". Its other URLs
  // map onto that page, which reads the path itself, so links and refreshes work:
  //   /about, /about/manual, and shareable /compare/artists?artistA=…&artistB=… links.
  // The earlier HTML prototype stays reachable at /prototype.
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/about", destination: "/" },
        { source: "/about/manual", destination: "/" },
        { source: "/connections", destination: "/" },
        { source: "/friends", destination: "/" },
        { source: "/compare/:mode(artists|songs)", destination: "/" },
        { source: "/prototype", destination: "/song-nexus.html" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  turbopack: {
    // Pin the workspace root to this app so Next doesn't infer it from a stray
    // lockfile in a parent directory.
    root: __dirname,
  },
};

export default nextConfig;
