"""ListMoreCredits: people credited on both artists' work according to Discogs and Genius.

The catalog's connections come from MusicBrainz. Discogs and Genius often credit producers,
writers and players that MusicBrainz lacks, so a two-artist comparison asks them too, live:

* **Discogs** (API, no key needed; ``discogs_token`` raises its rate limit). The artist is
  found through the Discogs ID the catalog already maps to it (from MusicBrainz and Wikidata),
  never by name. Credits are read from the main release of the artist's newest masters.
* **Genius** (API, needs ``genius_access_token``). The artist is the search hit whose name is
  exactly the artist's; anything less counts as not found. Credits are read from the artist's
  most popular songs. Only credits are read, never lyrics.

People are compared within one source by that source's own ID, so two people who share a name
are never merged. A person links to a catalog artist only when the catalog maps that exact
Discogs ID. Each source runs within a time budget: what it checked is reported (OK, PARTIAL),
as is why it was skipped (NO_KEY, NO_MATCH, FAILED). Responses are cached in memory for a day;
nothing is stored.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from collections import OrderedDict
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from songnexus.core.text import normalize

log = logging.getLogger(__name__)

DISCOGS_API = "https://api.discogs.com"
GENIUS_API = "https://api.genius.com"
DISCOGS_MASTERS = 8  # per artist, newest first
GENIUS_SONGS = 20  # per artist, most popular first
EVIDENCE_PER_SIDE = 5
MAX_PEOPLE = 40
CACHE_SIZE = 4096
CACHE_TTL_S = 24 * 3600
TIMEOUT_S = 10.0
# Discogs allows 25 requests a minute without a token and 60 with one.
DISCOGS_SPACING_S = {False: 2.5, True: 1.05}

_IGNORED_ROLE = re.compile(
    r"master|design|photo|artwork|art direction|a&r|manage|publish|label|copyright|liner"
    r"|manufactur|distribut|booking|legal|marketing| at$",
    re.IGNORECASE,
)
_INSTRUMENT_ROLE = re.compile(
    r"instrument|guitar|bass|drum|percussion|piano|keyboard|synth|organ|string|violin|viola"
    r"|cello|sax|trumpet|trombone|horn|flute|harp|banjo|ukulele|mandolin|tambourine|cymbal"
    r"|timbales|performer",
    re.IGNORECASE,
)
_DISCOGS_NUMBER = re.compile(r"\s\(\d+\)$")


def credit_role(label: str) -> str | None:
    """The app's role name for a source's credit label; None for labels it doesn't show."""
    if _IGNORED_ROLE.search(label):
        return None
    rules = (
        (r"produc", "producer"),
        (r"mix", "mixing"),
        (r"writ|lyric|compos|music by", "songwriting"),
        (r"program", "programming"),
        (r"engineer|record", "engineering"),
        (r"feat", "featured"),
        (r"vocal|choir|rap\b", "vocals"),
    )
    for pattern, role in rules:
        if re.search(pattern, label, re.IGNORECASE):
            return role
    return "instruments" if _INSTRUMENT_ROLE.search(label) else None


@dataclass(frozen=True)
class Work:
    """A release or song a person is credited on."""

    title: str
    url: str
    year: int | None


@dataclass
class Person:
    """Everyone a source credits on one artist's work, by that source's person ID."""

    name: str
    url: str
    roles: set[str] = field(default_factory=set)
    work: dict[str, Work] = field(default_factory=dict)


People = dict[str, Person]


def add_credit(
    people: People, pid: str, *, name: str, url: str, role: str | None, work: Work
) -> None:
    """Records that ``pid`` is credited as ``role`` on ``work`` (skipped without a role)."""
    if not pid or not name or role is None:
        return
    person = people.setdefault(pid, Person(name, url))
    person.roles.add(role)
    person.work.setdefault(work.url, work)


@dataclass(frozen=True)
class Shared:
    """A person a source credits on both artists' work."""

    source: str
    person_id: str
    name: str
    url: str
    roles_a: tuple[str, ...]
    roles_b: tuple[str, ...]
    evidence_a: tuple[Work, ...]
    evidence_b: tuple[Work, ...]


def common_people(source: str, a: People, b: People, exclude: Iterable[str]) -> list[Shared]:
    """People in both, leaving out the two artists, strongest overlap first."""
    skip = set(exclude)
    shared = [
        Shared(
            source=source,
            person_id=pid,
            name=pa.name,
            url=pa.url,
            roles_a=tuple(sorted(pa.roles)),
            roles_b=tuple(sorted(b[pid].roles)),
            evidence_a=tuple(list(pa.work.values())[:EVIDENCE_PER_SIDE]),
            evidence_b=tuple(list(b[pid].work.values())[:EVIDENCE_PER_SIDE]),
        )
        for pid, pa in a.items()
        if pid in b and pid not in skip
    ]

    def strength(s: Shared) -> tuple[int, int, str]:
        na, nb = len(a[s.person_id].work), len(b[s.person_id].work)
        return (-min(na, nb), -(na + nb), s.name)

    return sorted(shared, key=strength)[:MAX_PEOPLE]


def direct_work(a: People, b: People, a_id: str | None, b_id: str | None) -> list[Work]:
    """Work where one artist is credited on the other's."""
    found = [
        *(a[b_id].work.values() if b_id in a else ()),
        *(b[a_id].work.values() if a_id in b else ()),
    ]
    return list({w.url: w for w in found}.values())[:6]


@dataclass(frozen=True)
class Scan:
    """One artist's credits from one source."""

    people: People
    scanned: int
    complete: bool
    source_artist_id: str


class SourceUnavailableError(Exception):
    """A source failed in a way worth reporting (it never fails the comparison)."""


class CreditSources:
    """Reads credits from Discogs and Genius, politely and with an in-memory cache."""

    def __init__(
        self,
        *,
        http: Callable[[], httpx.Client],
        discogs_token: str = "",
        genius_token: str = "",
        budget_s: float = 15.0,
        now: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
        discogs_url: str = DISCOGS_API,
        genius_url: str = GENIUS_API,
    ) -> None:
        """Creates the reader; the budget bounds each source's work per comparison."""
        self._http = http
        self._discogs_token = discogs_token.strip()
        self._genius_token = genius_token.strip()
        self._budget_s = budget_s
        self._now = now
        self._sleep = sleep
        self._discogs_url = discogs_url.rstrip("/")
        self._genius_url = genius_url.rstrip("/")
        self._cache: OrderedDict[str, tuple[float, Any]] = OrderedDict()
        self._lock = threading.Lock()
        self._discogs_lock = threading.Lock()  # one Discogs request at a time, spaced
        self._discogs_last = 0.0

    def client(self) -> httpx.Client:
        """A new HTTP client for one comparison."""
        return self._http()

    @property
    def genius_enabled(self) -> bool:
        """Whether a Genius token is configured."""
        return bool(self._genius_token)

    # --- HTTP -------------------------------------------------------------------------------

    def _get(self, http: httpx.Client, url: str, headers: dict[str, str], *, discogs: bool) -> Any:
        with self._lock:
            hit = self._cache.get(url)
            if hit is not None and self._now() - hit[0] <= CACHE_TTL_S:
                self._cache.move_to_end(url)
                return hit[1]
        if discogs:
            with self._discogs_lock:
                wait = DISCOGS_SPACING_S[bool(self._discogs_token)] - (
                    self._now() - self._discogs_last
                )
                if wait > 0 and self._discogs_last:
                    self._sleep(wait)
                self._discogs_last = self._now()
                body = self._fetch(http, url, headers)
        else:
            body = self._fetch(http, url, headers)
        with self._lock:
            self._cache[url] = (self._now(), body)
            while len(self._cache) > CACHE_SIZE:
                self._cache.popitem(last=False)
        return body

    @staticmethod
    def _fetch(http: httpx.Client, url: str, headers: dict[str, str]) -> Any:
        try:
            response = http.get(url, headers=headers, timeout=TIMEOUT_S)
        except httpx.HTTPError as error:
            raise SourceUnavailableError(type(error).__name__) from error
        if response.status_code != HTTPStatus.OK:
            raise SourceUnavailableError(f"status {response.status_code}")
        try:
            return response.json()
        except ValueError as error:
            raise SourceUnavailableError("malformed response") from error

    # --- Discogs ----------------------------------------------------------------------------

    def discogs(
        self, http: httpx.Client, discogs_id: str, albums: frozenset[str] = frozenset()
    ) -> Scan:
        """Credits on the main releases of an artist's masters, within the budget.

        Masters whose title is one of the artist's albums in the catalog (``albums``, normalized)
        come first, newest first within each group: Discogs lists singles and reissues alongside
        albums, and albums carry the fullest credits.
        """
        headers = (
            {"Authorization": f"Discogs token={self._discogs_token}"} if self._discogs_token else {}
        )
        listing = self._get(
            http,
            f"{self._discogs_url}/artists/{quote(discogs_id)}/releases?sort=year&sort_order=desc&per_page=100",
            headers,
            discogs=True,
        )
        masters = sorted(
            (
                r
                for r in listing.get("releases", [])
                if r.get("type") == "master" and r.get("role") == "Main" and r.get("main_release")
            ),
            key=lambda r: normalize(str(r.get("title", ""))) not in albums,  # stable sort
        )[:DISCOGS_MASTERS]
        people: People = {}
        deadline = self._now() + self._budget_s
        scanned = 0
        for master in masters:
            if scanned and self._now() > deadline:
                return Scan(people, scanned, False, discogs_id)
            try:
                release = self._get(
                    http,
                    f"{self._discogs_url}/releases/{int(master['main_release'])}",
                    headers,
                    discogs=True,
                )
            except SourceUnavailableError:
                if not scanned:
                    raise
                return Scan(people, scanned, False, discogs_id)
            year = release.get("year") or master.get("year")
            work = Work(
                title=str(release.get("title") or "Untitled release"),
                url=str(
                    release.get("uri")
                    or f"https://www.discogs.com/release/{master['main_release']}"
                ),
                year=int(year) if year else None,
            )
            credits = [
                *release.get("extraartists", []),
                *(
                    c
                    for track in release.get("tracklist", [])
                    for c in track.get("extraartists", [])
                ),
            ]
            for credit in credits:
                if not credit.get("id"):
                    continue
                pid = str(credit["id"])
                add_credit(
                    people,
                    pid,
                    name=_DISCOGS_NUMBER.sub("", str(credit.get("name", ""))),
                    url=f"https://www.discogs.com/artist/{pid}",
                    role=credit_role(str(credit.get("role", ""))),
                    work=work,
                )
            scanned += 1
        return Scan(people, scanned, True, discogs_id)

    # --- Genius -----------------------------------------------------------------------------

    def genius(self, http: httpx.Client, name: str) -> Scan | None:
        """Credits on an artist's most popular songs; None when no exact-name artist is found."""
        headers = {"Authorization": f"Bearer {self._genius_token}"}

        def get(path: str) -> dict[str, Any]:
            body = self._get(http, f"{self._genius_url}{path}", headers, discogs=False)
            response: dict[str, Any] = body.get("response", {}) if isinstance(body, dict) else {}
            return response

        hits = get(f"/search?q={quote(name)}").get("hits", [])
        wanted = normalize(name)
        artist = next(
            (
                h["result"]["primary_artist"]
                for h in hits
                if normalize(str(h.get("result", {}).get("primary_artist", {}).get("name", "")))
                == wanted
            ),
            None,
        )
        if not artist or not artist.get("id"):
            return None
        artist_id = str(artist["id"])
        songs = [
            s
            for s in get(f"/artists/{artist_id}/songs?sort=popularity&per_page={GENIUS_SONGS}").get(
                "songs", []
            )
            if s.get("id") and str(s.get("primary_artist", {}).get("id")) == artist_id
        ]
        people: People = {}
        deadline = self._now() + self._budget_s
        scanned = 0
        for song_ref in songs:
            if scanned and self._now() > deadline:
                return Scan(people, scanned, False, artist_id)
            try:
                song = get(f"/songs/{int(song_ref['id'])}?text_format=plain").get("song", {})
            except SourceUnavailableError:
                if not scanned:
                    raise
                return Scan(people, scanned, False, artist_id)
            date = str(song.get("release_date") or "")
            work = Work(
                title=str(song.get("title") or "Untitled song"),
                url=str(song.get("url") or ""),
                year=int(date[:4]) if date[:4].isdigit() else None,
            )

            def add(
                credited: list[dict[str, Any]] | None, role: str | None, work: Work = work
            ) -> None:
                for p in credited or []:
                    if p.get("id") and str(p["id"]) != artist_id:
                        add_credit(
                            people,
                            str(p["id"]),
                            name=str(p.get("name", "")),
                            url=str(p.get("url", "")),
                            role=role,
                            work=work,
                        )

            add(song.get("producer_artists"), "producer")
            add(song.get("writer_artists"), "songwriting")
            add(song.get("featured_artists"), "featured")
            for performance in song.get("custom_performances") or []:
                add(performance.get("artists"), credit_role(str(performance.get("label", ""))))
            scanned += 1
        return Scan(people, scanned, True, artist_id)


class Check:
    """Statuses for a source's report."""

    OK = "OK"
    PARTIAL = "PARTIAL"
    NO_KEY = "NO_KEY"
    NO_MATCH = "NO_MATCH"
    FAILED = "FAILED"


@dataclass(frozen=True)
class SourceResult:
    """What one source found for a pair of artists, and its report."""

    source: str
    status: str
    shared: tuple[Shared, ...] = ()
    direct: tuple[Work, ...] = ()
    scanned_a: int = 0
    scanned_b: int = 0


@dataclass(frozen=True)
class Pair:
    """The two artists as each source needs them."""

    name_a: str
    name_b: str
    discogs_a: str | None
    discogs_b: str | None
    albums_a: frozenset[str] = frozenset()
    albums_b: frozenset[str] = frozenset()


def more_credits(sources: CreditSources, pair: Pair) -> list[SourceResult]:
    """Runs Discogs and Genius side by side; a failing source only removes its results."""

    def run_discogs() -> SourceResult:
        if not pair.discogs_a or not pair.discogs_b:
            return SourceResult("discogs", Check.NO_MATCH)
        with sources.client() as http:
            # One after the other: both artists share Discogs' per-minute limit.
            a = sources.discogs(http, pair.discogs_a, pair.albums_a)
            b = sources.discogs(http, pair.discogs_b, pair.albums_b)
        return _result("discogs", a, b)

    def run_genius() -> SourceResult:
        if not sources.genius_enabled:
            return SourceResult("genius", Check.NO_KEY)
        with sources.client() as http, ThreadPoolExecutor(max_workers=2) as pool:
            a, b = pool.map(lambda name: sources.genius(http, name), (pair.name_a, pair.name_b))
        if a is None or b is None:
            return SourceResult("genius", Check.NO_MATCH)
        return _result("genius", a, b)

    results: list[SourceResult] = []
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [("discogs", pool.submit(run_discogs)), ("genius", pool.submit(run_genius))]
        for source, future in futures:
            try:
                results.append(future.result())
            except (
                SourceUnavailableError,
                httpx.HTTPError,
                KeyError,
                TypeError,
                ValueError,
            ) as error:
                log.warning(
                    "more credits source failed", extra={"source": source, "error": str(error)}
                )
                results.append(SourceResult(source, Check.FAILED))
    return results


def _result(source: str, a: Scan, b: Scan) -> SourceResult:
    return SourceResult(
        source=source,
        status=Check.OK if a.complete and b.complete else Check.PARTIAL,
        shared=tuple(
            common_people(source, a.people, b.people, (a.source_artist_id, b.source_artist_id))
        ),
        direct=tuple(direct_work(a.people, b.people, a.source_artist_id, b.source_artist_id)),
        scanned_a=a.scanned,
        scanned_b=b.scanned,
    )
