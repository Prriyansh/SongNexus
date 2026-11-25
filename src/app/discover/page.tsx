import type { Metadata } from "next";
import Link from "next/link";
import EntitySearch from "@/discover/components/EntitySearch";
import { ArtistLink, Chips, Section } from "@/discover/components/parts";
import { biggestGenres, biggestLabels, popularArtists } from "@/discover/lib/browse";
import { catalog } from "@/discover/lib/catalog";

export const metadata: Metadata = {
  title: "Discover · Song Nexus",
  description: "Explore the people behind the music: paths between artists, collaborations, songs, labels and genres.",
};

export default function DiscoverHome() {
  const c = catalog();
  return (
    <>
      <header className="dx-head">
        <h1>Discover</h1>
        <p>
          The people behind the music and how they connect: {c.artists.length.toLocaleString("en")} artists and{" "}
          {c.songs.length.toLocaleString("en")} songs, linked by real credits.
        </p>
      </header>
      <EntitySearch label="Search Discover" placeholder="An artist, song, label or genre" kinds={["artist", "song", "label", "genre"]} />
      <div className="dx-cards">
        <Link className="dx-card" href="/discover/six-degrees">
          <h2>Six Degrees</h2>
          <p>Pick two artists and see the chain of people between them.</p>
        </Link>
        <Link className="dx-card" href="/discover/connections">
          <h2>Collaborators</h2>
          <p>Start from one artist and open the web of who they worked with.</p>
        </Link>
      </div>
      <Section title="Artists" note="The most listened to on ListenBrainz with full pages here.">
        <div className="dx-grid">{popularArtists(c, 24).map((artist) => <ArtistLink key={artist.id} artist={artist} />)}</div>
      </Section>
      <Section title="Genres"><Chips items={biggestGenres(c, 40)} /></Section>
      <Section title="Labels" note="The labels with the most albums in this catalog."><Chips items={biggestLabels(c, 24)} /></Section>
    </>
  );
}
