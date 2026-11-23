"""Artist facts through the API: GetArtist's `about`, and awards shared in CompareArtists."""

from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from songnexus.catalog.ingest import ingest_snapshot
from songnexus.catalog.snapshot import write_snapshot
from songnexus.config import Settings
from songnexus.core import ids
from songnexus.service.app import build_state, create_app
from songnexus.storage import migrate
from songnexus.storage.artist_facts import FactsRecord, Honor, write_facts
from songnexus.storage.db import make_engine, session_scope
from tests.catalog import fixtures as fx

ALICE, BOB, CAROL = (ids.artist_id(f"mb-{n}") for n in ("alice", "bob", "carol"))
GRAMMY = Honor("Q41254", "Grammy Award for Best New Artist", 2022)


@pytest.fixture(scope="module")
def client(tmp_path_factory: pytest.TempPathFactory) -> Iterator[TestClient]:
    root = tmp_path_factory.mktemp("facts")
    snapshot = root / "mb.jsonl.gz"
    write_snapshot(fx.small_catalog(), snapshot)
    url = f"sqlite:///{root / 'catalog.db'}"
    engine = make_engine(url)
    migrate.upgrade(engine)
    ingest_snapshot(engine, snapshot)
    with session_scope(engine) as session:
        write_facts(
            session,
            {
                ALICE: FactsRecord(
                    wikidata_id="Q1",
                    description="American singer",
                    wikipedia_url="https://en.wikipedia.org/wiki/Alice",
                    summary="Alice is a singer.",
                    awards=(GRAMMY, Honor("Q2", "Only Alice's", 2020)),
                    nominations=(Honor("Q3", "Album of the Year", 2023),),
                ),
                BOB: FactsRecord(
                    wikidata_id="Q9",
                    description=None,
                    wikipedia_url=None,
                    summary="Text without its article link is never shown.",
                    awards=(Honor("Q41254", "Grammy Award for Best New Artist", 2019),),
                    nominations=(),
                ),
            },
            datetime(2026, 11, 22, tzinfo=UTC),
        )
    settings = Settings(database_url=url, log_json=False, read_model_refresh_s=3600)
    with TestClient(create_app(settings, build_state(settings))) as test_client:
        yield test_client


def test_an_artist_page_carries_its_linked_facts(client: TestClient) -> None:
    about = client.get(f"/v1/artists/{ALICE}").json()["about"]
    assert about["description"] == "American singer"
    assert about["summary"] == "Alice is a singer."
    assert about["wikipediaUrl"] == "https://en.wikipedia.org/wiki/Alice"
    assert about["wikidataUrl"] == "https://www.wikidata.org/wiki/Q1"
    assert about["awards"][0] == {
        "displayName": "Grammy Award for Best New Artist",
        "year": 2022,
        "url": "https://www.wikidata.org/wiki/Q41254",
    }
    assert [n["displayName"] for n in about["nominations"]] == ["Album of the Year"]


def test_wikipedia_text_needs_its_article_link(client: TestClient) -> None:
    about = client.get(f"/v1/artists/{BOB}").json()["about"]
    assert about["summary"] is None
    assert about["wikipediaUrl"] is None
    assert len(about["awards"]) == 1


def test_an_artist_without_facts_has_none(client: TestClient) -> None:
    assert client.get(f"/v1/artists/{CAROL}").json()["about"] is None


def test_a_comparison_lists_the_awards_both_received(client: TestClient) -> None:
    body = client.get(f"/v1/artists/{ALICE}:compare", params={"other": f"artists/{BOB}"}).json()
    assert body["sharedAwards"] == [
        {
            "displayName": "Grammy Award for Best New Artist",
            "year": 2022,  # the first artist's year
            "url": "https://www.wikidata.org/wiki/Q41254",
        }
    ]
    other = client.get(f"/v1/artists/{ALICE}:compare", params={"other": f"artists/{CAROL}"})
    assert other.json()["sharedAwards"] == []
