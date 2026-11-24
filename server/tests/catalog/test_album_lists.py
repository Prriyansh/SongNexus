"""Billboard 200 runs, Rolling Stone's 500 Greatest Albums and Eurovision entries."""

from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select

from songnexus.catalog import billboard, eurovision, greatest_albums
from songnexus.catalog.ingest import ingest_snapshot
from songnexus.catalog.snapshot import write_snapshot
from songnexus.config import Settings
from songnexus.core import ids
from songnexus.service.app import build_state, create_app
from songnexus.service.billboard_job import run_billboard_200
from songnexus.service.lists_job import run_eurovision, run_greatest_albums
from songnexus.service.readmodel import load_read_model, probe_version
from songnexus.storage import migrate
from songnexus.storage import models as m
from songnexus.storage.db import make_engine, session_scope
from tests.catalog import fixtures as fx

ALBUM_WEEKS = """chart_week,current_week,title,performer,last_week,peak_pos,wks_on_chart,wks_at_no1
2020-01-04,9,First Album,Alice,NA,9,1,NA
2020-01-11,1,First Album,Alice,9,1,2,1
2021-05-01,40,Second Album,Alice Featuring Bob,NA,40,1,NA
2022-02-05,15,Second Album,Alice,NA,15,1,NA
2019-03-02,3,Their Album,Nobody We Know,NA,3,1,NA
"""

ROLLING_STONE = """\
sort_name,clean_name,album,rank_2003,rank_2012,rank_2020,release_year,spotify_popularity
"Alice",Alice,First Album,120,118,NA,2020,77
"Alice",Alice,Live Album,NA,NA,NA,2021,40
"Carol",Carol,Carol Sings,NA,NA,402,1999,12
"Strangers",Strangers,Unknown,5,5,5,1970,90
"""

CONTESTANTS = "\n".join(
    [
        "year,to_country_id,to_country,performer,song,place_contest,sf_num,running_final,"
        "running_sf,place_final,points_final,place_sf,points_sf,points_tele_final,"
        "points_jury_final,points_tele_sf,points_jury_sf,composers,lyricists,lyrics,youtube_url",
        '1974,se,Sweden,Alice,Song,1,,8,,1,24.0,,,,,,,A Writer,A Lyricist,"Some lyric line",x',
        '2005,mt,Malta,Alice,Other Song,,1,,3,,,12,40,,,,,,,"More lyric words",',
        '2010,de,Germany,Alice & Bob,Song,2,,,,2,200,,,,,,,,,"Duet lyric",',
        '1990,at,Austria,Alice,A Namesake Song,10,,,,10,58,,,,,,,,,"Other words",',
    ]
)


def test_billboard_200_rows_share_the_hot_100_parser() -> None:
    albums = {(a.title, a.performer): a for a in billboard.parse_weeks(ALBUM_WEEKS)}
    first = albums[("First Album", "Alice")]
    assert (first.peak, first.weeks) == (1, 2)


def test_the_list_keeps_ranked_albums_and_never_reads_spotify_columns() -> None:
    albums = greatest_albums.parse_albums(ROLLING_STONE)
    assert [(a.artist, a.title, a.rank_2003, a.rank_2020) for a in albums] == [
        ("Alice", "First Album", 120, None),
        ("Carol", "Carol Sings", None, 402),
        ("Strangers", "Unknown", 5, 5),
    ]  # Live Album was never ranked
    assert not hasattr(albums[0], "spotify_popularity")


def test_contest_entries_drop_the_lyrics() -> None:
    entries = eurovision.parse_entries(CONTESTANTS)
    assert [(e.year, e.country, e.song, e.place_final, e.points_final) for e in entries] == [
        (1974, "Sweden", "Song", 1, 24),
        (2005, "Malta", "Other Song", None, None),
        (2010, "Germany", "Song", 2, 200),
        (1990, "Austria", "A Namesake Song", 10, 58),
    ]
    assert entries[1].place_semi_final == 12
    assert all("lyric" not in repr(e).lower() for e in entries)


@pytest.fixture
def engine(tmp_path: Path) -> Iterator[Engine]:
    snapshot = tmp_path / "snapshot.jsonl.gz"
    write_snapshot(fx.small_catalog(), snapshot)
    engine = make_engine(f"sqlite:///{tmp_path / 'catalog.db'}")
    migrate.upgrade(engine)
    ingest_snapshot(engine, snapshot)
    yield engine
    engine.dispose()


def test_artist_pages_show_albums_lists_and_contests(engine: Engine) -> None:
    model = load_read_model(engine)
    now = datetime(2026, 11, 24, tzinfo=UTC)
    before = probe_version(engine)

    albums = run_billboard_200(engine, model, billboard.parse_weeks(ALBUM_WEEKS), now=now)
    assert albums == {
        "chartAlbums": 4,  # Second Album appears under two credits
        "artistsMatched": 1,  # Nobody We Know is not in the catalog
        "albumsMatched": 2,  # ...and is one run for Alice
        "numberOneAlbums": 1,
    }
    listed = run_greatest_albums(
        engine, model, greatest_albums.parse_albums(ROLLING_STONE), now=now
    )
    assert listed["artistsMatched"] == 2  # Alice and Carol; Strangers is not in the catalog
    contests = run_eurovision(engine, model, eurovision.parse_entries(CONTESTANTS), now=now)
    # "Alice & Bob" is a duo, not Alice; and the 1990 "Alice" sang a song our Alice never
    # recorded, so it is a namesake. Only her two own entries count.
    assert contests["entriesMatched"] == 2
    with session_scope(engine) as session:
        assert {(e.year, e.song) for e in session.scalars(select(m.EurovisionEntry))} == {
            (1974, "Song"),
            (2005, "Other Song"),
        }
    assert probe_version(engine) != before  # cached artist pages pick the new data up

    settings = Settings(database_url=str(engine.url), log_json=False, read_model_refresh_s=3600)
    with TestClient(create_app(settings, build_state(settings))) as client:
        alice = client.get(f"/v1/artists/{ids.artist_id('mb-alice')}").json()
        assert alice["albumCharts"] == {
            "entries": 2,
            "topTen": 1,
            "numberOnes": 1,
            "bestPeak": 1,
            "firstYear": 2020,
            "lastYear": 2022,
            "topAlbums": [
                {"title": "First Album", "peak": 1, "weeks": 2, "firstYear": 2020},
                {"title": "Second Album", "peak": 15, "weeks": 1, "firstYear": 2021},
            ],
        }
        assert alice["greatestAlbums"] == [
            {
                "title": "First Album",
                "releaseYear": 2020,
                "rank2003": 120,
                "rank2012": 118,
                "rank2020": None,
            }
        ]
        assert [e["year"] for e in alice["eurovision"]] == [1974, 2005]
        assert alice["eurovision"][0] == {
            "year": 1974,
            "country": "Sweden",
            "song": "Song",
            "placeFinal": 1,
            "pointsFinal": 24,
            "placeSemiFinal": None,
        }
        carol = client.get(f"/v1/artists/{ids.artist_id('mb-carol')}").json()
        assert carol["albumCharts"] is None
        assert carol["eurovision"] == []
        assert [a["rank2020"] for a in carol["greatestAlbums"]] == [402]
