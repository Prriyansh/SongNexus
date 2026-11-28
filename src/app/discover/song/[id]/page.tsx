import { GitCompareArrows, Network } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ShareButton from "@/discover/components/ShareButton";
import { AppLink, ArtistLink, Chips, Cover, plural, Section } from "@/discover/components/parts";
import { knownSongs } from "@/discover/lib/browse";
import { catalog } from "@/discover/lib/catalog";
import { creditGroups } from "@/discover/lib/credits";
import { pageMetadata } from "@/discover/lib/metadata";
import { entityHref } from "@/discover/lib/types";
import { artistRef, songCover, songRef } from "@/discover/lib/words";

type Props = PageProps<"/discover/song/[id]">;

const PRERENDERED = 30;
const COVER = 176;

export function generateStaticParams() {
  const c = catalog();
  return knownSongs(c, PRERENDERED).map((s) => ({ id: c.songs[s].id }));
}

async function find(params: Props["params"]): Promise<number> {
  const { id } = await params;
  return catalog().songAt.get(id.toLowerCase()) ?? notFound();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const at = await find(params);
  const c = catalog();
  const { id, name, note, image } = songRef(c, at);
  const people = new Set(c.songs[at].credits.map((x) => x.artist)).size;
  return pageMetadata(
    note ? `${name} by ${note}` : name,
    `The ${plural(people, "person", "people")} credited on “${name}”${note && ` by ${note}`}: performers, producers, musicians and engineers.`,
    `/discover/song/${id}`,
    image,
  );
}

function length(seconds: number | null): string | null {
  if (seconds === null) return null;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default async function SongPage({ params }: Props) {
  const at = await find(params);
  const c = catalog();
  const song = c.songs[at];
  const releases = c.songReleases[at].map((r) => c.releases[r]);
  const labels = [...new Set(releases.flatMap((r) => r.labels))].map((l) => c.labels[l]);
  return (
    <>
      <header className="dx-entity">
        <div className="dx-entity-photo">
          <Cover url={songCover(c, at)} size={COVER} />
        </div>
        <div className="dx-entity-text">
          <p className="dx-over">
            {["Song", song.year, length(song.seconds)].filter(Boolean).join(" · ")}
          </p>
          <h1>{song.title}</h1>
          <p className="dx-by">
            {song.primary.map((a, i) => (
              <span key={a}>
                {i > 0 && ", "}
                <Link href={entityHref({ kind: "artist", id: c.artists[a].id })}>
                  {c.artists[a].name}
                </Link>
              </span>
            ))}
          </p>
          <div className="dx-actions">
            <AppLink className="dx-button" href={`/compare/songs?songA=${song.id}`}>
              <GitCompareArrows size={16} aria-hidden="true" /> Compare this song
            </AppLink>
            <AppLink className="dx-button dx-quiet" href={`/connections?mode=song&song=${song.id}`}>
              <Network size={16} aria-hidden="true" /> Similar music
            </AppLink>
            <ShareButton label="Share" title={song.title} />
          </div>
        </div>
      </header>
      {creditGroups(song.credits).map(({ title, people }) => (
        <Section key={title} title={title}>
          <div className="dx-grid">
            {people.map(({ artist, parts }) => (
              <ArtistLink key={artist} artist={artistRef(c, artist)}>
                {parts.join(", ") || undefined}
              </ArtistLink>
            ))}
          </div>
        </Section>
      ))}
      {releases.length > 0 && (
        <Section title={releases.length === 1 ? "Album" : "Albums"}>
          <div className="dx-grid">
            {releases.map((r) => (
              <a
                key={r.id}
                className="dx-row"
                href={`https://musicbrainz.org/release-group/${r.id}`}
              >
                <Cover url={r.cover} />
                <span className="dx-row-text">
                  <strong>{r.title}</strong>
                  <small>{[r.year, "on MusicBrainz"].filter(Boolean).join(" · ")}</small>
                </span>
              </a>
            ))}
          </div>
        </Section>
      )}
      {labels.length > 0 && (
        <Section title="Labels">
          <Chips
            label="Labels"
            items={labels.map(({ id, name }) => ({ kind: "label", id, name, note: "" }))}
          />
        </Section>
      )}
      <p className="dx-source">
        <a href={`https://musicbrainz.org/recording/${song.id}`}>{song.title} on MusicBrainz</a>
      </p>
    </>
  );
}
