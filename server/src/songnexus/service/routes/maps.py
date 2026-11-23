"""Similar-music maps, playlist maps and playlist rooms (the Connection Web's map modes).

* ``GET /v1/artists/{artist}:similar`` and ``GET /v1/recordings/{recording}:similar``: what
  listeners play with an artist or a song, placed by how similar it is (``service.maps``).
* ``POST /v1/tasteMaps``: one playlist, or two to compare, on one map. Nothing is stored.
* ``POST /v1/tasteRooms``, ``GET /v1/tasteRooms/{code}``, ``POST /v1/tasteRooms/{code}:join``:
  a friend joins with a six-character code; the room keeps both playlists for a week.

Artists the viewer blocked never appear.
"""

from __future__ import annotations

import threading
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from songnexus.service import maps
from songnexus.service import schemas_maps as api
from songnexus.service.deps import (
    Viewer,
    app_state,
    parse_name,
    rate_limited,
    read_model,
    require_artist,
    viewer,
)
from songnexus.service.errors import ApiError, Status, invalid_argument, not_found
from songnexus.service.ratelimit import MethodClass
from songnexus.service.readmodel import ReadModel
from songnexus.service.routes.common import db_session, set_cache_control
from songnexus.service.schemas import PlaylistTrack
from songnexus.storage import catalog_repository as catalog
from songnexus.storage import taste_rooms as rooms

router = APIRouter(
    prefix="/v1", tags=["maps"], dependencies=[Depends(rate_limited(MethodClass.ANALYZE))]
)

ReadModelDep = Annotated[ReadModel, Depends(read_model)]
ViewerDep = Annotated[Viewer, Depends(viewer)]
SessionDep = Annotated[Session, Depends(db_session, scope="function")]
_LOCK = threading.Lock()


def recordings_client(request: Request) -> maps.SimilarRecordingsClient:
    """The process's ListenBrainz similar-recordings client (tests may preset one)."""
    existing: maps.SimilarRecordingsClient | None = getattr(
        request.app.state, "similar_recordings", None
    )
    if existing is not None:
        return existing
    with _LOCK:
        existing = getattr(request.app.state, "similar_recordings", None)
        if existing is None:
            existing = maps.SimilarRecordingsClient(http=app_state(request).outbound_http)
            request.app.state.similar_recordings = existing
    return existing


ClientDep = Annotated[maps.SimilarRecordingsClient, Depends(recordings_client)]


def _without_blocked(result: api.SimilarMap, who: Viewer) -> api.SimilarMap:
    if not who.blocked:
        return result
    hidden = {f"artists/{a}" for a in who.blocked}
    nodes = [n for n in result.nodes if n.artist not in hidden]
    kept = {n.id for n in nodes} | {result.center.id}
    links = [link for link in result.links if link.a in kept and link.b in kept]
    return result.model_copy(update={"nodes": nodes, "links": links})


@router.get(
    "/artists/{artist:rid}:similar", response_model=api.SimilarMap, summary="GetSimilarToArtist"
)
def similar_to_artist(
    artist: str,
    model: ReadModelDep,
    who: ViewerDep,
    session: SessionDep,
    client: ClientDep,
    response: Response,
) -> api.SimilarMap:
    """Artists and songs people play with this artist, placed by how similar they are."""
    artist_id = parse_name(artist, "artists", field="name")
    require_artist(model.graph, artist_id)
    if artist_id in who.blocked:
        raise not_found(f"artists/{artist_id}", reason="ARTIST_NOT_FOUND")
    result = _without_blocked(maps.artist_map(session, model, client, artist_id), who)
    _cache(response, who, result)
    return result


@router.get(
    "/recordings/{recording:rid}:similar",
    response_model=api.SimilarMap,
    summary="GetSimilarToRecording",
)
def similar_to_recording(
    recording: str,
    model: ReadModelDep,
    who: ViewerDep,
    session: SessionDep,
    client: ClientDep,
    response: Response,
) -> api.SimilarMap:
    """Songs people play with this song, and artists people play with its lead artist."""
    recording_id = parse_name(recording, "recordings", field="name")
    details = catalog.recording_details(session, recording_id)
    if details is None:
        raise not_found(f"recordings/{recording_id}", reason="RECORDING_NOT_FOUND")
    result = maps.song_map(session, model, client, recording_id, details.title)
    result = _without_blocked(result, who)
    _cache(response, who, result)
    return result


def _cache(response: Response, who: Viewer, result: api.SimilarMap) -> None:
    if any(
        s.status is not api.MapSourceStatus.OK
        for s in result.sources
        if s.status != api.MapSourceStatus.NO_MATCH
    ):
        response.headers["Cache-Control"] = "no-store"
    else:
        set_cache_control(response, who)


def _strip_blocked(tracks: list[PlaylistTrack], who: Viewer) -> list[PlaylistTrack]:
    hidden = {f"artists/{a}" for a in who.blocked}
    return [t for t in tracks if t.artists[0] not in hidden]


@router.post("/tasteMaps", response_model=api.TasteMap, summary="CreateTasteMap")
def create_taste_map(
    body: api.TasteMapRequest,
    model: ReadModelDep,
    who: ViewerDep,
    session: SessionDep,
    response: Response,
) -> api.TasteMap:
    """Maps one playlist, or two: what each holds, what both share, and what to try next.

    Receives track titles and artist names only (files are parsed on the device) and stores
    nothing. Artists are matched to the catalog by exact name, as in AnalyzePlaylist.
    """
    response.headers["Cache-Control"] = "no-store"
    mine = _strip_blocked(body.mine, who)
    if not mine:
        raise invalid_argument("The playlist has no artists to map.", field="mine")
    friend = _strip_blocked(body.friend, who) if body.friend is not None else None
    result = maps.taste_map(session, model, mine, friend)
    hidden = {f"artists/{a}" for a in who.blocked}
    nodes = [n for n in result.nodes if n.artist not in hidden]
    return result.model_copy(update={"nodes": nodes})


def _member(row: rooms.Member) -> api.RoomMember:
    return api.RoomMember(
        display_name=row.name, tracks=[PlaylistTrack.model_validate(t) for t in row.tracks]
    )


def _room(room: rooms.Room) -> api.TasteRoom:
    return api.TasteRoom(
        code=room.code,
        host=_member(room.host),
        guest=_member(room.guest) if room.guest else None,
        expire_time=room.expires_at
        if room.expires_at.tzinfo
        else room.expires_at.replace(tzinfo=UTC),
    )


def _stored(member: api.RoomMember) -> rooms.Member:
    return rooms.Member(
        member.display_name.strip(),
        [t.model_dump(mode="json", by_alias=True) for t in member.tracks],
    )


def _code(code: str) -> str:
    normalized = rooms.normalize_code(code)
    if not rooms.is_code(normalized):
        raise not_found(f"tasteRooms/{code}", reason="ROOM_NOT_FOUND")
    return normalized


@router.post("/tasteRooms", response_model=api.TasteRoom, summary="CreateTasteRoom")
def create_taste_room(
    body: api.RoomMember, session: SessionDep, response: Response
) -> api.TasteRoom:
    """Opens a room with your playlist; a friend joins with its code within a week."""
    response.headers["Cache-Control"] = "no-store"
    room = rooms.create_room(session, _stored(body), datetime.now(UTC))
    return _room(room)


@router.get("/tasteRooms/{code:rid}", response_model=api.TasteRoom, summary="GetTasteRoom")
def get_taste_room(code: str, session: SessionDep, response: Response) -> api.TasteRoom:
    """A room's playlists (anyone with the code can read it, as with a shared link)."""
    response.headers["Cache-Control"] = "no-store"
    room = rooms.read_room(session, _code(code), datetime.now(UTC))
    if room is None:
        raise not_found(f"tasteRooms/{code}", reason="ROOM_NOT_FOUND")
    return _room(room)


@router.post("/tasteRooms/{code:rid}:join", response_model=api.TasteRoom, summary="JoinTasteRoom")
def join_taste_room(
    code: str, body: api.RoomMember, session: SessionDep, response: Response
) -> api.TasteRoom:
    """Adds your playlist to a friend's room. A room holds two people."""
    response.headers["Cache-Control"] = "no-store"
    try:
        room = rooms.join_room(session, _code(code), _stored(body), datetime.now(UTC))
    except rooms.RoomFullError as error:
        raise ApiError(
            Status.ALREADY_EXISTS, "Someone already joined this room.", reason="ROOM_FULL"
        ) from error
    if room is None:
        raise not_found(f"tasteRooms/{code}", reason="ROOM_NOT_FOUND")
    return _room(room)
