"""CompareOnLastFm: listener counts and "similar to both" from Last.fm, for artist comparisons.

Ported from the team app's artist insights (Lakadia). Needs ``lastfm_api_key`` (free). Artists
are looked up by their MusicBrainz ID, never by name. "Similar" is listener behaviour on Last.fm:
it never means the two worked together. Answers are cached in memory for an hour.
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

log = logging.getLogger(__name__)

API = "https://ws.audioscrobbler.com/2.0/"
SIMILAR_LIMIT = 100
NOT_FOUND = 6  # Last.fm's error code for an ID it doesn't know: an answer, not a failure
TIMEOUT_S = 8.0
CACHE_SIZE = 2048
CACHE_TTL_S = 3600


class LastFmUnavailableError(Exception):
    """Last.fm couldn't be asked, or answered with an error other than "not found"."""


@dataclass(frozen=True)
class Audience:
    """An artist's Last.fm listeners and plays."""

    listeners: int
    plays: int
    url: str


@dataclass(frozen=True)
class SimilarArtist:
    """An artist Last.fm lists as similar."""

    name: str
    mbid: str | None
    url: str


def similar_to_both(a: list[SimilarArtist], b: list[SimilarArtist]) -> list[SimilarArtist]:
    """Artists on both lists, in the first list's order; by MusicBrainz ID, else exact URL."""
    keys_b = {s.mbid or s.url for s in b}
    return [s for s in a if (s.mbid or s.url) in keys_b]


@dataclass
class LastFmClient:
    """Last.fm's artist.getInfo and artist.getSimilar by MusicBrainz ID."""

    api_key: str
    http: Callable[[], httpx.Client]
    base_url: str = API
    now: Callable[[], float] = time.monotonic
    _cache: OrderedDict[tuple[str, str], tuple[float, dict[str, Any] | None]] = field(
        default_factory=OrderedDict
    )
    _lock: threading.Lock = field(default_factory=threading.Lock)

    @property
    def configured(self) -> bool:
        """Whether a key is set."""
        return bool(self.api_key)

    def audience(self, mbid: str) -> Audience | None:
        """Listeners and plays, or None when Last.fm doesn't know the artist."""
        body = self._call("artist.getinfo", mbid)
        artist = (body or {}).get("artist") or {}
        stats = artist.get("stats") or {}
        try:
            listeners = int(str(stats.get("listeners")))
        except (TypeError, ValueError):
            return None
        url = artist.get("url")
        if not isinstance(url, str):
            return None
        plays = stats.get("playcount") or stats.get("plays") or 0
        return Audience(listeners, int(plays) if str(plays).isdigit() else 0, url)

    def similar(self, mbid: str) -> list[SimilarArtist]:
        """Artists Last.fm lists as similar, best first."""
        body = self._call("artist.getsimilar", mbid, {"limit": str(SIMILAR_LIMIT)})
        rows = ((body or {}).get("similarartists") or {}).get("artist") or []
        return [
            SimilarArtist(r["name"], r.get("mbid") or None, r["url"])
            for r in rows
            if isinstance(r, dict)
            and isinstance(r.get("name"), str)
            and isinstance(r.get("url"), str)
        ]

    def _call(
        self, method: str, mbid: str, extra: dict[str, str] | None = None
    ) -> dict[str, Any] | None:
        key = (method, mbid)
        with self._lock:
            hit = self._cache.get(key)
            if hit and self.now() - hit[0] < CACHE_TTL_S:
                return hit[1]
        params = {"method": method, "mbid": mbid, "api_key": self.api_key, "format": "json"}
        try:
            with self.http() as http:
                response = http.get(
                    self.base_url, params={**params, **(extra or {})}, timeout=TIMEOUT_S
                )
            body = response.json()
        except (httpx.HTTPError, ValueError) as error:
            log.warning("lastfm unavailable", extra={"error": type(error).__name__})
            raise LastFmUnavailableError from error
        if not isinstance(body, dict):
            raise LastFmUnavailableError
        if body.get("error") == NOT_FOUND:
            result = None
        elif body.get("error") or response.status_code != httpx.codes.OK:
            log.warning("lastfm error", extra={"code": body.get("error")})
            raise LastFmUnavailableError
        else:
            result = body
        with self._lock:
            self._cache[key] = (self.now(), result)
            while len(self._cache) > CACHE_SIZE:
                self._cache.popitem(last=False)
        return result
