import { GitCompareArrows, Network, Spline, Waypoints } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import ShareButton from "@/discover/components/ShareButton";
import Tabs, { type Tab } from "@/discover/components/Tabs";
import {
  AppLink,
  ArtistLink,
  Avatar,
  Chips,
  Cover,
  More,
  plural,
  Section,
  SongLink,
} from "@/discover/components/parts";
import { popularArtists } from "@/discover/lib/browse";
import { catalog, type Artist, type Catalog } from "@/discover/lib/catalog";
import {
  COLLABORATION_LABELS,
  COLLABORATION_TYPES,
  collaborations,
  timeline,
  type Collaboration,
  type CollaborationType,
  type TimelineYear,
} from "@/discover/lib/collaborations";
import { neighbors } from "@/discover/lib/graph";
import { photoAt } from "@/discover/lib/images";
import { pageMetadata } from "@/discover/lib/metadata";
import { graph } from "@/discover/lib/server";
import { entityHref, WORKING_CATEGORIES } from "@/discover/lib/types";
import { artistNote, countryName, songRef } from "@/discover/lib/words";

type Props = PageProps<"/discover/artist/[id]">;

const PRERENDERED = 60;
const COLLABORATORS = 24;
const SHOWN = 9;
const SONGS_SHOWN = 12;
const SONGS = 60;
const HONORS_SHOWN = 6;
const PORTRAIT = 176;

/** The best-known artists are ready in advance; the rest are made on their first visit. */
export function generateStaticParams() {
  return popularArtists(catalog(), PRERENDERED).map(({ id }) => ({ id }));
}

async function find(params: Props["params"]): Promise<number> {
  const { id } = await params;
  return catalog().artistAt.get(id.toLowerCase()) ?? notFound();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const at = await find(params);
  const c = catalog();
  const artist = c.artists[at];
  const people = neighbors(graph(), at, WORKING_CATEGORIES).length;
  const about = artist.extras.facts?.[0] ?? artistNote(c, artist);
  return pageMetadata(
    artist.name,
    `${artist.name}${about ? `, ${about}` : ""}: ${plural(people, "collaborator")}, songs, albums and the credits behind them.`,
    `/discover/artist/${artist.id}`,
    artist.photo && photoAt(artist.photo.url, 330),
  );
}

const years = (first: number | null, last: number | null) =>
  first === null ? null : first === last ? `${first}` : `${first}–${last}`;

function collaborationNote(item: Collaboration, type: CollaborationType): string {
  const { count, firstYear, lastYear, directions } = item;
  const parts =
    type === "bands"
      ? [firstYear === null ? item.artist.note : `from ${firstYear}`]
      : [...directions, plural(count, "credit"), years(firstYear, lastYear)];
  return parts.filter(Boolean).join(" · ");
}

function People({ items, type }: { items: Collaboration[]; type: CollaborationType }) {
  return (
    <div className="dx-grid">
      {items.map((item) => (
        <ArtistLink key={item.artist.id} artist={item.artist}>
          {collaborationNote(item, type)}
        </ArtistLink>
      ))}
    </div>
  );
}

function Timeline({ rows }: { rows: TimelineYear[] }) {
  if (rows.length < 3) return null;
  const first = rows[0].year;
  const last = rows[rows.length - 1].year;
  const counts = new Map(rows.map((r) => [r.year, r.count]));
  const most = Math.max(...counts.values());
  const all = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  return (
    <Section
      title="Collaborations by year"
      note="Songs and albums made with someone else, by year of first release. Undated ones are left out."
    >
      <div
        className="dx-years"
        style={{ "--count": all.length } as CSSProperties}
        aria-hidden="true"
      >
        <div className="dx-timeline">
          {all.map((year) => {
            const count = counts.get(year) ?? 0;
            return (
              <span
                key={year}
                data-empty={count === 0 || undefined}
                style={{ height: `${Math.max(2, (100 * count) / most)}%` }}
                title={`${year}: ${count}`}
              />
            );
          })}
        </div>
        <p className="dx-axis">
          <span>{first}</span>
          <span>Most in a year: {most}</span>
          <span>{last}</span>
        </p>
      </div>
      <More label="Show as a table">
        <table>
          <thead>
            <tr>
              <th scope="col">Year</th>
              <th scope="col">Songs and albums</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.year}>
                <td>{row.year}</td>
                <td>{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </More>
    </Section>
  );
}

function albumsOf(c: Catalog, at: number) {
  return c.releasesOf[at]
    .map((r) => c.releases[r])
    .filter((r) => r.artists.includes(at))
    .sort((x, y) => (x.year ?? 9999) - (y.year ?? 9999));
}

function Albums({ c, albums }: { c: Catalog; albums: ReturnType<typeof albumsOf> }) {
  if (!albums.length) return null;
  return (
    <Section title="Albums" note="The albums in this catalog, not a full discography.">
      <div className="dx-albums">
        {albums.map((album) => {
          const labels = album.labels.map((l) => c.labels[l].name);
          return (
            <details key={album.id} className="dx-album">
              <summary>
                <Cover url={album.cover} size={72} />
                <span>
                  <strong>{album.title}</strong>
                  <small>{[album.year, ...labels].filter(Boolean).join(" · ")}</small>
                </span>
              </summary>
              <ol className="dx-tracks">
                {album.tracks.map((s) => (
                  <li key={s}>
                    <Link href={entityHref({ kind: "song", id: c.songs[s].id })} prefetch={false}>
                      {c.songs[s].title}
                    </Link>
                  </li>
                ))}
              </ol>
            </details>
          );
        })}
      </div>
    </Section>
  );
}

function songsBy(c: Catalog, at: number): number[] {
  const year = (s: number) => c.songs[s].year ?? 0;
  return c.songsOf[at]
    .filter((s) =>
      c.songs[s].credits.some((x) => x.artist === at && /^(primary|featured)$/.test(x.role)),
    )
    .sort((x, y) => year(y) - year(x) || c.songs[x].title.localeCompare(c.songs[y].title));
}

function Songs({ c, at, songs }: { c: Catalog; at: number; songs: number[] }) {
  if (!songs.length) return null;
  const link = (s: number) => {
    const song = c.songs[s];
    const note = [song.primary.includes(at) ? null : "featured", song.year].filter(Boolean);
    return <SongLink key={song.id} song={songRef(c, s)} note={note.join(" · ")} />;
  };
  return (
    <Section
      title="Songs"
      note={
        songs.length > SONGS
          ? `The newest ${SONGS} of ${songs.length} in this catalog.`
          : "Newest first."
      }
    >
      <div className="dx-grid">{songs.slice(0, SONGS_SHOWN).map(link)}</div>
      {songs.length > SONGS_SHOWN && (
        <More label={`Show ${Math.min(songs.length, SONGS) - SONGS_SHOWN} more`}>
          <div className="dx-grid">{songs.slice(SONGS_SHOWN, SONGS).map(link)}</div>
        </More>
      )}
    </Section>
  );
}

function Charts({ artist }: { artist: Artist }) {
  const { hot100, albums, eurovision } = artist.extras;
  if (!hot100 && !albums && !eurovision) return null;
  const rows = [
    { name: "Hot 100", what: "song", totals: hot100 },
    { name: "Billboard 200", what: "album", totals: albums },
  ];
  return (
    <Section
      title="Charts and contests"
      note="As the lead performer. Totals from the Billboard Hot 100 (since 1958) and Billboard 200 (since 1967), archived by UT Austin."
    >
      <div className="dx-charts">
        {rows.map(({ name, what, totals }) => {
          if (!totals) return null;
          const [entries, topTen, numberOnes, peak, first, last] = totals;
          return (
            <div key={name}>
              <h3>{name}</h3>
              <dl className="dx-numbers">
                <div>
                  <dt>{entries === 1 ? what : `${what}s`}</dt>
                  <dd>{entries}</dd>
                </div>
                <div>
                  <dt>top ten</dt>
                  <dd>{topTen}</dd>
                </div>
                <div>
                  <dt>number ones</dt>
                  <dd>{numberOnes}</dd>
                </div>
                <div>
                  <dt>best position</dt>
                  <dd>{peak}</dd>
                </div>
              </dl>
              <p className="dx-hint">Charted {years(first, last)}</p>
            </div>
          );
        })}
        {eurovision?.map(([year, country, song, place, points]) => (
          <div key={year}>
            <h3>Eurovision {year}</h3>
            <p>
              “{song}” for {country}
              {place !== null && (place === 1 ? ", which won" : `, placed ${place}`)}
              {points !== null && ` with ${plural(points, "point")}`}
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Honors({ artist }: { artist: Artist }) {
  const facts = artist.extras.facts;
  if (!facts) return null;
  const [, , awards, nominations, wikidata] = facts;
  const lists = [
    { title: "Awards", items: awards },
    { title: "Nominations", items: nominations },
  ].filter(({ items }) => items.length > 0);
  if (!lists.length) return null;
  const row = ([id, name, year]: (typeof awards)[number], i: number) => (
    <li key={`${id}-${i}`}>
      <a href={`https://www.wikidata.org/wiki/${id}`}>{name}</a>
      {year && <span className="dx-year">{year}</span>}
    </li>
  );
  const source: ReactNode = wikidata ? (
    <a href={`https://www.wikidata.org/wiki/${wikidata}`}>Wikidata</a>
  ) : (
    "Wikidata"
  );
  return (
    <Section
      title="Awards and nominations"
      note={<>As listed on {source}, which is community-edited, so this isn’t a full count.</>}
    >
      <div className="dx-two">
        {lists.map(({ title, items }) => (
          <div key={title}>
            <h3>{title}</h3>
            <ul className="dx-plain">{items.slice(0, HONORS_SHOWN).map(row)}</ul>
            {items.length > HONORS_SHOWN && (
              <More label={`Show ${items.length - HONORS_SHOWN} more`}>
                <ul className="dx-plain">{items.slice(HONORS_SHOWN).map(row)}</ul>
              </More>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

function Events({ artist }: { artist: Artist }) {
  const { events, eventCount } = artist.extras;
  if (!events) return null;
  const total = plural(
    eventCount ?? events.length,
    "concert or festival",
    "concerts and festivals",
  );
  return (
    <Section title="On stage" note={`The latest of ${total} MusicBrainz lists.`}>
      <ul className="dx-plain">
        {events.map(([id, name, date, place]) => (
          <li key={id}>
            <a href={`https://musicbrainz.org/event/${id}`}>{name}</a>
            {place && ` · ${place}`}
            {date && <span className="dx-year">{date}</span>}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function PhotoCredit({ artist }: { artist: Artist }) {
  const { photo } = artist;
  if (!photo) return null;
  return (
    <p className="dx-credit">
      Photo: <a href={photo.page}>{photo.author ?? "see its page"}</a>,{" "}
      {photo.licenseUrl ? <a href={photo.licenseUrl}>{photo.license}</a> : photo.license}, via
      Wikimedia Commons
    </p>
  );
}

function lifeOf({ type, begin, end }: Artist): string | null {
  if (begin === null) return null;
  const person = type === "Person";
  const started = `${person ? "born" : "formed"} ${begin}`;
  return end === null ? started : `${started}, ${person ? "died" : "ended"} ${end}`;
}

export default async function ArtistPage({ params }: Props) {
  const at = await find(params);
  const g = graph();
  const c = g.catalog;
  const artist = c.artists[at];
  const facts = artist.extras.facts;
  const about = facts?.[0] ?? artist.disambiguation;
  const groups: Tab[] = COLLABORATION_TYPES.flatMap((type) => {
    const { items, total } = collaborations(g, at, type, COLLABORATORS);
    if (!total) return [];
    const content = (
      <>
        <People items={items.slice(0, SHOWN)} type={type} />
        {items.length > SHOWN && (
          <More label={`Show ${items.length - SHOWN} more`}>
            <People items={items.slice(SHOWN)} type={type} />
          </More>
        )}
        {total > items.length && (
          <p className="dx-hint">
            The {items.length} closest of {total.toLocaleString("en")}.{" "}
            <Link href={`/discover/connections?artist=${artist.id}`}>See them as a web</Link>
          </p>
        )}
      </>
    );
    const label = `${COLLABORATION_LABELS[type]} · ${total.toLocaleString("en")}`;
    return [{ key: type, label, content }];
  });
  const albums = albumsOf(c, at);
  const songs = songsBy(c, at);
  const labels = [...new Set(albums.flatMap((album) => album.labels))].map((l) => c.labels[l]);
  const people = neighbors(g, at, WORKING_CATEGORIES).length;
  const numbers = [
    { value: people, what: people === 1 ? "collaborator" : "collaborators" },
    { value: songs.length, what: songs.length === 1 ? "song here" : "songs here" },
    { value: albums.length, what: albums.length === 1 ? "album here" : "albums here" },
    { value: artist.listeners ?? 0, what: "ListenBrainz listeners" },
  ].filter(({ value }) => value > 0);

  return (
    <>
      <header className="dx-entity">
        <div className="dx-entity-photo">
          <Avatar
            id={artist.id}
            name={artist.name}
            photo={artist.photo?.url}
            size={PORTRAIT}
            eager
          />
        </div>
        <div className="dx-entity-text">
          <p className="dx-over">
            {[artist.type, countryName(artist.country), lifeOf(artist)].filter(Boolean).join(" · ")}
          </p>
          <h1>{artist.name}</h1>
          {about && (
            <p>
              {about}
              {facts?.[1] && (
                <>
                  {" · "}
                  <a href={facts[1]}>Wikipedia</a>
                </>
              )}
            </p>
          )}
          <dl className="dx-numbers">
            {numbers.map(({ value, what }) => (
              <div key={what}>
                <dt>{what}</dt>
                <dd>{value.toLocaleString("en", { notation: "compact" })}</dd>
              </div>
            ))}
          </dl>
          <div className="dx-actions">
            <Link className="dx-button" href={`/discover/six-degrees?from=${artist.id}`}>
              <Spline size={16} aria-hidden="true" /> Six Degrees
            </Link>
            <Link className="dx-button dx-quiet" href={`/discover/connections?artist=${artist.id}`}>
              <Waypoints size={16} aria-hidden="true" /> Collaborators
            </Link>
            <AppLink
              className="dx-button dx-quiet"
              href={`/connections?mode=artist&artist=${artist.id}`}
            >
              <Network size={16} aria-hidden="true" /> Similar music
            </AppLink>
            <AppLink className="dx-button dx-quiet" href={`/compare/artists?artistA=${artist.id}`}>
              <GitCompareArrows size={16} aria-hidden="true" /> Compare
            </AppLink>
            <ShareButton label="Share" title={artist.name} />
          </div>
          <PhotoCredit artist={artist} />
        </div>
      </header>
      {artist.genres.length > 0 && (
        <Chips
          label="Genres"
          items={artist.genres.map(({ genre }) => ({
            kind: "genre",
            id: c.genres[genre].slug,
            name: c.genres[genre].name,
            note: "",
          }))}
        />
      )}
      {artist.level === 0 && (
        <p className="dx-hint">
          {artist.name} is here through credits on other artists’ music, so their own releases may
          be missing.
        </p>
      )}
      {groups.length > 0 && (
        <Section title="Worked with" note="From credits on songs and albums in this catalog.">
          <Tabs label="Kinds of collaboration" tabs={groups} />
        </Section>
      )}
      <Timeline rows={timeline(g, at)} />
      <Albums c={c} albums={albums} />
      <Songs c={c} at={at} songs={songs} />
      <Charts artist={artist} />
      <Honors artist={artist} />
      <Events artist={artist} />
      {labels.length > 0 && (
        <Section title="Labels">
          <Chips
            label="Labels"
            items={labels.map(({ id, name }) => ({ kind: "label", id, name, note: "" }))}
          />
        </Section>
      )}
      <p className="dx-source">
        <a href={`https://musicbrainz.org/artist/${artist.id}`}>{artist.name} on MusicBrainz</a>
      </p>
    </>
  );
}
