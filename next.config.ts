import type { NextConfig } from "next";

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
  turbopack: {
    // Pin the workspace root to this app so Next doesn't infer it from a stray
    // lockfile in a parent directory.
    root: __dirname,
  },
};

export default nextConfig;
