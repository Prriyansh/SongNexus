import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Serve the team's static SongNexus frontend (public/song-nexus.html) at the
  // root, same-origin as the /api/musicbrainz/* routes so the HTML's relative
  // API calls resolve. The Next app is the API/backend; its React page UI is
  // intentionally not used as the frontend.
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/", destination: "/song-nexus.html" },
        // Shareable comparison links, e.g. /compare/artists?artistA=…&artistB=…
        { source: "/compare/:mode(artists|songs)", destination: "/song-nexus.html" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  turbopack: {
    // Pin the workspace root to this app so Next doesn't infer it from a stray
    // lockfile in a parent directory.
    root: __dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
