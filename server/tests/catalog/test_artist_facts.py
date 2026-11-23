"""Artist facts from Wikidata and Wikipedia: parsing, the fetch, idempotent storage, the stamp."""

from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs

import httpx
import pytest
from sqlalchemy import Engine, select

from songnexus.catalog.ingest import ingest_snapshot
from songnexus.catalog.snapshot import write_snapshot
from songnexus.catalog.wikidata import facts
from songnexus.catalog.wikidata.fetch import WikidataClient
from songnexus.catalog.wikidata.images import USER_AGENT
from songnexus.core import ids
from songnexus.service.readmodel import probe_version
from songnexus.storage import migrate
from songnexus.storage import models as m
from songnexus.storage.artist_facts import Honor, read_artist_facts
from songnexus.storage.db import make_engine, session_scope
from tests.catalog import fixtures as fx

NOW = datetime(2026, 11, 22, 12, 0, tzinfo=UTC)
LATER = datetime(2026, 11, 23, 12, 0, tzinfo=UTC)
ENTITY = "http://www.wikidata.org/entity/"
WIKI = "https://en.wikipedia.org/wiki/"


def test_titles_come_from_english_wikipedia_urls() -> None:
    assert facts.wikipedia_title(f"{WIKI}Bj%C3%B6rk_(album)") == "Björk (album)"
    assert facts.wikipedia_title("https://de.wikipedia.org/wiki/Björk") is None


def test_honors_are_deduplicated_and_newest_first() -> None:
    rows = [
        {
            "item": f"{ENTITY}Q1",
            "honor": f"{ENTITY}Q10",
            "honorLabel": "Old",
            "time": "+2001-01-01T00:00:00Z",
        },
        {
            "item": f"{ENTITY}Q1",
            "honor": f"{ENTITY}Q11",
            "honorLabel": "New",
            "time": "+2022-01-01T00:00:00Z",
        },
        {
            "item": f"{ENTITY}Q1",
            "honor": f"{ENTITY}Q11",
            "honorLabel": "New",
            "time": "+2022-01-01T00:00:00Z",
        },
        {"item": f"{ENTITY}Q1", "honor": f"{ENTITY}Q12", "honorLabel": "Undated"},
        {"item": f"{ENTITY}Q1", "honor": f"{ENTITY}Q13", "honorLabel": ""},  # unnamed: dropped
    ]
    assert facts.parse_honors(rows)["Q1"] == [
        Honor("Q11", "New", 2022),
        Honor("Q10", "Old", 2001),
        Honor("Q12", "Undated", None),
    ]


def test_an_item_with_an_article_is_preferred() -> None:
    a = facts.ItemFacts("Q5", None, None)
    b = facts.ItemFacts("Q900", "singer", "Bob")
    assert facts.choose_item([a, b]) is b
    assert facts.choose_item([facts.ItemFacts("Q9", None, None), a]) is a


# MusicBrainz ID -> (QID, description, article title, awards, nominations)
ITEMS: dict[str, tuple[str, str | None, str | None, list[tuple[str, str, int]], list[Any]]] = {
    "mb-alice": ("Q1", "American singer", "Alice (singer)", [("Q10", "Best Song", 2020)], []),
    "mb-bob": (
        "Q2",
        None,
        "Bob Redirect",
        [("Q10", "Best Song", 2018)],
        [("Q20", "Best New", 2017)],
    ),
    "mb-carol": ("Q3", None, None, [], []),  # an item with nothing worth showing
}


class FakeWikimedia:
    """Answers SPARQL and Wikipedia requests from ITEMS, recording each request."""

    def __init__(self, items: dict[str, Any]) -> None:
        self.items = items
        self.requests: list[httpx.Request] = []

    def sparql(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        query = parse_qs(request.content.decode())["query"][0]
        rows: list[dict[str, Any]] = []
        for mbid, (qid, description, title, awards, nominations) in self.items.items():
            if f'"{mbid}"' not in query:
                continue
            base = {"musicbrainz": {"value": mbid}, "item": {"value": f"{ENTITY}{qid}"}}
            if "schema:description" in query:
                row = dict(base)
                if description:
                    row["description"] = {"value": description}
                if title:
                    row["article"] = {"value": WIKI + title.replace(" ", "_")}
                rows.append(row)
            else:
                honors = awards if "p:P166" in query else nominations
                rows += [
                    base
                    | {
                        "honor": {"value": f"{ENTITY}{h}"},
                        "honorLabel": {"value": name},
                        "time": {"value": f"+{year}-01-01T00:00:00Z"},
                    }
                    for h, name, year in honors
                ]
        return httpx.Response(200, json={"results": {"bindings": rows}})

    def wikipedia(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        titles = request.url.params["titles"].split("|")
        redirects = [{"from": "Bob Redirect", "to": "Bob (musician)"}]
        pages = []
        for title in titles:
            target = "Bob (musician)" if title == "Bob Redirect" else title
            pages.append(
                {
                    "title": target,
                    "extract": f"{target} is a musician.\n\nMore text.",
                    "fullurl": WIKI + target.replace(" ", "_"),
                }
            )
        return httpx.Response(200, json={"query": {"redirects": redirects, "pages": pages}})

    def clients(self, cache: Path) -> tuple[WikidataClient, facts.WikipediaClient]:
        def client(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
            return httpx.Client(
                transport=httpx.MockTransport(handler), headers={"User-Agent": USER_AGENT}
            )

        wikidata = WikidataClient(
            sparql_url="https://query.example/sparql",
            cache_dir=cache / "wikidata",
            min_interval_s=0,
            http=client(self.sparql),
        )
        wikipedia = facts.WikipediaClient(
            cache_dir=cache / "wikipedia",
            base_url="https://en.example/w/api.php",
            min_interval_s=0,
            http=client(self.wikipedia),
        )
        return wikidata, wikipedia


@pytest.fixture
def engine(tmp_path: Path) -> Iterator[Engine]:
    snapshot = tmp_path / "snapshot.jsonl.gz"
    write_snapshot(fx.small_catalog(), snapshot)
    engine = make_engine(f"sqlite:///{tmp_path / 'catalog.db'}")
    migrate.upgrade(engine)
    ingest_snapshot(engine, snapshot)
    yield engine
    engine.dispose()


def _stored(engine: Engine) -> dict[str, Any]:
    with session_scope(engine) as session:
        artist_ids = list(session.scalars(select(m.ArtistFacts.artist_id)))
        return read_artist_facts(session, artist_ids)


ALICE, BOB, CAROL = (ids.artist_id(f"mb-{n}") for n in ("alice", "bob", "carol"))


def test_fetch_stores_descriptions_summaries_and_honors(engine: Engine, tmp_path: Path) -> None:
    result = facts.run_fetch_facts(engine, *FakeWikimedia(ITEMS).clients(tmp_path), now=NOW)
    assert result["artistsWithWikidataItem"] == 3
    assert result["artistsWithWikipediaSummary"] == 2
    assert result["written"] == {"inserted": 2, "updated": 0, "unchanged": 0, "deleted": 0}

    stored = _stored(engine)
    assert set(stored) == {ALICE, BOB}  # Carol's item has nothing worth showing
    alice = stored[ALICE]
    assert alice.wikidata_id == "Q1"
    assert alice.description == "American singer"
    assert alice.summary == "Alice (singer) is a musician. More text."
    assert alice.wikipedia_url == f"{WIKI}Alice_(singer)"
    assert alice.awards == (Honor("Q10", "Best Song", 2020),)
    bob = stored[BOB]
    # The redirect is followed, and the canonical article is linked.
    assert bob.wikipedia_url == f"{WIKI}Bob_(musician)"
    assert bob.nominations == (Honor("Q20", "Best New", 2017),)


def test_requests_carry_only_the_generic_user_agent(engine: Engine, tmp_path: Path) -> None:
    fake = FakeWikimedia(ITEMS)
    facts.run_fetch_facts(engine, *fake.clients(tmp_path), now=NOW)
    assert fake.requests
    for request in fake.requests:
        assert request.headers["User-Agent"] == USER_AGENT
        assert "@" not in str(request.url)


def test_reruns_are_idempotent_and_follow_upstream_changes(engine: Engine, tmp_path: Path) -> None:
    facts.run_fetch_facts(engine, *FakeWikimedia(ITEMS).clients(tmp_path / "a"), now=NOW)
    before = probe_version(engine)
    again = facts.run_fetch_facts(engine, *FakeWikimedia(ITEMS).clients(tmp_path / "b"), now=LATER)
    assert again["written"] == {"inserted": 0, "updated": 0, "unchanged": 2, "deleted": 0}
    assert probe_version(engine) == before  # nothing changed, so no cache key changes

    changed = dict(ITEMS)
    changed["mb-alice"] = ("Q1", "American songwriter", "Alice (singer)", [], [])
    changed["mb-bob"] = ("Q2", None, None, [], [])  # Bob's facts are gone
    result = facts.run_fetch_facts(
        engine, *FakeWikimedia(changed).clients(tmp_path / "c"), now=LATER
    )
    assert result["written"] == {"inserted": 0, "updated": 1, "unchanged": 0, "deleted": 1}
    assert set(_stored(engine)) == {ALICE}
    assert _stored(engine)[ALICE].description == "American songwriter"
    assert probe_version(engine) != before


def test_the_version_carries_a_facts_stamp(engine: Engine, tmp_path: Path) -> None:
    plain = probe_version(engine)
    assert plain is not None
    assert ".fx" not in plain
    facts.run_fetch_facts(engine, *FakeWikimedia(ITEMS).clients(tmp_path), now=NOW)
    stamped = probe_version(engine)
    assert stamped is not None
    assert stamped.startswith(plain)
    assert ".fx" in stamped


def test_dry_runs_and_limits_write_nothing_else(engine: Engine, tmp_path: Path) -> None:
    dry = facts.run_fetch_facts(
        engine, *FakeWikimedia(ITEMS).clients(tmp_path / "a"), now=NOW, dry_run=True
    )
    assert "written" not in dry
    assert _stored(engine) == {}
    limited = facts.run_fetch_facts(
        engine, *FakeWikimedia(ITEMS).clients(tmp_path / "b"), now=NOW, limit=1
    )
    assert limited["artistsConsidered"] == 1
