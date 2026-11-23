"""CompareOnLastFm: ``GET /v1/artists/{artist}:compareOnLastFm?other=artists/{id}``.

Both artists' Last.fm listeners and plays, and the artists Last.fm lists as similar to both,
looked up by MusicBrainz ID. Without a Last.fm key the status is NO_KEY and the rest of the
comparison still shows. See ``service.lastfm_insights``.
"""

from __future__ import annotations

import threading
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from songnexus.core import ids
from songnexus.service import lastfm_insights as lastfm
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
from songnexus.service.errors import invalid_argument, not_found
from songnexus.service.ratelimit import MethodClass
from songnexus.service.readmodel import ReadModel
from songnexus.service.routes.common import db_session, set_cache_control
from songnexus.storage import maps_repository as repo

router = APIRouter(
    prefix="/v1", tags=["catalog"], dependencies=[Depends(rate_limited(MethodClass.ANALYZE))]
)
_LOCK = threading.Lock()
SIMILAR_SHOWN = 12


def lastfm_client(request: Request) -> lastfm.LastFmClient:
    """The process's Last.fm client (tests may preset one)."""
    existing: lastfm.LastFmClient | None = getattr(request.app.state, "lastfm", None)
    if existing is not None:
        return existing
    with _LOCK:
        existing = getattr(request.app.state, "lastfm", None)
        if existing is None:
            state = app_state(request)
            existing = lastfm.LastFmClient(
                api_key=state.settings.lastfm_api_key, http=state.outbound_http
            )
            request.app.state.lastfm = existing
    return existing


def _audience(found: lastfm.Audience | None) -> api.LastFmAudience | None:
    return (
        None
        if found is None
        else api.LastFmAudience(listeners=found.listeners, plays=found.plays, url=found.url)
    )


@router.get(
    "/artists/{artist:rid}:compareOnLastFm",
    response_model=api.CompareOnLastFm,
    summary="CompareOnLastFm",
)
def compare_on_lastfm(
    artist: str,
    other: Annotated[str, Query(description="Resource name of the artist to compare with.")],
    model: Annotated[ReadModel, Depends(read_model)],
    who: Annotated[Viewer, Depends(viewer)],
    session: Annotated[Session, Depends(db_session, scope="function")],
    client: Annotated[lastfm.LastFmClient, Depends(lastfm_client)],
    response: Response,
) -> api.CompareOnLastFm:
    """Both artists on Last.fm: listeners, plays, and artists similar to both."""
    a = parse_name(artist, "artists", field="name")
    b = parse_name(other, "artists", field="other")
    if a == b:
        raise invalid_argument("Pick two different artists.", field="other", reason="SAME_ARTIST")
    for x in (a, b):
        require_artist(model.graph, x)
        if x in who.blocked:
            raise not_found(f"artists/{x}", reason="ARTIST_NOT_FOUND")
    if not client.configured:
        response.headers["Cache-Control"] = "no-store"
        return api.CompareOnLastFm(status=api.LastFmStatus.NO_KEY)
    mbids = repo.musicbrainz_ids(session, "artist", [a, b])
    if a not in mbids or b not in mbids:
        set_cache_control(response, who)
        return api.CompareOnLastFm(status=api.LastFmStatus.OK)
    try:
        audience_a, audience_b = client.audience(mbids[a]), client.audience(mbids[b])
        both = lastfm.similar_to_both(client.similar(mbids[a]), client.similar(mbids[b]))
    except lastfm.LastFmUnavailableError:
        response.headers["Cache-Control"] = "no-store"
        return api.CompareOnLastFm(status=api.LastFmStatus.UNAVAILABLE)
    similar = []
    for s in both[:SIMILAR_SHOWN]:
        catalog_id = ids.artist_id(s.mbid) if s.mbid else None
        in_catalog = catalog_id in model.graph.nodes and catalog_id not in who.blocked
        if catalog_id in who.blocked:
            continue
        similar.append(
            api.LastFmSimilar(
                display_name=s.name,
                url=s.url,
                artist=f"artists/{catalog_id}" if in_catalog else None,
            )
        )
    set_cache_control(response, who)
    return api.CompareOnLastFm(
        status=api.LastFmStatus.OK,
        audience_a=_audience(audience_a),
        audience_b=_audience(audience_b),
        similar_to_both=similar,
    )
