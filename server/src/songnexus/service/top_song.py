"""GetTopRecording: an artist's most popular song, for the "Top song" shortcut on artist pages.

Ported from the team app (Priyansh's top-track shortcut). The catalog has no popularity data,
so the ranking comes from Deezer's public API (no key): the artist is the Deezer artist whose
name is exactly the artist's (the one with most fans if several share it), and their top tracks
are tried in order against the artist's own songs in our catalog, by title. Deezer only decides
*which* song; no Deezer numbers are shown. Answers are cached in memory for a day.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from songnexus.core.text import base_title, normalize
from songnexus.storage import models as m

log = logging.getLogger(__name__)

DEEZER_API = "https://api.deezer.com"
CANDIDATES = 10  # one request either way; more chances to find a song we have
TIMEOUT_S = 8.0
CACHE_SIZE = 2048
CACHE_TTL_S = 24 * 3600


class DeezerUnavailableError(Exception):
    """Deezer didn't answer, or answered with an error (it reports quota errors in a 200)."""


def song_key(title: str) -> str:
    """Titles compared without versions or punctuation ("Hit (Remastered)" = "hit")."""
    return normalize(base_title(title))


def pick_artist(rows: list[dict[str, Any]], name: str) -> dict[str, Any] | None:
    """The Deezer artist named exactly ``name`` (ignoring case and accents), most fans first."""
    wanted = normalize(name)
    exact = [r for r in rows if isinstance(r.get("name"), str) and normalize(r["name"]) == wanted]
    return max(exact, key=lambda r: int(r.get("nb_fan") or 0), default=None)


def match_top(titles: list[str], songs: list[tuple[str, str]]) -> str | None:
    """The first top title that is one of the artist's catalog songs (recording ID), or None."""
    by_key: dict[str, str] = {}
    for rid, title in songs:
        by_key.setdefault(song_key(title), rid)
    for title in titles:
        found = by_key.get(song_key(title))
        if found:
            return found
    return None


def lead_songs(session: Session, artist_id: str) -> list[tuple[str, str]]:
    """(recording, title) of the songs the artist leads, oldest release first."""
    rows = session.execute(
        select(m.Recording.id, m.Recording.title)
        .join(m.RecordingCredit, m.RecordingCredit.recording_id == m.Recording.id)
        .where(m.RecordingCredit.artist_id == artist_id, m.RecordingCredit.role == "primary")
        .order_by(m.Recording.first_release_date.is_(None), m.Recording.first_release_date)
    )
    return [(rid, title) for rid, title in rows]


@dataclass
class TopSongClient:
    """Deezer's top tracks per artist name, cached in memory for a day."""

    http: Callable[[], httpx.Client]
    base_url: str = DEEZER_API
    now: Callable[[], float] = time.monotonic
    _cache: OrderedDict[str, tuple[float, list[str]]] = field(default_factory=OrderedDict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def top_titles(self, name: str) -> list[str]:
        """The artist's top track titles on Deezer, best first ([] when no exact artist).

        Raises:
            DeezerUnavailableError: Deezer couldn't be asked (nothing is cached).
        """
        key = normalize(name)
        with self._lock:
            hit = self._cache.get(key)
            if hit and self.now() - hit[0] < CACHE_TTL_S:
                return hit[1]
        with self.http() as http:
            found = pick_artist(self._get(http, "/search/artist", {"q": name, "limit": "10"}), name)
            titles: list[str] = []
            if found and found.get("id") is not None:
                tracks = self._get(
                    http, f"/artist/{int(found['id'])}/top", {"limit": str(CANDIDATES)}
                )
                titles = [t["title"] for t in tracks if isinstance(t.get("title"), str)]
        with self._lock:
            self._cache[key] = (self.now(), titles)
            while len(self._cache) > CACHE_SIZE:
                self._cache.popitem(last=False)
        return titles

    def _get(self, http: httpx.Client, path: str, params: dict[str, str]) -> list[dict[str, Any]]:
        try:
            response = http.get(f"{self.base_url}{path}", params=params, timeout=TIMEOUT_S)
            response.raise_for_status()
            body = response.json()
        except (httpx.HTTPError, ValueError) as error:
            log.warning("deezer unavailable", extra={"error": type(error).__name__})
            raise DeezerUnavailableError from error
        if not isinstance(body, dict) or body.get("error"):
            raise DeezerUnavailableError
        data = body.get("data")
        return [r for r in data if isinstance(r, dict)] if isinstance(data, list) else []
