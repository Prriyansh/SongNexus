"""Reads behind the similar-music and playlist maps: co-listening, MusicBrainz IDs, top songs."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from songnexus.storage import models as m

MUSICBRAINZ = "musicbrainz"
PRIMARY = "primary"


def colistening(
    session: Session, artist_ids: Iterable[str], limit: int
) -> dict[str, list[tuple[str, float]]]:
    """Per artist, (other artist, session score) for its most co-listened artists, best first."""
    ids = list(dict.fromkeys(artist_ids))
    out: dict[str, list[tuple[str, float]]] = {a: [] for a in ids}
    if not ids:
        return out
    rows = session.execute(
        select(
            m.ArtistCoListening.artist_id,
            m.ArtistCoListening.other_artist_id,
            m.ArtistCoListening.score,
        )
        .where(m.ArtistCoListening.artist_id.in_(ids))
        .order_by(m.ArtistCoListening.artist_id, m.ArtistCoListening.rank)
    )
    for artist, other, score in rows:
        if len(out[artist]) < limit:
            out[artist].append((other, float(score)))
    return out


def musicbrainz_ids(
    session: Session, entity_type: str, entity_ids: Iterable[str]
) -> dict[str, str]:
    """A MusicBrainz ID for each entity that has one (the first ingested, if several)."""
    ids = list(dict.fromkeys(entity_ids))
    if not ids:
        return {}
    out: dict[str, str] = {}
    for entity, mbid in session.execute(
        select(m.EntitySourceMapping.entity_id, m.EntitySourceMapping.source_entity_id)
        .where(
            m.EntitySourceMapping.entity_type == entity_type,
            m.EntitySourceMapping.source_id == MUSICBRAINZ,
            m.EntitySourceMapping.entity_id.in_(ids),
        )
        .order_by(m.EntitySourceMapping.id)
    ):
        out.setdefault(entity, mbid)
    return out


def recordings_by_musicbrainz_id(session: Session, mbids: Iterable[str]) -> dict[str, str]:
    """The catalog recording for each MusicBrainz recording ID it knows."""
    ids = list(dict.fromkeys(mbids))
    if not ids:
        return {}
    rows = session.execute(
        select(m.EntitySourceMapping.source_entity_id, m.EntitySourceMapping.entity_id).where(
            m.EntitySourceMapping.entity_type == "recording",
            m.EntitySourceMapping.source_id == MUSICBRAINZ,
            m.EntitySourceMapping.source_entity_id.in_(ids),
        )
    )
    return {mbid: entity for mbid, entity in rows}  # noqa: C416 - Rows, not pairs


def top_recordings(session: Session, artist_id: str, limit: int) -> list[tuple[str, str]]:
    """(recording, title) of an artist's best-known songs as lead artist.

    Chart hits first (by peak), then the songs on the most releases: a song on many releases
    (singles, albums, compilations) is usually one people know.
    """
    appearances = (
        select(
            m.ReleaseRecording.recording_id.label("rid"),
            func.count().label("n"),
        )
        .group_by(m.ReleaseRecording.recording_id)
        .subquery()
    )
    rows = session.execute(
        select(m.Recording.id, m.Recording.title)
        .join(m.RecordingCredit, m.RecordingCredit.recording_id == m.Recording.id)
        .outerjoin(appearances, appearances.c.rid == m.Recording.id)
        .outerjoin(m.RecordingChart, m.RecordingChart.recording_id == m.Recording.id)
        .where(m.RecordingCredit.artist_id == artist_id, m.RecordingCredit.role == PRIMARY)
        .group_by(m.Recording.id, m.Recording.title, m.RecordingChart.peak, appearances.c.n)
        .order_by(
            m.RecordingChart.peak.is_(None),
            m.RecordingChart.peak,
            appearances.c.n.desc().nulls_last(),
            m.Recording.title,
        )
        .limit(limit)
    )
    return [(rid, title) for rid, title in rows]


def primary_artists(session: Session, recording_ids: Iterable[str]) -> dict[str, list[str]]:
    """The lead artists of each recording."""
    ids = list(dict.fromkeys(recording_ids))
    out: dict[str, list[str]] = defaultdict(list)
    if not ids:
        return out
    for rid, artist in session.execute(
        select(m.RecordingCredit.recording_id, m.RecordingCredit.artist_id)
        .where(m.RecordingCredit.recording_id.in_(ids), m.RecordingCredit.role == PRIMARY)
        .order_by(m.RecordingCredit.recording_id, m.RecordingCredit.id)
    ):
        out[rid].append(artist)
    return out


def recording_titles(session: Session, recording_ids: Iterable[str]) -> dict[str, str]:
    """Titles by recording ID."""
    ids = list(dict.fromkeys(recording_ids))
    if not ids:
        return {}
    rows = session.execute(select(m.Recording.id, m.Recording.title).where(m.Recording.id.in_(ids)))
    return {rid: title for rid, title in rows}  # noqa: C416 - Rows, not pairs
