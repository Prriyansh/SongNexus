"""Similar-music maps, playlist maps and playlist rooms through the API."""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from songnexus.catalog.canonicalize import build_batch
from songnexus.catalog.ingest import EnrichmentInputs, ingest_snapshot
from songnexus.catalog.snapshot import write_snapshot
from songnexus.config import Settings
from songnexus.core import ids
from songnexus.service import maps
from songnexus.service.app import build_state, create_app
from songnexus.service.schemas import PlaylistTrack
from songnexus.storage import migrate, taste_rooms
from songnexus.storage.db import make_engine, session_scope
from tests.catalog import fixtures as fx

GENRE_MAP = Path(__file__).resolve().parents[3] / "data" / "seeds" / "discogs_genre_map.json"
ALICE = f"artists/{ids.artist_id('mb-alice')}"
BOB = f"artists/{ids.artist_id('mb-bob')}"
CAROL = f"artists/{ids.artist_id('mb-carol')}"

SIMILAR_ROWS: list[dict[str, Any]] = [
    {"recording_mbid": "far-1", "recording_name": "Far Song", "artist_credit_name": "Stranger",
     "score": 50, "caa_id": 7, "caa_release_mbid": "rel-x"},
    {"recording_mbid": "far-2", "recording_name": "Far Song (Live)",
     "artist_credit_name": "Stranger", "score": 40},
    {"recording_mbid": "rec-2", "recording_name": "Other Song", "artist_credit_name": "Somebody",
     "score": 25},
    {"recording_mbid": "own", "recording_name": "Anything", "artist_credit_name": "Alice",
     "score": 90},
]  # fmt: skip


@pytest.fixture(scope="module")
def setup(tmp_path_factory: pytest.TempPathFactory) -> Iterator[tuple[TestClient, str]]:
    root = tmp_path_factory.mktemp("maps")
    paths = {}
    for name, records in {
        "mb": fx.small_catalog(),
        "empty": [],
        "listenbrainz": fx.listenbrainz_records(),
    }.items():
        paths[name] = root / f"{name}.jsonl.gz"
        write_snapshot(records, paths[name])
    url = f"sqlite:///{root / 'catalog.db'}"
    engine = make_engine(url)
    migrate.upgrade(engine)
    ingest_snapshot(
        engine,
        paths["mb"],
        EnrichmentInputs(
            paths["empty"], paths["empty"], GENRE_MAP, listenbrainz_snapshot=paths["listenbrainz"]
        ),
    )
    settings = Settings(database_url=url, data_dir=root, log_json=False, read_model_refresh_s=3600)
    app = create_app(settings, build_state(settings))

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/similar-recordings/json"
        return httpx.Response(200, json=SIMILAR_ROWS)

    app.state.similar_recordings = maps.SimilarRecordingsClient(
        http=lambda: httpx.Client(transport=httpx.MockTransport(handler))
    )
    with TestClient(app) as client:
        yield client, url


@pytest.fixture
def client(setup: tuple[TestClient, str]) -> TestClient:
    return setup[0]


def test_an_artist_map_places_co_listened_artists_by_closeness(client: TestClient) -> None:
    body = client.get(f"/v1/{ALICE}:similar").json()
    assert body["center"]["id"] == ALICE
    artists = {n["id"]: n for n in body["nodes"] if n["kind"] == "ARTIST"}
    assert artists[BOB]["similarity"] == 1.0  # the closest match
    assert 0 < artists[CAROL]["similarity"] < 0.1  # scored relative to Bob
    assert artists[BOB]["reasons"][0] == {
        "kind": "CO_LISTENED",
        "artists": ["Alice"],
        "otherArtists": [],
        "genres": [],
        "count": None,
        "otherCount": None,
        "theirs": False,
        "score": None,
        "sourceUrl": "https://listenbrainz.org/explore/similar-artists/",
    }
    songs = [n for n in body["nodes"] if n["kind"] == "SONG"]
    # One version per song, never Alice's own songs (those are on her page).
    assert [s["displayName"] for s in songs] == ["Far Song", "Other Song"]
    assert songs[0]["imageUrl"] == "https://coverartarchive.org/release/rel-x/7-250.jpg"
    assert songs[0]["recording"] is None  # outside the catalog: linked to MusicBrainz only
    assert songs[1]["recording"].startswith("recordings/")
    assert body["sources"] == [{"source": "listenbrainz", "status": "OK"}]


def test_a_song_map_adds_the_lead_artists_neighbors(client: TestClient) -> None:
    batch = build_batch(fx.small_catalog())
    song = next(
        r["entity_id"]
        for r in batch.mappings.values()
        if r["entity_type"] == "recording" and r["source_entity_id"] == "rec-1"
    )
    body = client.get(f"/v1/recordings/{song}:similar").json()
    assert body["center"]["kind"] == "SONG"
    assert body["center"]["subtitle"] == "Alice"
    assert {n["id"] for n in body["nodes"] if n["kind"] == "ARTIST"} == {BOB, CAROL}
    assert [n["displayName"] for n in body["nodes"] if n["kind"] == "SONG"] == [
        "Far Song",
        "Other Song",
    ]


def test_a_blocked_artist_never_appears_on_a_map() -> None:
    result = maps.api.SimilarMap(
        center=maps.api.MapNode(
            id=ALICE, kind=maps.api.MapNodeKind.ARTIST, display_name="Alice", similarity=1
        ),
        nodes=[
            maps.api.MapNode(
                id=BOB, kind=maps.api.MapNodeKind.ARTIST, display_name="Bob", artist=BOB,
                similarity=1,
            )
        ],
        links=[maps.api.MapLink(a=ALICE, b=BOB, kind=maps.api.MapLinkKind.CO_LISTENED)],
        sources=[],
    )  # fmt: skip
    from songnexus.service.deps import Viewer
    from songnexus.service.routes.maps import _without_blocked

    hidden = _without_blocked(result, Viewer(blocked=frozenset({BOB.removeprefix("artists/")})))
    assert hidden.nodes == []
    assert hidden.links == []


def _tracks(*rows: tuple[str, str]) -> list[dict[str, Any]]:
    return [{"title": title, "artists": [artist]} for title, artist in rows]


def test_two_playlists_on_one_map(client: TestClient) -> None:
    body = client.post(
        "/v1/tasteMaps",
        json={
            "mine": _tracks(("Song", "Alice feat. Bob"), ("Other Song", "Alice"), ("Hit", "Zed")),
            "friend": _tracks(("B-side", "Bob"), ("Hit (Live)", "Zed")),
            "friendName": "Sam",
        },
    ).json()
    groups = {n["displayName"]: n["group"] for n in body["nodes"] if n["kind"] == "ARTIST"}
    # Zed is on both; people who play Alice play Bob and the other way round; Carol is new.
    assert groups == {"Zed": "SHARED", "Alice": "FOR_THEM", "Bob": "FOR_ME", "Carol": "NEW"}
    carol = next(n for n in body["nodes"] if n["displayName"] == "Carol")
    assert carol["reasons"][0]["kind"] == "NEW_TO_YOU"
    assert carol["reasons"][0]["artists"] == ["Alice"]
    assert body["stats"]["sharedSongs"] == 1  # "Hit" and "Hit (Live)" are one song
    assert body["stats"]["sharedArtists"] == 1
    kinds = {link["kind"] for link in body["links"]}
    assert {"CO_LISTENED", "CONTAINS", "RECOMMENDED"} <= kinds


def test_one_playlist_maps_what_to_try(client: TestClient) -> None:
    body = client.post("/v1/tasteMaps", json={"mine": _tracks(("Song", "Alice"))}).json()
    groups = {n["displayName"]: n["group"] for n in body["nodes"] if n["kind"] == "ARTIST"}
    assert groups == {"Alice": "MINE", "Bob": "NEW", "Carol": "NEW"}


def test_rooms_join_two_playlists_with_a_code(client: TestClient) -> None:
    room = client.post(
        "/v1/tasteRooms", json={"displayName": "Ana", "tracks": _tracks(("Song", "Alice"))}
    ).json()
    code = room["code"]
    assert taste_rooms.is_code(code)
    assert room["guest"] is None
    lower = f"{code[:3].lower()} {code[3:].lower()}"  # typed by hand
    joined = client.post(
        f"/v1/tasteRooms/{lower}:join",
        json={"displayName": "Sam", "tracks": _tracks(("B-side", "Bob"))},
    ).json()
    assert joined["guest"]["displayName"] == "Sam"
    assert client.get(f"/v1/tasteRooms/{code}").json()["host"]["tracks"][0]["title"] == "Song"
    again = client.post(
        f"/v1/tasteRooms/{code}:join", json={"displayName": "X", "tracks": _tracks(("a", "b"))}
    )
    assert again.status_code == 409
    assert client.get("/v1/tasteRooms/ZZZZZZ").status_code == 404
    assert client.get("/v1/tasteRooms/not-a-code").status_code == 404


def test_rooms_expire_after_a_week(client: TestClient) -> None:
    engine = client.app.state.songnexus.engine  # type: ignore[attr-defined]
    now = datetime(2026, 11, 23, tzinfo=UTC)
    with session_scope(engine) as session:
        room = taste_rooms.create_room(
            session, taste_rooms.Member("Ana", _tracks(("Song", "Alice"))), now
        )
    with session_scope(engine) as session:
        assert taste_rooms.read_room(session, room.code, now + timedelta(days=6)) is not None
        assert taste_rooms.read_room(session, room.code, now + timedelta(days=7)) is None
        assert taste_rooms.purge_rooms(session, now + timedelta(days=8)) >= 1


def test_codes_avoid_letters_that_are_misread() -> None:
    assert not set("01OIL") & set(taste_rooms.ALPHABET)
    assert taste_rooms.new_code(lambda n: 0) == "AAAAAA"


@pytest.mark.parametrize(
    ("credit", "lead"),
    [("Alice feat. Bob", "Alice"), ("A & B", "A"), ("Solo", "Solo")],
)
def test_lead_of_a_credit(credit: str, lead: str) -> None:
    assert maps.lead_of(credit) == lead


def test_versions_of_one_song_share_a_key() -> None:
    assert maps.song_key("Hit (Live)", "Zed") == maps.song_key("Hit - Remastered 2011", "Zed")
    shelf = maps.shelf_of([PlaylistTrack(title="Hit", artists=["Zed"])] * 2)
    assert len(shelf.songs) == 1
