"""CompareRecordingSound against a fake song_compare service (httpx mock transport)."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from fastapi.testclient import TestClient

from songnexus.catalog.canonicalize import build_batch
from songnexus.catalog.ingest import EnrichmentInputs, ingest_snapshot
from songnexus.catalog.snapshot import write_snapshot
from songnexus.config import Settings
from songnexus.service.app import build_state, create_app
from songnexus.service.sound import SoundCompareClient
from songnexus.storage import migrate
from songnexus.storage.db import make_engine
from tests.catalog import fixtures as fx

GENRE_MAP = Path(__file__).resolve().parents[3] / "data" / "seeds" / "discogs_genre_map.json"
SERVICE = "http://song-compare.test"


def _recording(mbid: str) -> str:
    batch = build_batch(fx.small_catalog())
    (row,) = (
        r
        for r in batch.mappings.values()
        if r["entity_type"] == "recording" and r["source_entity_id"] == mbid
    )
    return f"recordings/{row['entity_id']}"


SONG, OTHER_SONG = _recording("rec-1"), _recording("rec-2")


def _brief(track_id: str, title: str, artists: list[str]) -> dict[str, Any]:
    return {
        "id": track_id,
        "title": title,
        "artists": artists,
        "album": "First Album",
        "genre": "indie-pop",
        "has_lyrics": True,
    }


def _track(track_id: str, title: str, *, lyrics: bool = True) -> dict[str, Any]:
    return {
        **_brief(track_id, title, ["Alice"]),
        "popularity": 70,
        "duration_ms": 201_000,
        "explicit": False,
        "tempo": 120.04,
        "key": 9,
        "mode": 0,
        "key_name": "A minor",
        "time_signature": 4,
        "audio": {
            "energy": 0.8,
            "danceability": 0.65,
            "valence": 0.4,
            "acousticness": 0.1,
            "speechiness": 0.05,
            "liveness": 0.2,
            "instrumentalness": 1.0000001,  # floating noise from the service is clamped
            "loudness": -5.0,
            "tempo": 0.5,
        },
        "lyrics": {
            "sentiment": {"compound": 0.42, "positive_share": 0.3, "negative_share": 0.1},
            "emotions": {"joy": 0.5},
            "top_emotion": "joy",
            "themes": {"love": 0.4},
            "top_themes": ["love", "night"],
            "structure": {
                "verses": 2,
                "choruses": 3,
                "bridges": 1,
                "has_intro": False,
                "has_outro": True,
                "sections_total": 6,
                "lines": 40,
                "words": 312,
                "repetition": 0.35,
                "lexical_diversity": 0.4,
            },
        }
        if lyrics
        else None,
    }


COMPARISON = {
    "a": _track("sp-1", "Song"),
    "b": _track("sp-2", "Other Song", lyrics=False),
    "overall": 0.81,
    "audio": {"score": 0.81, "distance": 0.2, "per_feature": {}},
    "lyrics": None,
    "credits": {"artists": ["Alice"], "same_album": True, "same_genre": True, "genre": "indie-pop"},
    "structure": {
        "tempo": {"a": 120.0, "b": 60.0, "half_double_match": True},
        "key": {"a": "A minor", "b": "C major", "relation": "relative major/minor"},
        "time_signature": {"a": 4, "b": 4},
        "duration_sec": {"a": 201, "b": 180},
    },
    "reasons": ["Similar energy and valence.", "Same album."],
}


class FakeService:
    """song_compare's routes, switchable between behaviors."""

    def __init__(self) -> None:
        self.mode = "ok"
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.mode == "down":
            raise httpx.ConnectError("refused", request=request)
        if self.mode == "broken":
            return httpx.Response(200, json={"unexpected": True})
        path = request.url.path
        if path == "/api/match":
            return self._match(parse_qs(urlsplit(str(request.url)).query)["title"][0])
        fixed = {
            "/api/compare": COMPARISON,
            "/api/similar/sp-1": {"results": SIMILAR_TO_SONG},
            "/api/similar/sp-2": {"results": []},
        }
        return httpx.Response(200, json=fixed[path]) if path in fixed else httpx.Response(500)

    def _match(self, title: str) -> httpx.Response:
        if self.mode == "missing" and title == "Other Song":
            return httpx.Response(404, json={"error": "No match."})
        track_id = "sp-1" if title == "Song" or self.mode == "same" else "sp-2"
        return httpx.Response(200, json={"track": _brief(track_id, title, ["Alice"])})


SIMILAR_TO_SONG = [
    {**_brief("sp-2", "Other Song", ["Alice"]), "score": 0.9, "shares_artist": True},
    {**_brief("sp-9", "Elsewhere", ["Nobody"]), "score": 0.7, "shares_artist": False},
]


@pytest.fixture(scope="module")
def service() -> FakeService:
    return FakeService()


@pytest.fixture(scope="module")
def app_client(
    tmp_path_factory: pytest.TempPathFactory, service: FakeService
) -> Iterator[TestClient]:
    root = tmp_path_factory.mktemp("sound")
    paths = {}
    for name, records in {"mb": fx.small_catalog(), "wikidata": [], "discogs": []}.items():
        paths[name] = root / f"{name}.jsonl.gz"
        write_snapshot(records, paths[name])
    url = f"sqlite:///{root / 'catalog.db'}"
    engine = make_engine(url)
    migrate.upgrade(engine)
    ingest_snapshot(
        engine, paths["mb"], EnrichmentInputs(paths["wikidata"], paths["discogs"], GENRE_MAP)
    )
    settings = Settings(
        database_url=url,
        data_dir=root,
        log_json=False,
        read_model_refresh_s=3600,
        song_compare_url=SERVICE + "/",
    )
    state = build_state(settings)
    state.outbound_http = lambda: httpx.Client(transport=httpx.MockTransport(service))
    with TestClient(create_app(settings, state)) as test_client:
        yield test_client


@pytest.fixture
def client(app_client: TestClient, service: FakeService) -> TestClient:
    service.mode = "ok"
    service.requests.clear()
    app_client.app.state.sound_client = None  # type: ignore[attr-defined]  # a fresh cache per test
    return app_client


def _compare(client: TestClient) -> dict[str, Any]:
    response = client.get(f"/v1/{SONG}:compareSound", params={"other": OTHER_SONG})
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def test_compares_two_songs_with_reasons_and_profiles(client: TestClient) -> None:
    body = _compare(client)
    assert body["status"] == "OK"
    comparison = body["comparison"]
    assert comparison["similarity"] == 0.81
    assert comparison["lyricSimilarity"] is None
    assert comparison["structure"] == {
        "halfOrDoubleTime": True,
        "keyRelation": "relative major/minor",
    }
    # The app calls valence "positivity", so the reasons do too.
    assert comparison["reasons"][0] == "Similar energy and positivity."
    track = comparison["trackA"]
    assert (track["tempoBpm"], track["key"], track["timeSignature"]) == (120.0, "A minor", 4)
    features = {f["feature"]: f["value"] for f in track["features"]}
    assert features["ENERGY"] == 0.8
    assert features["INSTRUMENTALNESS"] == 1.0
    assert len(features) == 7  # loudness and the tempo ratio are not 0-1 features
    assert track["lyrics"]["topThemes"] == ["love", "night"]
    assert "popularity" not in track  # no popularity numbers are shown
    assert comparison["trackB"]["lyrics"] is None
    assert body["sources"] == [
        "dataSources/kaggle-spotify-tracks",
        "dataSources/genius-lyrics-dataset",
    ]


def test_similar_songs_link_to_the_catalog_only_when_matched(client: TestClient) -> None:
    body = _compare(client)
    first, second = body["similarA"]
    assert (first["title"], first["recording"]) == ("Other Song", OTHER_SONG)
    assert (second["title"], second["recording"]) == ("Elsewhere", None)
    assert body["similarB"] == []


def test_only_titles_and_artist_names_are_sent(client: TestClient, service: FakeService) -> None:
    _compare(client)
    matches = [r for r in service.requests if r.url.path == "/api/match"]
    asked = sorted(tuple(sorted(parse_qs(urlsplit(str(r.url)).query))) for r in matches)
    assert asked == [("artist", "title"), ("artist", "title")]
    assert {parse_qs(urlsplit(str(r.url)).query)["artist"][0] for r in matches} == {"Alice"}


def test_a_song_outside_the_dataset_is_named(client: TestClient, service: FakeService) -> None:
    service.mode = "missing"
    body = _compare(client)
    assert body["status"] == "NOT_FOUND"
    assert body["missing"] == [OTHER_SONG]
    assert body["comparison"] is None


def test_two_names_for_one_track_say_so(client: TestClient, service: FakeService) -> None:
    service.mode = "same"
    assert _compare(client)["status"] == "SAME_TRACK"


@pytest.mark.parametrize("mode", ["down", "broken"])
def test_an_unreachable_or_broken_service_is_unavailable_and_not_cached(
    client: TestClient, service: FakeService, mode: str
) -> None:
    service.mode = mode
    response = client.get(f"/v1/{SONG}:compareSound", params={"other": OTHER_SONG})
    assert response.json()["status"] == "UNAVAILABLE"
    assert response.headers["cache-control"] == "no-store"
    service.mode = "ok"
    assert _compare(client)["status"] == "OK"  # the failure was not remembered


def test_results_are_cached(client: TestClient, service: FakeService) -> None:
    _compare(client)
    asked = len(service.requests)
    _compare(client)
    assert len(service.requests) == asked


def test_without_a_service_url_it_is_unavailable(client: TestClient) -> None:
    client.app.state.sound_client = SoundCompareClient(  # type: ignore[attr-defined]
        "", timeout_s=1.0, http=httpx.Client
    )
    assert _compare(client)["status"] == "UNAVAILABLE"


def test_bad_requests_are_rejected(client: TestClient) -> None:
    same = client.get(f"/v1/{SONG}:compareSound", params={"other": SONG})
    assert same.status_code == 400
    unknown = client.get(
        f"/v1/{SONG}:compareSound", params={"other": "recordings/0000000000000000000000"}
    )
    assert unknown.status_code in (400, 404)
