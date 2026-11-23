"""CompareRecordingSound: the sound & lyrics comparison of two songs, from the song_compare service.

song_compare (``song_compare/``, a Flask API) holds a 2022 dataset of about 76,000 songs with
Spotify audio features and an analysis of their Genius lyrics. It knows songs by its own IDs, so
each of our recordings is matched to it by title and primary artist (``/api/match``); then
``/api/compare`` explains how alike the two are and ``/api/similar`` finds songs that sound like
each. Songs it lacks are reported, never guessed.

A similar song links back to our catalog only when its artist resolves to one catalog artist
unambiguously and that artist has a song with the same title (``catalog_titles``, the rule the
link resolver uses). Only titles and artist names are sent; nothing about the listener.

The service may be missing (no ``song_compare_url``), asleep (a serverless cold start) or down:
any of those answers UNAVAILABLE, so the rest of the song comparison still shows. Results other
than UNAVAILABLE are cached per catalog version.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx
from pydantic import BaseModel, ConfigDict, ValidationError

from songnexus.core.search import EntityType
from songnexus.core.text import base_title
from songnexus.service import schemas_sound as api
from songnexus.service.link_resolver import catalog_artists, catalog_titles
from songnexus.service.readmodel import ReadModel

log = logging.getLogger(__name__)

SIMILAR_PER_SONG = 4
SEARCH_ASK = 25  # dataset hits asked for; fewer are in the catalog
CACHE_SIZE = 1024
CACHE_TTL_S = 6 * 3600
SOURCES = ["dataSources/kaggle-spotify-tracks", "dataSources/genius-lyrics-dataset"]
# The service's feature names, in the order the app shows them.
FEATURES = {
    "energy": api.SoundFeature.ENERGY,
    "danceability": api.SoundFeature.DANCEABILITY,
    "valence": api.SoundFeature.VALENCE,
    "acousticness": api.SoundFeature.ACOUSTICNESS,
    "speechiness": api.SoundFeature.SPEECHINESS,
    "liveness": api.SoundFeature.LIVENESS,
    "instrumentalness": api.SoundFeature.INSTRUMENTALNESS,
}
SAME_TRACK_ERROR = "Pick two different songs."


@dataclass(frozen=True)
class SongName:
    """What the service is asked to match: a title and the song's first primary artist."""

    recording: str  # `recordings/{id}`, reported back when the dataset lacks the song
    title: str
    artist: str


# --- The service's JSON (only the fields used; anything else is ignored) ----------------------


class _Upstream(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)


class _Brief(_Upstream):
    id: str
    title: str
    artists: list[str]
    album: str | None = None
    genre: str | None = None


class _Sentiment(_Upstream):
    compound: float


class _LyricStructure(_Upstream):
    verses: int
    choruses: int
    bridges: int
    words: int
    repetition: float


class _Lyrics(_Upstream):
    sentiment: _Sentiment
    top_emotion: str
    top_themes: list[str]
    structure: _LyricStructure


class _Track(_Brief):
    tempo: float
    key_name: str
    time_signature: int | None = None
    duration_ms: int
    audio: dict[str, float]
    lyrics: _Lyrics | None = None


class _AudioScore(_Upstream):
    score: float


class _LyricScore(_Upstream):
    score: float
    semantic: float
    vocabulary: float
    themes: float
    sentiment: float
    shared_themes: list[str]


class _Tempo(_Upstream):
    half_double_match: bool


class _Key(_Upstream):
    relation: str


class _Structure(_Upstream):
    tempo: _Tempo
    key: _Key


class _Comparison(_Upstream):
    a: _Track
    b: _Track
    overall: float
    audio: _AudioScore
    lyrics: _LyricScore | None = None
    structure: _Structure
    reasons: list[str]


class _Similar(_Brief):
    score: float
    shares_artist: bool


class _Match(_Upstream):
    track: _Brief


class _SimilarList(_Upstream):
    results: list[_Similar]


# --- Client -----------------------------------------------------------------------------------


class _SearchHit(_Brief):
    has_lyrics: bool = False


class _SearchList(_Upstream):
    results: list[_SearchHit] = []


class _UnavailableError(Exception):
    """The service is missing, unreachable or answered with something unusable."""


class _SameTrackError(Exception):
    """The service says both songs are the same track."""


def _unit(value: float) -> float:
    return round(min(1.0, max(0.0, value)), 4)


class SoundCompareClient:
    """Asks the song_compare service to compare two songs."""

    def __init__(
        self,
        base_url: str,
        *,
        timeout_s: float,
        http: Callable[[], httpx.Client],
        now: Callable[[], float] = time.monotonic,
    ) -> None:
        """Creates a client; an empty ``base_url`` means the service isn't configured."""
        self._base_url = base_url.strip().rstrip("/")
        self._timeout = httpx.Timeout(timeout_s, connect=min(5.0, timeout_s))
        self._http = http
        self._now = now
        self._cache: OrderedDict[tuple[str, ...], tuple[float, api.CompareSoundResponse]] = (
            OrderedDict()
        )
        self._lock = threading.Lock()
        self._search_cache: OrderedDict[tuple[str, ...], tuple[float, api.SearchSoundResponse]] = (
            OrderedDict()
        )

    @property
    def configured(self) -> bool:
        """Whether a service URL is set."""
        return bool(self._base_url)

    def compare(self, model: ReadModel, a: SongName, b: SongName) -> api.CompareSoundResponse:
        """Matches both songs in the dataset, compares them and finds songs like each."""
        if not self.configured:
            return api.CompareSoundResponse(status=api.SoundStatus.UNAVAILABLE)
        key = (model.version, a.title, a.artist, b.title, b.artist)
        cached = self._cached(key)
        if cached is not None:
            return cached
        try:
            with self._http() as http:
                result = self._compare(http, model, a, b)
        except _SameTrackError:
            result = api.CompareSoundResponse(status=api.SoundStatus.SAME_TRACK, sources=SOURCES)
        except _UnavailableError:
            return api.CompareSoundResponse(status=api.SoundStatus.UNAVAILABLE)
        self._store(key, result)
        return result

    def _compare(
        self, http: httpx.Client, model: ReadModel, a: SongName, b: SongName
    ) -> api.CompareSoundResponse:
        with ThreadPoolExecutor(max_workers=3) as pool:
            matches = list(pool.map(lambda song: self._match(http, song), (a, b)))
            missing = [song.recording for song, m in zip((a, b), matches, strict=True) if m is None]
            if missing:
                return api.CompareSoundResponse(
                    status=api.SoundStatus.NOT_FOUND, missing=missing, sources=SOURCES
                )
            ma, mb = (m for m in matches if m is not None)
            if ma.id == mb.id:
                raise _SameTrackError
            ids = quote(ma.id, safe=""), quote(mb.id, safe="")
            compared = pool.submit(self._get, http, f"/api/compare?a={ids[0]}&b={ids[1]}")
            similar = [
                pool.submit(self._get, http, f"/api/similar/{i}?k={SIMILAR_PER_SONG}") for i in ids
            ]
            raw = compared.result()
            similar_raw = [s.result() for s in similar]
        if raw is None:
            raise _UnavailableError
        comparison = self._parse(_Comparison, raw)
        lists = [[] if s is None else self._parse(_SimilarList, s).results for s in similar_raw]
        return api.CompareSoundResponse(
            status=api.SoundStatus.OK,
            comparison=_comparison(comparison),
            similar_a=[_similar(model, s) for s in lists[0]],
            similar_b=[_similar(model, s) for s in lists[1]],
            sources=SOURCES,
        )

    def search(self, model: ReadModel, query: str, limit: int) -> api.SearchSoundResponse:
        """Dataset songs matching ``query`` that our catalog also has, most popular first."""
        if not self.configured:
            return api.SearchSoundResponse(status=api.SoundStatus.UNAVAILABLE)
        key = (model.version, "search", query.casefold(), str(limit))
        cached = self._cached_search(key)
        if cached is not None:
            return cached
        try:
            with self._http() as http:
                raw = self._get(http, f"/api/search?q={quote(query, safe='')}&limit={SEARCH_ASK}")
        except _UnavailableError:
            return api.SearchSoundResponse(status=api.SoundStatus.UNAVAILABLE)
        found = [] if raw is None else self._parse(_SearchList, raw).results
        hits = []
        for song in found:
            artists = catalog_artists(model, song.artists[:1])
            titles = (
                catalog_titles(model, song.title, EntityType.RECORDING, artists) if artists else []
            )
            if titles:
                hits.append(
                    api.SoundSearchHit(
                        recording=f"recordings/{titles[0]}",
                        title=song.title,
                        artists=song.artists,
                        genre=song.genre,
                        has_lyrics=song.has_lyrics,
                    )
                )
        result = api.SearchSoundResponse(status=api.SoundStatus.OK, results=hits[:limit])
        with self._lock:
            self._search_cache[key] = (self._now(), result)
            while len(self._search_cache) > CACHE_SIZE:
                self._search_cache.popitem(last=False)
        return result

    def _cached_search(self, key: tuple[str, ...]) -> api.SearchSoundResponse | None:
        with self._lock:
            hit = self._search_cache.get(key)
            if hit and self._now() - hit[0] < CACHE_TTL_S:
                return hit[1]
        return None

    def _match(self, http: httpx.Client, song: SongName) -> _Brief | None:
        title = base_title(song.title)
        found = self._get(
            http, f"/api/match?title={quote(title, safe='')}&artist={quote(song.artist, safe='')}"
        )
        return None if found is None else self._parse(_Match, found).track

    def _get(self, http: httpx.Client, path: str) -> Any:
        """The JSON at ``path``; None for a 404 (not in the dataset)."""
        try:
            response = http.get(f"{self._base_url}{path}", timeout=self._timeout)
        except httpx.HTTPError as error:
            log.warning("song_compare unreachable", extra={"error": type(error).__name__})
            raise _UnavailableError from error
        if response.status_code == HTTPStatus.NOT_FOUND:
            return None
        if response.status_code == HTTPStatus.BAD_REQUEST and _error(response) == SAME_TRACK_ERROR:
            raise _SameTrackError
        if response.status_code != HTTPStatus.OK:
            log.warning("song_compare error", extra={"status": response.status_code})
            raise _UnavailableError
        try:
            return response.json()
        except ValueError as error:
            raise _UnavailableError from error

    @staticmethod
    def _parse[T: _Upstream](model: type[T], body: Any) -> T:
        try:
            return model.model_validate(body)
        except ValidationError as error:
            log.warning(
                "song_compare answered an unexpected shape", extra={"model": model.__name__}
            )
            raise _UnavailableError from error

    def _cached(self, key: tuple[str, ...]) -> api.CompareSoundResponse | None:
        with self._lock:
            hit = self._cache.get(key)
            if hit is None:
                return None
            stored_at, value = hit
            if self._now() - stored_at > CACHE_TTL_S:
                del self._cache[key]
                return None
            self._cache.move_to_end(key)
            return value

    def _store(self, key: tuple[str, ...], value: api.CompareSoundResponse) -> None:
        with self._lock:
            self._cache[key] = (self._now(), value)
            self._cache.move_to_end(key)
            while len(self._cache) > CACHE_SIZE:
                self._cache.popitem(last=False)


def _error(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return ""
    return str(body.get("error", "")) if isinstance(body, dict) else ""


def _track(track: _Track) -> api.SoundTrack:
    lyrics = track.lyrics
    return api.SoundTrack(
        title=track.title,
        artists=track.artists,
        album=track.album,
        genre=track.genre,
        tempo_bpm=round(track.tempo, 1),
        key=track.key_name,
        time_signature=track.time_signature,
        duration_ms=track.duration_ms,
        features=[
            api.FeatureValue(feature=feature, value=_unit(track.audio[name]))
            for name, feature in FEATURES.items()
            if name in track.audio
        ],
        lyrics=None
        if lyrics is None
        else api.LyricProfile(
            top_emotion=lyrics.top_emotion,
            sentiment=round(min(1.0, max(-1.0, lyrics.sentiment.compound)), 4),
            top_themes=lyrics.top_themes,
            structure=api.LyricStructure(
                verses=lyrics.structure.verses,
                choruses=lyrics.structure.choruses,
                bridges=lyrics.structure.bridges,
                words=lyrics.structure.words,
                repetition=_unit(lyrics.structure.repetition),
            ),
        ),
    )


def _comparison(c: _Comparison) -> api.SoundComparison:
    lyrics = c.lyrics
    return api.SoundComparison(
        track_a=_track(c.a),
        track_b=_track(c.b),
        similarity=_unit(c.overall),
        sound_similarity=_unit(c.audio.score),
        lyric_similarity=None
        if lyrics is None
        else api.LyricSimilarity(
            score=_unit(lyrics.score),
            meaning=_unit(lyrics.semantic),
            shared_words=_unit(lyrics.vocabulary),
            themes=_unit(lyrics.themes),
            sentiment=_unit(lyrics.sentiment),
            shared_themes=lyrics.shared_themes,
        ),
        structure=api.SoundStructure(
            half_or_double_time=c.structure.tempo.half_double_match,
            key_relation=c.structure.key.relation,
        ),
        # The service says "valence"; the app calls it positivity, so the reasons do too.
        reasons=[r.replace("valence", "positivity") for r in c.reasons],
    )


def _similar(model: ReadModel, song: _Similar) -> api.SimilarSong:
    artists = catalog_artists(model, song.artists[:1])
    hits = catalog_titles(model, song.title, EntityType.RECORDING, artists) if artists else []
    return api.SimilarSong(
        title=song.title,
        artists=song.artists,
        genre=song.genre,
        similarity=_unit(song.score),
        shares_artist=song.shares_artist,
        recording=f"recordings/{hits[0]}" if hits else None,
    )
