import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ShareButton from "@/discover/components/ShareButton";
import { ArtistLink, Cover, More, plural, Section } from "@/discover/components/parts";
import { biggestLabels } from "@/discover/lib/browse";
import { catalog, type Catalog } from "@/discover/lib/catalog";
import { pageMetadata } from "@/discover/lib/metadata";
import { artistRef } from "@/discover/lib/words";

type Props = PageProps<"/discover/label/[id]">;

const PRERENDERED = 24;
const ARTISTS = 60;
const SHOWN = 12;

export function generateStaticParams() {
  return biggestLabels(catalog(), PRERENDERED).map(({ id }) => ({ id }));
}

async function find(params: Props["params"]): Promise<number> {
  const { id } = await params;
  return catalog().labelAt.get(id.toLowerCase()) ?? notFound();
}

function releasesOf(c: Catalog, at: number) {
  return c.labelReleases[at]
    .map((r) => c.releases[r])
    .sort((x, y) => (x.year ?? 9999) - (y.year ?? 9999));
}

/** The label's artists, those with the most albums there first. */
function artistsOf(c: Catalog, releases: ReturnType<typeof releasesOf>): [number, number][] {
  const counts = new Map<number, number>();
  for (const { artists } of releases) {
    for (const artist of artists) counts.set(artist, (counts.get(artist) ?? 0) + 1);
  }
  const listeners = (at: number) => c.artists[at].listeners ?? 0;
  return [...counts].sort(([x, m], [y, n]) => n - m || listeners(y) - listeners(x));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const at = await find(params);
  const c = catalog();
  const { id, name } = c.labels[at];
  const releases = releasesOf(c, at);
  const artists = artistsOf(c, releases);
  return pageMetadata(
    name,
    `${plural(releases.length, "album")} by ${plural(artists.length, "artist")} on ${name}.`,
    `/discover/label/${id}`,
  );
}

export default async function LabelPage({ params }: Props) {
  const at = await find(params);
  const c = catalog();
  const label = c.labels[at];
  const releases = releasesOf(c, at);
  const artists = artistsOf(c, releases);
  const album = (r: (typeof releases)[number]) => (
    <a key={r.id} className="dx-row" href={`https://musicbrainz.org/release-group/${r.id}`}>
      <Cover url={r.cover} />
      <span className="dx-row-text">
        <strong>{r.title}</strong>
        <small>
          {[r.artists.map((a) => c.artists[a].name).join(", "), r.year].filter(Boolean).join(" · ")}
        </small>
      </span>
    </a>
  );
  return (
    <>
      <header className="dx-head">
        <p className="dx-over">Record label</p>
        <h1>{label.name}</h1>
        <p>
          {plural(releases.length, "album")} by {plural(artists.length, "artist")} in this catalog.
        </p>
        <div className="dx-actions">
          <ShareButton label="Share" title={label.name} />
        </div>
      </header>
      <Section title="Artists">
        <div className="dx-grid">
          {artists.slice(0, ARTISTS).map(([artist, count]) => (
            <ArtistLink key={artist} artist={artistRef(c, artist)}>
              {plural(count, "album")}
            </ArtistLink>
          ))}
        </div>
      </Section>
      <Section title="Albums" note="Oldest first.">
        <div className="dx-grid">{releases.slice(0, SHOWN).map(album)}</div>
        {releases.length > SHOWN && (
          <More label={`Show ${releases.length - SHOWN} more`}>
            <div className="dx-grid">{releases.slice(SHOWN).map(album)}</div>
          </More>
        )}
      </Section>
      <p className="dx-source">
        <a href={`https://musicbrainz.org/label/${label.id}`}>{label.name} on MusicBrainz</a>
      </p>
    </>
  );
}
