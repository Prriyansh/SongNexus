"""Writes src/discover/data/catalog.json from a SongNexus v2 catalog database (SQLite).

    python scripts/discover/export_catalog.py path/to/songnexus-dev.db

The database is built by the v2 pipeline (branch ``alpha-release``, ``songnexus ingest`` and its
``fetch-*`` commands). Only facts with an open license, plus chart totals, are exported; see
src/discover/CLAUDE.md for the sources. Standard library only; the same database always gives the
same file. Everything refers to other things by position, so the file stays small; the reader is
src/discover/lib/catalog.ts.
"""

from __future__ import annotations

import json
import sqlite3
import sys
from collections import defaultdict
from contextlib import closing
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "src" / "discover" / "data" / "catalog.json"
MAX_GENRES = 8
MAX_HONORS = 24
MAX_EVENTS = 8
FORMAT_VERSION = 1


def year_of(value: str | None) -> int | None:
    """The year of an ISO date ("1975-10-31", "1975"), or None."""
    return int(value[:4]) if value and value[:4].isdigit() else None


def slug_of(name: str) -> str:
    """A URL name for a genre: letters and digits of any script, joined by hyphens."""
    return "-".join("".join(c if c.isalnum() else " " for c in name.casefold()).split())


def secure(url: str | None) -> str | None:
    """The https form of an address; Commons still lists some licenses by http."""
    return url.replace("http://", "https://", 1) if url else None


def index_of(rows: list[tuple]) -> dict[str, int]:
    return {row[0]: i for i, row in enumerate(rows)}


class Codes:
    """Strings as positions in a list, in order of first use."""

    def __init__(self) -> None:
        self.values: list[str] = []
        self._at: dict[str, int] = {}

    def code(self, value: str) -> int:
        if value not in self._at:
            self._at[value] = len(self.values)
            self.values.append(value)
        return self._at[value]


def honors(raw: str | None) -> list[list]:
    rows = json.loads(raw) if raw else []
    rows.sort(key=lambda h: (-(h.get("year") or 0), h["name"]))
    return [[h["id"], h["name"], h.get("year")] for h in rows[:MAX_HONORS]]


def export(path: Path) -> dict:
    """The catalog in a database, which is opened for reading only and closed again."""
    with closing(sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)) as db:
        return catalog_in(db)


def catalog_in(db: sqlite3.Connection) -> dict:
    def q(sql: str) -> list[tuple]:
        return db.execute(sql).fetchall()

    # The MusicBrainz ID of every artist, song, release and label (the smallest when merged).
    mbid: dict[str, dict[str, str]] = defaultdict(dict)
    for kind, entity, source in q(
        "select entity_type, entity_id, min(source_entity_id) from entity_source_mappings"
        " where source_id = 'musicbrainz' group by 1, 2"
    ):
        mbid[kind][entity] = source

    artists = q(
        "select a.id, a.name, a.artist_type, a.country, a.disambiguation, a.begin_date, a.end_date,"
        " a.detail_level, max(u.listeners) from artists a"
        " left join artist_audiences u on u.artist_id = a.id group by a.id"
    )
    # MusicBrainz's placeholders ("[unknown]", "[traditional]") are not people who met.
    artists = sorted(
        (a for a in artists if a[0] in mbid["artist"] and not a[1].startswith("[")),
        key=lambda a: mbid["artist"][a[0]],
    )
    artist_at = index_of(artists)

    aliases: dict[str, list[str]] = defaultdict(list)
    for artist, alias in q("select artist_id, alias from artist_aliases order by 1, 2"):
        aliases[artist].append(alias)

    # Genres: each source's share of votes, averaged over the sources that know the artist.
    votes: dict[str, dict[str, dict[str, int]]] = defaultdict(lambda: defaultdict(dict))
    for artist, genre, source, count in q(
        "select artist_id, genre_id, source_id, votes from artist_genres where votes > 0"
    ):
        votes[artist][source][genre] = count
    shares: dict[str, list[tuple[str, float]]] = {}
    for artist, by_source in votes.items():
        total: dict[str, float] = defaultdict(float)
        for genre_votes in by_source.values():
            all_votes = sum(genre_votes.values())
            for genre, count in genre_votes.items():
                total[genre] += count / all_votes / len(by_source)
        shares[artist] = sorted(total.items(), key=lambda kv: (-kv[1], kv[0]))[:MAX_GENRES]
    used = {g for a, rows in shares.items() if a in artist_at for g, _ in rows}
    genres = sorted((g for g in q("select id, name from genres") if g[0] in used), key=lambda g: g[1])
    genre_at = index_of(genres)
    parents: dict[str, list[int]] = defaultdict(list)
    for child, parent in q("select genre_id, parent_genre_id from genre_parents order by 1, 2"):
        if child in genre_at and parent in genre_at:
            parents[child].append(genre_at[parent])
    slugs: dict[str, int] = {}
    genre_rows = []
    for genre, name in genres:
        slug = slug_of(name) or f"genre-{genre_at[genre]}"
        slugs[slug] = slugs.get(slug, 0) + 1
        genre_rows.append([name, slug if slugs[slug] == 1 else f"{slug}-{slugs[slug]}", parents[genre]])

    labels = sorted(
        (r for r in q("select id, name from labels") if r[0] in mbid["label"]),
        key=lambda r: mbid["label"][r[0]],
    )
    label_at = index_of(labels)
    releases = sorted(
        (
            r
            for r in q(
                "select r.id, r.title, r.first_release_date, c.thumbnail_url from releases r"
                " left join release_covers c on c.release_id = r.id"
            )
            if r[0] in mbid["release"]
        ),
        key=lambda r: mbid["release"][r[0]],
    )
    songs = sorted(
        (
            s
            for s in q("select id, title, first_release_date, length_ms from recordings")
            if s[0] in mbid["recording"]
        ),
        key=lambda s: mbid["recording"][s[0]],
    )
    song_at = index_of(songs)

    roles, details = Codes(), Codes()
    details.code("")

    def credits(table: str, column: str) -> dict[str, list[int]]:
        """Flat triples (artist, role, detail) per song or release."""
        out: dict[str, list[int]] = defaultdict(list)
        for subject, artist, role, detail in q(
            f"select distinct {column}, artist_id, role, coalesce(role_detail, '') from {table}"
            " order by 1, 2, 3, 4"
        ):
            if artist in artist_at:
                out[subject] += [artist_at[artist], roles.code(role), details.code(detail)]
        return out

    song_credits = credits("recording_credits", "recording_id")
    release_credits = credits("release_credits", "release_id")
    release_artists: dict[str, list[int]] = defaultdict(list)
    for release, artist in q("select release_id, artist_id from release_artists order by 1, position"):
        if artist in artist_at:
            release_artists[release].append(artist_at[artist])
    release_labels: dict[str, list[int]] = defaultdict(list)
    for release, label in q("select distinct release_id, label_id from release_labels order by 1, 2"):
        if label in label_at:
            release_labels[release].append(label_at[label])
    tracks: dict[str, list[int]] = defaultdict(list)
    for release, song in q(
        "select release_id, recording_id from release_recordings order by 1, disc_number, position"
    ):
        if song in song_at and song_at[song] not in tracks[release]:
            tracks[release].append(song_at[song])

    relation_types = Codes()
    relations = [
        [artist_at[s], artist_at[o], relation_types.code(kind), year_of(begin), year_of(end)]
        for s, o, kind, begin, end in q(
            "select subject_artist_id, object_artist_id, relation_type, begin_date, end_date"
            " from artist_relations order by 1, 2, 3, 4"
        )
        if s in artist_at and o in artist_at
    ]

    facts = {
        artist: [description, url, honors(awards), honors(nominations), wikidata]
        for artist, description, url, awards, nominations, wikidata in q(
            "select artist_id, description, wikipedia_url, awards, nominations, wikidata_id"
            " from artist_facts"
        )
    }
    # Chart totals only: the weekly charts and the album-by-album runs are Billboard's and stay out.
    hot100 = {
        artist: [entries, top_ten, number_ones, peak, int(first[:4]), int(last[:4])]
        for artist, entries, top_ten, number_ones, peak, first, last in q(
            "select artist_id, entries, top_ten, number_ones, best_peak, first_week, last_week"
            " from artist_charts"
        )
    }
    albums = {
        artist: [entries, top_ten, number_ones, peak, int(first[:4]), int(last[:4])]
        for artist, entries, top_ten, number_ones, peak, first, last in q(
            "select artist_id, count(*), sum(peak <= 10), sum(peak = 1), min(peak),"
            " min(first_week), max(last_week) from album_chart_runs group by 1"
        )
    }
    contests: dict[str, list[list]] = defaultdict(list)
    for artist, *entry in q(
        "select artist_id, year, country, song, place_final, points_final, place_semi_final"
        " from eurovision_entries order by 1, 2"
    ):
        contests[artist].append(entry)
    events: dict[str, list[list]] = defaultdict(list)
    for artist, event, name, date, place in q(
        "select p.artist_id, e.id, e.name, e.date, e.place from event_performers p"
        " join events e on e.id = p.event_id order by p.artist_id, e.date desc, e.id"
    ):
        events[artist].append([event, name, date, place])

    # Photos: the address of Commons' 330-pixel version, and the credit its license asks for. A
    # photo that has to be credited but names no author can't be, so it is left out.
    photos = {
        artist_at[artist]: [thumb, page, author, license_name, secure(license_url)]
        for artist, thumb, page, author, license_name, license_url in q(
            "select artist_id, thumbnail_url, page_url, author, license, license_url"
            " from artist_images order by artist_id"
        )
        if artist in artist_at and (author or not license_name.startswith("CC BY"))
    }

    artist_rows = []
    extras = {}
    for artist, name, kind, country, disambiguation, begin, end, level, listeners in artists:
        row = [
            mbid["artist"][artist],
            name,
            kind,
            country,
            disambiguation or None,
            year_of(begin),
            year_of(end),
            {"full": 2, "profile": 1}.get(level, 0),
            listeners,
            [n for g, s in shares.get(artist, []) for n in (genre_at[g], round(s * 100))],
            aliases.get(artist, []),
        ]
        artist_rows.append(row)
        extra = {
            "facts": facts.get(artist),
            "hot100": hot100.get(artist),
            "albums": albums.get(artist),
            "eurovision": contests.get(artist),
            "events": events[artist][:MAX_EVENTS] if artist in events else None,
            "eventCount": len(events[artist]) if artist in events else None,
        }
        if any(v for v in extra.values()):
            extras[artist_at[artist]] = {k: v for k, v in extra.items() if v}

    return {
        "version": FORMAT_VERSION,
        "roles": roles.values,
        "details": details.values,
        "relationTypes": relation_types.values,
        "artists": artist_rows,
        "extras": extras,
        "photos": photos,
        "genres": genre_rows,
        "labels": [[mbid["label"][i], name] for i, name in labels],
        "songs": [
            [mbid["recording"][i], title, year_of(date), round(ms / 1000) if ms else None, song_credits[i]]
            for i, title, date, ms in songs
        ],
        "releases": [
            [
                mbid["release"][i],
                title,
                year_of(date),
                thumb,
                release_artists[i],
                release_labels[i],
                tracks[i],
                release_credits[i],
            ]
            for i, title, date, thumb in releases
        ],
        "relations": relations,
    }


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    data = export(Path(sys.argv[1]))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    OUT.write_text(text + "\n", encoding="utf-8", newline="\n")
    counts = {k: len(v) for k, v in data.items() if isinstance(v, (list, dict))}
    print(f"{OUT}: {OUT.stat().st_size / 1e6:.2f} MB {counts}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
