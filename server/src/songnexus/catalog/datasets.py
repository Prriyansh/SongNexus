"""Downloads a published dataset file into the git-ignored raw cache (``fetch-*`` commands only).

The chart, list and contest datasets are read from their publishers' files, kept in
``data/raw/<source>/`` and downloaded again once the local copy is older than the publisher's
update cycle. Nothing here is committed: only the summaries a job derives reach the database.
"""

from __future__ import annotations

import time
from pathlib import Path

import httpx

from songnexus.catalog.wikidata.images import USER_AGENT

WEEK_S = 6 * 24 * 3600  # weekly publishers: a copy younger than six days is current
YEAR_S = 30 * 24 * 3600  # yearly releases: checked again after a month


def download(
    raw_dir: Path,
    url: str,
    *,
    refresh_after_s: float = WEEK_S,
    http: httpx.Client | None = None,
) -> Path:
    """The file at ``url`` as a local copy named after it, fetched again once it is stale."""
    target = raw_dir / url.rsplit("/", 1)[-1]
    if target.exists() and time.time() - target.stat().st_mtime < refresh_after_s:
        return target
    raw_dir.mkdir(parents=True, exist_ok=True)
    client = http or httpx.Client(timeout=httpx.Timeout(120.0, connect=15.0), follow_redirects=True)
    with client:
        response = client.get(url, headers={"User-Agent": USER_AGENT})
        response.raise_for_status()
    partial = target.with_suffix(".partial")
    partial.write_bytes(response.content)
    partial.replace(target)
    return target
