"""Album covers from the Cover Art Archive: parsing, the fetch, storage, and the API."""

from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine

from songnexus.catalog import coverart
from songnexus.catalog.canonicalize import build_batch
from songnexus.catalog.ingest import ingest_snapshot
from songnexus.catalog.snapshot import write_snapshot
from songnexus.config import Settings
from songnexus.service.app import build_state, create_app
from songnexus.service.readmodel import probe_version
from songnexus.storage import migrate
from songnexus.storage.db import make_engine, session_scope
from songnexus.storage.release_covers import read_recording_covers, read_release_covers
from tests.catalog import fixtures as fx

NOW = datetime(2026, 11, 23, tzinfo=UTC)
THUMB = "http://coverartarchive.org/release/r1/11-250.jpg"


def _image(**overrides: Any) -> dict[str, Any]:
    image = {
        "front": True,
        "approved": True,
        "thumbnails": {"250": THUMB, "500": "http://coverartarchive.org/release/r1/11-500.jpg"},
    }
    return image | overrides


def test_the_front_cover_is_taken_over_https() -> None:
    cover = coverart.parse_cover({"images": [_image(front=False), _image()]}, "rg-1")
    assert cover is not None
    assert cover.thumbnail_url == "https://coverartarchive.org/release/r1/11-250.jpg"
    assert cover.page_url == "https://coverartarchive.org/release-group/rg-1"


def test_unapproved_or_missing_fronts_are_none() -> None:
    assert coverart.parse_cover({"images": [_image(approved=False)]}, "rg") is None
    assert coverart.parse_cover({"images": []}, "rg") is None
    older = _image(thumbnails={"small": THUMB, "large": THUMB})
    assert coverart.parse_cover({"images": [older]}, "rg") is not None


def _release_group_ids() -> list[str]:
    batch = build_batch(fx.small_catalog())
    return sorted(
        r["source_entity_id"] for r in batch.mappings.values() if r["entity_type"] == "release"
    )


@pytest.fixture
def engine(tmp_path: Path) -> Iterator[Engine]:
    snapshot = tmp_path / "snapshot.jsonl.gz"
    write_snapshot(fx.small_catalog(), snapshot)
    engine = make_engine(f"sqlite:///{tmp_path / 'catalog.db'}")
    migrate.upgrade(engine)
    ingest_snapshot(engine, snapshot)
    yield engine
    engine.dispose()


def _client(cache: Path, with_cover: set[str]) -> coverart.CoverArtClient:
    def handler(request: httpx.Request) -> httpx.Response:
        mbid = request.url.path.rsplit("/", 1)[1]
        if mbid not in with_cover:
            return httpx.Response(404, text="No cover art found")
        return httpx.Response(200, json={"images": [_image()]})

    return coverart.CoverArtClient(
        cache_dir=cache,
        base_url="https://caa.example",
        min_interval_s=0,
        http=httpx.Client(transport=httpx.MockTransport(handler)),
    )


def test_fetch_stores_covers_and_a_missing_cover_is_not_a_failure(
    engine: Engine, tmp_path: Path
) -> None:
    groups = _release_group_ids()
    first = groups[0]
    result = coverart.run_fetch_covers(engine, _client(tmp_path / "a", {first}), now=NOW)
    assert result["releasesConsidered"] == len(groups)
    assert result["releasesWithCover"] == 1
    with session_scope(engine) as session:
        assert len(read_release_covers(session)) == 1
        covers = read_recording_covers(session)
    assert covers
    assert set(covers.values()) == {"https://coverartarchive.org/release/r1/11-250.jpg"}

    before = probe_version(engine)
    again = coverart.run_fetch_covers(engine, _client(tmp_path / "b", {first}), now=NOW)
    assert again["written"]["unchanged"] == 1
    assert probe_version(engine) == before
    assert before is not None
    assert ".cv" in before


def test_songs_carry_their_cover_through_the_api(engine: Engine, tmp_path: Path) -> None:
    coverart.run_fetch_covers(engine, _client(tmp_path / "c", set(_release_group_ids())), now=NOW)
    url = str(engine.url)
    settings = Settings(database_url=url, log_json=False, read_model_refresh_s=3600)
    batch = build_batch(fx.small_catalog())
    song, other = (
        f"recordings/{r['entity_id']}"
        for r in sorted(batch.mappings.values(), key=lambda r: r["source_entity_id"])
        if r["entity_type"] == "recording" and r["source_entity_id"] in ("rec-1", "rec-2")
    )
    with TestClient(create_app(settings, build_state(settings))) as client:
        body = client.get(f"/v1/{song}:compare", params={"other": other}).json()
        assert body["recordingA"]["coverUrl"].startswith("https://coverartarchive.org/")
        recording = client.get(f"/v1/{song}").json()
        assert any(a["coverUrl"] for a in recording["appearances"])
