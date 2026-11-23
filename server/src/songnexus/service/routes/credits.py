"""ListMoreCredits: people credited on both artists' work by Discogs and Genius (live).

``GET /v1/artists/{artist}:moreCredits?other=artists/{id}`` complements the catalog's
MusicBrainz connections with credits those two sources hold. It never fails because a source
is missing, slow or down: each source's check says what happened. See ``service.more_credits``.
"""

from __future__ import annotations

import threading
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from songnexus.service import convert
from songnexus.service import schemas as api
from songnexus.service.deps import app_state, parse_name, rate_limited, read_model, require_artist
from songnexus.service.errors import invalid_argument
from songnexus.service.more_credits import Check, CreditSources, Pair, Work, more_credits
from songnexus.service.ratelimit import MethodClass
from songnexus.service.readmodel import ReadModel
from songnexus.service.routes.common import db_session
from songnexus.storage import catalog_repository as repo

router = APIRouter(
    prefix="/v1", tags=["analysis"], dependencies=[Depends(rate_limited(MethodClass.ANALYZE))]
)

_LOCK = threading.Lock()
_UNITS = {"discogs": "releases", "genius": "songs"}


def credit_sources(request: Request) -> CreditSources:
    """The process's Discogs and Genius reader, built on first use (tests may preset one)."""
    existing: CreditSources | None = getattr(request.app.state, "credit_sources", None)
    if existing is not None:
        return existing
    with _LOCK:
        existing = getattr(request.app.state, "credit_sources", None)
        if existing is None:
            state = app_state(request)
            settings = state.settings
            existing = CreditSources(
                http=state.outbound_http,
                discogs_token=settings.discogs_token,
                genius_token=settings.genius_access_token,
                budget_s=settings.more_credits_budget_s,
            )
            request.app.state.credit_sources = existing
    return existing


def _work(work: Work) -> api.CreditWork:
    return api.CreditWork(title=work.title, url=work.url, year=work.year)


@router.get(
    "/artists/{artist:rid}:moreCredits",
    response_model=api.ListMoreCreditsResponse,
    summary="ListMoreCredits",
)
def list_more_credits(
    artist: str,
    model: Annotated[ReadModel, Depends(read_model)],
    session: Annotated[Session, Depends(db_session, scope="function")],
    sources: Annotated[CreditSources, Depends(credit_sources)],
    response: Response,
    other: Annotated[str, Query(description="Resource name of the artist to compare with.")],
) -> api.ListMoreCreditsResponse:
    """Lists people Discogs and Genius credit on both artists' work, with the evidence.

    Discogs is reached through the Discogs ID the catalog maps to each artist; Genius by an
    exact name match. People are compared within one source by its own IDs. A person links to
    a catalog artist only through that exact Discogs ID.
    """
    a = parse_name(artist, "artists", field="name")
    b = parse_name(other, "artists", field="other")
    if a == b:
        raise invalid_argument("Pick two different artists.", field="other", reason="SAME_ARTIST")
    graph = model.graph
    require_artist(graph, a)
    require_artist(graph, b)
    discogs = repo.discogs_ids(session, [a, b])
    results = more_credits(
        sources,
        Pair(
            graph.nodes[a].name,
            graph.nodes[b].name,
            discogs.get(a),
            discogs.get(b),
            frozenset(repo.album_titles(session, a)),
            frozenset(repo.album_titles(session, b)),
        ),
    )
    discogs_people = [s.person_id for r in results if r.source == "discogs" for s in r.shared]
    catalog = repo.artists_by_discogs_ids(session, discogs_people)
    collaborators = [
        api.SourcedCollaborator(
            source=f"dataSources/{s.source}",
            display_name=s.name,
            url=s.url,
            artist=convert.artist_summary(graph, catalog[s.person_id])
            if s.source == "discogs" and catalog.get(s.person_id) in graph.nodes
            else None,
            roles_a=list(s.roles_a),
            roles_b=list(s.roles_b),
            evidence_a=[_work(w) for w in s.evidence_a],
            evidence_b=[_work(w) for w in s.evidence_b],
        )
        for r in results
        for s in r.shared
    ]
    settled = all(r.status not in (Check.FAILED, Check.PARTIAL) for r in results)
    response.headers["Cache-Control"] = "public, max-age=3600" if settled else "no-store"
    return api.ListMoreCreditsResponse(
        collaborators=collaborators,
        direct=[_work(w) for r in results for w in r.direct],
        checks=[
            api.CreditSourceCheck(
                source=f"dataSources/{r.source}",
                status=api.CreditSourceStatus(r.status),
                scanned_a=r.scanned_a,
                scanned_b=r.scanned_b,
                unit=_UNITS[r.source],
            )
            for r in results
        ],
    )
