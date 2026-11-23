"""The Top song shortcut: Deezer's ranking, matched to the artist's own songs in the catalog."""

from collections.abc import Iterator

import httpx
import pytest
from fastapi.testclient import TestClient

from songnexus.catalog.ingest import ingest_snapshot
from songnexus.catalog.snapshot import write_snapshot
from songnexus.config import Settings
from songnexus.core import ids
from songnexus.service import top_song
from songnexus.service.app import build_state, create_app
from songnexus.storage import migrate
from songnexus.storage.db import make_engine
from tests.catalog import fixtures as fx

ALICE = f"artists/{ids.artist_id('mb-alice')}"
BOB = f"artists/{ids.artist_id('mb-bob')}"


class FakeDeezer:
    def __init__(self) -> None:
        self.mode = "ok"
        self.calls = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls += 1
        if self.mode == "down":
            raise httpx.ConnectError("refused", request=request)
        if self.mode == "quota":
            return httpx.Response(200, json={"error": {"type": "Exception", "code": 4}})
        if request.url.path == "/search/artist":
            q = request.url.params["q"]
            rows = (
                [
                    {"id": 1, "name": "Alice", "nb_fan": 10},
                    {"id": 2, "name": "ALICE", "nb_fan": 99},
                    {"id": 3, "name": "Alice Cooper", "nb_fan": 5000},
                ]
                if q == "Alice"
                else [{"id": 9, "name": "Bobby", "nb_fan": 1}]
            )
            return httpx.Response(200, json={"data": rows})
        assert request.url.path == "/artist/2/top"  # the exact name with the most fans
        return httpx.Response(
            200, json={"data": [{"title": "Not In Our Data"}, {"title": "Other Song (Remastered)"}]}
        )


@pytest.fixture(scope="module")
def deezer() -> FakeDeezer:
    return FakeDeezer()


@pytest.fixture(scope="module")
def client(tmp_path_factory: pytest.TempPathFactory, deezer: FakeDeezer) -> Iterator[TestClient]:
    root = tmp_path_factory.mktemp("top")
    snapshot = root / "mb.jsonl.gz"
    write_snapshot(fx.small_catalog(), snapshot)
    url = f"sqlite:///{root / 'catalog.db'}"
    engine = make_engine(url)
    migrate.upgrade(engine)
    ingest_snapshot(engine, snapshot)
    settings = Settings(database_url=url, data_dir=root, log_json=False, read_model_refresh_s=3600)
    app = create_app(settings, build_state(settings))
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def fresh(client: TestClient, deezer: FakeDeezer) -> None:
    deezer.mode = "ok"
    client.app.state.top_song = top_song.TopSongClient(  # type: ignore[attr-defined]
        http=lambda: httpx.Client(transport=httpx.MockTransport(deezer))
    )


def test_the_first_top_song_we_have_is_offered(client: TestClient) -> None:
    body = client.get(f"/v1/{ALICE}:topRecording").json()
    assert body["status"] == "OK"
    assert body["displayName"] == "Other Song"
    assert body["recording"].startswith("recordings/")
    assert body["source"] == "dataSources/deezer"


def test_no_exact_artist_means_no_match(client: TestClient) -> None:
    assert client.get(f"/v1/{BOB}:topRecording").json() == {
        "status": "NO_MATCH",
        "recording": None,
        "displayName": None,
        "source": "dataSources/deezer",
    }


@pytest.mark.parametrize("mode", ["down", "quota"])
def test_deezer_trouble_is_unavailable_and_not_cached(
    client: TestClient, deezer: FakeDeezer, mode: str
) -> None:
    deezer.mode = mode
    response = client.get(f"/v1/{ALICE}:topRecording")
    assert response.json()["status"] == "UNAVAILABLE"
    assert response.headers["Cache-Control"] == "no-store"
    deezer.mode = "ok"
    assert client.get(f"/v1/{ALICE}:topRecording").json()["status"] == "OK"


def test_answers_are_cached(client: TestClient, deezer: FakeDeezer) -> None:
    client.get(f"/v1/{ALICE}:topRecording")
    calls = deezer.calls
    client.get(f"/v1/{ALICE}:topRecording")
    assert deezer.calls == calls


def test_titles_match_without_versions() -> None:
    songs = [("r1", "Hit (Remastered 2011)"), ("r2", "Other")]
    assert top_song.match_top(["Nope", "hit"], songs) == "r1"
    assert top_song.match_top(["Nope"], songs) is None
    assert top_song.pick_artist([{"name": "Beyonce", "nb_fan": 1}], "Beyoncé") is not None
