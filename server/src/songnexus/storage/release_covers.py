"""Reads and writes album covers (table ``release_covers``) from the Cover Art Archive."""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from dataclasses import dataclass, fields
from datetime import datetime

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from songnexus.storage import models as m


@dataclass(frozen=True)
class CoverRecord:
    """A release's front cover: two sizes hot-linked from the archive, and its page."""

    thumbnail_url: str  # about 250 px
    large_url: str  # about 500 px
    page_url: str  # the release group's page on the Cover Art Archive


_FIELDS = tuple(f.name for f in fields(CoverRecord))
_DELETE_BATCH = 500


@dataclass(frozen=True)
class WriteStats:
    """What a write changed."""

    inserted: int
    updated: int
    unchanged: int
    deleted: int


def release_ids_by_musicbrainz_id(session: Session) -> dict[str, str]:
    """Returns {MusicBrainz release-group ID: release ID} for every mapped release."""
    rows = session.execute(
        select(m.EntitySourceMapping.source_entity_id, m.EntitySourceMapping.entity_id).where(
            m.EntitySourceMapping.entity_type == "release",
            m.EntitySourceMapping.source_id == "musicbrainz",
        )
    )
    return {mbid: release_id for mbid, release_id in rows.all()}  # noqa: C416


def write_covers(
    session: Session, covers: Mapping[str, CoverRecord | None], now: datetime
) -> WriteStats:
    """Makes ``release_covers`` match ``covers`` for the releases it names.

    ``None`` = no front cover now (a stored one is removed). Unchanged rows keep their
    ``fetched_at``, so a re-run with the same answers changes no cache key.
    """
    existing = {
        row.release_id: row
        for row in session.scalars(select(m.ReleaseCover))
        if row.release_id in covers
    }
    inserted = updated = unchanged = 0
    for release_id, record in covers.items():
        if record is None:
            continue
        values = {name: getattr(record, name) for name in _FIELDS}
        row = existing.get(release_id)
        if row is None:
            session.add(m.ReleaseCover(release_id=release_id, fetched_at=now, **values))
            inserted += 1
        elif any(getattr(row, k) != v for k, v in values.items()):
            for k, v in values.items():
                setattr(row, k, v)
            row.fetched_at = now
            updated += 1
        else:
            unchanged += 1
    removed = sorted(r for r, record in covers.items() if record is None and r in existing)
    for start in range(0, len(removed), _DELETE_BATCH):
        batch = removed[start : start + _DELETE_BATCH]
        session.execute(delete(m.ReleaseCover).where(m.ReleaseCover.release_id.in_(batch)))
    return WriteStats(inserted, updated, unchanged, len(removed))


def read_recording_covers(session: Session) -> dict[str, str]:
    """Returns {recording ID: cover thumbnail URL}: the earliest release with a cover."""
    rows = session.execute(
        select(m.ReleaseRecording.recording_id, m.ReleaseCover.thumbnail_url)
        .join(m.ReleaseCover, m.ReleaseCover.release_id == m.ReleaseRecording.release_id)
        .join(m.Release, m.Release.id == m.ReleaseRecording.release_id)
        .order_by(m.Release.first_release_date.is_(None), m.Release.first_release_date)
    ).all()
    covers: dict[str, str] = {}
    for recording_id, url in rows:
        covers.setdefault(recording_id, url)
    return covers


def read_release_covers(session: Session) -> dict[str, str]:
    """Returns {release ID: cover thumbnail URL}."""
    rows = session.execute(select(m.ReleaseCover.release_id, m.ReleaseCover.thumbnail_url))
    return {release_id: url for release_id, url in rows.all()}  # noqa: C416 (Result has keys())


def covers_stamp(session: Session) -> str | None:
    """A short fingerprint of the stored covers (joins the served version), or None."""
    count, latest = session.execute(
        select(func.count(), func.max(m.ReleaseCover.fetched_at)).select_from(m.ReleaseCover)
    ).one()
    if not count:
        return None
    return hashlib.sha256(f"{count}|{latest}".encode()).hexdigest()[:8]
