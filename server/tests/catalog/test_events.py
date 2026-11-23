"""Concerts and festivals from MusicBrainz: parsing, merging, the fetch, and the API."""

from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine

from songnexus.catalog.ingest import ingest_snapshot
from songnexus.catalog.musicbrainz.client import MusicBrainzClient
from songnexus.catalog.musicbrainz.events import merge, parse_event, run_fetch_events
from songnexus.catalog.snapshot import write_snapshot
from songnexus.config import Settings
from songnexus.core import ids
from songnexus.service.app import build_state, create_app
from songnexus.storage import migrate
from songnexus.storage.db import make_engine
from songnexus.storage.events import EventRecord
from tests.catalog import fixtures as fx

ALICE, BOB = ids.artist_id("mb-alice"), ids.artist_id("mb-bob")
CATALOG = {"mb-alice": ALICE, "mb-bob": BOB}


def _rel(kind: str, mbid: str) -> dict[str, Any]:
    return {"target-type": "artist", "type": kind, "artist": {"id": mbid}}


def _event(event_id: str, *rels: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return {
        "id": event_id,
        "name": f"Event {event_id}",
        "type": "Concert",
        "life-span": {"begin": "2019-07-12"},
        "relations": [
            *rels,
            {"target-type": "place", "type": "held at", "place": {"name": "Arena"}},
        ],
        **extra,
    }


def test_performers_count_only_as_acts_and_only_by_id() -> None:
    event = parse_event(
        _event(
            "e1",
            _rel("main performer", "mb-alice"),
            _rel("support act", "mb-bob"),
            _rel("main performer", "mb-unknown"),  # not in the catalog
            {"target-type": "artist", "type": "host", "artist": {"id": "mb-bob"}},
        ),
        CATALOG,
    )
    assert event == EventRecord(
        "e1", "Event e1", "Concert", "2019-07-12", "Arena", tuple(sorted((ALICE, BOB)))
    )


def test_cancelled_or_catalog_less_events_are_dropped() -> None:
    assert (
        parse_event(_event("e2", _rel("main performer", "mb-alice"), cancelled=True), CATALOG)
        is None
    )
    assert parse_event(_event("e3", _rel("main performer", "mb-unknown")), CATALOG) is None


def test_one_event_seen_from_two_artists_is_merged() -> None:
    a = EventRecord("e1", "Fest", None, None, None, (ALICE,))
    b = EventRecord("e1", "Fest", None, None, None, (BOB,))
    (merged,) = merge([a, b])
    assert set(merged.performers) == {ALICE, BOB}


@pytest.fixture
def engine(tmp_path: Path) -> Iterator[Engine]:
    snapshot = tmp_path / "snapshot.jsonl.gz"
    write_snapshot(fx.small_catalog(), snapshot)
    engine = make_engine(f"sqlite:///{tmp_path / 'catalog.db'}")
    migrate.upgrade(engine)
    ingest_snapshot(engine, snapshot)
    yield engine
    engine.dispose()


def test_shared_bills_reach_the_artist_and_compare_pages(engine: Engine, tmp_path: Path) -> None:
    listings = {
        # An event's record lists every performer, whichever artist it was found through.
        # Only seed (fully fetched) artists are browsed: Alice here, not Bob.
        "mb-alice": [
            _event("fest", _rel("main performer", "mb-alice"), _rel("support act", "mb-bob")),
            _event("solo", _rel("main performer", "mb-alice")),
        ],
    }

    def handler(request: httpx.Request) -> httpx.Response:
        events = listings.get(request.url.params["artist"], [])
        return httpx.Response(200, json={"events": events, "event-count": len(events)})

    client = MusicBrainzClient(
        base_url="https://mb.example/ws/2",
        cache_dir=tmp_path / "cache",
        min_interval_s=0,
        http=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    result = run_fetch_events(engine, client, now=datetime(2026, 11, 23, tzinfo=UTC))
    assert result["events"] == 2
    assert result["eventsWithTwoOrMoreCatalogArtists"] == 1

    settings = Settings(database_url=str(engine.url), log_json=False, read_model_refresh_s=3600)
    with TestClient(create_app(settings, build_state(settings))) as api:
        stage = api.get(f"/v1/artists/{ALICE}").json()["stage"]
        assert stage["total"] == 2
        assert stage["recent"][0]["url"].startswith("https://musicbrainz.org/event/")
        shared = api.get(f"/v1/artists/{ALICE}:compare", params={"other": f"artists/{BOB}"}).json()
        (event,) = shared["sharedEvents"]
        assert event["displayName"] == "Event fest"
        assert event["place"] == "Arena"
        assert {p["name"] for p in event["performers"]} == {f"artists/{ALICE}", f"artists/{BOB}"}
