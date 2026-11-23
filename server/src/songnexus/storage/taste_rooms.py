"""Playlist rooms (table ``taste_rooms``): one person opens a room, a friend joins with its code.

Codes are six characters without 0/O or 1/I/L, since people read them aloud and type them. A
room holds two people at most and is deleted a week after it opens; expired rooms read as
missing even before the purge removes them.
"""

from __future__ import annotations

import secrets
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from songnexus.storage import models as m

ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 6
TTL = timedelta(days=7)
MAX_CREATE_TRIES = 5


@dataclass(frozen=True)
class Member:
    """One side of a room."""

    name: str
    tracks: list[dict[str, Any]]


@dataclass(frozen=True)
class Room:
    """A room as stored."""

    code: str
    host: Member
    guest: Member | None
    expires_at: datetime


class RoomFullError(Exception):
    """Someone already joined: a room is for two people, and a guest is never replaced."""


def normalize_code(text: str) -> str:
    """The code as typed, made canonical ("abc 234" -> "ABC234")."""
    return "".join(text.split()).replace("-", "").upper()


def is_code(code: str) -> bool:
    """Whether ``code`` could be a room code."""
    return len(code) == CODE_LENGTH and all(c in ALPHABET for c in code)


def new_code(pick: Callable[[int], int] = secrets.randbelow) -> str:
    """A random code."""
    return "".join(ALPHABET[pick(len(ALPHABET))] for _ in range(CODE_LENGTH))


def _room(row: m.TasteRoom) -> Room:
    guest = (
        Member(row.guest_name or "", list(row.guest_tracks))
        if row.guest_tracks is not None
        else None
    )
    return Room(row.code, Member(row.host_name, list(row.host_tracks)), guest, row.expires_at)


def create_room(
    session: Session, host: Member, now: datetime, make_code: Callable[[], str] = new_code
) -> Room:
    """Opens a room with a fresh code (expired rooms are cleared first).

    Raises:
        RuntimeError: No free code was found (practically impossible).
    """
    purge_rooms(session, now)
    for _ in range(MAX_CREATE_TRIES):
        code = make_code()
        if session.get(m.TasteRoom, code) is not None:
            continue
        row = m.TasteRoom(
            code=code,
            host_name=host.name,
            host_tracks=host.tracks,
            created_at=now,
            expires_at=now + TTL,
        )
        try:
            with session.begin_nested():
                session.add(row)
        except IntegrityError:
            continue
        return _room(row)
    raise RuntimeError("no free room code")


def read_room(session: Session, code: str, now: datetime) -> Room | None:
    """The room, or None when it doesn't exist or has expired."""
    row = session.get(m.TasteRoom, code)
    if row is None or _aware(row.expires_at) <= now:
        return None
    return _room(row)


def join_room(session: Session, code: str, guest: Member, now: datetime) -> Room | None:
    """Adds the guest; None when the room is missing or expired.

    Raises:
        RoomFullError: Someone already joined.
    """
    if read_room(session, code, now) is None:
        return None
    joined = session.execute(
        update(m.TasteRoom)
        .where(m.TasteRoom.code == code, m.TasteRoom.guest_tracks.is_(None))
        .values(guest_name=guest.name, guest_tracks=guest.tracks)
    )
    if not joined.rowcount:  # type: ignore[attr-defined]
        raise RoomFullError(code)
    session.expire_all()
    return read_room(session, code, now)


def purge_rooms(session: Session, now: datetime) -> int:
    """Deletes expired rooms; returns how many."""
    result = session.execute(delete(m.TasteRoom).where(m.TasteRoom.expires_at <= now))
    return int(result.rowcount or 0)  # type: ignore[attr-defined]


def _aware(value: datetime) -> datetime:
    """SQLite returns naive datetimes; they are stored in UTC."""
    return value if value.tzinfo else value.replace(tzinfo=UTC)
