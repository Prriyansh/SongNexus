"""Reference facts about artists from Wikidata and Wikipedia (``songnexus fetch-facts``).

Everything is reached through the artist's Wikidata item, found by MusicBrainz ID (P434), so
nothing is matched by name. Three steps, through the shared polite, cached HTTP client:

1. Wikidata SPARQL, in batches: the item, its English description and its English Wikipedia
   article.
2. Wikidata SPARQL, in batches: awards received (P166) and nominations (P1411), with the year
   (P585) when stated. Deprecated statements are skipped, and an award without an English
   label is dropped, never guessed.
3. Wikipedia's Action API, at most 20 articles a request: the plain-text introduction (a few
   sentences) and the canonical URL. Wikipedia text is CC BY-SA 4.0, so the URL is stored with
   it and the app always shows it linked.

Requests carry the same generic User-Agent as the image fetch and nothing about the person
running the command. Wikidata and Wikipedia are community-edited; the app says "listed on
Wikidata" and links to it rather than presenting totals.
"""

from __future__ import annotations

import logging
import re
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit

import httpx
from sqlalchemy import Engine

from songnexus.catalog.http import PoliteClient, SourceRequestError
from songnexus.catalog.wikidata.fetch import WikidataClient, bindings
from songnexus.catalog.wikidata.images import http_client, select_artists
from songnexus.storage.artist_facts import FactsRecord, Honor, write_facts
from songnexus.storage.artist_images import artist_ids_by_musicbrainz_id, detail_levels
from songnexus.storage.db import session_scope

log = logging.getLogger(__name__)

WIKIPEDIA_API_URL = "https://en.wikipedia.org/w/api.php"
WIKIPEDIA_PREFIX = "https://en.wikipedia.org/wiki/"
SPARQL_BATCH = 200  # MusicBrainz IDs per query (honor queries return many rows each)
WIKIPEDIA_BATCH = 20  # the API's limit on extracts per request
SUMMARY_SENTENCES = 4
MAX_HONORS = 100  # per artist and kind; the app shows a few and counts the rest
MAX_DESCRIPTION_CHARS = 512
AWARD, NOMINATION = "P166", "P1411"
_QID = re.compile(r"Q\d+")


class WikipediaError(SourceRequestError):
    """A Wikipedia request failed permanently."""


class WikipediaClient(PoliteClient):
    """Calls the English Wikipedia Action API (JSON, format version 2)."""

    error_type = WikipediaError

    def __init__(
        self,
        *,
        cache_dir: Path,
        base_url: str = WIKIPEDIA_API_URL,
        min_interval_s: float = 1.0,
        http: httpx.Client | None = None,
    ) -> None:
        """Creates a client; ``http`` defaults to one with the generic User-Agent."""
        super().__init__(
            source="wikipedia",
            base_url=base_url,
            cache_dir=cache_dir,
            min_interval_s=min_interval_s,
            http=http or http_client("application/json"),
        )

    def extra_params(self) -> dict[str, str | int]:
        """Every request asks for JSON in format version 2 (pages as a list)."""
        return {"format": "json", "formatversion": 2}


def _values(musicbrainz_ids: Iterable[str]) -> str:
    return " ".join(f'"{mbid}"' for mbid in sorted(musicbrainz_ids))


def items_query(musicbrainz_ids: Iterable[str]) -> str:
    """The item, English description and English Wikipedia article for each MusicBrainz ID."""
    return (
        "SELECT ?musicbrainz ?item ?description ?article WHERE {\n"
        f"  VALUES ?musicbrainz {{ {_values(musicbrainz_ids)} }}\n"
        "  ?item wdt:P434 ?musicbrainz .\n"
        '  OPTIONAL { ?item schema:description ?description . FILTER(LANG(?description) = "en") }\n'
        "  OPTIONAL { ?article schema:about ?item ;"
        " schema:isPartOf <https://en.wikipedia.org/> . }\n"
        "}"
    )


def honors_query(prop: str, musicbrainz_ids: Iterable[str]) -> str:
    """Non-deprecated ``prop`` statements (awards or nominations), with an English label."""
    return (
        "SELECT ?musicbrainz ?item ?honor ?honorLabel ?time WHERE {\n"
        f"  VALUES ?musicbrainz {{ {_values(musicbrainz_ids)} }}\n"
        f"  ?item wdt:P434 ?musicbrainz ; p:{prop} ?statement .\n"
        f"  ?statement ps:{prop} ?honor ; wikibase:rank ?rank .\n"
        "  FILTER(?rank != wikibase:DeprecatedRank)\n"
        "  OPTIONAL { ?statement pq:P585 ?time . }\n"
        '  ?honor rdfs:label ?honorLabel . FILTER(LANG(?honorLabel) = "en")\n'
        "}"
    )


def _qid(uri: str) -> str | None:
    tail = uri.rsplit("/", 1)[-1]
    return tail if _QID.fullmatch(tail) else None


def _year(time: str) -> int | None:
    match = re.match(r"^[+]?(\d{4})-", time)
    return int(match.group(1)) if match else None


def wikipedia_title(article_url: str) -> str | None:
    """``Olivia Rodrigo`` for ``https://en.wikipedia.org/wiki/Olivia_Rodrigo``, else None."""
    if not article_url.startswith(WIKIPEDIA_PREFIX):
        return None
    title = unquote(urlsplit(article_url).path.removeprefix("/wiki/")).replace("_", " ").strip()
    return title or None


@dataclass(frozen=True)
class ItemFacts:
    """What the item query says about one Wikidata item."""

    item: str
    description: str | None
    article_title: str | None


def parse_items(rows: Iterable[Mapping[str, str]]) -> dict[str, list[ItemFacts]]:
    """Groups item rows by MusicBrainz ID; an ID can (rarely) have several items."""
    found: dict[tuple[str, str], ItemFacts] = {}
    for row in rows:
        mbid, item = row.get("musicbrainz", ""), _qid(row.get("item", ""))
        if not mbid or not item:
            continue
        description = row.get("description", "").strip()[:MAX_DESCRIPTION_CHARS] or None
        title = wikipedia_title(row.get("article", ""))
        previous = found.get((mbid, item))
        found[(mbid, item)] = ItemFacts(
            item,
            description or (previous.description if previous else None),
            title or (previous.article_title if previous else None),
        )
    by_mbid: dict[str, list[ItemFacts]] = defaultdict(list)
    for (mbid, _), facts in sorted(found.items()):
        by_mbid[mbid].append(facts)
    return dict(by_mbid)


def parse_honors(rows: Iterable[Mapping[str, str]]) -> dict[str, list[Honor]]:
    """Groups honor rows by item: once per (award, year), newest first, undated last."""
    by_item: dict[str, set[Honor]] = defaultdict(set)
    for row in rows:
        item, honor = _qid(row.get("item", "")), _qid(row.get("honor", ""))
        name = row.get("honorLabel", "").strip()
        if item and honor and name:
            by_item[item].add(Honor(honor, name, _year(row.get("time", ""))))
    return {
        item: sorted(honors, key=lambda h: (h.year is None, -(h.year or 0), h.name, h.id))[
            :MAX_HONORS
        ]
        for item, honors in by_item.items()
    }


def _number(item: str) -> int:
    return int(item[1:])


def choose_item(candidates: Sequence[ItemFacts]) -> ItemFacts:
    """One item per artist: the one with an English article, else the oldest (lowest QID)."""
    return min(candidates, key=lambda c: (c.article_title is None, _number(c.item)))


def fetch_summaries(
    wikipedia: WikipediaClient, titles: Iterable[str]
) -> dict[str, tuple[str, str]]:
    """Returns {asked title: (introduction, canonical URL)} for articles that exist.

    Raises:
        SourceRequestError: A request failed permanently.
    """
    wanted = sorted(set(titles))
    out: dict[str, tuple[str, str]] = {}
    for start in range(0, len(wanted), WIKIPEDIA_BATCH):
        batch = wanted[start : start + WIKIPEDIA_BATCH]
        body = wikipedia.get(
            "extracts",
            "",
            {
                "action": "query",
                "prop": "extracts|info",
                "exintro": 1,
                "explaintext": 1,
                "exsentences": SUMMARY_SENTENCES,
                "exlimit": WIKIPEDIA_BATCH,
                "inprop": "url",
                "redirects": 1,
                "titles": "|".join(batch),
            },
        ).body
        query: dict[str, Any] = body.get("query", {})
        resolved = {t: t for t in batch}
        for step in ("normalized", "redirects"):
            moves = {m.get("from"): m.get("to") for m in query.get(step, [])}
            resolved = {t: moves.get(r, r) for t, r in resolved.items()}
        pages = {p.get("title"): p for p in query.get("pages", []) if not p.get("missing")}
        for asked, title in resolved.items():
            page = pages.get(title)
            if not page:
                continue
            text = " ".join(str(page.get("extract", "")).split())
            url = str(page.get("fullurl") or page.get("canonicalurl") or "")
            if text and url.startswith(WIKIPEDIA_PREFIX):
                out[asked] = (text, url)
    return out


@dataclass
class FactsReport:
    """Coverage numbers, printed by the command."""

    artists_considered: int = 0
    with_item: int = 0
    with_description: int = 0
    with_summary: int = 0
    with_awards: int = 0
    with_nominations: int = 0
    honors: dict[str, int] = field(default_factory=lambda: {AWARD: 0, NOMINATION: 0})

    def as_dict(self) -> dict[str, Any]:
        """The report as JSON."""
        return {
            "artistsConsidered": self.artists_considered,
            "artistsWithWikidataItem": self.with_item,
            "artistsWithDescription": self.with_description,
            "artistsWithWikipediaSummary": self.with_summary,
            "artistsWithAwards": self.with_awards,
            "artistsWithNominations": self.with_nominations,
            "awards": self.honors[AWARD],
            "nominations": self.honors[NOMINATION],
        }


def find_facts(
    wikidata: WikidataClient,
    wikipedia: WikipediaClient,
    artists: Mapping[str, Sequence[str]],
    report: FactsReport,
) -> dict[str, FactsRecord | None]:
    """Looks up every artist's facts; returns {artist ID: facts or None}.

    Raises:
        SourceRequestError: A request failed permanently.
    """
    mbids = sorted({mbid for ids in artists.values() for mbid in ids})
    items: dict[str, list[ItemFacts]] = {}
    honors: dict[str, dict[str, list[Honor]]] = {AWARD: {}, NOMINATION: {}}
    for start in range(0, len(mbids), SPARQL_BATCH):
        batch = mbids[start : start + SPARQL_BATCH]
        items.update(parse_items(bindings(wikidata.sparql(items_query(batch)))))
        for prop in (AWARD, NOMINATION):
            honors[prop].update(parse_honors(bindings(wikidata.sparql(honors_query(prop, batch)))))
    chosen: dict[str, ItemFacts] = {}
    for artist_id, artist_mbids in artists.items():
        candidates = [c for mbid in artist_mbids for c in items.get(mbid, [])]
        if candidates:
            chosen[artist_id] = choose_item(candidates)
    summaries = fetch_summaries(
        wikipedia, (c.article_title for c in chosen.values() if c.article_title)
    )
    out: dict[str, FactsRecord | None] = {}
    for artist_id in artists:
        facts = chosen.get(artist_id)
        if facts is None:
            out[artist_id] = None
            continue
        summary = summaries.get(facts.article_title or "")
        record = FactsRecord(
            wikidata_id=facts.item,
            description=facts.description,
            wikipedia_url=summary[1] if summary else None,
            summary=summary[0] if summary else None,
            awards=tuple(honors[AWARD].get(facts.item, [])),
            nominations=tuple(honors[NOMINATION].get(facts.item, [])),
        )
        out[artist_id] = record
        report.with_item += 1
        report.with_description += bool(record.description)
        report.with_summary += bool(record.summary)
        report.with_awards += bool(record.awards)
        report.with_nominations += bool(record.nominations)
        report.honors[AWARD] += len(record.awards)
        report.honors[NOMINATION] += len(record.nominations)
    return out


def run_fetch_facts(
    engine: Engine,
    wikidata: WikidataClient,
    wikipedia: WikipediaClient,
    *,
    now: datetime,
    limit: int | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Fetches facts for catalog artists and stores them (unless ``dry_run``).

    Idempotent: unchanged answers write nothing; an artist whose facts are gone loses its row.
    Artists outside ``limit`` (best-known first) are untouched.

    Raises:
        SourceRequestError: A request failed permanently; nothing is written.
    """
    with session_scope(engine) as session:
        mapping = artist_ids_by_musicbrainz_id(session)
        levels = detail_levels(session)
    artists = select_artists(mapping, levels, limit)
    report = FactsReport(artists_considered=len(artists))
    found = find_facts(wikidata, wikipedia, artists, report)
    result: dict[str, Any] = {"dryRun": dry_run, **report.as_dict()}
    if not dry_run:
        with session_scope(engine) as session:
            stats = write_facts(session, found, now)
        result["written"] = {
            "inserted": stats.inserted,
            "updated": stats.updated,
            "unchanged": stats.unchanged,
            "deleted": stats.deleted,
        }
    result["networkRequests"] = wikidata.network_requests + wikipedia.network_requests
    result["cacheHits"] = wikidata.cache_hits + wikipedia.cache_hits
    log.info("fetch-facts finished", extra=result)
    return result
