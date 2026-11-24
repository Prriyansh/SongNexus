"""Matches the Billboard Hot 100 and Billboard 200 history to the catalog and stores summaries.

A chart credit is matched to one catalog artist by name (``artist_names``: the whole credit, then
its lead, exactly; a name two artists share matches neither), and a song's title to one of that
artist's catalog songs (``catalog_titles``, the rule shared links use). Artists get their
history as the lead performer even when the song itself is not in the catalog; songs only when
both match.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from collections.abc import Iterable
from datetime import datetime
from typing import Any

from sqlalchemy import Engine

from songnexus.catalog.billboard import ChartSong
from songnexus.core.search import EntityType
from songnexus.service.artist_names import ArtistNames
from songnexus.service.link_resolver import catalog_titles
from songnexus.service.readmodel import ReadModel
from songnexus.storage.album_lists import AlbumRun, replace_album_runs
from songnexus.storage.charts import ArtistChart, SongChart, replace_charts
from songnexus.storage.db import session_scope

log = logging.getLogger(__name__)
TOP_TEN = 10


def summarize(
    model: ReadModel, names: ArtistNames, songs: Iterable[ChartSong]
) -> tuple[dict[str, SongChart], dict[str, ArtistChart]]:
    """The per-recording and per-artist summaries for the chart songs the catalog knows."""
    by_artist: dict[str, list[ChartSong]] = defaultdict(list)
    by_recording: dict[str, SongChart] = {}
    for song in songs:
        match = names.match(song.performer, split=True)
        if match is None:
            continue
        artist = match.artist_id
        hits = catalog_titles(model, song.title, EntityType.RECORDING, [artist])
        if match.by_alias and not hits:
            continue  # matched through another of their names: only songs we know count
        by_artist[artist].append(song)
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


def album_runs_by_artist(
    model: ReadModel, names: ArtistNames, albums: Iterable[ChartSong]
) -> dict[str, list[AlbumRun]]:
    """Billboard 200 runs by catalog lead artist; one run per title (re-entries merged)."""
    runs: dict[str, dict[str, AlbumRun]] = defaultdict(dict)
    for album in albums:
        match = names.match(album.performer, split=True)
        if match is None:
            continue
        artist = match.artist_id
        if match.by_alias and not catalog_titles(model, album.title, EntityType.RELEASE, [artist]):
            continue  # matched through another of their names: only albums we know count
        seen = runs[artist].get(album.title)
        runs[artist][album.title] = (
            AlbumRun(album.title, album.peak, album.weeks, album.first_week, album.last_week)
            if seen is None
            else AlbumRun(
                album.title,
                min(seen.peak, album.peak),
                max(seen.weeks, album.weeks),
                min(seen.first_week, album.first_week),
                max(seen.last_week, album.last_week),
            )
        )
    return {artist: list(by_title.values()) for artist, by_title in runs.items()}


def run_billboard_200(
    engine: Engine, model: ReadModel, albums: list[ChartSong], *, now: datetime
) -> dict[str, Any]:
    """Matches the Billboard 200 albums' lead artists and replaces the stored runs."""
    runs = album_runs_by_artist(model, ArtistNames.load(engine, model.graph.nodes), albums)
    with session_scope(engine) as session:
        replace_album_runs(session, runs, now)
    result = {
        "chartAlbums": len(albums),
        "artistsMatched": len(runs),
        "albumsMatched": sum(len(r) for r in runs.values()),
        "numberOneAlbums": sum(run.peak == 1 for r in runs.values() for run in r),
    }
    log.info("fetch-billboard (200) finished", extra=result)
    return result


def run_billboard(
    engine: Engine, model: ReadModel, songs: list[ChartSong], *, now: datetime
) -> dict[str, Any]:
    """Matches the chart songs to the catalog and replaces the stored summaries."""
    recordings, artists = summarize(model, ArtistNames.load(engine, model.graph.nodes), songs)
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
