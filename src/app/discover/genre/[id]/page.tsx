import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ShareButton from "@/discover/components/ShareButton";
import { ArtistLink, Chips, plural, Section } from "@/discover/components/parts";
import { biggestGenres } from "@/discover/lib/browse";
import { catalog, type Catalog } from "@/discover/lib/catalog";
import { pageMetadata } from "@/discover/lib/metadata";
import type { EntityRef } from "@/discover/lib/types";
import { artistRef } from "@/discover/lib/words";

type Props = PageProps<"/discover/genre/[id]">;

const PRERENDERED = 40;
const ARTISTS = 60;
/** An artist counts toward a genre from this share of their genre votes, in percent. */
const MIN_SHARE = 10;

export function generateStaticParams() {
  return biggestGenres(catalog(), PRERENDERED).map(({ id }) => ({ id }));
}

async function find(params: Props["params"]): Promise<number> {
  const { id } = await params;
  let slug = id;
  try {
    slug = decodeURIComponent(id);
  } catch {
    // A malformed address simply isn't found.
  }
  return catalog().genreAt.get(slug) ?? notFound();
}

// Artists are listed under a genre only when they have it, so it is always found.
const shareOf = (c: Catalog, artist: number, genre: number) =>
  c.artists[artist].genres.find((g) => g.genre === genre)!.share;

function artistsOf(c: Catalog, at: number): number[] {
  const listeners = (artist: number) => c.artists[artist].listeners ?? 0;
  return c.genreArtists[at]
    .filter((artist) => shareOf(c, artist, at) >= MIN_SHARE)
    .sort((x, y) => listeners(y) - listeners(x) || x - y);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const at = await find(params);
  const c = catalog();
  const { name, slug } = c.genres[at];
  const artists = artistsOf(c, at);
  const names = artists.slice(0, 3).map((a) => c.artists[a].name);
  return pageMetadata(
    name[0].toUpperCase() + name.slice(1),
    `${plural(artists.length, "artist")} in ${name}${names.length ? `, including ${names.join(", ")}` : ""}.`,
    `/discover/genre/${encodeURIComponent(slug)}`,
  );
}

export default async function GenrePage({ params }: Props) {
  const at = await find(params);
  const c = catalog();
  const genre = c.genres[at];
  const artists = artistsOf(c, at);
  const refs = (list: number[]): EntityRef[] =>
    list
      .map((g): EntityRef => ({
        kind: "genre",
        id: c.genres[g].slug,
        name: c.genres[g].name,
        note: "",
      }))
      .sort((x, y) => x.name.localeCompare(y.name));
  return (
    <>
      <header className="dx-head">
        <p className="dx-over">Genre</p>
        <h1 className="dx-cap">{genre.name}</h1>
        <p>{plural(artists.length, "artist")} in this catalog.</p>
        <div className="dx-actions">
          <ShareButton label="Share" title={genre.name} />
        </div>
      </header>
      {genre.parents.length > 0 && (
        <Section title="Part of">
          <Chips label="Broader genres" items={refs(genre.parents)} />
        </Section>
      )}
      {genre.children.length > 0 && (
        <Section title="Subgenres">
          <Chips label="Subgenres" items={refs(genre.children)} />
        </Section>
      )}
      <Section
        title="Artists"
        note={
          artists.length > ARTISTS ? `The ${ARTISTS} most listened to on ListenBrainz.` : undefined
        }
      >
        <div className="dx-grid">
          {artists.slice(0, ARTISTS).map((artist) => (
            <ArtistLink key={artist} artist={artistRef(c, artist)}>
              {shareOf(c, artist, at)}% {genre.name}
            </ArtistLink>
          ))}
        </div>
      </Section>
    </>
  );
}
