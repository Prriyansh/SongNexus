import Link from "next/link";
import { Suspense } from "react";
import { AppLink, ArtistLink, Avatar, Chips, Loading, Missing, plural, Section } from "@/discover/components/parts";
import { COLLABORATION_LABELS, COLLABORATION_TYPES, collaborations, timeline, type Collaboration } from "@/discover/lib/collaborations";
import type { Artist, Catalog } from "@/discover/lib/catalog";
import { graph } from "@/discover/lib/server";
import { entityHref } from "@/discover/lib/types";
import { countryName } from "@/discover/lib/words";

const COLLABORATORS = 24;
const FIRST_SHOWN = 8;
const SONGS = 30;

const years = (first: number | null, last: number | null) => (first === null ? null : first === last ? `${first}` : `${first}–${last}`);

function collaborationNote({ count, firstYear, lastYear, directions }: Collaboration, bands: boolean): string {
  if (bands) return firstYear === null ? "" : `from ${firstYear}`;
  return [...directions, plural(count, "credit"), years(firstYear, lastYear)].filter(Boolean).join(" · ");
}

function People({ items, bands }: { items: Collaboration[]; bands: boolean }) {
  return <div className="dx-grid">{items.map((item) => <ArtistLink key={item.artist.id} artist={item.artist}>{collaborationNote(item, bands) || item.artist.note}</ArtistLink>)}</div>;
}

function Timeline({ rows }: { rows: { year: number; count: number }[] }) {
  if (rows.length < 3) return null;
  const [first, last] = [rows[0].year, rows[rows.length - 1].year];
  const at = new Map(rows.map((r) => [r.year, r.count]));
  const most = Math.max(...rows.map((r) => r.count));
  const all = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  return (
    <Section title="Collaborations by year" note="Songs and albums made with someone else, by year of first release. Undated ones are left out.">
      <div className="dx-timeline" aria-hidden="true">
        {all.map((year) => <span key={year} style={{ height: `${Math.max(2, (100 * (at.get(year) ?? 0)) / most)}%` }} title={`${year}: ${at.get(year) ?? 0}`} />)}
      </div>
      <p className="dx-axis" aria-hidden="true"><span>{first}</span><span>{last}</span></p>
      <details className="dx-details">
        <summary>Show as a table</summary>
        <table><thead><tr><th scope="col">Year</th><th scope="col">Songs and albums</th></tr></thead><tbody>{rows.map((r) => <tr key={r.year}><td>{r.year}</td><td>{r.count}</td></tr>)}</tbody></table>
      </details>
    </Section>
  );
}

function Albums({ c, at }: { c: Catalog; at: number }) {
  const albums = c.releasesOf[at].map((r) => c.releases[r]).filter((r) => r.artists.includes(at)).sort((x, y) => (x.year ?? 9999) - (y.year ?? 9999));
  if (!albums.length) return null;
  return (
    <Section title="Albums" note="The albums in this catalog, not a full discography.">
      <div className="dx-albums">
        {albums.map((album) => (
          <details key={album.id} className="dx-album">
            <summary>
              {/* Hot-linked from the Cover Art Archive, at the small size it serves. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {album.cover ? <img src={album.cover} alt="" loading="lazy" width={64} height={64} /> : <span className="dx-nocover" aria-hidden="true" />}
              <span><strong>{album.title}</strong><small>{[album.year, ...album.labels.map((l) => c.labels[l].name)].filter(Boolean).join(" · ")}</small></span>
            </summary>
            <ol className="dx-tracks">{album.tracks.map((s) => <li key={s}><Link href={entityHref({ kind: "song", id: c.songs[s].id })}>{c.songs[s].title}</Link></li>)}</ol>
          </details>
        ))}
      </div>
    </Section>
  );
}

function Songs({ c, at }: { c: Catalog; at: number }) {
  const songs = c.songsOf[at].map((s) => c.songs[s]).filter((s) => s.primary.includes(at) || s.credits.some((x) => x.artist === at && x.role === "featured"));
  songs.sort((x, y) => (y.year ?? 0) - (x.year ?? 0) || x.title.localeCompare(y.title));
  if (!songs.length) return null;
  return (
    <Section title="Songs" note={songs.length > SONGS ? `The newest ${SONGS} of ${songs.length} in this catalog.` : undefined}>
      <ul className="dx-tracks dx-columns">
        {songs.slice(0, SONGS).map((s) => <li key={s.id}><Link href={entityHref({ kind: "song", id: s.id })}><strong>{s.title}</strong><small>{[s.primary.includes(at) ? null : "featured", s.year].filter(Boolean).join(" · ")}</small></Link></li>)}
      </ul>
    </Section>
  );
}

function Charts({ artist }: { artist: Artist }) {
  const { hot100, albums, eurovision } = artist.extras;
  if (!hot100 && !albums && !eurovision) return null;
  const line = ([entries, topTen, numberOnes, peak, first, last]: NonNullable<typeof hot100>, what: string) =>
    `${plural(entries, what)}, ${topTen} in the top ten, ${plural(numberOnes, "number one")}; best position ${peak}; charted ${years(first, last)}`;
  return (
    <Section title="Charts and contests" note="As the lead performer. Chart totals from the Billboard Hot 100 (since 1958) and Billboard 200 (since 1967), archived by UT Austin.">
      <dl className="dx-facts">
        {hot100 && <><dt>Hot 100</dt><dd>{line(hot100, "song")}</dd></>}
        {albums && <><dt>Billboard 200</dt><dd>{line(albums, "album")}</dd></>}
        {eurovision?.map(([year, country, song, place, points]) => (
          <div key={year}><dt>Eurovision {year}</dt><dd>“{song}” for {country}{place !== null && `, placed ${place}${points !== null ? ` with ${plural(points, "point")}` : ""}`}</dd></div>
        ))}
      </dl>
    </Section>
  );
}

function Honors({ artist }: { artist: Artist }) {
  const facts = artist.extras.facts;
  const lists = [["Awards", facts?.[2] ?? []], ["Nominations", facts?.[3] ?? []]] as const;
  if (!facts || lists.every(([, list]) => !list.length)) return null;
  return (
    <Section title="Awards and nominations" note={<>As listed on {facts[4] ? <a href={`https://www.wikidata.org/wiki/${facts[4]}`}>Wikidata</a> : "Wikidata"}, which is community-edited, so this isn’t a full count.</>}>
      <div className="dx-two">
        {lists.map(([title, list]) => list.length > 0 && (
          <div key={title}>
            <h3>{title}</h3>
            <ul className="dx-plain">{list.map(([id, name, year], i) => <li key={`${id}-${i}`}><a href={`https://www.wikidata.org/wiki/${id}`}>{name}</a>{year && <span className="dx-year">{year}</span>}</li>)}</ul>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Events({ artist }: { artist: Artist }) {
  const { events, eventCount } = artist.extras;
  if (!events) return null;
  return (
    <Section title="On stage" note={`The latest of ${plural(eventCount ?? events.length, "concert or festival", "concerts and festivals")} MusicBrainz lists.`}>
      <ul className="dx-plain">
        {events.map(([id, name, date, place]) => <li key={id}><a href={`https://musicbrainz.org/event/${id}`}>{name}</a>{place && ` · ${place}`}{date && <span className="dx-year">{date}</span>}</li>)}
      </ul>
    </Section>
  );
}

async function Content({ params }: { params: PageProps<"/discover/artist/[id]">["params"] }) {
  const { id } = await params;
  const g = graph();
  const c = g.catalog;
  const at = c.artistAt.get(id.toLowerCase());
  if (at === undefined) return <Missing what="artist" />;
  const artist = c.artists[at];
  const facts = artist.extras.facts;
  const life = artist.begin === null ? null : `${artist.type === "Person" ? "born" : "formed"} ${artist.begin}${artist.end !== null ? `, ${artist.type === "Person" ? "died" : "ended"} ${artist.end}` : ""}`;
  const groups = COLLABORATION_TYPES.map((type) => ({ type, ...collaborations(g, at, type, COLLABORATORS) })).filter((group) => group.total > 0);
  const labels = [...new Set(c.releasesOf[at].filter((r) => c.releases[r].artists.includes(at)).flatMap((r) => c.releases[r].labels))];
  return (
    <>
      <title>{`${artist.name} · Discover · Song Nexus`}</title>
      <header className="dx-head dx-entity">
        <Avatar id={artist.id} name={artist.name} size={96} />
        <div>
          <p className="dx-over">{[artist.type, countryName(artist.country), life].filter(Boolean).join(" · ")}</p>
          <h1>{artist.name}</h1>
          {(facts?.[0] || artist.disambiguation) && <p>{facts?.[0] ?? artist.disambiguation}{facts?.[1] && <> · <a href={facts[1]}>Wikipedia</a></>}</p>}
          <p className="dx-actions">
            <Link className="dx-button" href={`/discover/six-degrees?from=${artist.id}`}>Six Degrees from here</Link>
            <Link className="dx-button dx-quiet" href={`/discover/connections?artist=${artist.id}`}>Open connections</Link>
            <AppLink className="dx-button dx-quiet" href={`/connections?mode=artist&artist=${artist.id}`}>Similar music</AppLink>
            <AppLink className="dx-button dx-quiet" href={`/compare/artists?artistA=${artist.id}`}>Compare</AppLink>
          </p>
        </div>
      </header>
      {artist.genres.length > 0 && <Chips items={artist.genres.map(({ genre }) => ({ kind: "genre", id: c.genres[genre].slug, name: c.genres[genre].name, note: "" }))} />}
      {artist.level === 0 && <p className="dx-hint">This artist is here through credits on other artists’ music, so their own releases may be missing.</p>}
      {groups.map(({ type, items, total }) => (
        <Section key={type} title={COLLABORATION_LABELS[type]} note={total > items.length ? `The ${items.length} closest of ${total.toLocaleString("en")}.` : plural(total, "artist")}>
          <People items={items.slice(0, FIRST_SHOWN)} bands={type === "bands"} />
          {items.length > FIRST_SHOWN && <details className="dx-details"><summary>Show {items.length - FIRST_SHOWN} more</summary><People items={items.slice(FIRST_SHOWN)} bands={type === "bands"} /></details>}
        </Section>
      ))}
      <Timeline rows={timeline(g, at)} />
      <Albums c={c} at={at} />
      <Songs c={c} at={at} />
      {labels.length > 0 && <Section title="Labels"><Chips items={labels.map((l) => ({ kind: "label", id: c.labels[l].id, name: c.labels[l].name, note: "" }))} /></Section>}
      <Charts artist={artist} />
      <Honors artist={artist} />
      <Events artist={artist} />
      <p className="dx-source"><a href={`https://musicbrainz.org/artist/${artist.id}`}>See {artist.name} on MusicBrainz</a></p>
    </>
  );
}

export default function ArtistPage({ params }: PageProps<"/discover/artist/[id]">) {
  return <Suspense fallback={<Loading />}><Content params={params} /></Suspense>;
}
