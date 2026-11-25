import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The deployed frontend is the team's HTML design in public/, served at / by a
// Next rewrite. These tests guard that the comparison feature stays integrated
// into that design and keeps all MusicBrainz work on the server.
const html = readFileSync(
  fileURLToPath(new URL("../../../public/song-nexus.html", import.meta.url)),
  "utf8"
);
const compareScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1])
  .pop()!;

describe("song-nexus.html — preserved design", () => {
  it("keeps the original shell, brand and all five original views", () => {
    expect(html).toContain("<b>Song Nexus</b>");
    for (const id of ["v-foryou", "v-connect", "v-explore", "v-degrees", "v-setup"]) {
      expect(html).toContain(`id="${id}"`);
    }
    for (const nav of ["For you", "Connect", "Explore", "Six Degrees", "Setup"]) {
      expect(html).toContain(`>${nav}</button>`);
    }
  });

  it("keeps the d3 prototype and its sample-data app intact", () => {
    expect(html).toContain("d3.min.js");
    expect(html).toContain("function renderConnect()");
    expect(html).toContain('taylor:{n:"Taylor Swift"');
  });
});

describe("song-nexus.html — added Compare feature", () => {
  it("adds a Compare nav item and view wired to the existing router", () => {
    expect(html).toContain('data-go="compare"');
    expect(html).toContain('id="v-compare"');
    expect(compareScript).toContain("RENDER.compare = renderCompare");
  });

  it("reuses the existing design vocabulary rather than Next page styling", () => {
    const compareSection = html.slice(
      html.indexOf('id="v-compare"'),
      html.indexOf('id="v-explore"')
    );
    // Static markup reuses existing shell/control classes...
    for (const cls of ["card pick", "chip", "btn btn-primary", "cmp-pick"]) {
      expect(compareSection).toContain(cls);
    }
    // ...and the rendered cards reuse the Connect view's side/sims components.
    for (const cls of ["card side", "sims", "side-top", "works"]) {
      expect(compareScript).toContain(cls);
    }
    // No dark/lime Next styling or framework bundle leaked into the frontend.
    expect(html).not.toContain("lime-300");
    expect(html).not.toMatch(/bg-\[#10110f\]/);
  });

  it("offers both artist and song comparison modes", () => {
    expect(html).toContain('data-cmpmode="artists"');
    expect(html).toContain('data-cmpmode="songs"');
  });
});

describe("song-nexus.html — API usage stays server-side", () => {
  it("calls the app's own relative API routes", () => {
    expect(compareScript).toContain("/api/musicbrainz/search");
    expect(compareScript).toContain("/api/musicbrainz/details");
  });

  it("does not duplicate MusicBrainz integration in the browser", () => {
    // No upstream host, no User-Agent, no API keys in client code.
    expect(compareScript).not.toContain("musicbrainz.org");
    expect(compareScript).not.toContain("coverartarchive.org");
    expect(compareScript.toLowerCase()).not.toContain("user-agent");
  });

  it("handles loading, empty, error and retryable states", () => {
    expect(compareScript).toContain("Searching MusicBrainz");
    expect(compareScript).toContain("No matches");
    expect(compareScript).toContain("data-cmpretry");
    expect(compareScript).toContain("retryable");
  });
});
