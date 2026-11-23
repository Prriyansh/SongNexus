"""Album covers from the Cover Art Archive (``songnexus fetch-covers``).

The catalog's releases are MusicBrainz release groups, and the archive answers by release group
(``/release-group/{mbid}``) with the front cover of a representative release. The images stay
their rights holders': the app hot-links the archive's thumbnails and links its page, and copies
nothing. A release group without a cover is a 404, which means "none", not a failure.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import Engine

from songnexus.catalog.http import PoliteClient, SourceRequestError
from songnexus.catalog.wikidata.images import USER_AGENT
from songnexus.storage.db import session_scope
from songnexus.storage.release_covers import (
    CoverRecord,
    release_ids_by_musicbrainz_id,
    write_covers,
)

log = logging.getLogger(__name__)

COVER_ART_URL = "https://coverartarchive.org"


class CoverArtError(SourceRequestError):
    """A Cover Art Archive request failed permanently (no cover is a 404)."""


class CoverArtClient(PoliteClient):
    """Calls the Cover Art Archive's JSON API."""

    error_type = CoverArtError

    def __init__(
        self,
        *,
        cache_dir: Path,
        base_url: str = COVER_ART_URL,
        min_interval_s: float = 0.25,
        http: httpx.Client | None = None,
    ) -> None:
        """Creates a client; it follows the archive's redirects, with the generic User-Agent."""
        super().__init__(
            source="cover-art-archive",
            base_url=base_url,
            cache_dir=cache_dir,
            min_interval_s=min_interval_s,
            max_retries=3,
            # The archive answers a release group by redirecting to a release's record.
            http=http
            or httpx.Client(
                timeout=httpx.Timeout(30.0, connect=10.0),
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
                follow_redirects=True,
            ),
        )


def _https(url: str) -> str:
    return "https://" + url.split("://", 1)[1] if url.startswith("http://") else url


def parse_cover(body: Mapping[str, Any], release_group_mbid: str) -> CoverRecord | None:
    """The front cover in an archive answer, or None when there is no usable one."""
    for image in body.get("images", []):
        if not image.get("front") or image.get("approved") is False:
            continue
        thumbs = image.get("thumbnails") or {}
        small = thumbs.get("250") or thumbs.get("small")
        large = thumbs.get("500") or thumbs.get("large") or small
        if isinstance(small, str) and isinstance(large, str):
            return CoverRecord(
                thumbnail_url=_https(small),
                large_url=_https(large),
                page_url=f"{COVER_ART_URL}/release-group/{release_group_mbid}",
            )
    return None


def fetch_cover(client: CoverArtClient, release_group_mbid: str) -> CoverRecord | None:
    """The release group's front cover, or None.

    Raises:
        CoverArtError: The archive failed in a way other than "no cover".
    """
    try:
        body = client.get("cover", f"release-group/{release_group_mbid}", {}).body
    except CoverArtError as error:
        if "-> 404" in str(error):
            return None
        raise
    return parse_cover(body, release_group_mbid)


def run_fetch_covers(
    engine: Engine,
    client: CoverArtClient,
    *,
    now: datetime,
    limit: int | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Fetches the front cover of catalog releases and stores them (unless ``dry_run``).

    Idempotent, like the other fetches; releases outside ``limit`` are untouched.

    Raises:
        SourceRequestError: A request failed permanently; nothing is written.
    """
    with session_scope(engine) as session:
        mapping = release_ids_by_musicbrainz_id(session)
    wanted = sorted(mapping.items())[:limit] if limit is not None else sorted(mapping.items())
    covers = {release_id: fetch_cover(client, mbid) for mbid, release_id in wanted}
    result: dict[str, Any] = {
        "dryRun": dry_run,
        "releasesConsidered": len(covers),
        "releasesWithCover": sum(c is not None for c in covers.values()),
    }
    if not dry_run:
        with session_scope(engine) as session:
            stats = write_covers(session, covers, now)
        result["written"] = {
            "inserted": stats.inserted,
            "updated": stats.updated,
            "unchanged": stats.unchanged,
            "deleted": stats.deleted,
        }
    result["networkRequests"] = client.network_requests
    result["cacheHits"] = client.cache_hits
    log.info("fetch-covers finished", extra=result)
    return result
