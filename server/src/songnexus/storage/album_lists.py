"""Reads and writes the album charts, album lists and contest entries of catalog artists.

Tables ``album_chart_runs`` (Billboard 200), ``greatest_albums`` (Rolling Stone's 500) and
``eurovision_entries``. Each fetch replaces its whole table in one transaction, so readers see
the old set or the new one, never a mix.
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from songnexus.storage import models as m


@dataclass(frozen=True)
class AlbumRun:
    """An album's run on the Billboard 200."""

    title: str
    peak: int
    weeks: int
    first_week: date
    last_week: date


@dataclass(frozen=True)
class ListedAlbum:
    """An album on Rolling Stone's list, with its rank in each edition it made."""

    title: str
    release_year: int | None
    rank_2003: int | None
    rank_2012: int | None
    rank_2020: int | None


@dataclass(frozen=True)
class ContestEntry:
    """A Eurovision entry."""

    year: int
    country: str
    song: str
    place_final: int | None
    points_final: int | None
    place_semi_final: int | None


def replace_album_runs(
    session: Session, runs: Mapping[str, Sequence[AlbumRun]], now: datetime
) -> None:
    """Replaces every stored Billboard 200 run (``runs`` by catalog artist ID)."""
    session.execute(delete(m.AlbumChartRun))
    session.add_all(
        m.AlbumChartRun(
            artist_id=artist_id,
            title=run.title,
            peak=run.peak,
            weeks=run.weeks,
            first_week=run.first_week,
            last_week=run.last_week,
            fetched_at=now,
        )
        for artist_id, artist_runs in runs.items()
        for run in artist_runs
    )


def replace_listed_albums(
    session: Session, albums: Mapping[str, Sequence[ListedAlbum]], now: datetime
) -> None:
    """Replaces every stored Rolling Stone list entry."""
    session.execute(delete(m.GreatestAlbum))
    session.add_all(
        m.GreatestAlbum(
            artist_id=artist_id,
            title=album.title,
            release_year=album.release_year,
            rank_2003=album.rank_2003,
            rank_2012=album.rank_2012,
            rank_2020=album.rank_2020,
            fetched_at=now,
        )
        for artist_id, artist_albums in albums.items()
        for album in artist_albums
    )


def replace_contest_entries(
    session: Session, entries: Mapping[str, Sequence[ContestEntry]], now: datetime
) -> None:
    """Replaces every stored Eurovision entry."""
    session.execute(delete(m.EurovisionEntry))
    session.add_all(
        m.EurovisionEntry(
            artist_id=artist_id,
            year=entry.year,
            country=entry.country,
            song=entry.song,
            place_final=entry.place_final,
            points_final=entry.points_final,
            place_semi_final=entry.place_semi_final,
            fetched_at=now,
        )
        for artist_id, artist_entries in entries.items()
        for entry in artist_entries
    )


def album_runs(session: Session, artist_id: str) -> list[AlbumRun]:
    """An artist's Billboard 200 albums, best peak first, then the longest runs."""
    rows = session.scalars(
        select(m.AlbumChartRun)
        .where(m.AlbumChartRun.artist_id == artist_id)
        .order_by(m.AlbumChartRun.peak, m.AlbumChartRun.weeks.desc(), m.AlbumChartRun.first_week)
    )
    return [AlbumRun(r.title, r.peak, r.weeks, r.first_week, r.last_week) for r in rows]


def listed_albums(session: Session, artist_id: str) -> list[ListedAlbum]:
    """An artist's albums on Rolling Stone's list, oldest release first."""
    rows = session.scalars(
        select(m.GreatestAlbum)
        .where(m.GreatestAlbum.artist_id == artist_id)
        .order_by(m.GreatestAlbum.release_year, m.GreatestAlbum.title)
    )
    return [
        ListedAlbum(r.title, r.release_year, r.rank_2003, r.rank_2012, r.rank_2020) for r in rows
    ]


def contest_entries(session: Session, artist_id: str) -> list[ContestEntry]:
    """An artist's Eurovision entries, oldest first."""
    rows = session.scalars(
        select(m.EurovisionEntry)
        .where(m.EurovisionEntry.artist_id == artist_id)
        .order_by(m.EurovisionEntry.year, m.EurovisionEntry.country)
    )
    return [
        ContestEntry(r.year, r.country, r.song, r.place_final, r.points_final, r.place_semi_final)
        for r in rows
    ]


def album_lists_stamp(session: Session) -> str | None:
    """A short fingerprint of the three tables (joins the served version), or None if empty."""
    parts = []
    for model in (m.AlbumChartRun, m.GreatestAlbum, m.EurovisionEntry):
        count, latest = session.execute(
            select(func.count(), func.max(model.fetched_at)).select_from(model)
        ).one()
        parts.append(f"{count}|{latest}")
    if all(p.startswith("0|") for p in parts):
        return None
    return hashlib.sha256(";".join(parts).encode()).hexdigest()[:8]
