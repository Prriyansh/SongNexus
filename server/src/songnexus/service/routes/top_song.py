"""GetTopRecording: an artist's most popular song in our catalog, ranked by Deezer.

``GET /v1/artists/{artist}:topRecording`` answers with the recording, NO_MATCH when Deezer has
no artist by exactly that name or none of their top songs is in our catalog, or UNAVAILABLE
when Deezer can't be asked. See ``service.top_song``.
"""

from __future__ import annotations

import enum
import threading
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from songnexus.service import top_song
from songnexus.service.deps import (
    Viewer,
    app_state,
    parse_name,
    rate_limited,
    read_model,
    require_artist,
    viewer,
)
from songnexus.service.errors import not_found
from songnexus.service.ratelimit import MethodClass
from songnexus.service.readmodel import ReadModel
from songnexus.service.routes.common import db_session, set_cache_control
from songnexus.service.schemas import ApiModel

router = APIRouter(
    prefix="/v1", tags=["catalog"], dependencies=[Depends(rate_limited(MethodClass.ANALYZE))]
)
_LOCK = threading.Lock()


class TopRecordingStatus(enum.StrEnum):
    """Whether a top song was found."""

    OK = "OK"
    NO_MATCH = "NO_MATCH"
    UNAVAILABLE = "UNAVAILABLE"


class TopRecording(ApiModel):
    """GetTopRecording: which song to open first. Deezer picks it; no Deezer numbers are shown."""

    status: TopRecordingStatus
    recording: str | None = None
    display_name: str | None = None
    source: str = "dataSources/deezer"


def top_song_client(request: Request) -> top_song.TopSongClient:
    """The process's Deezer client (tests may preset one)."""
    existing: top_song.TopSongClient | None = getattr(request.app.state, "top_song", None)
    if existing is not None:
        return existing
    with _LOCK:
        existing = getattr(request.app.state, "top_song", None)
        if existing is None:
            existing = top_song.TopSongClient(http=app_state(request).outbound_http)
            request.app.state.top_song = existing
    return existing


@router.get(
    "/artists/{artist:rid}:topRecording", response_model=TopRecording, summary="GetTopRecording"
)
def get_top_recording(
    artist: str,
    model: Annotated[ReadModel, Depends(read_model)],
    who: Annotated[Viewer, Depends(viewer)],
    session: Annotated[Session, Depends(db_session, scope="function")],
    client: Annotated[top_song.TopSongClient, Depends(top_song_client)],
    response: Response,
) -> TopRecording:
    """The artist's most popular song that our catalog has, by Deezer's ranking."""
    artist_id = parse_name(artist, "artists", field="name")
    require_artist(model.graph, artist_id)
    if artist_id in who.blocked:
        raise not_found(f"artists/{artist_id}", reason="ARTIST_NOT_FOUND")
    try:
        titles = client.top_titles(model.graph.nodes[artist_id].name)
    except top_song.DeezerUnavailableError:
        response.headers["Cache-Control"] = "no-store"
        return TopRecording(status=TopRecordingStatus.UNAVAILABLE)
    songs = top_song.lead_songs(session, artist_id)
    found = top_song.match_top(titles, songs)
    set_cache_control(response, who)
    if found is None:
        return TopRecording(status=TopRecordingStatus.NO_MATCH)
    title = next(t for rid, t in songs if rid == found)
    return TopRecording(
        status=TopRecordingStatus.OK, recording=f"recordings/{found}", display_name=title
    )
