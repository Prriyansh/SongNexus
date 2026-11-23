"""Reads and writes concerts and festivals (tables ``events``, ``event_performers``)."""

from __future__ import annotations

import hashlib
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from songnexus.storage import models as m


@dataclass(frozen=True)
class EventRecord:
    """An event from MusicBrainz and the catalog artists who performed at it."""

    id: str  # the MusicBrainz event ID
    name: str
    kind: str | None  # Concert, Festival, ...
    date: str | None  # ISO date, as precise as MusicBrainz knows it ("2019", "2019-07-12")
    place: str | None
    performers: tuple[str, ...]  # catalog artist IDs


def replace_events(session: Session, events: Iterable[EventRecord], now: datetime) -> int:
    """Replaces every stored event (one transaction). Returns how many were stored."""
    session.execute(delete(m.EventPerformer))
    session.execute(delete(m.Event))
    count = 0
    for event in events:
        session.add(
            m.Event(
                id=event.id,
                name=event.name,
                kind=event.kind,
                date=event.date,
                place=event.place,
                fetched_at=now,
            )
        )
        session.add_all(
            m.EventPerformer(event_id=event.id, artist_id=a) for a in sorted(set(event.performers))
        )
        count += 1
    return count


def artist_events(session: Session, artist_id: str, limit: int) -> list[EventRecord]:
    """An artist's events, newest first."""
    rows = session.scalars(
        select(m.Event)
        .join(m.EventPerformer, m.EventPerformer.event_id == m.Event.id)
        .where(m.EventPerformer.artist_id == artist_id)
        .order_by(m.Event.date.is_(None), m.Event.date.desc(), m.Event.name)
        .limit(limit)
    ).all()
    return [_record(session, row) for row in rows]


def count_artist_events(session: Session, artist_id: str) -> int:
    """How many events the artist performed at."""
    return int(
        session.scalar(
            select(func.count())
            .select_from(m.EventPerformer)
            .where(m.EventPerformer.artist_id == artist_id)
        )
        or 0
    )


def shared_events(session: Session, a: str, b: str, limit: int) -> list[EventRecord]:
    """Events both artists performed at, newest first."""
    both = (
        select(m.EventPerformer.event_id)
        .where(m.EventPerformer.artist_id.in_([a, b]))
        .group_by(m.EventPerformer.event_id)
        .having(func.count(func.distinct(m.EventPerformer.artist_id)) == 2)  # noqa: PLR2004
    )
    rows = session.scalars(
        select(m.Event)
        .where(m.Event.id.in_(both))
        .order_by(m.Event.date.is_(None), m.Event.date.desc(), m.Event.name)
        .limit(limit)
    ).all()
    return [_record(session, row) for row in rows]


def _record(session: Session, row: m.Event) -> EventRecord:
    performers: Sequence[str] = session.scalars(
        select(m.EventPerformer.artist_id).where(m.EventPerformer.event_id == row.id)
    ).all()
    return EventRecord(row.id, row.name, row.kind, row.date, row.place, tuple(performers))


def events_stamp(session: Session) -> str | None:
    """A short fingerprint of the stored events (joins the served version), or None."""
    count, latest = session.execute(
        select(func.count(), func.max(m.Event.fetched_at)).select_from(m.Event)
    ).one()
    if not count:
        return None
    return hashlib.sha256(f"{count}|{latest}".encode()).hexdigest()[:8]
