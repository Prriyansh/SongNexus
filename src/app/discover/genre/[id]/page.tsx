import { Suspense } from "react";
import { ArtistLink, Chips, Loading, Missing, plural, Section } from "@/discover/components/parts";
import { catalog } from "@/discover/lib/catalog";
import type { EntityRef } from "@/discover/lib/types";
import { artistRef } from "@/discover/lib/words";

const ARTISTS = 60;
/** An artist counts toward a genre when at least this much of their genre votes are for it. */
const MIN_SHARE = 10;

async function Content({ params }: { params: PageProps<"/discover/genre/[id]">["params"] }) {
  const { id } = await params;
  const c = catalog();
  let slug = id;
  try { slug = decodeURIComponent(id); } catch { /* A malformed address simply isn't found. */ }
  const at = c.genreAt.get(slug);
  if (at === undefined) return <Missing what="genre" />;
  const genre = c.genres[at];
  const share = (artist: number) => c.artists[artist].genres.find((g) => g.genre === at)?.share ?? 0;
  const artists = c.genreArtists[at].filter((a) => share(a) >= MIN_SHARE).sort((x, y) => (c.artists[y].listeners ?? 0) - (c.artists[x].listeners ?? 0) || x - y);
  const refs = (list: number[]): EntityRef[] => list.map((g) => ({ kind: "genre", id: c.genres[g].slug, name: c.genres[g].name, note: "" }));
  return (
    <>
      <title>{`${genre.name} · Discover · Song Nexus`}</title>
      <header className="dx-head"><p className="dx-over">Genre</p><h1 className="dx-cap">{genre.name}</h1><p>{plural(artists.length, "artist")} in this catalog.</p></header>
      {genre.parents.length > 0 && <Section title="Part of"><Chips items={refs(genre.parents)} /></Section>}
      {genre.children.length > 0 && <Section title="Subgenres"><Chips items={refs(genre.children)} /></Section>}
      <Section title="Artists" note={artists.length > ARTISTS ? `The ${ARTISTS} most listened to on ListenBrainz.` : undefined}>
        <div className="dx-grid">{artists.slice(0, ARTISTS).map((a) => <ArtistLink key={a} artist={artistRef(c, a)}>{`${share(a)}% ${genre.name}`}</ArtistLink>)}</div>
      </Section>
    </>
  );
}

export default function GenrePage({ params }: PageProps<"/discover/genre/[id]">) {
  return <Suspense fallback={<Loading />}><Content params={params} /></Suspense>;
}
