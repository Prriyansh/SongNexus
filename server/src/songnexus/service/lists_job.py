"""Matches Rolling Stone's 500 Greatest Albums and the Eurovision entries to catalog artists.

A credit is matched to one catalog artist by its whole name (``artist_names``; a name two
artists share matches neither). Unlike the charts, a credit is never split into a lead: a
Eurovision duo is not either of its members. A contest entry also needs its song among the
artist's catalog songs, since many contestants share a name with someone better known ("Jónsi"
of Iceland 2004 is not Sigur Rós's singer). Entries whose artist the catalog doesn't know are
left out.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from collections.abc import Iterable
from datetime import datetime
from typing import Any

from sqlalchemy import Engine

from songnexus.catalog import eurovision, greatest_albums
from songnexus.core.search import EntityType
from songnexus.service.artist_names import ArtistNames
from songnexus.service.link_resolver import catalog_titles
from songnexus.service.readmodel import ReadModel
from songnexus.storage.album_lists import (
    ContestEntry,
    ListedAlbum,
    replace_contest_entries,
    replace_listed_albums,
)
from songnexus.storage.db import session_scope

log = logging.getLogger(__name__)


def listed_by_artist(
    model: ReadModel, names: ArtistNames, albums: Iterable[greatest_albums.ListedAlbum]
) -> dict[str, list[ListedAlbum]]:
    """The list's albums by catalog artist (one row per title)."""
    out: dict[str, dict[str, ListedAlbum]] = defaultdict(dict)
    for album in albums:
        match = names.match(album.artist)
        if match is None:
            continue
        artist = match.artist_id
        # Matched through another of their names: only an album the catalog has counts.
        if not match.by_alias or catalog_titles(model, album.title, EntityType.RELEASE, [artist]):
            out[artist].setdefault(
                album.title,
                ListedAlbum(
                    album.title,
                    album.release_year,
                    album.rank_2003,
                    album.rank_2012,
                    album.rank_2020,
                ),
            )
    return {artist: list(by_title.values()) for artist, by_title in out.items()}


def entries_by_artist(
    model: ReadModel, names: ArtistNames, entries: Iterable[eurovision.ContestEntry]
) -> dict[str, list[ContestEntry]]:
    """The contest entries by catalog artist whose song the catalog has (one per year, country)."""
    out: dict[str, dict[tuple[int, str], ContestEntry]] = defaultdict(dict)
    for entry in entries:
        match = names.match(entry.performer)
        if match is None:
            continue
        artist = match.artist_id
        if catalog_titles(model, entry.song, EntityType.RECORDING, [artist]):
            out[artist].setdefault(
                (entry.year, entry.country),
                ContestEntry(
                    entry.year,
                    entry.country,
                    entry.song,
                    entry.place_final,
                    entry.points_final,
                    entry.place_semi_final,
                ),
            )
    return {artist: list(by_key.values()) for artist, by_key in out.items()}


def run_greatest_albums(
    engine: Engine, model: ReadModel, albums: list[greatest_albums.ListedAlbum], *, now: datetime
) -> dict[str, Any]:
    """Matches the list to the catalog and replaces the stored entries."""
    matched = listed_by_artist(model, ArtistNames.load(engine, model.graph.nodes), albums)
    with session_scope(engine) as session:
        replace_listed_albums(session, matched, now)
    result = {
        "listedAlbums": len(albums),
        "artistsMatched": len(matched),
        "albumsMatched": sum(len(a) for a in matched.values()),
    }
    log.info("fetch-greatest-albums finished", extra=result)
    return result


def run_eurovision(
    engine: Engine, model: ReadModel, entries: list[eurovision.ContestEntry], *, now: datetime
) -> dict[str, Any]:
    """Matches the contest entries to the catalog and replaces the stored ones."""
    matched = entries_by_artist(model, ArtistNames.load(engine, model.graph.nodes), entries)
    with session_scope(engine) as session:
        replace_contest_entries(session, matched, now)
    result = {
        "entries": len(entries),
        "artistsMatched": len(matched),
        "entriesMatched": sum(len(e) for e in matched.values()),
    }
    log.info("fetch-eurovision finished", extra=result)
    return result
