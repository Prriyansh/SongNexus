"""Reads and writes artist facts (table ``artist_facts``): description, Wikipedia, honors."""

from __future__ import annotations

import hashlib
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from songnexus.storage import models as m


@dataclass(frozen=True)
class Honor:
    """An award or a nomination as Wikidata lists it."""

    id: str  # Wikidata QID of the award
    name: str  # its English label
    year: int | None = None

    def as_json(self) -> dict[str, Any]:
        """The stored form."""
        return {"id": self.id, "name": self.name, "year": self.year}

    @staticmethod
    def from_json(value: Mapping[str, Any]) -> Honor:
        """Reads the stored form."""
        year = value.get("year")
        return Honor(str(value["id"]), str(value["name"]), int(year) if year is not None else None)


@dataclass(frozen=True)
class FactsRecord:
    """One artist's facts as stored."""

    wikidata_id: str
    description: str | None
    wikipedia_url: str | None
    summary: str | None
    awards: tuple[Honor, ...]
    nominations: tuple[Honor, ...]
    # Average monthly human views of the Wikipedia article (last 12 complete months).
    monthly_views: int | None = None

    @property
    def is_empty(self) -> bool:
        """Nothing worth showing."""
        return not (self.description or self.summary or self.awards or self.nominations)


_SCALARS = ("wikidata_id", "description", "wikipedia_url", "summary", "monthly_views")
_DELETE_BATCH = 500  # artist IDs per DELETE, well under SQLite's parameter limit


@dataclass(frozen=True)
class WriteStats:
    """What a write changed."""

    inserted: int
    updated: int
    unchanged: int
    deleted: int


def _values(record: FactsRecord) -> dict[str, Any]:
    return {
        **{name: getattr(record, name) for name in _SCALARS},
        "awards": [h.as_json() for h in record.awards],
        "nominations": [h.as_json() for h in record.nominations],
    }


def write_facts(
    session: Session, facts: Mapping[str, FactsRecord | None], now: datetime
) -> WriteStats:
    """Makes ``artist_facts`` match ``facts`` for the artists it names.

    ``None`` (or an empty record) means there is nothing to show now, so a stored row is
    removed. Unchanged rows keep their ``fetched_at``, so a re-run with the same answers writes
    nothing and the version stamp, and with it every ETag, stays the same. Artists not named
    are left as they are.
    """
    existing = {
        row.artist_id: row
        for row in session.scalars(select(m.ArtistFacts))
        if row.artist_id in facts
    }
    inserted = updated = unchanged = 0
    stale: list[str] = []
    for artist_id, record in facts.items():
        if record is None or record.is_empty:
            stale.append(artist_id)
            continue
        values = _values(record)
        row = existing.get(artist_id)
        if row is None:
            session.add(m.ArtistFacts(artist_id=artist_id, fetched_at=now, **values))
            inserted += 1
        elif any(getattr(row, k) != v for k, v in values.items()):
            for k, v in values.items():
                setattr(row, k, v)
            row.fetched_at = now
            updated += 1
        else:
            unchanged += 1
    removed = sorted(a for a in stale if a in existing)
    for start in range(0, len(removed), _DELETE_BATCH):
        batch = removed[start : start + _DELETE_BATCH]
        session.execute(delete(m.ArtistFacts).where(m.ArtistFacts.artist_id.in_(batch)))
    return WriteStats(inserted, updated, unchanged, len(removed))


def read_artist_facts(session: Session, artist_ids: Iterable[str]) -> dict[str, FactsRecord]:
    """Returns {artist ID: facts} for the given artists that have any."""
    wanted = sorted(set(artist_ids))
    if not wanted:
        return {}
    rows = session.scalars(select(m.ArtistFacts).where(m.ArtistFacts.artist_id.in_(wanted)))
    return {
        row.artist_id: FactsRecord(
            wikidata_id=row.wikidata_id,
            description=row.description,
            wikipedia_url=row.wikipedia_url,
            summary=row.summary,
            awards=tuple(Honor.from_json(h) for h in row.awards or []),
            nominations=tuple(Honor.from_json(h) for h in row.nominations or []),
            monthly_views=row.monthly_views,
        )
        for row in rows
    }


def facts_stamp(session: Session) -> str | None:
    """Returns a short fingerprint of the stored facts, or None when there are none.

    It joins the catalog version, so a ``fetch-facts`` run that changes rows reloads the read
    model and changes every cache key and ETag.
    """
    count, latest = session.execute(
        select(func.count(), func.max(m.ArtistFacts.fetched_at)).select_from(m.ArtistFacts)
    ).one()
    if not count:
        return None
    return hashlib.sha256(f"{count}|{latest}".encode()).hexdigest()[:8]
