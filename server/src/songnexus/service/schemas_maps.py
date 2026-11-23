"""Schemas for the similar-music maps, playlist maps and playlist rooms.

A map puts something in the middle and places everything else by how similar it is. Similarity
comes from listening data (ListenBrainz: what people play in the same sessions), so every node
says why it is there; the client words the reasons. Distances are relative to the closest match
on the map, never an absolute score.
"""

from __future__ import annotations

import enum
from datetime import datetime

from pydantic import Field

from songnexus.service.schemas import ApiModel, PlaylistTrack

MAX_TASTE_TRACKS = 250
MAX_MEMBER_NAME = 30


class MapNodeKind(enum.StrEnum):
    """What a node is."""

    ARTIST = "ARTIST"
    SONG = "SONG"


class MapGroup(enum.StrEnum):
    """Where a node belongs on the map (playlist maps color by it)."""

    CENTER = "CENTER"
    SIMILAR = "SIMILAR"
    # Playlist maps: on your playlist, the friend's, both, or neither.
    MINE = "MINE"
    THEIRS = "THEIRS"
    SHARED = "SHARED"
    # On one playlist, and close to what the other person plays.
    FOR_ME = "FOR_ME"
    FOR_THEM = "FOR_THEM"
    # On neither playlist; listening data connects it to what is on them.
    NEW = "NEW"


class ReasonKind(enum.StrEnum):
    """Why a node is on the map. The client words each kind; the fields carry the facts."""

    # People who play `artists[0]` often play this in the same listening sessions.
    CO_LISTENED = "CO_LISTENED"
    # Both carry `genres` in the catalog.
    SHARED_GENRES = "SHARED_GENRES"
    # A calculated sound match with the center song (`score`, 0–1), from the sound service.
    SOUND_MATCH = "SOUND_MATCH"
    # On your playlist (`count` songs) or the friend's (`theirs` true).
    ON_PLAYLIST = "ON_PLAYLIST"
    # On both playlists: `count` of yours, `otherCount` of theirs.
    ON_BOTH = "ON_BOTH"
    # On one playlist and played by people who play `artists` from the other.
    CLOSE_TO_OTHER = "CLOSE_TO_OTHER"
    # On neither: people who play `artists` (yours) and `otherArtists` (theirs) play it too.
    NEW_TO_YOU = "NEW_TO_YOU"


class MapReason(ApiModel):
    """One reason a node is on the map."""

    kind: ReasonKind
    artists: list[str] = Field(default_factory=list, description="Display names.")
    other_artists: list[str] = Field(default_factory=list, description="Display names.")
    genres: list[str] = Field(default_factory=list, description="Genre display names.")
    count: int | None = None
    other_count: int | None = None
    theirs: bool = False
    score: float | None = None
    source_url: str | None = None


class MapNode(ApiModel):
    """An artist or a song on a map."""

    id: str = Field(description="Unique on the map: a resource name or a map-local key.")
    kind: MapNodeKind
    display_name: str
    subtitle: str = Field(default="", description="For songs, the credited artists.")
    artist: str | None = Field(default=None, description="`artists/{artist}` when in the catalog.")
    recording: str | None = Field(
        default=None, description="`recordings/{recording}` when in the catalog."
    )
    image_url: str | None = None
    similarity: float = Field(
        description="0–1, relative to the closest match on this map (1 for the center)."
    )
    group: MapGroup = MapGroup.SIMILAR
    weight: float = Field(default=1.0, description="Songs on the playlists, for playlist maps.")
    listeners: int | None = Field(default=None, description="ListenBrainz listeners, if known.")
    reasons: list[MapReason] = Field(default_factory=list)
    source_url: str | None = Field(default=None, description="Where the node itself is listed.")


class MapLinkKind(enum.StrEnum):
    """What a line between two nodes means. Never a credit."""

    SIMILAR = "SIMILAR"  # to the center, as close as the node's similarity
    CO_LISTENED = "CO_LISTENED"  # two nodes listeners connect
    PERFORMED = "PERFORMED"  # an artist and their song
    CONTAINS = "CONTAINS"  # an artist and a playlist song by them
    RECOMMENDED = "RECOMMENDED"  # a playlist artist and a new artist it leads to


class MapLink(ApiModel):
    """A line between two nodes."""

    a: str
    b: str
    kind: MapLinkKind
    strength: float = 1.0


class MapSourceStatus(enum.StrEnum):
    """What happened when a map asked a source."""

    OK = "OK"
    PARTIAL = "PARTIAL"
    NO_MATCH = "NO_MATCH"
    UNAVAILABLE = "UNAVAILABLE"


class MapSource(ApiModel):
    """A source a map used, and how that went."""

    source: str = Field(description="A data-source ID (see ListDataSources).")
    status: MapSourceStatus


class SimilarMap(ApiModel):
    """Similar artists and songs around an artist or a song."""

    center: MapNode
    nodes: list[MapNode]
    links: list[MapLink]
    sources: list[MapSource]


class TasteMapRequest(ApiModel):
    """One playlist, or two to compare. Parsed on the device; nothing is stored."""

    mine: list[PlaylistTrack] = Field(min_length=1, max_length=MAX_TASTE_TRACKS)
    friend: list[PlaylistTrack] | None = Field(default=None, max_length=MAX_TASTE_TRACKS)
    friend_name: str = Field(default="", max_length=MAX_MEMBER_NAME)


class TasteStats(ApiModel):
    """What the playlists hold."""

    mine_songs: int
    mine_artists: int
    friend_songs: int
    friend_artists: int
    shared_artists: int
    shared_songs: int


class TasteMap(ApiModel):
    """A map of one or two playlists: what each holds, what they share, what to try."""

    nodes: list[MapNode]
    links: list[MapLink]
    stats: TasteStats
    sources: list[MapSource]


class RoomMember(ApiModel):
    """One person's side of a room: a first name and a playlist."""

    display_name: str = Field(default="", max_length=MAX_MEMBER_NAME)
    tracks: list[PlaylistTrack] = Field(min_length=1, max_length=MAX_TASTE_TRACKS)


class TasteRoom(ApiModel):
    """Two playlists joined by a short code. Rooms are deleted a week after they open."""

    code: str = Field(description="Six characters, no 0/O or 1/I/L.")
    host: RoomMember
    guest: RoomMember | None = None
    expire_time: datetime
