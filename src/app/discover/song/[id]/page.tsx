import Link from "next/link";
import { Suspense } from "react";
import { AppLink, ArtistLink, Chips, Loading, Missing, Section } from "@/discover/components/parts";
import { catalog } from "@/discover/lib/catalog";
import { creditGroups } from "@/discover/lib/credits";
import { entityHref, type EntityRef } from "@/discover/lib/types";
import { artistRef } from "@/discover/lib/words";

const length = (seconds: number | null) => (seconds === null ? null : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`);

async function Content({ params }: { params: PageProps<"/discover/song/[id]">["params"] }) {
  const { id } = await params;
  const c = catalog();
  const at = c.songAt.get(id.toLowerCase());
  if (at === undefined) return <Missing what="song" />;
  const song = c.songs[at];
  const releases = c.songReleases[at].map((r) => c.releases[r]);
  const labels: EntityRef[] = [...new Set(releases.flatMap((r) => r.labels))].map((l) => ({ kind: "label", id: c.labels[l].id, name: c.labels[l].name, note: "" }));
  return (
    <>
      <title>{`${song.title} · Discover · Song Nexus`}</title>
      <header className="dx-head">
        <p className="dx-over">{["Song", song.year, length(song.seconds)].filter(Boolean).join(" · ")}</p>
        <h1>{song.title}</h1>
        <p className="dx-by">
          {song.primary.map((a, i) => <span key={a}>{i > 0 && ", "}<Link href={entityHref({ kind: "artist", id: c.artists[a].id })}>{c.artists[a].name}</Link></span>)}
        </p>
        <p className="dx-actions">
          <AppLink className="dx-button" href={`/compare/songs?songA=${song.id}`}>Compare this song</AppLink>
          <AppLink className="dx-button dx-quiet" href={`/connections?mode=song&song=${song.id}`}>Similar music</AppLink>
        </p>
      </header>
      {releases.length > 0 && (
        <Section title={releases.length === 1 ? "Album" : "Albums"}>
          <ul className="dx-plain">{releases.map((r) => <li key={r.id}><a href={`https://musicbrainz.org/release-group/${r.id}`}>{r.title}</a>{r.year !== null && <span className="dx-year">{r.year}</span>}</li>)}</ul>
        </Section>
      )}
      {creditGroups(song.credits).map(({ title, people }) => (
        <Section key={title} title={title}>
          <div className="dx-grid">{people.map(({ artist, parts }) => <ArtistLink key={artist} artist={artistRef(c, artist)}>{parts.join(", ") || undefined}</ArtistLink>)}</div>
        </Section>
      ))}
      {labels.length > 0 && <Section title="Labels"><Chips items={labels} /></Section>}
      <p className="dx-source"><a href={`https://musicbrainz.org/recording/${song.id}`}>See this song on MusicBrainz</a></p>
    </>
  );
}

export default function SongPage({ params }: PageProps<"/discover/song/[id]">) {
  return <Suspense fallback={<Loading />}><Content params={params} /></Suspense>;
}
