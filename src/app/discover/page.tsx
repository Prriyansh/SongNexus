import { Spline, Waypoints } from "lucide-react";
import Link from "next/link";
import EntitySearch from "@/discover/components/EntitySearch";
import ForYouShelf from "@/discover/components/ForYouShelf";
import RecentShelf from "@/discover/components/RecentShelf";
import TodayCard from "@/discover/components/TodayCard";
import { AppLink, ArtistCard, Avatar, Chips, plural, Section } from "@/discover/components/parts";
import { biggestGenres, biggestLabels, popularArtists, surprisePairs } from "@/discover/lib/browse";
import { sixDegreesHref } from "@/discover/lib/links";
import { pageMetadata } from "@/discover/lib/metadata";
import { graph } from "@/discover/lib/server";

export const metadata = pageMetadata(
  "Discover",
  "The people behind the music: paths between artists, who worked with whom, and the songs, labels and genres that connect them.",
  "/discover",
);

const PAIRS = 6;
const ARTISTS = 18;
const GENRES = 36;
const LABELS = 24;

export default function DiscoverHome() {
  const g = graph();
  const c = g.catalog;
  return (
    <>
      <header className="dx-hero">
        <h1>The people behind the music</h1>
        <p>
          {plural(c.artists.length, "artist")} and {plural(c.songs.length, "song")}, linked by real
          credits.
        </p>
        <EntitySearch
          main
          label="Search Discover"
          placeholder="An artist, song, label or genre"
          kinds={["artist", "song", "label", "genre"]}
        />
        <TodayCard />
      </header>
      <Section
        title="For you"
        note={
          <>
            Artists connected to your favourites in <AppLink href="/about">About Me</AppLink>.
          </>
        }
      >
        <ForYouShelf />
      </Section>
      <RecentShelf title="Where you left off" />
      <div className="dx-cards">
        <Link className="dx-card" href="/discover/six-degrees">
          <Spline size={26} aria-hidden="true" />
          <span>
            <strong>Six Degrees</strong>
            <small>Pick two artists and see the chain of people between them.</small>
          </span>
        </Link>
        <Link className="dx-card" href="/discover/connections">
          <Waypoints size={26} aria-hidden="true" />
          <span>
            <strong>Collaborators</strong>
            <small>Start from one artist and open the web of who they worked with.</small>
          </span>
        </Link>
      </div>
      <Section
        title="Closer than you’d think"
        note="Artists from different worlds, and how few people are between them."
      >
        <div className="dx-pairs">
          {surprisePairs(g)
            .slice(0, PAIRS)
            .map(({ from, to, steps }) => (
              <Link
                key={`${from.id}${to.id}`}
                className="dx-pair"
                href={sixDegreesHref({ from, to })}
                prefetch={false}
              >
                <span className="dx-pair-faces">
                  <Avatar id={from.id} name={from.name} photo={from.photo} size={60} eager />
                  <Avatar id={to.id} name={to.name} photo={to.photo} size={60} eager />
                </span>
                <span>
                  <strong>
                    {from.name} and {to.name}
                  </strong>
                  <small>{plural(steps, "step")} apart</small>
                </span>
              </Link>
            ))}
        </div>
      </Section>
      <Section title="Artists" note="The most listened to on ListenBrainz with full pages here.">
        <div className="dx-portraits">
          {popularArtists(c, ARTISTS).map((artist) => (
            <ArtistCard key={artist.id} artist={artist} />
          ))}
        </div>
      </Section>
      <Section title="Genres">
        <Chips label="Genres" items={biggestGenres(c, GENRES)} />
      </Section>
      <Section title="Labels" note="The labels with the most albums in this catalog.">
        <Chips label="Labels" items={biggestLabels(c, LABELS)} />
      </Section>
    </>
  );
}
