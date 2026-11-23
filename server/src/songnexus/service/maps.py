"""Similar-music maps and playlist maps (the Connection Web's "Similar" and "My playlist" modes).

Ported from the team app's similar-music Connection Web and Friends playlist maps. Similarity
comes from listening data, never from credits:

* **Artists**: the ListenBrainz co-listening the catalog stores (who people play in the same
  listening sessions, CC0), scored relative to the closest match. Shared catalog genres are
  given as a further reason, never as the measure.
* **Songs**: ListenBrainz's session-based similar recordings, asked live (CC0, no key) for an
  artist's best-known songs or for one song, cached in memory for a day. Songs outside the
  catalog still show, linked to MusicBrainz.
* **Playlists**: artist names are matched to the catalog exactly as AnalyzePlaylist does; nothing
  sent is stored (rooms store the two playlists for a week; see ``storage.taste_rooms``).

Everything returned says why it is there (``MapReason``), so the client can explain a distance.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from collections import OrderedDict
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from itertools import pairwise
from typing import Any

import httpx
from sqlalchemy.orm import Session

from songnexus.core.graph.model import ArtistGraph
from songnexus.core.resolution import Decision
from songnexus.core.text import normalize
from songnexus.service import convert
from songnexus.service import schemas_maps as api
from songnexus.service.readmodel import ReadModel
from songnexus.service.schemas import PlaylistTrack
from songnexus.storage import maps_repository as repo

log = logging.getLogger(__name__)

LABS = "https://labs.api.listenbrainz.org"
SONG_ALGORITHM = "session_based_days_9000_session_300_contribution_5_threshold_15_limit_50_skip_30"
LISTENBRAINZ = "listenbrainz"

SIMILAR_ARTISTS = 30
LINK_SOURCES = 10  # the closest few get lines to each other
LINKS_PER_ARTIST = 5
SIMILAR_SONGS = 24
SONGS_PER_ARTIST = 2
SEED_SONGS = 5
ENOUGH_SONGS = 12
SHARED_GENRES_SHOWN = 3

# Playlist maps.
ARTISTS_TO_CHECK = 15
SIMILAR_DEPTH = 15  # how far down an artist's co-listening list still counts as close
SHOWN_ARTISTS = 14
SHOWN_SONGS = 8
SHOWN_NEW = 12
RECOMMENDED_LINKS = 3
MAX_REASON_NAMES = 4

CACHE_SIZE = 2048
CACHE_TTL_S = 24 * 3600
TIMEOUT_S = 8.0

_VERSION = re.compile(r"\s*[(\[].*?[)\]]|\s+-\s+.*$")
_LEAD = re.compile(r"\s*(?:,|&|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|\bx\b)\s*", re.IGNORECASE)


def lead_of(credit: str) -> str:
    """The first name in an artist credit ("A feat. B" -> "A")."""
    return _LEAD.split(credit.strip(), maxsplit=1)[0].strip() or credit.strip()


def song_key(title: str, artist: str) -> str:
    """One key for every version of a song (live, remix, "- Remastered") by one lead artist."""
    return f"{normalize(_VERSION.sub('', title))}|{normalize(lead_of(artist))}"


def _rounded(value: float) -> float:
    return round(max(0.0, min(1.0, value)), 3)


def _source(status: api.MapSourceStatus, source: str = LISTENBRAINZ) -> api.MapSource:
    return api.MapSource(source=source, status=status)


def _artist_node(
    graph: ArtistGraph,
    artist_id: str,
    *,
    similarity: float,
    group: api.MapGroup,
    reasons: Sequence[api.MapReason] = (),
    weight: float = 1.0,
) -> api.MapNode:
    node = graph.nodes[artist_id]
    genre = node.genres[0].name if node.genres else ""
    return api.MapNode(
        id=f"artists/{artist_id}",
        kind=api.MapNodeKind.ARTIST,
        display_name=node.name,
        subtitle=genre,
        artist=f"artists/{artist_id}",
        image_url=convert.image_url(graph, artist_id),
        similarity=_rounded(similarity),
        group=group,
        weight=weight,
        listeners=graph.listeners.get(artist_id),
        reasons=list(reasons),
    )


def shared_genres(graph: ArtistGraph, a: str, b: str) -> list[str]:
    """Genre names both artists carry, in ``a``'s order."""
    theirs = {g.genre_id for g in graph.nodes[b].genres}
    return [g.name for g in graph.nodes[a].genres if g.genre_id in theirs][:SHARED_GENRES_SHOWN]


# --- Similar artists ---------------------------------------------------------------------------


@dataclass
class ArtistNeighbors:
    """An artist's similar artists, their links to each other, and the source status."""

    nodes: list[api.MapNode]
    links: list[api.MapLink]
    status: api.MapSourceStatus


def similar_artists(
    session: Session, graph: ArtistGraph, artist_id: str, *, via: str | None = None
) -> ArtistNeighbors:
    """The artists people play with ``artist_id``, closest first, scored against the closest.

    ``via`` names what the listeners played when it was not the artist itself (a song).
    """
    rows = [
        (other, score)
        for other, score in repo.colistening(session, [artist_id], SIMILAR_ARTISTS * 2)[artist_id]
        if other in graph.nodes and other != artist_id
    ][:SIMILAR_ARTISTS]
    if not rows:
        return ArtistNeighbors([], [], api.MapSourceStatus.NO_MATCH)
    top = max(score for _, score in rows) or 1.0
    played = via or graph.nodes[artist_id].name
    nodes = []
    for other, score in rows:
        reasons = [
            api.MapReason(
                kind=api.ReasonKind.CO_LISTENED,
                artists=[played],
                source_url="https://listenbrainz.org/explore/similar-artists/",
            )
        ]
        if genres := shared_genres(graph, artist_id, other):
            reasons.append(api.MapReason(kind=api.ReasonKind.SHARED_GENRES, genres=genres))
        nodes.append(
            _artist_node(
                graph, other, similarity=score / top, group=api.MapGroup.SIMILAR, reasons=reasons
            )
        )
    ids = [other for other, _ in rows]
    on_map = set(ids)
    links: dict[tuple[str, str], api.MapLink] = {}
    for source, others in repo.colistening(session, ids[:LINK_SOURCES], SIMILAR_ARTISTS).items():
        for other, _ in [o for o in others if o[0] in on_map][:LINKS_PER_ARTIST]:
            a, b = sorted((f"artists/{source}", f"artists/{other}"))
            links[(a, b)] = api.MapLink(a=a, b=b, kind=api.MapLinkKind.CO_LISTENED)
    return ArtistNeighbors(nodes, list(links.values()), api.MapSourceStatus.OK)


# --- Similar songs (live) ----------------------------------------------------------------------


@dataclass
class SimilarRecordingsClient:
    """ListenBrainz Labs' similar recordings, cached in memory for a day."""

    http: Callable[[], httpx.Client]
    base_url: str = LABS
    now: Callable[[], float] = time.monotonic
    _cache: OrderedDict[str, tuple[float, list[dict[str, Any]]]] = field(
        default_factory=OrderedDict
    )
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def similar(self, mbid: str) -> list[dict[str, Any]]:
        """Rows for one MusicBrainz recording.

        Raises:
            httpx.HTTPError: The request failed (nothing is cached).
        """
        with self._lock:
            hit = self._cache.get(mbid)
            if hit and self.now() - hit[0] < CACHE_TTL_S:
                self._cache.move_to_end(mbid)
                return hit[1]
        with self.http() as http:
            response = http.get(
                f"{self.base_url}/similar-recordings/json",
                params={"recording_mbids": mbid, "algorithm": SONG_ALGORITHM},
                timeout=TIMEOUT_S,
            )
            response.raise_for_status()
            body = response.json()
        rows = [r for r in body if isinstance(r, dict)] if isinstance(body, list) else []
        with self._lock:
            self._cache[mbid] = (self.now(), rows)
            while len(self._cache) > CACHE_SIZE:
                self._cache.popitem(last=False)
        return rows


@dataclass(frozen=True)
class SongCandidate:
    """A similar song as ListenBrainz lists it."""

    mbid: str
    title: str
    credit: str
    similarity: float
    cover: str | None


def song_candidates(
    rows: Iterable[dict[str, Any]], seen: Iterable[str], seen_artist: str = ""
) -> list[SongCandidate]:
    """Similar songs, closest first: one version of each song, at most two per lead artist.

    ``seen`` holds song keys already on the map (the seeds among them); ``seen_artist`` is the
    seed's own lead artist, whose other songs are left to the artist map.
    """
    ordered = sorted(rows, key=lambda r: -float(r.get("score") or 0))
    top = max((float(r.get("score") or 0) for r in ordered), default=0.0) or 1.0
    keys = set(seen)
    per_artist: dict[str, int] = {}
    out: list[SongCandidate] = []
    for row in ordered:
        mbid, title = row.get("recording_mbid"), row.get("recording_name")
        if not isinstance(mbid, str) or not isinstance(title, str) or not title.strip():
            continue
        credit = str(row.get("artist_credit_name") or "")
        lead = normalize(lead_of(credit))
        key = song_key(title, credit)
        if key in keys or per_artist.get(lead, 0) >= SONGS_PER_ARTIST:
            continue
        if seen_artist and lead == normalize(seen_artist):
            continue
        keys.add(key)
        per_artist[lead] = per_artist.get(lead, 0) + 1
        caa, release = row.get("caa_id"), row.get("caa_release_mbid")
        cover = (
            f"https://coverartarchive.org/release/{release}/{caa}-250.jpg"
            if caa and isinstance(release, str)
            else None
        )
        out.append(
            SongCandidate(mbid, title.strip(), credit, float(row.get("score") or 0) / top, cover)
        )
    return out


def song_nodes(
    session: Session,
    model: ReadModel,
    candidates: Sequence[SongCandidate],
    played: str,
) -> list[api.MapNode]:
    """Map nodes for similar songs; catalog songs link to their pages."""
    catalog = repo.recordings_by_musicbrainz_id(session, [c.mbid for c in candidates])
    nodes = []
    for c in candidates:
        recording = catalog.get(c.mbid)
        cover = c.cover or (model.recording_covers.get(recording) if recording else None)
        nodes.append(
            api.MapNode(
                id=f"recordings/{recording}" if recording else f"musicbrainz/recordings/{c.mbid}",
                kind=api.MapNodeKind.SONG,
                display_name=c.title,
                subtitle=c.credit,
                recording=f"recordings/{recording}" if recording else None,
                image_url=cover,
                similarity=_rounded(c.similarity),
                reasons=[
                    api.MapReason(
                        kind=api.ReasonKind.CO_LISTENED,
                        artists=[played],
                        source_url=f"https://musicbrainz.org/recording/{c.mbid}",
                    )
                ],
                source_url=f"https://musicbrainz.org/recording/{c.mbid}",
            )
        )
    return nodes


def performed_links(nodes: Iterable[api.MapNode]) -> list[api.MapLink]:
    """A line from each song to its lead artist when that artist is on the map."""
    artists = {normalize(n.display_name): n.id for n in nodes if n.kind is api.MapNodeKind.ARTIST}
    links = []
    for n in nodes:
        if n.kind is not api.MapNodeKind.SONG:
            continue
        artist = artists.get(normalize(lead_of(n.subtitle)))
        if artist:
            links.append(api.MapLink(a=artist, b=n.id, kind=api.MapLinkKind.PERFORMED))
    return links


def similar_songs_for(
    session: Session,
    model: ReadModel,
    client: SimilarRecordingsClient,
    seeds: Sequence[tuple[str, str]],
    lead: str,
) -> tuple[list[api.MapNode], api.MapSourceStatus]:
    """Similar songs from the first seeds (catalog recording, title) that have listening data."""
    mbids = repo.musicbrainz_ids(session, "recording", [rid for rid, _ in seeds])
    seen = {song_key(title, lead) for _, title in seeds}
    found: list[SongCandidate] = []
    failed = asked = 0
    played = ""
    for rid, title in seeds:
        mbid = mbids.get(rid)
        if not mbid:
            continue
        asked += 1
        try:
            rows = client.similar(mbid)
        except (httpx.HTTPError, ValueError) as error:
            log.warning("similar recordings failed", extra={"error": type(error).__name__})
            failed += 1
            continue
        fresh = song_candidates(rows, seen | {song_key(c.title, c.credit) for c in found}, lead)
        if fresh and not played:
            played = title
        found = sorted([*found, *fresh], key=lambda c: -c.similarity)[:SIMILAR_SONGS]
        if len(found) >= ENOUGH_SONGS:
            break
    if not asked:
        status = api.MapSourceStatus.NO_MATCH
    elif failed == asked:
        status = api.MapSourceStatus.UNAVAILABLE
    else:
        status = api.MapSourceStatus.PARTIAL if failed else api.MapSourceStatus.OK
    return song_nodes(session, model, found, f"{played} ({lead})" if played else lead), status


# --- Maps around an artist or a song -----------------------------------------------------------


def artist_map(
    session: Session, model: ReadModel, client: SimilarRecordingsClient, artist_id: str
) -> api.SimilarMap:
    """Similar artists and songs around an artist."""
    graph = model.graph
    neighbors = similar_artists(session, graph, artist_id)
    lead = graph.nodes[artist_id].name
    songs, song_status = similar_songs_for(
        session, model, client, repo.top_recordings(session, artist_id, SEED_SONGS), lead
    )
    center = _artist_node(graph, artist_id, similarity=1.0, group=api.MapGroup.CENTER)
    nodes = [*neighbors.nodes, *songs]
    return api.SimilarMap(
        center=center,
        nodes=nodes,
        links=[*neighbors.links, *performed_links([center, *nodes])],
        sources=[_source(_worst(neighbors.status, song_status))],
    )


def song_map(
    session: Session,
    model: ReadModel,
    client: SimilarRecordingsClient,
    recording_id: str,
    title: str,
) -> api.SimilarMap:
    """Similar songs around a song, and the artists people play with its lead artist."""
    graph = model.graph
    leads = list(repo.primary_artists(session, [recording_id]).get(recording_id, []))
    lead_id = next((a for a in leads if a in graph.nodes), None)
    lead = graph.nodes[lead_id].name if lead_id else ""
    songs, song_status = similar_songs_for(session, model, client, [(recording_id, title)], lead)
    neighbors = (
        similar_artists(session, graph, lead_id, via=f"{title} ({lead})")
        if lead_id
        else ArtistNeighbors([], [], api.MapSourceStatus.NO_MATCH)
    )
    center = api.MapNode(
        id=f"recordings/{recording_id}",
        kind=api.MapNodeKind.SONG,
        display_name=title,
        subtitle=", ".join(graph.nodes[a].name for a in leads if a in graph.nodes),
        recording=f"recordings/{recording_id}",
        image_url=model.recording_covers.get(recording_id),
        similarity=1.0,
        group=api.MapGroup.CENTER,
    )
    nodes = [*songs, *neighbors.nodes]
    return api.SimilarMap(
        center=center,
        nodes=nodes,
        links=[*neighbors.links, *performed_links(nodes)],
        sources=[_source(_worst(song_status, neighbors.status))],
    )


def _worst(*statuses: api.MapSourceStatus) -> api.MapSourceStatus:
    """One status for several lookups: OK if any found something, noting any that failed."""
    s = set(statuses)
    failed = bool(s & {api.MapSourceStatus.UNAVAILABLE, api.MapSourceStatus.PARTIAL})
    if api.MapSourceStatus.OK in s:
        return api.MapSourceStatus.PARTIAL if failed else api.MapSourceStatus.OK
    if api.MapSourceStatus.PARTIAL in s:
        return api.MapSourceStatus.PARTIAL
    if api.MapSourceStatus.UNAVAILABLE in s:
        return api.MapSourceStatus.UNAVAILABLE
    return api.MapSourceStatus.NO_MATCH


# --- Two artists ------------------------------------------------------------------------------

COMPARE_PER_SIDE = 18


def compare_map(
    session: Session, graph: ArtistGraph, a: str, b: str, path: Sequence[str]
) -> api.CompareMap:
    """Two artists, the credit path between them, and who listeners play with each or both.

    The team app's two-artist Connection Web (Helen): the pair at either end, documented
    credits along the middle, and the artists around each, closest first, so zooming in
    reveals more of them.
    """
    rows = repo.colistening(session, [a, b], COMPARE_PER_SIDE * 2)
    scores = {side: {o: s for o, s in rows[side] if o in graph.nodes} for side in (a, b)}
    tops = {side: max(scores[side].values(), default=0.0) or 1.0 for side in (a, b)}
    names = {side: graph.nodes[side].name for side in (a, b)}
    on_path = [p for p in path if p in graph.nodes]
    taken = {a, b, *on_path}
    nodes = [
        _artist_node(graph, a, similarity=1.0, group=api.MapGroup.CENTER),
        _artist_node(graph, b, similarity=1.0, group=api.MapGroup.CENTER),
    ]
    links: list[api.MapLink] = []
    for step in on_path[1:-1]:
        nodes.append(
            _artist_node(
                graph,
                step,
                similarity=1.0,
                group=api.MapGroup.SHARED,
                weight=3,
                reasons=[
                    api.MapReason(kind=api.ReasonKind.CREDIT_PATH, artists=[names[a], names[b]])
                ],
            )
        )
    for x, y in pairwise(on_path):
        links.append(api.MapLink(a=f"artists/{x}", b=f"artists/{y}", kind=api.MapLinkKind.CREDIT))

    def both_score(o: str) -> float:
        return (scores[a][o] / tops[a] + scores[b][o] / tops[b]) / 2

    both = sorted((o for o in scores[a] if o in scores[b] and o not in taken), key=both_score)
    for other in list(reversed(both))[:COMPARE_PER_SIDE]:
        taken.add(other)
        nodes.append(
            _artist_node(
                graph,
                other,
                similarity=both_score(other),
                group=api.MapGroup.SHARED,
                weight=2,
                reasons=[
                    api.MapReason(kind=api.ReasonKind.CO_LISTENED, artists=[names[a], names[b]])
                ],
            )
        )
        for side in (a, b):
            links.append(
                api.MapLink(
                    a=f"artists/{side}",
                    b=f"artists/{other}",
                    kind=api.MapLinkKind.SIMILAR,
                    strength=_rounded(scores[side][other] / tops[side]),
                )
            )
    for side, group in ((a, api.MapGroup.MINE), (b, api.MapGroup.THEIRS)):
        ranked = sorted((o for o in scores[side] if o not in taken), key=lambda o: -scores[side][o])
        for other in ranked[:COMPARE_PER_SIDE]:
            taken.add(other)
            similarity = scores[side][other] / tops[side]
            reasons = [api.MapReason(kind=api.ReasonKind.CO_LISTENED, artists=[names[side]])]
            if genres := shared_genres(graph, side, other):
                reasons.append(api.MapReason(kind=api.ReasonKind.SHARED_GENRES, genres=genres))
            nodes.append(
                _artist_node(graph, other, similarity=similarity, group=group, reasons=reasons)
            )
            links.append(
                api.MapLink(
                    a=f"artists/{side}",
                    b=f"artists/{other}",
                    kind=api.MapLinkKind.SIMILAR,
                    strength=_rounded(similarity),
                )
            )
    found = bool(scores[a] or scores[b])
    return api.CompareMap(
        nodes=nodes,
        links=links,
        path=[f"artists/{p}" for p in on_path],
        sources=[_source(api.MapSourceStatus.OK if found else api.MapSourceStatus.NO_MATCH)],
    )


# --- Playlist maps -----------------------------------------------------------------------------


@dataclass
class ShelfArtist:
    """One artist on a playlist: their name as written (or the catalog's) and their songs."""

    name: str
    songs: list[PlaylistTrack] = field(default_factory=list)


@dataclass
class Shelf:
    """A playlist grouped by lead artist, one entry per song (versions count once)."""

    artists: dict[str, ShelfArtist] = field(default_factory=dict)
    songs: dict[str, PlaylistTrack] = field(default_factory=dict)


def shelf_of(tracks: Iterable[PlaylistTrack], graph: ArtistGraph | None = None) -> Shelf:
    """Groups tracks by their lead artist's normalized name (``artists/{id}`` picks resolve)."""
    shelf = Shelf()
    for track in tracks:
        lead = track.artists[0].strip()
        if lead.startswith("artists/") and graph is not None:
            node = graph.nodes.get(lead.removeprefix("artists/"))
            lead = node.name if node else ""
        lead = lead_of(lead)
        key = song_key(track.title or lead, lead)
        artist_key = normalize(lead)
        if not artist_key or key in shelf.songs:
            continue
        shelf.songs[key] = track
        shelf.artists.setdefault(artist_key, ShelfArtist(lead)).songs.append(track)
    return shelf


def _names(names: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(names))[:MAX_REASON_NAMES]


def _top_keys(shelf: Shelf, count: int) -> list[str]:
    ranked = sorted(shelf.artists.items(), key=lambda kv: -len(kv[1].songs))
    return [key for key, _ in ranked[:count]]


@dataclass
class TasteInputs:
    """What a playlist map is built from, so it can be built and tested without a database."""

    mine: Shelf
    friend: Shelf | None
    catalog_ids: dict[str, str]  # artist key -> catalog artist ID (exact matches only)
    similar_to: dict[str, list[str]]  # artist key -> catalog IDs people play with them


def build_taste_map(graph: ArtistGraph, inputs: TasteInputs) -> api.TasteMap:  # noqa: PLR0912, PLR0915
    """The map itself: what each playlist holds, what they share, and what to try next."""
    mine, friend = inputs.mine, inputs.friend
    theirs = friend or Shelf()
    has_friend = friend is not None
    by_id = {cid: key for key, cid in inputs.catalog_ids.items()}

    def close(a_key: str, b_key: str) -> bool:
        a_id, b_id = inputs.catalog_ids.get(a_key), inputs.catalog_ids.get(b_key)
        return bool(
            (b_id and b_id in inputs.similar_to.get(a_key, []))
            or (a_id and a_id in inputs.similar_to.get(b_key, []))
        )

    def close_to(key: str, shelf: Shelf) -> list[str]:
        return [
            entry.name
            for other, entry in shelf.artists.items()
            if other != key and close(key, other)
        ]

    nodes: list[api.MapNode] = []
    links: dict[tuple[str, str], api.MapLink] = {}

    def link(a: str, b: str, kind: api.MapLinkKind) -> None:
        pair = (a, b) if a < b else (b, a)
        links.setdefault(pair, api.MapLink(a=pair[0], b=pair[1], kind=kind))

    def node_id(key: str) -> str:
        cid = inputs.catalog_ids.get(key)
        return f"artists/{cid}" if cid else f"playlist/artists/{key}"

    def add_artist(
        key: str, name: str, group: api.MapGroup, weight: float, reasons: list[api.MapReason]
    ) -> None:
        cid = inputs.catalog_ids.get(key)
        if cid and cid in graph.nodes:
            node = _artist_node(
                graph, cid, similarity=1.0, group=group, reasons=reasons, weight=weight
            )
        else:
            node = api.MapNode(
                id=node_id(key),
                kind=api.MapNodeKind.ARTIST,
                display_name=name,
                similarity=1.0,
                group=group,
                weight=weight,
                reasons=reasons,
            )
        nodes.append(node)

    shared = [k for k in mine.artists if k in theirs.artists]
    shared_set = set(shared)
    for key in shared:
        m_entry, t_entry = mine.artists[key], theirs.artists[key]
        add_artist(
            key,
            m_entry.name,
            api.MapGroup.SHARED,
            len(m_entry.songs) + len(t_entry.songs),
            [
                api.MapReason(
                    kind=api.ReasonKind.ON_BOTH,
                    count=len(m_entry.songs),
                    other_count=len(t_entry.songs),
                )
            ],
        )

    def ranked(shelf: Shelf) -> list[tuple[str, ShelfArtist]]:
        rows = [(k, e) for k, e in shelf.artists.items() if k not in shared_set]
        return sorted(rows, key=lambda kv: -len(kv[1].songs))[:SHOWN_ARTISTS]

    for side, shelf, other in ((False, mine, theirs), (True, theirs, mine)):
        if side and not has_friend:
            break
        for key, entry in ranked(shelf):
            near = close_to(key, other) if has_friend else []
            group = (
                (api.MapGroup.FOR_ME if side else api.MapGroup.FOR_THEM)
                if near
                else (api.MapGroup.THEIRS if side else api.MapGroup.MINE)
            )
            reasons = [
                api.MapReason(kind=api.ReasonKind.ON_PLAYLIST, count=len(entry.songs), theirs=side)
            ]
            if near:
                reasons.append(
                    api.MapReason(
                        kind=api.ReasonKind.CLOSE_TO_OTHER, artists=_names(near), theirs=not side
                    )
                )
            add_artist(key, entry.name, group, len(entry.songs), reasons)
    on_map = {n.id for n in nodes}

    # Lines between playlist artists that listeners connect (across playlists with a friend).
    sources = [k for k in mine.artists if node_id(k) in on_map]
    targets = list(theirs.artists) if has_friend else sources
    for a in sources:
        for b in targets:
            if a != b and node_id(b) in on_map and close(a, b):
                link(node_id(a), node_id(b), api.MapLinkKind.CO_LISTENED)

    # Songs: those on both playlists, then each person's from the artists that matter here.
    group_of = {n.id: n.group for n in nodes}

    def add_song(key: str, song: PlaylistTrack, group: api.MapGroup, theirs_: bool) -> None:
        lead = lead_of(song.artists[0])
        song_id = f"playlist/songs/{key}"
        reason = (
            api.MapReason(kind=api.ReasonKind.ON_BOTH)
            if group is api.MapGroup.SHARED
            else api.MapReason(kind=api.ReasonKind.ON_PLAYLIST, theirs=theirs_)
        )
        nodes.append(
            api.MapNode(
                id=song_id,
                kind=api.MapNodeKind.SONG,
                display_name=song.title or lead,
                subtitle=", ".join(song.artists),
                similarity=1.0,
                group=group,
                reasons=[reason],
            )
        )
        owner = node_id(normalize(lead))
        if owner in on_map:
            link(owner, song_id, api.MapLinkKind.CONTAINS)

    shared_songs = [k for k in mine.songs if k in theirs.songs]
    for key in shared_songs:
        add_song(key, mine.songs[key], api.MapGroup.SHARED, theirs_=False)
    flagged = {api.MapGroup.FOR_ME, api.MapGroup.FOR_THEM}

    def songs_of(shelf: Shelf) -> list[tuple[str, PlaylistTrack]]:
        rows = [(k, s) for k, s in shelf.songs.items() if k not in set(shared_songs)]
        rows.sort(
            key=lambda kv: (
                group_of.get(node_id(normalize(lead_of(kv[1].artists[0])))) not in flagged
            )
        )
        return rows[:SHOWN_SONGS]

    for key, song in songs_of(mine):
        owner = group_of.get(node_id(normalize(lead_of(song.artists[0]))))
        add_song(
            key,
            song,
            api.MapGroup.FOR_THEM if owner is api.MapGroup.FOR_THEM else api.MapGroup.MINE,
            theirs_=False,
        )
    if has_friend:
        for key, song in songs_of(theirs):
            owner = group_of.get(node_id(normalize(lead_of(song.artists[0]))))
            add_song(
                key,
                song,
                api.MapGroup.FOR_ME if owner is api.MapGroup.FOR_ME else api.MapGroup.THEIRS,
                theirs_=True,
            )

    # New to both: catalog artists listeners connect to what is on the playlists.
    on_playlists = {
        inputs.catalog_ids[k] for k in [*mine.artists, *theirs.artists] if k in inputs.catalog_ids
    }
    candidates: dict[str, tuple[list[str], list[str]]] = {}
    for source, similar in inputs.similar_to.items():
        in_mine, in_theirs = mine.artists.get(source), theirs.artists.get(source)
        for cid in similar:
            if cid in on_playlists or cid in by_id or cid not in graph.nodes:
                continue
            m_names, t_names = candidates.setdefault(cid, ([], []))
            if in_mine:
                m_names.append(in_mine.name)
            if in_theirs:
                t_names.append(in_theirs.name)

    def new_rank(item: tuple[str, tuple[list[str], list[str]]]) -> tuple[int, int, str]:
        _, (m_names, t_names) = item
        both = int(has_friend and bool(m_names) and bool(t_names))
        return (-both, -(len(m_names) + len(t_names)), graph.nodes[item[0]].name)

    for cid, (m_names, t_names) in sorted(candidates.items(), key=new_rank)[:SHOWN_NEW]:
        nodes.append(
            _artist_node(
                graph,
                cid,
                similarity=1.0,
                group=api.MapGroup.NEW,
                weight=len(m_names) + len(t_names),
                reasons=[
                    api.MapReason(
                        kind=api.ReasonKind.NEW_TO_YOU,
                        artists=_names(m_names),
                        other_artists=_names(t_names),
                    )
                ],
            )
        )
        firsts = [*m_names[:1], *t_names[:1], *m_names, *t_names]
        for name in list(dict.fromkeys(firsts))[:RECOMMENDED_LINKS]:
            source_id = node_id(normalize(name))
            if source_id in on_map:
                link(source_id, f"artists/{cid}", api.MapLinkKind.RECOMMENDED)

    return api.TasteMap(
        nodes=nodes,
        links=list(links.values()),
        stats=api.TasteStats(
            mine_songs=len(mine.songs),
            mine_artists=len(mine.artists),
            friend_songs=len(theirs.songs),
            friend_artists=len(theirs.artists),
            shared_artists=len(shared),
            shared_songs=len(shared_songs),
        ),
        sources=[],
    )


def taste_map(
    session: Session,
    model: ReadModel,
    mine: Sequence[PlaylistTrack],
    friend: Sequence[PlaylistTrack] | None,
) -> api.TasteMap:
    """Builds a playlist map: names matched to the catalog, co-listening from the catalog."""
    graph = model.graph
    my_shelf = shelf_of(mine, graph)
    friend_shelf = shelf_of(friend, graph) if friend is not None else None
    keys = list(
        dict.fromkeys(
            [*_top_keys(my_shelf, ARTISTS_TO_CHECK)]
            + (_top_keys(friend_shelf, ARTISTS_TO_CHECK) if friend_shelf else [])
        )
    )
    all_keys = list(
        dict.fromkeys([*my_shelf.artists, *(friend_shelf.artists if friend_shelf else {})])
    )

    def name_of(key: str) -> str:
        entry = my_shelf.artists.get(key) or (
            friend_shelf.artists.get(key) if friend_shelf else None
        )
        return entry.name if entry else key

    resolutions = model.resolutions.resolve(model.search, [name_of(k) for k in all_keys])
    catalog_ids = {
        key: r.entity_id
        for key, r in zip(all_keys, resolutions, strict=True)
        if r.decision is Decision.MATCHED and r.entity_id and r.entity_id in graph.nodes
    }
    checked = [k for k in keys if k in catalog_ids]
    rows = repo.colistening(session, [catalog_ids[k] for k in checked], SIMILAR_DEPTH)
    similar_to = {k: [other for other, _ in rows[catalog_ids[k]]] for k in checked}
    result = build_taste_map(graph, TasteInputs(my_shelf, friend_shelf, catalog_ids, similar_to))
    status = api.MapSourceStatus.OK if any(similar_to.values()) else api.MapSourceStatus.NO_MATCH
    return result.model_copy(update={"sources": [_source(status)]})
