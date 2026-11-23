"""ListMoreCredits against fake Discogs and Genius APIs (httpx mock transport)."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import insert, select

from songnexus.catalog.ingest import ingest_snapshot
from songnexus.catalog.snapshot import write_snapshot
from songnexus.config import Settings
from songnexus.core import ids
from songnexus.service.app import build_state, create_app
from songnexus.service.more_credits import CreditSources, credit_role
from songnexus.storage import migrate
from songnexus.storage import models as m
from songnexus.storage.db import make_engine, session_scope
from tests.catalog import fixtures as fx

ALICE, BOB, CAROL = (ids.artist_id(f"mb-{n}") for n in ("alice", "bob", "carol"))
DISCOGS = {ALICE: "100", BOB: "200", CAROL: "300"}  # Carol is also credited, as a producer


@pytest.mark.parametrize(
    ("label", "role"),
    [
        ("Producer", "producer"),
        ("Mixed By", "mixing"),
        ("Written-By", "songwriting"),
        ("Bass Guitar", "instruments"),
        ("Mastered By", None),
        ("Photography By", None),
        ("Featuring", "featured"),
    ],
)
def test_credit_labels_map_to_the_apps_roles(label: str, role: str | None) -> None:
    assert credit_role(label) == role


def _release(rid: int, title: str, credits: list[tuple[int, str, str]]) -> dict[str, Any]:
    return {
        "id": rid,
        "title": title,
        "year": 2020,
        "uri": f"https://www.discogs.com/release/{rid}",
        "extraartists": [{"id": pid, "name": name, "role": role} for pid, name, role in credits],
        "tracklist": [],
    }


RELEASES = {
    # Alice's album: Carol (300) produced it; Dan (2) mixed it; Bob (200) features on it.
    11: _release(
        11,
        "Alice Album",
        [(300, "Carol", "Producer"), (2, "Dan (2)", "Mixed By"), (200, "Bob", "Featuring")],
    ),
    # Bob's album: Carol produced it too, and Dan mastered it (not shown).
    21: _release(21, "Bob Album", [(300, "Carol", "Producer"), (2, "Dan (2)", "Mastered By")]),
}


class FakeApis:
    """Discogs and Genius, switchable between behaviors."""

    def __init__(self) -> None:
        self.discogs_down = False
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.host == "api.discogs.com":
            return self._discogs(request.url.path)
        if request.url.host == "api.genius.com":
            return self._genius(request)
        return httpx.Response(404)

    def _discogs(self, path: str) -> httpx.Response:
        if self.discogs_down:
            return httpx.Response(503)
        if path.endswith("/releases") and "/artists/" in path:
            main = {"100": 11, "200": 21}.get(path.split("/")[2])
            releases = [{"type": "master", "role": "Main", "main_release": main, "title": "x"}]
            return httpx.Response(200, json={"releases": releases if main else []})
        return httpx.Response(200, json=RELEASES[int(path.split("/")[2])])

    @staticmethod
    def _genius(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/search":
            q = request.url.params["q"]
            hit = {"result": {"primary_artist": {"id": 1 if q == "Alice" else 9, "name": q}}}
            body: dict[str, Any] = {"hits": [hit]}
        elif path.endswith("/songs"):
            aid = int(path.split("/")[2])
            body = {"songs": [{"id": aid * 10, "primary_artist": {"id": aid}}]}
        else:
            sid = int(path.split("/")[2])
            writer = {"id": 77, "name": "Wren Writer", "url": "https://genius.com/artists/Wren"}
            body = {
                "song": {
                    "title": f"Song {sid}",
                    "url": f"https://genius.com/song-{sid}",
                    "release_date": "2021-05-01",
                    "writer_artists": [writer],
                }
            }
        return httpx.Response(200, json={"response": body})


@pytest.fixture(scope="module")
def apis() -> FakeApis:
    return FakeApis()


@pytest.fixture(scope="module")
def app_client(tmp_path_factory: pytest.TempPathFactory) -> Iterator[TestClient]:
    root = tmp_path_factory.mktemp("credits")
    snapshot = root / "mb.jsonl.gz"
    write_snapshot(fx.small_catalog(), snapshot)
    url = f"sqlite:///{root / 'catalog.db'}"
    engine = make_engine(url)
    migrate.upgrade(engine)
    ingest_snapshot(engine, snapshot)
    with session_scope(engine) as session:
        run = session.scalar(select(m.EntitySourceMapping.ingestion_run_id).limit(1))
        session.execute(
            insert(m.EntitySourceMapping),
            [
                {
                    "id": f"test-discogs-{discogs_id}",
                    "source_id": "discogs",
                    "source_entity_id": discogs_id,
                    "entity_type": "artist",
                    "entity_id": artist_id,
                    "match_method": "wikidata",
                    "confidence": 1.0,
                    "decision": "merged",
                    "ingestion_run_id": run,
                }
                for artist_id, discogs_id in DISCOGS.items()
            ],
        )
    settings = Settings(database_url=url, log_json=False, read_model_refresh_s=3600)
    with TestClient(create_app(settings, build_state(settings))) as test_client:
        yield test_client


def _sources(apis: FakeApis, genius: str = "") -> CreditSources:
    return CreditSources(
        http=lambda: httpx.Client(transport=httpx.MockTransport(apis)),
        genius_token=genius,
        sleep=lambda _s: None,
    )


@pytest.fixture
def client(app_client: TestClient, apis: FakeApis) -> TestClient:
    apis.discogs_down = False
    apis.requests.clear()
    app_client.app.state.credit_sources = _sources(apis)  # type: ignore[attr-defined]
    return app_client


def _credits(client: TestClient) -> dict[str, Any]:
    response = client.get(f"/v1/artists/{ALICE}:moreCredits", params={"other": f"artists/{BOB}"})
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def test_discogs_finds_people_on_both_through_mapped_ids(client: TestClient) -> None:
    body = _credits(client)
    (carol,) = body["collaborators"]
    assert carol["source"] == "dataSources/discogs"
    assert carol["displayName"] == "Carol"
    assert carol["url"] == "https://www.discogs.com/artist/300"
    # Carol's Discogs ID is mapped in the catalog, so she links to her artist page.
    assert carol["artist"]["name"] == f"artists/{CAROL}"
    assert (carol["rolesA"], carol["rolesB"]) == (["producer"], ["producer"])
    assert carol["evidenceA"][0] == {
        "title": "Alice Album",
        "url": "https://www.discogs.com/release/11",
        "year": 2020,
    }
    # Dan mastered Bob's album, a role the app doesn't show, so he isn't on both.
    # Bob features on Alice's album: a direct credit.
    assert body["direct"] == [carol["evidenceA"][0]]
    checks = {c["source"]: c for c in body["checks"]}
    assert checks["dataSources/discogs"]["status"] == "OK"
    assert checks["dataSources/discogs"]["scannedA"] == 1
    assert checks["dataSources/discogs"]["unit"] == "releases"
    assert checks["dataSources/genius"]["status"] == "NO_KEY"


def test_genius_runs_only_with_a_token(client: TestClient, apis: FakeApis) -> None:
    client.app.state.credit_sources = _sources(apis, genius="token")  # type: ignore[attr-defined]
    body = _credits(client)
    genius = [c for c in body["collaborators"] if c["source"] == "dataSources/genius"]
    assert [(c["displayName"], c["artist"]) for c in genius] == [("Wren Writer", None)]
    assert genius[0]["rolesA"] == ["songwriting"]
    asked = [r for r in apis.requests if r.url.host == "api.genius.com"]
    assert all(r.headers["Authorization"] == "Bearer token" for r in asked)
    assert all("lyrics" not in str(r.url) for r in asked)


def test_a_failing_source_is_reported_not_raised(client: TestClient, apis: FakeApis) -> None:
    apis.discogs_down = True
    response = client.get(f"/v1/artists/{ALICE}:moreCredits", params={"other": f"artists/{BOB}"})
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    checks = {c["source"]: c["status"] for c in response.json()["checks"]}
    assert checks["dataSources/discogs"] == "FAILED"


def test_an_artist_without_a_discogs_id_is_no_match(client: TestClient) -> None:
    other = ids.artist_id("mb-band")
    response = client.get(f"/v1/artists/{ALICE}:moreCredits", params={"other": f"artists/{other}"})
    if response.status_code == 404:  # the fixture has no such artist; nothing to check
        pytest.skip("no artist without a Discogs ID in the fixture")
    checks = {c["source"]: c["status"] for c in response.json()["checks"]}
    assert checks["dataSources/discogs"] == "NO_MATCH"


def test_the_same_artist_twice_is_rejected(client: TestClient) -> None:
    response = client.get(f"/v1/artists/{ALICE}:moreCredits", params={"other": f"artists/{ALICE}"})
    assert response.status_code == 400


def test_responses_are_cached_in_memory(client: TestClient, apis: FakeApis) -> None:
    _credits(client)
    asked = len(apis.requests)
    _credits(client)
    assert len(apis.requests) == asked


def test_discogs_reads_the_artists_albums_first() -> None:
    asked: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        asked.append(request.url.path)
        if request.url.path.endswith("/releases") and "/artists/" in request.url.path:
            releases = [
                {"type": "master", "role": "Main", "main_release": 31, "title": "A Single"},
                {"type": "master", "role": "Main", "main_release": 32, "title": "The Album"},
            ]
            return httpx.Response(200, json={"releases": releases})
        return httpx.Response(200, json=_release(int(request.url.path.split("/")[2]), "x", []))

    sources = CreditSources(
        http=lambda: httpx.Client(transport=httpx.MockTransport(handler)), sleep=lambda _s: None
    )
    with sources.client() as http:
        sources.discogs(http, "100", frozenset({"the album"}))
    assert asked[1:] == ["/releases/32", "/releases/31"]
