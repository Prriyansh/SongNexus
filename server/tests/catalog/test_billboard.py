"""Billboard Hot 100 history: parsing the weekly rows, matching to the catalog, and the API."""

from collections.abc import Iterator
from datetime import UTC, date, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine

from songnexus.catalog import billboard
from songnexus.catalog.canonicalize import build_batch
from songnexus.catalog.ingest import ingest_snapshot
from songnexus.catalog.snapshot import write_snapshot
from songnexus.config import Settings
from songnexus.core import ids
from songnexus.service.app import build_state, create_app
from songnexus.service.billboard_job import run_billboard
from songnexus.service.readmodel import load_read_model
from songnexus.storage import migrate
from songnexus.storage.db import make_engine
from tests.catalog import fixtures as fx

WEEKS = """chart_week,current_week,title,performer,last_week,peak_pos,wks_on_chart,wks_at_no1
2021-01-09,12,Song,Alice Featuring Bob,NA,12,1,NA
2021-01-02,30,Song,Alice Featuring Bob,NA,30,2,NA
2021-01-16,1,Song,Alice Featuring Bob,12,1,3,1
2021-02-06,40,Other Song,Alice,NA,40,1,NA
2021-03-06,5,Not In Our Data,Alice,NA,5,1,NA
2021-03-06,7,Elsewhere,Nobody We Know,NA,7,1,NA
bad,row,,,,,,
"""


def test_weekly_rows_become_one_run_per_song() -> None:
    songs = {(s.title, s.performer): s for s in billboard.parse_weeks(WEEKS)}
    run = songs[("Song", "Alice Featuring Bob")]
    assert (run.peak, run.weeks) == (1, 3)
    assert (run.first_week, run.last_week) == (date(2021, 1, 2), date(2021, 1, 16))
    assert len(songs) == 4  # the malformed row is skipped


@pytest.mark.parametrize(
    ("performer", "expected"),
    [
        ("Simon & Garfunkel", ["Simon & Garfunkel", "Simon"]),
        ("Lil Durk Featuring Morgan Wallen", ["Lil Durk Featuring Morgan Wallen", "Lil Durk"]),
        ("A, B & C", ["A, B & C", "A"]),
        ("Solo", ["Solo"]),
    ],
)
def test_the_whole_credit_is_tried_before_its_lead(performer: str, expected: list[str]) -> None:
    assert billboard.performer_candidates(performer) == expected


@pytest.fixture
def engine(tmp_path: Path) -> Iterator[Engine]:
    snapshot = tmp_path / "snapshot.jsonl.gz"
    write_snapshot(fx.small_catalog(), snapshot)
    engine = make_engine(f"sqlite:///{tmp_path / 'catalog.db'}")
    migrate.upgrade(engine)
    ingest_snapshot(engine, snapshot)
    yield engine
    engine.dispose()


def test_artists_and_songs_get_their_chart_history(engine: Engine) -> None:
    model = load_read_model(engine)
    now = datetime(2026, 11, 23, tzinfo=UTC)
    result = run_billboard(engine, model, billboard.parse_weeks(WEEKS), now=now)
    # Alice leads three chart songs; two are in the catalog. Nobody We Know is not an artist.
    assert result["artistsMatched"] == 1
    assert result["songsMatched"] == 2
    assert result["numberOnes"] == 1

    settings = Settings(database_url=str(engine.url), log_json=False, read_model_refresh_s=3600)
    batch = build_batch(fx.small_catalog())
    song = next(
        r["entity_id"]
        for r in batch.mappings.values()
        if r["entity_type"] == "recording" and r["source_entity_id"] == "rec-1"
    )
    with TestClient(create_app(settings, build_state(settings))) as client:
        alice = client.get(f"/v1/artists/{ids.artist_id('mb-alice')}").json()
        assert alice["charts"] == {
            "entries": 3,
            "topTen": 2,
            "numberOnes": 1,
            "bestPeak": 1,
            "firstYear": 2021,
            "lastYear": 2021,
        }
        assert client.get(f"/v1/artists/{ids.artist_id('mb-carol')}").json()["charts"] is None
        chart = client.get(f"/v1/recordings/{song}").json()["chart"]
        assert chart == {
            "peak": 1,
            "weeks": 3,
            "firstWeek": "2021-01-02",
            "lastWeek": "2021-01-16",
        }
