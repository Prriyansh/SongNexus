"""Reads and writes Billboard Hot 100 summaries (tables ``recording_charts``, ``artist_charts``)."""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from songnexus.storage import models as m


@dataclass(frozen=True)
class SongChart:
    """A catalog song's run on the Hot 100."""

    peak: int
    weeks: int
    first_week: date
    last_week: date


@dataclass(frozen=True)
class ArtistChart:
    """A catalog artist's Hot 100 history, over the songs where they are the lead performer."""

    entries: int
    top_ten: int
    number_ones: int
    best_peak: int
    first_week: date
    last_week: date


def replace_charts(
    session: Session,
    songs: Mapping[str, SongChart],
    artists: Mapping[str, ArtistChart],
    now: datetime,
) -> None:
    """Replaces every stored summary (one transaction: readers see the old or the new set)."""
    session.execute(delete(m.RecordingChart))
    session.execute(delete(m.ArtistChart))
    session.add_all(
        m.RecordingChart(
            recording_id=recording_id,
            peak=c.peak,
            weeks=c.weeks,
            first_week=c.first_week,
            last_week=c.last_week,
            fetched_at=now,
        )
        for recording_id, c in songs.items()
    )
    session.add_all(
        m.ArtistChart(
            artist_id=artist_id,
            entries=c.entries,
            top_ten=c.top_ten,
            number_ones=c.number_ones,
            best_peak=c.best_peak,
            first_week=c.first_week,
            last_week=c.last_week,
            fetched_at=now,
        )
        for artist_id, c in artists.items()
    )


def song_chart(session: Session, recording_id: str) -> SongChart | None:
    """A song's run, or None."""
    row = session.get(m.RecordingChart, recording_id)
    return None if row is None else SongChart(row.peak, row.weeks, row.first_week, row.last_week)


def artist_chart(session: Session, artist_id: str) -> ArtistChart | None:
    """An artist's history, or None."""
    row = session.get(m.ArtistChart, artist_id)
    if row is None:
        return None
    return ArtistChart(
        row.entries, row.top_ten, row.number_ones, row.best_peak, row.first_week, row.last_week
    )


def charts_stamp(session: Session) -> str | None:
    """A short fingerprint of the stored charts (joins the served version), or None."""
    count, latest = session.execute(
        select(func.count(), func.max(m.ArtistChart.fetched_at)).select_from(m.ArtistChart)
    ).one()
    if not count:
        return None
    return hashlib.sha256(f"{count}|{latest}".encode()).hexdigest()[:8]
