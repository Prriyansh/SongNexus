"""CompareRecordingSound: how two songs compare in sound and lyrics (the song_compare service).

``GET /v1/recordings/{recording}:compareSound?other=recordings/{id}`` matches both songs in the
song_compare dataset by title and first primary artist, and returns its explained comparison and
songs that sound like each. It never fails because the service is missing or asleep: the status
says UNAVAILABLE and the rest of the song comparison still shows. See ``service.sound``.
"""

from __future__ import annotations

import threading
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from songnexus.service import schemas_sound as api
from songnexus.service.deps import Viewer, app_state, parse_name, rate_limited, read_model, viewer
from songnexus.service.errors import invalid_argument, not_found
from songnexus.service.ratelimit import MethodClass
from songnexus.service.readmodel import ReadModel
from songnexus.service.routes.common import db_session, set_cache_control
from songnexus.service.sound import SongName, SoundCompareClient
from songnexus.storage import catalog_repository as repo

router = APIRouter(
    prefix="/v1", tags=["catalog"], dependencies=[Depends(rate_limited(MethodClass.ANALYZE))]
)

_LOCK = threading.Lock()


def sound_client(request: Request) -> SoundCompareClient:
    """The process's song_compare client, built on first use (tests may preset one)."""
    existing: SoundCompareClient | None = getattr(request.app.state, "sound_client", None)
    if existing is not None:
        return existing
    with _LOCK:
        existing = getattr(request.app.state, "sound_client", None)
        if existing is None:
            state = app_state(request)
            existing = SoundCompareClient(
                state.settings.song_compare_url,
                timeout_s=state.settings.song_compare_timeout_s,
                http=state.outbound_http,
            )
            request.app.state.sound_client = existing
    return existing


def _song(model: ReadModel, session: Session, recording_id: str, who: Viewer) -> SongName:
    details = repo.recording_details(session, recording_id)
    if details is None:
        raise not_found(f"recordings/{recording_id}", reason="RECORDING_NOT_FOUND")
    primaries = [
        c.artist_id
        for c in details.credits
        if c.role == "primary"
        and c.artist_id in model.graph.nodes
        and c.artist_id not in who.blocked
    ]
    artist = model.graph.nodes[primaries[0]].name if primaries else ""
    return SongName(recording=f"recordings/{recording_id}", title=details.title, artist=artist)


@router.get(
    "/recordings/{recording:rid}:compareSound",
    response_model=api.CompareSoundResponse,
    summary="CompareRecordingSound",
)
def compare_recording_sound(
    request: Request,
    recording: str,
    model: Annotated[ReadModel, Depends(read_model)],
    who: Annotated[Viewer, Depends(viewer)],
    session: Annotated[Session, Depends(db_session, scope="function")],
    client: Annotated[SoundCompareClient, Depends(sound_client)],
    response: Response,
    other: Annotated[str, Query(description="Resource name of the recording to compare with.")],
) -> api.CompareSoundResponse:
    """Compares two songs' sound and lyrics, from the song_compare dataset.

    Each song is matched to the dataset by title and first primary artist; a song it lacks is
    listed in `missing` (NOT_FOUND). The similarity blends sound and lyrics and comes with
    plain-language reasons. Similar songs link to our catalog only when matched unambiguously.
    """
    a_id = parse_name(recording, "recordings", field="name")
    b_id = parse_name(other, "recordings", field="other")
    if a_id == b_id:
        raise invalid_argument("Pick two different songs.", field="other", reason="SAME_RECORDING")
    a, b = _song(model, session, a_id, who), _song(model, session, b_id, who)
    result = client.compare(model, a, b)
    if result.status is api.SoundStatus.UNAVAILABLE:
        response.headers["Cache-Control"] = "no-store"
    else:
        set_cache_control(response, who)
    return result
