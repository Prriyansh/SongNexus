import { Suspense } from "react";
import { ArtistLink, Loading, Missing, plural, Section } from "@/discover/components/parts";
import { catalog } from "@/discover/lib/catalog";
import { artistRef } from "@/discover/lib/words";

const ARTISTS = 60;

async function Content({ params }: { params: PageProps<"/discover/label/[id]">["params"] }) {
  const { id } = await params;
  const c = catalog();
  const at = c.labelAt.get(id.toLowerCase());
  if (at === undefined) return <Missing what="label" />;
  const label = c.labels[at];
  const releases = c.labelReleases[at].map((r) => c.releases[r]).sort((x, y) => (x.year ?? 9999) - (y.year ?? 9999));
  const counts = new Map<number, number>();
  for (const release of releases) for (const artist of release.artists) counts.set(artist, (counts.get(artist) ?? 0) + 1);
  const artists = [...counts].sort(([x, m], [y, n]) => n - m || (c.artists[y].listeners ?? 0) - (c.artists[x].listeners ?? 0));
  return (
    <>
      <title>{`${label.name} · Discover · Song Nexus`}</title>
      <header className="dx-head"><p className="dx-over">Record label</p><h1>{label.name}</h1><p>{plural(releases.length, "album")} by {plural(artists.length, "artist")} in this catalog.</p></header>
      <Section title="Artists">
        <div className="dx-grid">{artists.slice(0, ARTISTS).map(([artist, count]) => <ArtistLink key={artist} artist={artistRef(c, artist)}>{plural(count, "album")}</ArtistLink>)}</div>
      </Section>
      <Section title="Albums">
        <ul className="dx-plain dx-columns">
          {releases.map((r) => <li key={r.id}><a href={`https://musicbrainz.org/release-group/${r.id}`}>{r.title}</a> · {r.artists.map((a) => c.artists[a].name).join(", ")}{r.year !== null && <span className="dx-year">{r.year}</span>}</li>)}
        </ul>
      </Section>
      <p className="dx-source"><a href={`https://musicbrainz.org/label/${label.id}`}>See {label.name} on MusicBrainz</a></p>
    </>
  );
}

export default function LabelPage({ params }: PageProps<"/discover/label/[id]">) {
  return <Suspense fallback={<Loading />}><Content params={params} /></Suspense>;
}
