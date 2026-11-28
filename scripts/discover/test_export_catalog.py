"""Tests of the catalog export: python -m unittest discover -s scripts/discover (no packages needed)."""

from __future__ import annotations

import contextlib
import io
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import export_catalog as ec  # noqa: E402

TABLES = {
    "entity_source_mappings": "entity_type, entity_id, source_entity_id, source_id",
    "artists": "id, name, artist_type, country, disambiguation, begin_date, end_date, detail_level",
    "artist_audiences": "artist_id, listeners",
    "artist_aliases": "artist_id, alias",
    "artist_genres": "artist_id, genre_id, source_id, votes",
    "genres": "id, name",
    "genre_parents": "genre_id, parent_genre_id",
    "labels": "id, name",
    "releases": "id, title, first_release_date",
    "release_covers": "release_id, thumbnail_url",
    "release_credits": "release_id, artist_id, role, role_detail",
    "release_artists": "release_id, artist_id, position",
    "release_labels": "release_id, label_id",
    "release_recordings": "release_id, recording_id, disc_number, position",
    "recordings": "id, title, first_release_date, length_ms",
    "recording_credits": "recording_id, artist_id, role, role_detail",
    "artist_relations": "subject_artist_id, object_artist_id, relation_type, begin_date, end_date",
    "artist_facts": "artist_id, description, wikipedia_url, awards, nominations, wikidata_id",
    "artist_charts": "artist_id, entries, top_ten, number_ones, best_peak, first_week, last_week",
    "album_chart_runs": "artist_id, title, peak, weeks, first_week, last_week",
    "eurovision_entries": "artist_id, year, country, song, place_final, points_final, place_semi_final",
    "event_performers": "event_id, artist_id",
    "events": "id, name, date, place",
    "artist_images": "artist_id, thumbnail_url, page_url, author, license, license_url",
}

AWARDS = json.dumps(
    [
        {"id": "Q1", "name": "Old Award", "year": 1990},
        {"id": "Q3", "name": "Undated Award"},
        {"id": "Q2", "name": "New Award", "year": 2010},
    ]
)

ROWS: dict[str, list[tuple]] = {
    "entity_source_mappings": [
        ("artist", "anna", "mb-2", "musicbrainz"),
        ("artist", "anna", "discogs-1", "discogs"),
        ("artist", "ben", "mb-1", "musicbrainz"),
        ("artist", "nobody", "mb-0", "musicbrainz"),
        ("recording", "song", "mbs-9", "musicbrainz"),
        ("recording", "song", "mbs-1", "musicbrainz"),  # merged: the smallest ID is kept
        ("release", "album", "mbr-1", "musicbrainz"),
        ("label", "label", "mbl-1", "musicbrainz"),
    ],
    "artists": [
        ("anna", "Anna", "Person", "SE", "", "1980-05-01", None, "full"),
        ("ben", "Ben", None, None, "the singer", "bad date", "2001", "stub"),
        ("nobody", "[unknown]", None, None, None, None, None, "stub"),
        ("unmapped", "Not in MusicBrainz", None, None, None, None, None, "full"),
    ],
    "artist_audiences": [("anna", 5), ("anna", 9)],
    "artist_aliases": [("anna", "Änna"), ("unmapped", "x")],
    "artist_genres": [
        ("anna", "g-pop", "musicbrainz", 3),
        ("anna", "g-rock", "musicbrainz", 1),
        ("anna", "g-pop", "discogs", 10),
        ("anna", "g-none", "discogs", 0),
    ],
    "genres": [("g-pop", "Synth-Pop"), ("g-rock", "synth pop"), ("g-none", "unused")],
    "genre_parents": [("g-pop", "g-rock"), ("g-pop", "g-none")],
    "labels": [("label", "Label"), ("label-x", "Unmapped label")],
    "releases": [("album", "Album", "1999-01-01"), ("album-x", "Unmapped", None)],
    "release_covers": [("album", "https://coverartarchive.org/x.jpg")],
    "release_credits": [("album", "ben", "producer", None)],
    "release_artists": [("album", "anna", 0), ("album", "unmapped", 1)],
    "release_labels": [("album", "label"), ("album", "label"), ("album", "label-x")],
    "release_recordings": [("album", "song", 1, 1), ("album", "song", 2, 1), ("album", "gone", 1, 2)],
    "recordings": [("song", "Song", "1999", 181400), ("song-x", "Unmapped song", None, None)],
    "recording_credits": [
        ("song", "anna", "primary", None),
        ("song", "anna", "primary", None),  # the same credit from two sources
        ("song", "ben", "instrument", "guitar"),
        ("song", "nobody", "producer", None),
    ],
    "artist_relations": [
        ("ben", "anna", "supported", "1999-02", None),
        ("nobody", "anna", "member_of", None, None),
    ],
    "artist_facts": [("anna", "Singer", "https://en.wikipedia.org/wiki/Anna", AWARDS, None, "Q9")],
    "artist_charts": [("anna", 4, 2, 1, 1, "1999-01-01", "2005-06-01")],
    "album_chart_runs": [
        ("anna", "A", 1, 5, "1999-01-01", "2000-01-01"),
        ("anna", "B", 30, 9, "2003-01-01", "2004-02-01"),
    ],
    "eurovision_entries": [("anna", 1999, "Sweden", "Song", 1, 163, None)],
    "event_performers": [(f"e{i}", "anna") for i in range(12)],
    "events": [(f"e{i}", f"Event {i}", f"20{i:02}-01-01", None) for i in range(12)],
    "artist_images": [
        ("anna", "https://upload/x.jpg", "https://commons/x", "Someone", "CC BY 4.0", "http://cc/by/4.0/"),
    ],
}


def build(folder: Path, rows: dict[str, list[tuple]]) -> Path:
    path = folder / "v2.db"
    with contextlib.closing(sqlite3.connect(path)) as db:
        for table, columns in TABLES.items():
            db.execute(f"create table {table} ({columns})")
            marks = ", ".join("?" for _ in columns.split(","))
            db.executemany(f"insert into {table} values ({marks})", rows.get(table, []))
        db.commit()
    return path


class ExportTest(unittest.TestCase):
    def setUp(self) -> None:
        folder = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(folder.cleanup)
        self.folder = Path(folder.name)

    def export(self, **changes: list[tuple]) -> dict:
        path = build(self.folder, {**ROWS, **changes})
        data = ec.export(path)
        path.unlink(missing_ok=True)
        return data

    def test_artists_are_by_musicbrainz_id_without_placeholders_or_unmapped_ones(self) -> None:
        rows = self.export()["artists"]
        self.assertEqual([row[0] for row in rows], ["mb-1", "mb-2"])
        ben, anna = rows
        self.assertEqual(anna[1:9], ["Anna", "Person", "SE", None, 1980, None, 2, 9])
        self.assertEqual(anna[10], ["Änna"])
        # A date that isn't one is no date; a missing level is the least known.
        self.assertEqual(ben[4:8], ["the singer", None, 2001, 0])

    def test_genres_average_their_sources_and_skip_unused_ones(self) -> None:
        data = self.export()
        self.assertEqual([g[0] for g in data["genres"]], ["Synth-Pop", "synth pop"])
        # 3 of 4 votes in one source, all in the other: (75 + 100) / 2.
        self.assertEqual(data["artists"][1][9], [0, 88, 1, 12])

    def test_genres_with_the_same_address_get_different_ones(self) -> None:
        slugs = [g[1] for g in self.export()["genres"]]
        self.assertEqual(slugs, ["synth-pop", "synth-pop-2"])

    def test_genre_parents_only_point_at_genres_that_are_there(self) -> None:
        self.assertEqual([g[2] for g in self.export()["genres"]], [[1], []])

    def test_songs_keep_each_credit_once_and_only_for_known_artists(self) -> None:
        data = self.export()
        [(song_id, title, year, seconds, flat)] = data["songs"]
        self.assertEqual((song_id, title, year, seconds), ("mbs-1", "Song", 1999, 181))
        credits = [
            (data["artists"][flat[i]][1], data["roles"][flat[i + 1]], data["details"][flat[i + 2]])
            for i in range(0, len(flat), 3)
        ]
        self.assertEqual(credits, [("Anna", "primary", ""), ("Ben", "instrument", "guitar")])

    def test_albums_point_at_known_things_once(self) -> None:
        [album] = self.export()["releases"]
        self.assertEqual(album[:4], ["mbr-1", "Album", 1999, "https://coverartarchive.org/x.jpg"])
        self.assertEqual(album[4:7], [[1], [0], [0]])  # artists, labels, tracks

    def test_relations_between_known_artists_only(self) -> None:
        data = self.export()
        self.assertEqual(data["relations"], [[0, 1, 0, 1999, None]])
        self.assertEqual(data["relationTypes"], ["supported"])

    def test_facts_list_the_newest_honors_first(self) -> None:
        extra = self.export()["extras"][1]
        description, _, awards, nominations, wikidata = extra["facts"]
        self.assertEqual([a[1] for a in awards], ["New Award", "Old Award", "Undated Award"])
        self.assertEqual((description, nominations, wikidata), ("Singer", [], "Q9"))

    def test_long_lists_of_honors_and_events_are_cut_but_counted(self) -> None:
        many = json.dumps([{"id": f"Q{i}", "name": f"A{i:03}"} for i in range(99)])
        facts = [("anna", None, None, many, None, None)]
        extra = self.export(artist_facts=facts)["extras"][1]
        self.assertEqual(len(extra["facts"][2]), ec.MAX_HONORS)
        self.assertEqual((len(extra["events"]), extra["eventCount"]), (ec.MAX_EVENTS, 12))
        self.assertEqual(extra["events"][0], ["e11", "Event 11", "2011-01-01", None])

    def test_charts_are_totals_only(self) -> None:
        data = self.export()
        extra = data["extras"][1]
        self.assertEqual(extra["hot100"], [4, 2, 1, 1, 1999, 2005])
        self.assertEqual(extra["albums"], [2, 1, 1, 1, 1999, 2004])
        self.assertEqual(extra["eurovision"], [[1999, "Sweden", "Song", 1, 163, None]])
        # No album's own run leaves the database.
        self.assertNotIn('"B"', json.dumps(data))

    def test_artists_with_nothing_extra_have_no_entry(self) -> None:
        self.assertEqual(list(self.export()["extras"]), [1])

    def test_photos_keep_their_credit_over_a_secure_link(self) -> None:
        self.assertEqual(
            self.export()["photos"],
            {1: ["https://upload/x.jpg", "https://commons/x", "Someone", "CC BY 4.0", "https://cc/by/4.0/"]},
        )

    def test_photos_that_must_be_credited_but_cannot_be_are_left_out(self) -> None:
        def photos(author: str | None, license_name: str, artist: str = "anna") -> dict:
            row = (artist, "https://t", "https://p", author, license_name, None)
            return self.export(artist_images=[row])["photos"]

        self.assertEqual(photos(None, "CC BY-SA 4.0"), {})
        self.assertEqual(photos("", "CC BY 2.0"), {})
        self.assertIn(1, photos(None, "Public domain"))
        self.assertIn(1, photos(None, "CC0"))
        self.assertEqual(photos("Someone", "CC BY 4.0", artist="nobody"), {})

    def test_the_same_database_always_gives_the_same_file(self) -> None:
        shuffled = {table: list(reversed(rows)) for table, rows in ROWS.items()}
        first = json.dumps(self.export(), sort_keys=True)
        self.assertEqual(first, json.dumps(self.export(**shuffled), sort_keys=True))

    def test_an_empty_database_exports_an_empty_catalog(self) -> None:
        data = self.export(**{table: [] for table in TABLES})
        self.assertEqual(data["artists"], [])
        self.assertEqual(data["version"], ec.FORMAT_VERSION)

    def test_the_database_is_only_read(self) -> None:
        path = build(self.folder, ROWS)
        before = path.read_bytes()
        ec.export(path)
        self.assertEqual(path.read_bytes(), before)

    def test_the_command_writes_the_file_and_explains_itself(self) -> None:
        path = build(self.folder, ROWS)
        out = self.folder / "data" / "catalog.json"
        with mock.patch.object(ec, "OUT", out), contextlib.redirect_stdout(io.StringIO()) as said:
            with mock.patch.object(sys, "argv", ["export_catalog.py", str(path)]):
                self.assertEqual(ec.main(), 0)
        self.assertIn("MB", said.getvalue())
        text = out.read_text(encoding="utf-8")
        self.assertIn("Änna", text)  # not escaped
        self.assertTrue(text.endswith("\n"))
        self.assertNotIn(b"\r", out.read_bytes())
        with mock.patch.object(sys, "argv", ["x"]), contextlib.redirect_stderr(io.StringIO()) as err:
            self.assertEqual(ec.main(), 2)
        self.assertIn("export_catalog.py", err.getvalue())


class HelpersTest(unittest.TestCase):
    def test_years(self) -> None:
        for value, year in [("1975-10-31", 1975), ("1975", 1975), ("", None), (None, None), ("????", None)]:
            self.assertEqual(ec.year_of(value), year, value)

    def test_slugs(self) -> None:
        for name, slug in [("Hip Hop", "hip-hop"), ("R&B", "r-b"), ("música", "música"), ("!!!", "")]:
            self.assertEqual(ec.slug_of(name), slug)

    def test_codes_are_in_order_of_first_use(self) -> None:
        codes = ec.Codes()
        self.assertEqual([codes.code(v) for v in ["b", "a", "b"]], [0, 1, 0])
        self.assertEqual(codes.values, ["b", "a"])


if __name__ == "__main__":
    unittest.main()
