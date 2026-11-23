"""Artist comparisons on Last.fm, and the labels both artists released on."""

from collections.abc import Iterator

import httpx
import pytest
from fastapi.testclient import TestClient

from songnexus.catalog.ingest import ingest_snapshot
from songnexus.catalog.snapshot import write_snapshot
from songnexus.config import Settings
from songnexus.core import ids
from songnexus.service import lastfm_insights as lastfm
from songnexus.service.app import build_state, create_app
from songnexus.storage import migrate
from songnexus.storage.db import make_engine
from tests.catalog import fixtures as fx

ALICE = f"artists/{ids.artist_id('mb-alice')}"
BOB = f"artists/{ids.artist_id('mb-bob')}"
CAROL = f"artists/{ids.artist_id('mb-carol')}"


def similar(*rows: tuple[str, str | None]) -> dict[str, object]:
    return {
        "similarartists": {
            "artist": [
                {"name": n, "mbid": m or "", "url": f"https://www.last.fm/music/{n}"}
                for n, m in rows
            ]
        }
    }


class FakeLastFm:
    def __init__(self) -> None:
        self.mode = "ok"
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.mode == "down":
            raise httpx.ConnectError("refused", request=request)
        method, mbid = request.url.params["method"], request.url.params["mbid"]
        if mbid == "mb-bob" and method == "artist.getinfo":
            return httpx.Response(404, json={"error": 6, "message": "not found"})
        if method == "artist.getinfo":
            info = {
                "url": "https://www.last.fm/music/Alice",
                "stats": {"listeners": "1200", "playcount": "56000"},
            }
            return httpx.Response(200, json={"artist": info})
        if mbid == "mb-alice":
            return httpx.Response(
                200, json=similar(("Carol", "mb-carol"), ("Dee", None), ("Eve", "mb-eve"))
            )
        return httpx.Response(200, json=similar(("Eve", "mb-eve"), ("Carol", "mb-carol")))


@pytest.fixture(scope="module")
def fake() -> FakeLastFm:
    return FakeLastFm()


@pytest.fixture(scope="module")
def client(tmp_path_factory: pytest.TempPathFactory) -> Iterator[TestClient]:
    root = tmp_path_factory.mktemp("lastfm")
    snapshot = root / "mb.jsonl.gz"
    bob = fx.credit(("mb-bob", "Bob", ""))
    bob_album = fx.release_record(
        "rel-9",
        "rg-9",
        "Bob Album",
        bob,
        [fx.recording("rec-9", "Bob Song", bob)],
        labels=[fx.label_info("mb-label", "Label Records", "LR-009")],
    )
    write_snapshot([*fx.small_catalog(), bob_album], snapshot)
    url = f"sqlite:///{root / 'catalog.db'}"
    engine = make_engine(url)
    migrate.upgrade(engine)
    ingest_snapshot(engine, snapshot)
    settings = Settings(database_url=url, data_dir=root, log_json=False, read_model_refresh_s=3600)
    with TestClient(create_app(settings, build_state(settings))) as test_client:
        yield test_client


def _use(client: TestClient, fake: FakeLastFm, key: str = "k") -> None:
    fake.mode = "ok"
    client.app.state.lastfm = lastfm.LastFmClient(  # type: ignore[attr-defined]
        api_key=key, http=lambda: httpx.Client(transport=httpx.MockTransport(fake))
    )


def test_audience_and_similar_to_both(client: TestClient, fake: FakeLastFm) -> None:
    _use(client, fake)
    body = client.get(f"/v1/{ALICE}:compareOnLastFm", params={"other": BOB}).json()
    assert body["status"] == "OK"
    assert body["audienceA"] == {
        "listeners": 1200,
        "plays": 56000,
        "url": "https://www.last.fm/music/Alice",
    }
    assert body["audienceB"] is None  # Last.fm doesn't know Bob: an answer, not a failure
    # On both lists, in Alice's order; Carol is in our catalog, Eve is not.
    assert [(s["displayName"], s["artist"]) for s in body["similarToBoth"]] == [
        ("Carol", CAROL),
        ("Eve", None),
    ]
    # Looked up by MusicBrainz ID, never by name.
    assert all("artist" not in r.url.params for r in fake.requests)


def test_without_a_key_it_says_so(client: TestClient, fake: FakeLastFm) -> None:
    _use(client, fake, key="")
    body = client.get(f"/v1/{ALICE}:compareOnLastFm", params={"other": BOB}).json()
    assert body == {"status": "NO_KEY", "audienceA": None, "audienceB": None, "similarToBoth": []}


def test_an_unreachable_lastfm_is_unavailable(client: TestClient, fake: FakeLastFm) -> None:
    _use(client, fake)
    fake.mode = "down"
    response = client.get(f"/v1/{ALICE}:compareOnLastFm", params={"other": BOB})
    assert response.json()["status"] == "UNAVAILABLE"
    assert response.headers["Cache-Control"] == "no-store"


def test_comparisons_list_labels_both_released_on(client: TestClient) -> None:
    body = client.get(f"/v1/{ALICE}:compare", params={"other": BOB}).json()
    assert [(lb["displayName"], lb["releaseCount"]) for lb in body["sharedLabels"]] == [
        ("Label Records", 1)
    ]
    assert client.get(f"/v1/{ALICE}:compare", params={"other": CAROL}).json()["sharedLabels"] == []
