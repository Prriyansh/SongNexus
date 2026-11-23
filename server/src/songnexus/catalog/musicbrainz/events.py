"""Concerts and festivals from MusicBrainz (``songnexus fetch-events``), CC0 core data.

For each fully fetched (seed) artist, the events MusicBrainz lists for them are browsed with
their performers and venue. A performer counts only when MusicBrainz links them as a main act,
support act or guest, and only through their MusicBrainz ID, so two artists "shared the bill"
only when the event's own record says so. Requests go through the polite MusicBrainz client
(about one a second), never alongside another MusicBrainz fetch.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable, Mapping
from datetime import datetime
from typing import Any

from sqlalchemy import Engine

from songnexus.catalog.musicbrainz.client import MusicBrainzClient
from songnexus.storage.artist_images import artist_ids_by_musicbrainz_id, detail_levels
from songnexus.storage.db import session_scope
from songnexus.storage.events import EventRecord, replace_events

log = logging.getLogger(__name__)

PAGE_SIZE = 100
MAX_PAGES = 2  # an artist's 200 most recent events is plenty for "shared the bill"
PERFORMER_TYPES = frozenset({"main performer", "support act", "guest performer"})
EVENT_INC = "artist-rels+place-rels"


def parse_event(raw: Mapping[str, Any], catalog: Mapping[str, str]) -> EventRecord | None:
    """An event with the catalog artists who performed at it, or None without any."""
    event_id, name = raw.get("id"), raw.get("name")
    if not isinstance(event_id, str) or not isinstance(name, str) or raw.get("cancelled"):
        return None
    performers: list[str] = []
    place = None
    for rel in raw.get("relations", []):
        if rel.get("target-type") == "artist" and rel.get("type") in PERFORMER_TYPES:
            artist = catalog.get(str((rel.get("artist") or {}).get("id", "")))
            if artist:
                performers.append(artist)
        elif rel.get("target-type") == "place" and place is None:
            place = (rel.get("place") or {}).get("name") or None
    if not performers:
        return None
    begin = (raw.get("life-span") or {}).get("begin") or None
    return EventRecord(
        id=event_id,
        name=name.strip(),
        kind=raw.get("type") or None,
        date=begin,
        place=place,
        performers=tuple(sorted(set(performers))),
    )


def browse_events(client: MusicBrainzClient, artist_mbid: str) -> list[dict[str, Any]]:
    """An artist's events as MusicBrainz lists them (up to ``MAX_PAGES`` pages)."""
    events: list[dict[str, Any]] = []
    for page in range(MAX_PAGES):
        body = client.get(
            "events",
            "event",
            {
                "artist": artist_mbid,
                "inc": EVENT_INC,
                "limit": PAGE_SIZE,
                "offset": page * PAGE_SIZE,
            },
        ).body
        batch = body.get("events", [])
        events.extend(batch)
        if len(events) >= int(body.get("event-count", 0)) or len(batch) < PAGE_SIZE:
            break
    return events


def merge(events: Iterable[EventRecord]) -> list[EventRecord]:
    """One record per event, with every catalog performer any artist's listing showed."""
    merged: dict[str, EventRecord] = {}
    for event in events:
        seen = merged.get(event.id)
        merged[event.id] = (
            event
            if seen is None
            else EventRecord(
                seen.id,
                seen.name,
                seen.kind,
                seen.date,
                seen.place,
                tuple(sorted(set(seen.performers) | set(event.performers))),
            )
        )
    return list(merged.values())


def run_fetch_events(
    engine: Engine,
    client: MusicBrainzClient,
    *,
    now: datetime,
    limit: int | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Fetches the events of the catalog's fully fetched artists and stores them.

    Raises:
        SourceRequestError: A request failed permanently; nothing is written.
    """
    with session_scope(engine) as session:
        catalog = artist_ids_by_musicbrainz_id(session)
        levels = detail_levels(session)
    seeds = sorted(mbid for mbid, artist in catalog.items() if levels.get(artist) == "full")
    if limit is not None:
        seeds = seeds[:limit]
    found: list[EventRecord] = []
    for mbid in seeds:
        for raw in browse_events(client, mbid):
            event = parse_event(raw, catalog)
            if event is not None:
                found.append(event)
    events = merge(found)
    result: dict[str, Any] = {
        "dryRun": dry_run,
        "artistsConsidered": len(seeds),
        "events": len(events),
        "eventsWithTwoOrMoreCatalogArtists": sum(len(e.performers) > 1 for e in events),
    }
    if not dry_run:
        with session_scope(engine) as session:
            result["stored"] = replace_events(session, events, now)
    result["networkRequests"] = client.network_requests
    result["cacheHits"] = client.cache_hits
    log.info("fetch-events finished", extra=result)
    return result
