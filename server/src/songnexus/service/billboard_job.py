"""Matches the Billboard Hot 100 history to the catalog and stores the summaries.

A chart song's lead performer is matched to one catalog artist by name (``catalog_artists``: only
an unambiguous match counts, never a namesake), and its title to one of that artist's catalog
songs (``catalog_titles``, the rule shared links use). Artists get their history as the lead
performer even when the song itself is not in the catalog; songs only when both match.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from collections.abc import Iterable
from datetime import datetime
from typing import Any

from sqlalchemy import Engine

from songnexus.catalog.billboard import ChartSong, performer_candidates
from songnexus.core.search import EntityType
from songnexus.service.link_resolver import catalog_artists, catalog_titles
from songnexus.service.readmodel import ReadModel
from songnexus.storage.charts import ArtistChart, SongChart, replace_charts
from songnexus.storage.db import session_scope

log = logging.getLogger(__name__)
TOP_TEN = 10


def lead_artist(model: ReadModel, performer: str, cache: dict[str, str | None]) -> str | None:
    """The catalog artist a chart credit names first, or None (cached per credit)."""
    if performer not in cache:
        found = None
        for name in performer_candidates(performer):
            matched = catalog_artists(model, [name])
            if matched:
                found = matched[0]
                break
        cache[performer] = found
    return cache[performer]


def summarize(
    model: ReadModel, songs: Iterable[ChartSong]
) -> tuple[dict[str, SongChart], dict[str, ArtistChart]]:
    """The per-recording and per-artist summaries for the chart songs the catalog knows."""
    cache: dict[str, str | None] = {}
    by_artist: dict[str, list[ChartSong]] = defaultdict(list)
    by_recording: dict[str, SongChart] = {}
    for song in songs:
        artist = lead_artist(model, song.performer, cache)
        if artist is None:
            continue
        by_artist[artist].append(song)
        hits = catalog_titles(model, song.title, EntityType.RECORDING, [artist])
        if not hits:
            continue
        run = SongChart(song.peak, song.weeks, song.first_week, song.last_week)
        seen = by_recording.get(hits[0])
        by_recording[hits[0]] = (
            run
            if seen is None
            else SongChart(
                min(seen.peak, run.peak),
                max(seen.weeks, run.weeks),
                min(seen.first_week, run.first_week),
                max(seen.last_week, run.last_week),
            )
        )
    artists = {
        artist: ArtistChart(
            entries=len(runs),
            top_ten=sum(r.peak <= TOP_TEN for r in runs),
            number_ones=sum(r.peak == 1 for r in runs),
            best_peak=min(r.peak for r in runs),
            first_week=min(r.first_week for r in runs),
            last_week=max(r.last_week for r in runs),
        )
        for artist, runs in by_artist.items()
    }
    return by_recording, artists


def run_billboard(
    engine: Engine, model: ReadModel, songs: list[ChartSong], *, now: datetime
) -> dict[str, Any]:
    """Matches the chart songs to the catalog and replaces the stored summaries."""
    recordings, artists = summarize(model, songs)
    with session_scope(engine) as session:
        replace_charts(session, recordings, artists, now)
    result = {
        "chartSongs": len(songs),
        "artistsMatched": len(artists),
        "songsMatched": len(recordings),
        "numberOnes": sum(a.number_ones for a in artists.values()),
    }
    log.info("fetch-billboard finished", extra=result)
    return result
